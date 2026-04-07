#!/usr/bin/env python3
"""CLI headless: Comparador de Planilhas SEFAZ vs SCI -> Notas Faltantes.xlsx"""
import argparse
import json
import sys
from pathlib import Path

import pandas as pd


def emit(kind: str, **kw):
    print(json.dumps({"kind": kind, **kw}), flush=True)


def progress(value: int):
    emit("progress", value=max(0, min(100, value)))


def processar(sefaz_paths: list[str], sci_paths: list[str], output: str):
    progress(5)

    col_sefaz = "Num."
    col_cnpj = "CNPJ/CPF"
    cols_sci_possiveis = ["Documento", "Nr. documento", "Nº NF."]

    # --- Carregar SEFAZ ---
    dados_sefaz = pd.DataFrame()
    total_files = len(sefaz_paths) + len(sci_paths)
    done_files = 0

    for p in sefaz_paths:
        if p.lower().endswith(".csv"):
            df = pd.read_csv(p, sep=";", encoding="latin1", skiprows=1)
        else:
            df = pd.read_excel(p, skiprows=1)
        df.rename(columns={
            "CNPJ/CPF Emitente": col_cnpj,
            "CNPJ/CPF Destinatário": col_cnpj,
        }, inplace=True)
        dados_sefaz = pd.concat((dados_sefaz, df), ignore_index=True)
        done_files += 1
        progress(5 + int((done_files / total_files) * 50))

    if "#" in dados_sefaz.columns:
        dados_sefaz.drop("#", axis=1, inplace=True)

    # --- Carregar SCI ---
    col_sci = ""
    dados_sci = pd.DataFrame()

    for p in sci_paths:
        found = False
        for col in cols_sci_possiveis:
            try:
                if p.lower().endswith(".csv"):
                    df = pd.read_csv(p, usecols=[col], sep=";", encoding="latin1")
                else:
                    df = pd.read_excel(p, usecols=[col])
                col_sci = col
                found = True
                break
            except (ValueError, KeyError):
                continue
        if not found:
            raise ValueError(
                f"Coluna de notas do SCI nao encontrada em: {Path(p).name}. "
                f"Esperado: {', '.join(cols_sci_possiveis)}"
            )
        df = df[df[col_sci].notnull()]
        dados_sci = pd.concat((dados_sci, df), ignore_index=True)
        done_files += 1
        progress(5 + int((done_files / total_files) * 50))

    progress(60)

    # --- Comparar ---
    notas_sefaz = set(dados_sefaz[col_sefaz])
    notas_sci = set(dados_sci[col_sci])
    notas_faltantes = notas_sefaz - notas_sci

    dados_faltantes = dados_sefaz[
        (dados_sefaz[col_sefaz].isin(notas_faltantes))
        & (dados_sefaz["Situação"] != "Cancelado")
    ].copy()

    progress(75)

    # CNPJ como texto
    if col_cnpj in dados_faltantes.columns:
        dados_faltantes[col_cnpj] = dados_faltantes[col_cnpj].astype(str)

    # Tipo de documento pela chave de acesso
    if "Chave Acesso" in dados_faltantes.columns:
        dados_faltantes["Tipo de Documento"] = (
            dados_faltantes["Chave Acesso"]
            .astype(str)
            .str.slice(20, 22)
            .map({"55": "NF-e", "57": "CT-e", "65": "NFC-e"})
            .fillna("Outro")
        )

    progress(85)

    # --- Salvar ---
    out = Path(output)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet_name = "Notas Faltantes"

    with pd.ExcelWriter(str(out), engine="xlsxwriter") as writer:
        dados_faltantes.to_excel(writer, index=False, sheet_name=sheet_name)
        ws = writer.sheets[sheet_name]
        larguras = {"#": 3, "Chave Acesso": 46}
        for idx, col_name in enumerate(dados_faltantes.columns):
            ws.set_column(idx, idx, larguras.get(col_name, 18))

    progress(100)
    return len(dados_faltantes)


def main() -> int:
    p = argparse.ArgumentParser(description="Comparador de Planilhas SEFAZ vs SCI")
    p.add_argument("--sefaz", required=True, nargs="+", help="Arquivos SEFAZ (.xlsx, .xls, .csv)")
    p.add_argument("--sci", required=True, nargs="+", help="Arquivos SCI (.xlsx, .xls, .csv)")
    p.add_argument("--output", required=True, help="Caminho do arquivo de saida (.xlsx)")
    args = p.parse_args()

    for f in args.sefaz + args.sci:
        if not Path(f).is_file():
            emit("error", message=f"Arquivo nao encontrado: {f}")
            return 1

    try:
        out = args.output
        if not out.lower().endswith(".xlsx"):
            out += ".xlsx"
        n = processar(args.sefaz, args.sci, out)
        emit("done", output=out, count=n)
        return 0
    except Exception as e:
        emit("error", message=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
