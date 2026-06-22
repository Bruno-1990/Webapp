#!/usr/bin/env python3
"""CLI headless: Extrator GNRE (PDF -> XLSX).

Protocolo JSON-lines em stdout:
  {"kind": "progress", "value": 0..100}
  {"kind": "file", "ok": true|false, "arquivo": "...", "duplicate": bool, "motivo": "..."}
  {"kind": "error", "message": "..."}
  {"kind": "done", "output": "<xlsx>", "result": {...}}

Argumentos:
  --pdfs-dir DIR   Pasta com PDFs (varredura recursiva, filtra .pdf)
  --output PATH    Caminho do XLSX de saída
  --db PATH        (Opcional) Override do caminho do SQLite. Equivale a GNRE_DB_PATH.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import db
from extractor import ExtractionError, extract_gnre
from validators import ValidationError
from xlsx_export import build_xlsx_file


def emit(kind: str, **kw) -> None:
    print(json.dumps({"kind": kind, **kw}, ensure_ascii=False), flush=True)


def progress(value: int) -> None:
    emit("progress", value=max(0, min(100, int(value))))


def _list_pdfs(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return sorted([p for p in root.rglob("*") if p.is_file() and p.suffix.lower() == ".pdf"])


def processar(pdfs_dir: Path, output_xlsx: Path) -> dict:
    progress(2)
    db.init_db()
    pdfs = _list_pdfs(pdfs_dir)
    total = len(pdfs)
    if total == 0:
        raise ExtractionError(f"Nenhum PDF encontrado em: {pdfs_dir}")

    ok = dup = fail = 0
    valor_total = 0.0
    nomes_sucesso: list[str] = []
    nomes_falha: list[str] = []
    falhas_inline: list[dict] = []

    base = 5
    span = 85

    for i, p in enumerate(pdfs, 1):
        nome = p.name
        try:
            gnre = extract_gnre(str(p))
            valor = float(gnre.valor_principal)
            status = db.insert_lancamento(
                arquivo=nome,
                cnpj_destinatario=gnre.cnpj_destinatario,
                valor_principal=valor,
                uf_favorecida=gnre.uf_favorecida,
                data_vencimento=gnre.data_vencimento,
                periodo_referencia=gnre.periodo_referencia,
                no_controle=gnre.no_controle,
            )
            if status == "duplicate":
                dup += 1
                valor_total += valor
                nomes_sucesso.append(nome)
                emit("file", ok=False, duplicate=True, arquivo=nome)
            else:
                ok += 1
                valor_total += valor
                nomes_sucesso.append(nome)
                emit(
                    "file",
                    ok=True,
                    arquivo=nome,
                    cnpj_destinatario=gnre.cnpj_destinatario,
                    valor_principal=valor,
                    vias_concordantes=gnre.vias_concordantes,
                )
        except (ExtractionError, ValidationError) as e:
            fail += 1
            motivo = str(e)
            db.insert_falha(nome, motivo)
            nomes_falha.append(nome)
            falhas_inline.append({"arquivo": nome, "motivo": motivo})
            emit("file", ok=False, arquivo=nome, motivo=motivo)
        except Exception as e:
            fail += 1
            motivo = f"erro inesperado: {e}"
            db.insert_falha(nome, motivo)
            nomes_falha.append(nome)
            falhas_inline.append({"arquivo": nome, "motivo": motivo})
            emit("file", ok=False, arquivo=nome, motivo=motivo)
        finally:
            progress(base + int((i / total) * span))

    lancamentos = db.fetch_lancamentos_by_files(nomes_sucesso)
    falhas = db.fetch_falhas_by_files(nomes_falha)
    if not falhas and falhas_inline:
        falhas = falhas_inline

    build_xlsx_file(output_xlsx, lancamentos, falhas)
    progress(100)

    return {
        "totais": {"ok": ok, "dup": dup, "fail": fail, "total": total},
        "valorTotal": round(valor_total, 2),
        "lancamentos": len(lancamentos),
        "falhas": len(falhas),
    }


def main() -> int:
    p = argparse.ArgumentParser(description="Extrator GNRE (PDF -> XLSX)")
    p.add_argument("--pdfs-dir", required=True, help="Pasta com PDFs GNRE")
    p.add_argument("--output", required=True, help="Caminho do XLSX de saída")
    p.add_argument(
        "--db",
        default=None,
        help="Override do caminho do SQLite (equivale a GNRE_DB_PATH)",
    )
    args = p.parse_args()

    if args.db:
        os.environ["GNRE_DB_PATH"] = args.db

    pdfs_dir = Path(args.pdfs_dir)
    output_xlsx = Path(args.output)
    if output_xlsx.suffix.lower() != ".xlsx":
        output_xlsx = output_xlsx.with_suffix(".xlsx")

    if not pdfs_dir.exists():
        emit("error", message=f"Pasta de PDFs não encontrada: {pdfs_dir}")
        return 1

    try:
        result = processar(pdfs_dir, output_xlsx)
        emit("done", output=str(output_xlsx.resolve()), result=result)
        return 0
    except Exception as e:
        emit("error", message=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
