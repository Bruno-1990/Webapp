"""Coloca `sped_engine/` no sys.path (os módulos do motor usam imports flat)."""
from __future__ import annotations

import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1] / "sped_engine"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))
