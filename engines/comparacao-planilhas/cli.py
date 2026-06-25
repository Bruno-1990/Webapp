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


def norm_nota(v) -> str:
    """Normaliza um numero de nota para texto comparavel.

    SEFAZ "Num." chega como int (Excel); SCI pode chegar como str (CSV com
    linha "Totais" ou valores ="..." forcam a coluna para texto) ou float
    (ex.: "75.0"). Sem normalizar, int 59 != str "59" e TODAS as notas
    aparecem como faltantes.
    """
    s = str(v).strip()
    if s.endswith(".0"):
        s = s[:-2]
    return s


def processar(sefaz_paths: list[str], sci_paths: list[str], output: str):
    progress(5)

    col_sefaz = "Num."
    col_cnpj = "CNPJ/CPF"
    cols_sci_possiveis = ["Documento", "Nr. documento", "Nº NF."]

    # Colunas que devem ser lidas como texto para preservar precisao
    # (chave de 44 digitos vira notacao cientifica como float; CNPJ pode perder zeros)
    text_dtype = {
        "Chave Acesso": str,
        "CNPJ/CPF": str,
        "CNPJ/CPF Emitente": str,
        "CNPJ/CPF Destinatário": str,
    }

    # --- Carregar SEFAZ ---
    dados_sefaz = pd.DataFrame()
    total_files = len(sefaz_paths) + len(sci_paths)
    done_files = 0

    for p in sefaz_paths:
        if p.lower().endswith(".csv"):
            df = pd.read_csv(p, sep=";", encoding="latin1", skiprows=1, dtype=text_dtype)
        else:
            df = pd.read_excel(p, skiprows=1, dtype=text_dtype)
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
    # Normaliza ambos os lados para texto antes de comparar: SEFAZ vem como int
    # e SCI como str, entao a diferenca de conjuntos crua marca tudo como faltante.
    sefaz_norm = dados_sefaz[col_sefaz].map(norm_nota)
    notas_sci = {norm_nota(v) for v in dados_sci[col_sci]}

    dados_faltantes = dados_sefaz[
        (~sefaz_norm.isin(notas_sci))
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
        dados_faltantes.to_excel(writer, index=False, sheet_name=sheet_name, header=False, startrow=1)
        wb = writer.book
        ws = writer.sheets[sheet_name]

        header_fmt = wb.add_format({
            "bold": True,
            "align": "center",
            "valign": "vcenter",
            "bg_color": "#4169E1",
            "font_color": "#ffffff",
            "border": 1,
            "border_color": "#CECECE",
        })
        cell_fmt = wb.add_format({
            "align": "center",
            "valign": "vcenter",
            "border": 1,
            "border_color": "#CECECE",
        })
        text_cell_fmt = wb.add_format({
            "align": "center",
            "valign": "vcenter",
            "num_format": "@",
            "border": 1,
            "border_color": "#CECECE",
        })
        text_cols = {"Chave Acesso", col_cnpj}

        ws.set_row(0, 25, header_fmt)
        for row_idx in range(len(dados_faltantes)):
            ws.set_row(row_idx + 1, 20)

        for idx, col_name in enumerate(dados_faltantes.columns):
            ws.write(0, idx, col_name, header_fmt)
            # str(v) por item: no pandas 3.x, astype(str) preserva NaN como float
            # (nao vira "nan"), entao map(len) direto quebra com "float has no len()".
            series = dados_faltantes[col_name]
            max_data = int(series.map(lambda v: len(str(v))).max()) if len(series) else 0
            width = min(max(len(str(col_name)), max_data) + 2, 60)
            fmt = text_cell_fmt if col_name in text_cols else cell_fmt
            ws.set_column(idx, idx, width, fmt)

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
