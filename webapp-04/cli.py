#!/usr/bin/env python3
"""CLI headless: Consolidado SCI → ProdutosSCI.xlsx (três abas)."""
import argparse
import json
import sys
from pathlib import Path

from progress_weighted import Stage, WeightedProgress
from transformador import TransformadorProdutos


class CliProgressUi:
    """Emite progresso global na stdout para o worker Node (JSON por linha)."""

    def set_message(self, msg: str) -> None:
        pass

    def update_total(self, v: float) -> None:
        iv = max(0, min(100, int(round(float(v)))))
        print(json.dumps({"kind": "progress", "value": iv}), flush=True)

    def update_current(self, v: float) -> None:
        pass

    def pulse_current(self, on: bool = True) -> None:
        pass


def main() -> int:
    p = argparse.ArgumentParser(description="Consolidado SCI → Excel")
    p.add_argument("--input", required=True, help="Arquivo SCI (.csv, .txt, .xlsx, .xls)")
    p.add_argument("--output", required=True, help="Caminho do ProdutosSCI.xlsx")
    p.add_argument("--sheet", default=None, help="Nome da aba (Excel com várias folhas)")
    args = p.parse_args()
    inp = Path(args.input)
    out = Path(args.output)
    if not inp.is_file():
        print(json.dumps({"kind": "error", "message": f"Entrada não encontrada: {inp}"}), flush=True)
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)

    try:
        if out.suffix.lower() != ".xlsx":
            out = out.with_suffix(".xlsx")

        ui = CliProgressUi()
        job = TransformadorProdutos(
            caminho_sci=str(inp.resolve()),
            caminho_saida=str(out.resolve()),
            sheet_name=args.sheet,
        )
        stages = [
            Stage("Início", 5),
            Stage("Processamento", 55),
            Stage("Configuração", 5),
            Stage("Finalização", 35),
        ]
        wp = WeightedProgress(ui, stages)
        job.executar(progress=wp)
        print(json.dumps({"kind": "done", "output": str(out.resolve())}), flush=True)
        return 0
    except Exception as e:
        print(json.dumps({"kind": "error", "message": str(e)}), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
