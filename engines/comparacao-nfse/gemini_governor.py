"""Rate limiter (token bucket) e circuit breaker compartilhados via Redis.

Permite que multiplos processos Python (workers paralelos) respeitem um RPM
global do Gemini sem se atropelarem. Estado vive no Redis — Lua scripts
garantem atomicidade nas operacoes de check/refill.

Uso tipico:

    >>> import redis
    >>> r = redis.Redis.from_url(os.environ["REDIS_URL"])
    >>> bucket = TokenBucket(r, "nfse:gemini:bucket", capacity=1500, refill_per_sec=25.0)
    >>> circuit = CircuitBreaker(r, "nfse:gemini:circuit", failure_threshold=3, cooldown_sec=300)
    >>>
    >>> circuit.check()  # raises QuotaExhaustedError se aberto
    >>> bucket.acquire(1, max_wait_sec=10.0)
    >>> # ... call gemini ...
    >>> circuit.record_success()  # ou circuit.record_failure() em 429
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from enum import Enum

# Tipo do client Redis intencionalmente nao anotado para aceitar redis.Redis e
# fakeredis.FakeStrictRedis sem dependencia obrigatoria de redis em testes.

# ─── TokenBucket ─────────────────────────────────────────────────────────────

# Algoritmo classico: bucket com capacity tokens, refill linear no tempo.
# Lua script garante read-modify-write atomico mesmo com varios clientes.
_TAKE_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'last')
local tokens = tonumber(data[1])
local last = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  last = now
end

local elapsed = math.max(0, now - last)
tokens = math.min(capacity, tokens + elapsed * refill)

-- Tolerancia para erros de ponto flutuante (ex.: 0 + 0.1 * 10 = 0.9999...).
local epsilon = 1e-9
if tokens + epsilon >= requested then
  tokens = math.max(0, tokens - requested)
  redis.call('HMSET', key, 'tokens', tokens, 'last', now)
  redis.call('EXPIRE', key, 3600)
  return {1, tostring(tokens), '0'}
else
  redis.call('HMSET', key, 'tokens', tokens, 'last', now)
  redis.call('EXPIRE', key, 3600)
  local wait
  if refill > 0 then
    wait = (requested - tokens) / refill
  else
    wait = -1
  end
  return {0, tostring(tokens), tostring(wait)}
end
"""


class TokenBucket:
    """Token bucket distribuido. Capacity tokens, refill linear (tokens/seg).

    `try_take` e nao-bloqueante; `acquire` aguarda o tempo necessario.
    """

    def __init__(
        self,
        redis_client,
        key: str,
        capacity: int,
        refill_per_sec: float,
        *,
        clock=None,
        sleeper=None,
    ):
        self._r = redis_client
        self._key = key
        self.capacity = capacity
        self.refill_per_sec = refill_per_sec
        self._sha = None  # cache opcional do EVALSHA (futuro)
        # Injetaveis para testes deterministicos
        self._clock = clock or time.time
        self._sleeper = sleeper or time.sleep

    def _now(self) -> float:
        return self._clock()

    def try_take(self, n: int = 1, *, now: float | None = None) -> tuple[bool, float]:
        """Tenta consumir `n` tokens. Retorna (ok, wait_sec).

        Se `ok` False, `wait_sec` indica quanto esperar para tentar de novo
        (ou -1 se refill==0 e sem tokens — nunca havera).
        """
        t = self._now() if now is None else now
        result = self._r.eval(
            _TAKE_LUA, 1, self._key, t, self.capacity, self.refill_per_sec, n
        )
        # fakeredis retorna list de bytes/str/int dependendo de versao
        ok = int(result[0]) == 1
        wait = float(result[2]) if not isinstance(result[2], (int, float)) else float(result[2])
        return ok, wait

    def acquire(self, n: int = 1, *, max_wait_sec: float = 10.0) -> None:
        """Bloqueia ate conseguir `n` tokens ou levanta TimeoutError.

        Em caso de bucket sem refill (refill_per_sec=0) e vazio, levanta
        imediatamente.
        """
        deadline = self._now() + max_wait_sec
        while True:
            ok, wait = self.try_take(n)
            if ok:
                return
            if wait < 0:
                raise TimeoutError("Token bucket sem refill e vazio")
            remaining = deadline - self._now()
            if remaining <= 0 or wait > remaining:
                raise TimeoutError(
                    f"Token bucket espera {wait:.2f}s > max_wait {max_wait_sec:.2f}s"
                )
            # Cap em 1s para nao dormir demais e responder a mudancas de refill
            self._sleeper(min(wait, 1.0))


# ─── CircuitBreaker ──────────────────────────────────────────────────────────


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


@dataclass
class QuotaExhaustedError(Exception):
    """Chamadas Gemini bloqueadas: circuit breaker aberto."""

    retry_after_sec: float
    reason: str = "Cota do Gemini esgotada (circuit breaker aberto)."

    def __str__(self) -> str:
        return f"{self.reason} retry_after={self.retry_after_sec:.0f}s"


# Campos no Redis hash:
#   state: 'closed' | 'open' | 'half_open'
#   failures: int (contagem desde ultimo close)
#   open_until: float (timestamp em que o circuit deve transicionar p/ HALF_OPEN)


class CircuitBreaker:
    """Circuit breaker compartilhado. Atomico via Lua para record_failure/check."""

    def __init__(
        self,
        redis_client,
        key: str,
        *,
        failure_threshold: int = 3,
        cooldown_sec: int = 300,
    ):
        self._r = redis_client
        self._key = key
        self.failure_threshold = failure_threshold
        self.cooldown_sec = cooldown_sec

    def _now(self) -> float:
        return time.time()

    def _read(self) -> tuple[CircuitState, int, float]:
        data = self._r.hmget(self._key, "state", "failures", "open_until")
        state_raw = data[0]
        if state_raw is None:
            return CircuitState.CLOSED, 0, 0.0
        state = CircuitState((state_raw.decode() if isinstance(state_raw, bytes) else state_raw))
        failures = int(data[1] or 0)
        open_until = float(data[2] or 0.0)
        return state, failures, open_until

    def state(self, *, now: float | None = None) -> CircuitState:
        t = self._now() if now is None else now
        state, _, open_until = self._read()
        if state == CircuitState.OPEN and t >= open_until:
            # Transicao soft para HALF_OPEN sem escrita (proximo record_*
            # consolida no Redis). Evita race entre leitores.
            self._r.hset(self._key, "state", CircuitState.HALF_OPEN.value)
            return CircuitState.HALF_OPEN
        return state

    def check(self, *, now: float | None = None) -> None:
        """Levanta QuotaExhaustedError se circuit estiver aberto."""
        t = self._now() if now is None else now
        s = self.state(now=t)
        if s == CircuitState.OPEN:
            _, _, open_until = self._read()
            wait = max(0.0, open_until - t)
            raise QuotaExhaustedError(retry_after_sec=wait)

    def record_failure(self, *, now: float | None = None) -> None:
        t = self._now() if now is None else now
        state, failures, _ = self._read()
        new_failures = failures + 1
        if state == CircuitState.HALF_OPEN:
            # Falha em half-open reabre imediatamente
            self._open(t)
            return
        if new_failures >= self.failure_threshold:
            self._open(t)
        else:
            self._r.hset(
                self._key,
                mapping={"state": CircuitState.CLOSED.value, "failures": str(new_failures)},
            )
            self._r.expire(self._key, max(3600, self.cooldown_sec * 2))

    def record_success(self, *, now: float | None = None) -> None:
        t = self._now() if now is None else now
        state = self.state(now=t)
        if state == CircuitState.HALF_OPEN or state == CircuitState.CLOSED:
            # Reset
            self._r.hset(
                self._key,
                mapping={
                    "state": CircuitState.CLOSED.value,
                    "failures": "0",
                    "open_until": "0",
                },
            )
            self._r.expire(self._key, 3600)

    def _open(self, now: float) -> None:
        open_until = now + self.cooldown_sec
        self._r.hset(
            self._key,
            mapping={
                "state": CircuitState.OPEN.value,
                "failures": str(self.failure_threshold),
                "open_until": str(open_until),
            },
        )
        self._r.expire(self._key, max(3600, self.cooldown_sec * 2))

    def force_close(self) -> None:
        """Override administrativo: fecha o circuit imediatamente."""
        self._r.hset(
            self._key,
            mapping={
                "state": CircuitState.CLOSED.value,
                "failures": "0",
                "open_until": "0",
            },
        )


# ─── Governor (wrapper) ──────────────────────────────────────────────────────


@dataclass
class GeminiGovernor:
    """Combo de TokenBucket + CircuitBreaker compartilhados.

    Uso:
        gov.guard()  # raises QuotaExhaustedError se circuit aberto, espera token
        try:
            resp = call_gemini(...)
            gov.report_success()
        except QuotaError:
            gov.report_failure()
            raise
    """

    bucket: TokenBucket
    circuit: CircuitBreaker
    max_wait_sec: float = 30.0

    def guard(self) -> None:
        """Verifica circuit e adquire token. Levanta QuotaExhaustedError se OPEN."""
        self.circuit.check()
        self.bucket.acquire(1, max_wait_sec=self.max_wait_sec)

    def report_success(self) -> None:
        self.circuit.record_success()

    def report_failure(self) -> None:
        self.circuit.record_failure()


def build_default_governor(redis_client, *, rpm: int = 1500, cooldown_sec: int = 300) -> GeminiGovernor:
    """Cria governor com chaves padrao do projeto NFS-e."""
    return GeminiGovernor(
        bucket=TokenBucket(
            redis_client,
            key="nfse:gemini:bucket",
            capacity=rpm,
            refill_per_sec=rpm / 60.0,
        ),
        circuit=CircuitBreaker(
            redis_client,
            key="nfse:gemini:circuit",
            failure_threshold=3,
            cooldown_sec=cooldown_sec,
        ),
    )
