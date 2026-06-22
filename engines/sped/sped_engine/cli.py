#!/usr/bin/env python3
"""CLI headless: converte SPED .txt em XLSX (sem Tkinter/Qt)."""
import argparse
import json
import sys
from pathlib import Path

from cli_progress_stdout import CliProgress
from cabecalhos_sped import merge_headers
from config import HEADERS
from dataframe_builder import DefaultDataFrameBuilder
from parser import DefaultSpedParser
from processor import Processor
from reader import SpedFileReader
from writer_xlsxwriter import XlsxWriterExcelWriter


def main() -> int:
    p = argparse.ArgumentParser(description="SPED EFD TXT -> XLSX")
    p.add_argument("--input", required=True, help="Arquivo SPED .txt")
    p.add_argument("--output", required=True, help="Caminho completo do .xlsx de saída")
    p.add_argument(
        "--sheets",
        default=None,
        help="Registros a exportar como abas (CSV), ex: C100,C170. Omitir = todas.",
    )
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

        prog = CliProgress()
        merged_headers = merge_headers(HEADERS)
        processor = Processor(
            reader=SpedFileReader(),
            parser=DefaultSpedParser(),
            df_builder=DefaultDataFrameBuilder(merged_headers),
            writer=XlsxWriterExcelWriter(),
            formatter=None,
            reporter=None,
            progress=prog,
        )
        export_regs = None
        if args.sheets:
            parts = [x.strip() for x in args.sheets.split(",") if x.strip()]
            if len(parts) > 128:
                print(json.dumps({"kind": "error", "message": "Máximo de 128 registros em --sheets"}), flush=True)
                return 1
            export_regs = parts if parts else None
        processor.run(inp, out, export_regs=export_regs)
        print(json.dumps({"kind": "done", "output": str(out.resolve())}), flush=True)
        return 0
    except Exception as e:
        print(json.dumps({"kind": "error", "message": str(e)}), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
