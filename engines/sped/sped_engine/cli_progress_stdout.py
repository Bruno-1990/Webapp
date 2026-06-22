"""Progresso para stdout em JSON (consumido pelo worker Node)."""
import json
import sys


class CliProgress:
    def __init__(self):
        self._total_global = 1
        self._current_global = 0

    def _emit(self, value: int, label: str = ""):
        msg = {"kind": "progress", "value": max(0, min(100, int(value)))}
        if label:
            msg["label"] = label
        print(json.dumps(msg), flush=True)

    def start(self, total_steps: int):
        self._total_global = max(1, total_steps)
        self._current_global = 0
        self._emit(2, "inicio")

    def tick_global(self, step_label=None):
        self._current_global += 1
        pct = 2 + min(90, int((self._current_global / self._total_global) * 88))
        self._emit(pct, step_label or "")

    def tick_local(self, current, total, step_label=None):
        pass

    def reset_local(self):
        pass

    def animate_local(self, step_label="Processando", duration_ms=2000, steps=50):
        self._emit(min(94, 70 + (hash(step_label) % 20)), step_label or "etapa")

    def close(self):
        pass
