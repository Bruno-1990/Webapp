#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""XLSX (com _LINHA) + SPED .txt → SPED .txt mesclado."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from merger import merge_sped_from_xlsx


def main() -> int:
    p = argparse.ArgumentParser(description="Mescla alterações do XLSX no arquivo SPED original")
    p.add_argument("--sped", required=False, help="Arquivo SPED .txt original (opcional para planilha completa)")
    p.add_argument("--xlsx", required=True, help="Planilha gerada pela ferramenta SPED→XLSX (com coluna _LINHA)")
    p.add_argument("--output", required=True, help="Caminho do .txt de saída")
    args = p.parse_args()

    sped = Path(args.sped) if args.sped else None
    xlsx = Path(args.xlsx)
    out = Path(args.output)

    if sped is not None and not sped.is_file():
        print(json.dumps({"kind": "error", "message": f"SPED não encontrado: {sped}"}), flush=True)
        return 1
    if not xlsx.is_file():
        print(json.dumps({"kind": "error", "message": f"XLSX não encontrado: {xlsx}"}), flush=True)
        return 1

    try:
        print(json.dumps({"kind": "progress", "value": 5}), flush=True)
        merge_sped_from_xlsx(sped, xlsx, out)
        print(json.dumps({"kind": "progress", "value": 100}), flush=True)
        print(json.dumps({"kind": "done", "output": str(out.resolve())}), flush=True)
        return 0
    except Exception as e:
        print(json.dumps({"kind": "error", "message": str(e)}), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
