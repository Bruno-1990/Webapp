# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import re

_ROOT = Path(__file__).resolve().parent
_SPED_ENGINE = _ROOT.parent / "sped" / "sped_engine"
if _SPED_ENGINE.is_dir():
    sys.path.insert(0, str(_SPED_ENGINE))

from cabecalhos_sped import merge_headers  # noqa: E402
from config import HEADERS  # noqa: E402

from line_builders import (
    append_extras,
    build_sped_line,
    inner_payload_for_register_with_template,
    normalize_sped_field,
)

MERGE_HEADERS = merge_headers(HEADERS)

# Índices dos campos que devem ficar vazios no C100 quando COD_MOD = 65 (NFC-e)
_C100_CAMPOS_VAZIOS_MOD65 = {3, 22, 23, 24, 25, 26, 27, 28}


def _limpar_campos_mod65(inner: list[str]) -> list[str]:
    """Para C100 com COD_MOD=65 (NFC-e), campos proibidos devem ficar vazios."""
    if len(inner) > 4 and inner[4].strip() == "65":
        for idx in _C100_CAMPOS_VAZIOS_MOD65:
            if idx < len(inner):
                inner[idx] = ""
    return inner
REG_SHEET_RE = re.compile(r"^[0-9A-Z]{4}$")


def _is_reg_sheet(name: str) -> bool:
    return bool(REG_SHEET_RE.fullmatch(name.strip().upper()))


def _sorted_col_keys(columns: list[str]) -> list[str]:
    cols: list[tuple[int, str]] = []
    for c in columns:
        if not isinstance(c, str) or not c.startswith("COL_"):
            continue
        tail = c[4:]
        if tail.isdigit():
            cols.append((int(tail), c))
    cols.sort(key=lambda x: x[0])
    return [c for _, c in cols]


def _read_text(path: Path) -> str:
    # Mantido por compatibilidade com chamadas legadas.
    text, _enc = _read_text_with_encoding(path)
    return text


def _read_text_with_encoding(path: Path) -> tuple[str, str]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise RuntimeError(f"Não foi possível ler {path}") from exc

    # Ordem intencional:
    # 1) UTF-8 estrito (preserva arquivos já UTF-8 sem corromper),
    # 2) CP1252 (mais comum no ecossistema Windows/PVA),
    # 3) Latin-1 (fallback amplo sem perda por exceção).
    for enc in ("utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc), enc
        except UnicodeDecodeError:
            continue

    # Último fallback: evita crash em arquivo malformado.
    return raw.decode("utf-8", errors="replace"), "utf-8"


def _reg_from_sped_line(line: str) -> str | None:
    if "|" not in line:
        return None
    parts = line.rstrip("\r\n").split("|")
    if len(parts) < 3:
        return None
    return (parts[1] or "").strip().upper() or None


def merge_sped_from_xlsx(sped_path: Path | None, xlsx_path: Path, output_path: Path) -> None:
    text = ""
    lines: list[str] = []
    from_original = sped_path is not None
    source_encoding = "utf-8"
    if sped_path is not None:
        text, source_encoding = _read_text_with_encoding(sped_path)
        lines = text.splitlines()
        if not lines:
            raise ValueError("Arquivo SPED vazio.")

    xl = pd.ExcelFile(xlsx_path, engine="openpyxl")

    editable_sheets = [sheet for sheet in xl.sheet_names if _is_reg_sheet(sheet)]
    if not editable_sheets:
        raise ValueError("Nenhuma aba de registro SPED encontrada no XLSX.")

    for sheet in editable_sheets:

        df = pd.read_excel(xl, sheet_name=sheet, dtype=object)
        if "_LINHA" not in df.columns:
            raise ValueError(f"Aba '{sheet}': coluna _LINHA obrigatória (use XLSX gerado pela ferramenta atual).")
        if df.empty:
            continue

        headers_rec = MERGE_HEADERS.get(sheet)
        cols = list(df.columns)
        col_keys = _sorted_col_keys(cols)
        if headers_rec is None and not col_keys:
            raise ValueError(
                f"Aba '{sheet}': sem mapeamento conhecido e sem colunas COL_XX para reconstruir a linha."
            )

        for idx in range(len(df)):
            row = df.iloc[idx]
            line_no = row["_LINHA"]
            if pd.isna(line_no):
                continue
            try:
                n = int(float(line_no))
            except (TypeError, ValueError) as e:
                raise ValueError(f"Aba '{sheet}', linha Excel {idx + 2}: _LINHA inválida: {line_no!r}") from e

            if from_original:
                if n < 1 or n > len(lines):
                    raise ValueError(f"Aba '{sheet}', linha Excel {idx + 2}: _LINHA={n} fora do intervalo (1–{len(lines)}).")

                orig = lines[n - 1]
                reg_file = _reg_from_sped_line(orig)
                if reg_file != sheet:
                    raise ValueError(
                        f"Aba '{sheet}', _LINHA={n}: registro no SPED é {reg_file!r}, esperado {sheet!r}."
                    )
                orig_inner = orig.rstrip("\r\n").split("|")[1:-1]
            else:
                while len(lines) < n:
                    lines.append("")
                orig_inner = []

            row_dict = {c: row[c] for c in cols}
            if headers_rec is not None:
                inner = inner_payload_for_register_with_template(
                    sheet, row_dict, headers_rec, orig_inner if from_original else None
                )
            else:
                inner = []
                for i, c in enumerate(col_keys):
                    template_value = orig_inner[i] if i < len(orig_inner) else None
                    inner.append(normalize_sped_field(c, row_dict.get(c, ""), template_value))
            inner = append_extras(inner, row_dict, cols, template_inner=orig_inner if from_original else None)
            if sheet == "C100":
                inner = _limpar_campos_mod65(inner)
            # Mantém a cardinalidade exata de campos da linha original para evitar
            # rejeições no PVA por "número de campos diferente do leiaute".
            if from_original:
                if len(inner) < len(orig_inner):
                    inner.extend([""] * (len(orig_inner) - len(inner)))
                elif len(inner) > len(orig_inner):
                    inner = inner[: len(orig_inner)]
            else:
                # Compatibilidade PVA: K010 exige pelo menos IND_TIPO_EST.
                if sheet == "K010":
                    if len(inner) == 1:
                        inner.append("0")
                    elif len(inner) >= 2 and inner[1] == "":
                        inner[1] = "0"
                    if len(inner) > 2:
                        inner = inner[:2]
                # Compatibilidade retroativa: em alguns perfis o 1010 tem
                # layout menor; removemos somente cauda vazia até o tamanho
                # esperado nesses casos.
                elif sheet == "1010":
                    while len(inner) > 14 and inner[-1] == "":
                        inner.pop()
                    if len(inner) > 14:
                        inner = inner[:14]
                    elif len(inner) < 14:
                        inner.extend([""] * (14 - len(inner)))
            lines[n - 1] = build_sped_line(inner)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    trailing = "\n" if (from_original and text.endswith("\n")) else "\n"
    output_encoding = source_encoding if from_original else "utf-8"
    output_path.write_text("\n".join(lines) + trailing, encoding=output_encoding, newline="\n")
