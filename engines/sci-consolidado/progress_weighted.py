# progress_weighted.py
# --------------------------------------------------------------------------------------
# Orquestrador de progresso por etapas (com pesos) + "shim" de compatibilidade
# para callbacks heterogêneas (msg/message/total/current/max/pulse).
#
# Principais métodos:
#   - goto(stage_name)            -> vai para a etapa e zera o progresso local
#   - advance_local(percent)      -> avança 0..100% dentro da etapa atual (com clamp)
#   - tick(done, total)           -> utilitário para progresso incremental
#   - complete_stage()            -> marca 100% da etapa atual
#   - excel_progress(*args, **k)  -> callback tolerante a vários formatos
#
# UI esperada (opcional; se ausente, é no-op seguro):
#   - update_total(percent)  # barra global 0..100
#   - update_current(percent)# barra da etapa 0..100
#   - set_message(msg)       # texto de status
#   - pulse_current(bool)    # modo indeterminado (pulsante) da barra da etapa
# --------------------------------------------------------------------------------------

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Callable, Any


@dataclass
class Stage:
    name: str
    weight: float  # peso relativo; não precisa somar exatamente 100


class WeightedProgress:
    """
    Orquestra o progresso global (0..100) a partir do progresso local das etapas.

    Design goals:
      - Tolerante a UI ausente ou incompleta (safe no-op).
      - Pesos não precisam somar 100; a classe normaliza internamente.
      - Callback compatível com várias assinaturas (msg/message/total/current/max/pulse).
      - Clamps (0..100) para evitar estouro visual.
    """

    # ----------------------------------------------------------------------------------
    # Construção
    # ----------------------------------------------------------------------------------
    def __init__(self, ui: Any = None, stages: Optional[List[Stage]] = None):
        self.ui = ui
        self._bind_ui(ui)
        self._on_stage_change: Optional[Callable[[str], None]] = None

        if not stages:
            stages = [Stage("Etapa", 100.0)]
        self.set_stages(stages)

        self.index = 0
        self._stage_local = 0.0
        # aplica 0% na barra logo de início (evita "lixo" visual)
        self._apply(0.0)

    # ----------------------------------------------------------------------------------
    # UI binding (no-ops seguros quando a UI não tem os métodos)
    # ----------------------------------------------------------------------------------
    def _bind_ui(self, ui: Any) -> None:
        self._ui_update_total: Callable[[float], None] = (
            getattr(ui, "update_total", lambda *_: None) if ui else (lambda *_: None)
        )
        self._ui_update_current: Callable[[float], None] = (
            getattr(ui, "update_current", lambda *_: None) if ui else (lambda *_: None)
        )
        self._ui_set_message: Callable[[str], None] = (
            getattr(ui, "set_message", lambda *_: None) if ui else (lambda *_: None)
        )
        self._ui_pulse_current: Callable[[bool], None] = (
            getattr(ui, "pulse_current", lambda *_: None) if ui else (lambda *_: None)
        )

    # API pública de UI (mantém nomes esperados pelo restante do app)
    def set_message(self, msg: str) -> None:
        self._ui_set_message(str(msg))

    def pulse_current(self, enabled: bool) -> None:
        self._ui_pulse_current(bool(enabled))

    # ----------------------------------------------------------------------------------
    # Estágios
    # ----------------------------------------------------------------------------------
    def set_stages(self, stages: List[Stage]) -> None:
        if not stages:
            raise ValueError("É necessário pelo menos uma etapa.")
        # evita pesos negativos e soma zero
        safe_stages: List[Stage] = []
        for s in stages:
            w = float(s.weight)
            if w < 0:
                w = 0.0
            safe_stages.append(Stage(s.name, w))

        self.stages = safe_stages
        self._total_weight = sum(s.weight for s in self.stages) or 1.0  # evita div/0

        # offsets acumulados em "unidade de peso" (não normalizada)
        self.offsets: List[float] = []
        acc = 0.0
        for s in self.stages:
            self.offsets.append(acc)
            acc += s.weight

    def on_stage_change(self, handler: Optional[Callable[[str], None]]) -> None:
        """Permite observar mudanças de etapa (opcional)."""
        self._on_stage_change = handler

    def goto(self, stage_name: str) -> None:
        for i, s in enumerate(self.stages):
            if s.name == stage_name:
                self.index = i
                self._stage_local = 0.0
                if self._on_stage_change:
                    try:
                        self._on_stage_change(s.name)
                    except Exception:
                        pass
                self._apply(0.0)
                return
        raise ValueError(f"Stage '{stage_name}' não encontrado.")

    # ----------------------------------------------------------------------------------
    # Progresso dentro da etapa
    # ----------------------------------------------------------------------------------
    def advance_local(self, local_percent: float) -> None:
        p = self._clamp_percent(local_percent)
        self._stage_local = p
        self._apply(p)

    def tick(self, done: int, total: int) -> None:
        if total and total > 0:
            self.advance_local((done / total) * 100.0)

    def complete_stage(self) -> None:
        self.advance_local(100.0)

    # ----------------------------------------------------------------------------------
    # Callback compatível com ExcelManager (e outros produtores de progresso)
    # ----------------------------------------------------------------------------------
    def excel_progress(self, *args, **kwargs) -> None:
        """
        Aceita formatos variados de callback:
          - on_progress(percent)
          - on_progress(percent, message)
          - on_progress(percent=..., message=...)
          - on_progress(msg="...", total=..., current=..., pulse=True/False)
          - on_progress(total=...)          # tratado como percentual 0..100
          - on_progress(current=..., max=...)  # convertido para percentual
          - on_progress(current=...)        # tratado como percentual 0..100
        """
        percent: Optional[float] = None
        message: Optional[str] = None

        # Posicionais
        if len(args) >= 1:
            percent = args[0]
        if len(args) >= 2:
            message = args[1]

        # Nomeados (aliases)
        if message is None:
            message = kwargs.get("message") or kwargs.get("msg") or kwargs.get("text")

        if percent is None:
            if "percent" in kwargs:
                percent = kwargs["percent"]
            elif "total" in kwargs:
                percent = kwargs["total"]
            elif "current" in kwargs and "max" in kwargs:
                try:
                    percent = (float(kwargs["current"]) / float(kwargs["max"])) * 100.0
                except Exception:
                    percent = None
            elif "value" in kwargs and "maximum" in kwargs:
                try:
                    percent = (float(kwargs["value"]) / float(kwargs["maximum"])) * 100.0
                except Exception:
                    percent = None
            elif "current" in kwargs:
                try:
                    percent = float(kwargs["current"])  # trata como % direto
                except Exception:
                    percent = None

        # pulso indeterminado (se enviado)
        if "pulse" in kwargs:
            try:
                self.pulse_current(bool(kwargs["pulse"]))
            except Exception:
                pass

        if message:
            self.set_message(message)

        if percent is not None:
            try:
                self.advance_local(float(percent))
            except Exception:
                pass

    # ----------------------------------------------------------------------------------
    # Internos
    # ----------------------------------------------------------------------------------
    def _apply(self, local_percent: float) -> None:
        """Converte o progresso local da etapa atual em progresso global normalizado (0..100)."""
        base_weight = self.offsets[self.index]
        stage_weight = self.stages[self.index].weight

        # contribuição local da etapa em "unidade de peso":
        local_weight = stage_weight * (self._clamp_percent(local_percent) / 100.0)

        # normaliza para 0..100
        global_percent = ((base_weight + local_weight) / self._total_weight) * 100.0

        # Atualiza UI (se houver)
        self._ui_update_total(self._clamp_percent(global_percent))
        self._ui_update_current(self._clamp_percent(local_percent))

    @staticmethod
    def _clamp_percent(value: float) -> float:
        try:
            v = float(value)
        except Exception:
            v = 0.0
        if v < 0.0:
            return 0.0
        if v > 100.0:
            return 100.0
        return v
