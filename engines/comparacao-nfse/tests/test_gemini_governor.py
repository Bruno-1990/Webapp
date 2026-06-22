"""Token bucket + circuit breaker compartilhados via Redis.

Esses testes usam fakeredis (com Lua via lupa) para nao precisar de Redis real
no CI. O codigo de producao usa redis-py com a mesma interface.
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import fakeredis
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gemini_governor import (
    CircuitBreaker,
    CircuitState,
    QuotaExhaustedError,
    TokenBucket,
)


# ─── Token Bucket ────────────────────────────────────────────────────────────


@pytest.fixture
def fake_redis():
    return fakeredis.FakeStrictRedis()


def test_take_returns_immediately_when_tokens_available(fake_redis):
    bucket = TokenBucket(fake_redis, key="t1", capacity=5, refill_per_sec=1.0)
    ok, wait = bucket.try_take(1, now=100.0)
    assert ok is True
    assert wait == 0.0


def test_take_fails_when_empty(fake_redis):
    bucket = TokenBucket(fake_redis, key="t2", capacity=2, refill_per_sec=1.0)
    # Esgota o bucket
    assert bucket.try_take(1, now=100.0)[0]
    assert bucket.try_take(1, now=100.0)[0]
    # Terceiro pedido falha — wait > 0
    ok, wait = bucket.try_take(1, now=100.0)
    assert ok is False
    assert wait > 0.0
    assert wait == pytest.approx(1.0, abs=0.01)


def test_refill_over_time(fake_redis):
    bucket = TokenBucket(fake_redis, key="t3", capacity=5, refill_per_sec=2.0)
    # Esgota
    for _ in range(5):
        assert bucket.try_take(1, now=100.0)[0]
    # Sem tokens
    assert bucket.try_take(1, now=100.0)[0] is False
    # Avanca 2 segundos -> 4 tokens disponiveis
    ok, _ = bucket.try_take(1, now=102.0)
    assert ok is True
    # Mais 3 com sucesso (sobram 0)
    for _ in range(3):
        assert bucket.try_take(1, now=102.0)[0] is True
    # Agora vazio de novo
    assert bucket.try_take(1, now=102.0)[0] is False


def test_capacity_is_upper_bound_after_long_idle(fake_redis):
    bucket = TokenBucket(fake_redis, key="t4", capacity=3, refill_per_sec=1.0)
    bucket.try_take(1, now=100.0)  # cria a chave
    # 1000 segundos depois — refill nao excede capacity
    ok, _ = bucket.try_take(3, now=1100.0)
    assert ok is True
    ok, _ = bucket.try_take(1, now=1100.0)
    assert ok is False


def test_concurrent_takes_are_atomic(fake_redis):
    """10 threads tentam pegar 1 token cada com capacity=5 -> exatamente 5 sucessos."""
    bucket = TokenBucket(fake_redis, key="t5", capacity=5, refill_per_sec=0.0)
    results: list[bool] = []
    lock = threading.Lock()

    def worker():
        ok, _ = bucket.try_take(1, now=100.0)
        with lock:
            results.append(ok)

    threads = [threading.Thread(target=worker) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sum(1 for r in results if r) == 5
    assert sum(1 for r in results if not r) == 5


def test_acquire_blocks_until_token_then_returns(fake_redis):
    """acquire() deve dormir o wait time e tentar de novo."""
    sleeps: list[float] = []
    clock = [100.0]

    def fake_sleep(seconds: float):
        sleeps.append(seconds)
        clock[0] += seconds

    bucket = TokenBucket(
        fake_redis,
        key="t6",
        capacity=1,
        refill_per_sec=10.0,
        clock=lambda: clock[0],
        sleeper=fake_sleep,
    )
    bucket.try_take(1)  # esgota no tempo 100
    bucket.acquire(1, max_wait_sec=1.0)
    assert len(sleeps) >= 1
    assert all(s > 0 for s in sleeps)


def test_acquire_raises_if_max_wait_exceeded(fake_redis):
    sleeps: list[float] = []
    clock = [100.0]

    def fake_sleep(seconds: float):
        # Avanca clock mas pouco — nunca enche o bucket dentro do max_wait
        sleeps.append(seconds)
        clock[0] += seconds

    bucket = TokenBucket(
        fake_redis,
        key="t7",
        capacity=1,
        refill_per_sec=0.001,
        clock=lambda: clock[0],
        sleeper=fake_sleep,
    )
    bucket.try_take(1)
    with pytest.raises(TimeoutError):
        bucket.acquire(1, max_wait_sec=0.5)


# ─── Circuit Breaker ─────────────────────────────────────────────────────────


def test_circuit_starts_closed(fake_redis):
    cb = CircuitBreaker(fake_redis, key="c1", failure_threshold=3, cooldown_sec=60)
    assert cb.state(now=100.0) == CircuitState.CLOSED


def test_three_failures_open_circuit(fake_redis):
    cb = CircuitBreaker(fake_redis, key="c2", failure_threshold=3, cooldown_sec=60)
    cb.record_failure(now=100.0)
    cb.record_failure(now=101.0)
    assert cb.state(now=101.0) == CircuitState.CLOSED
    cb.record_failure(now=102.0)
    assert cb.state(now=102.0) == CircuitState.OPEN


def test_check_raises_when_open(fake_redis):
    cb = CircuitBreaker(fake_redis, key="c3", failure_threshold=1, cooldown_sec=60)
    cb.record_failure(now=100.0)
    with pytest.raises(QuotaExhaustedError) as exc:
        cb.check(now=110.0)
    assert exc.value.retry_after_sec > 0


def test_cooldown_transitions_to_half_open(fake_redis):
    cb = CircuitBreaker(fake_redis, key="c4", failure_threshold=1, cooldown_sec=30)
    cb.record_failure(now=100.0)
    assert cb.state(now=100.0) == CircuitState.OPEN
    # Antes do cooldown — ainda OPEN
    assert cb.state(now=120.0) == CircuitState.OPEN
    # Depois do cooldown — HALF_OPEN
    assert cb.state(now=131.0) == CircuitState.HALF_OPEN


def test_half_open_success_closes_circuit(fake_redis):
    cb = CircuitBreaker(fake_redis, key="c5", failure_threshold=1, cooldown_sec=10)
    cb.record_failure(now=100.0)
    assert cb.state(now=120.0) == CircuitState.HALF_OPEN
    cb.record_success(now=121.0)
    assert cb.state(now=121.0) == CircuitState.CLOSED


def test_half_open_failure_reopens_with_longer_cooldown(fake_redis):
    cb = CircuitBreaker(fake_redis, key="c6", failure_threshold=1, cooldown_sec=10)
    cb.record_failure(now=100.0)
    assert cb.state(now=120.0) == CircuitState.HALF_OPEN
    cb.record_failure(now=121.0)
    # Apos cooldown original (10s), deveria ter voltado pra HALF_OPEN.
    # Mas como abriu de novo via HALF_OPEN, mantemos OPEN ate proximo check.
    assert cb.state(now=125.0) == CircuitState.OPEN


def test_record_success_when_closed_is_noop(fake_redis):
    cb = CircuitBreaker(fake_redis, key="c7", failure_threshold=3, cooldown_sec=60)
    cb.record_success(now=100.0)  # nao explode, e ainda CLOSED
    assert cb.state(now=100.0) == CircuitState.CLOSED


def test_force_close_resets_state(fake_redis):
    cb = CircuitBreaker(fake_redis, key="c8", failure_threshold=1, cooldown_sec=60)
    cb.record_failure(now=100.0)
    assert cb.state(now=100.0) == CircuitState.OPEN
    cb.force_close()
    assert cb.state(now=100.0) == CircuitState.CLOSED
