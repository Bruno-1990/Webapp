# -*- coding: utf-8 -*-
"""Monta o payload interno (campos entre o primeiro e o último '|') a partir de uma linha do XLSX."""
from __future__ import annotations

import math
import re
import unicodedata
from datetime import date, datetime
from typing import Any

try:
    import pandas as pd
except ImportError:
    pd = None  # type: ignore


def cell_str(value: Any) -> str:
    if value is None or (pd is not None and isinstance(value, float) and pd.isna(value)):
        return ""
    if isinstance(value, float):
        if math.isnan(value):
            return ""
        if value == int(value):
            return str(int(value))
        s = f"{value:.12f}".rstrip("0").rstrip(".")
        return s if s else "0"
    if isinstance(value, int):
        return str(value)
    return str(value).strip()


_NUMERIC_FIELD_RE = re.compile(r"^(VL_|ALIQ_|QTD$|QUANT_)", re.IGNORECASE)
_TEMPLATE_NUMERIC_RE = re.compile(r"^-?\d+(?:[.,]\d+)?$")


def _sanitize_text(value: str) -> str:
    # Regra operacional solicitada: normalizar cedilha e til no SPED de saída.
    s = value.replace("ç", "c").replace("Ç", "C").replace("~", "")
    decomp = unicodedata.normalize("NFD", s)
    decomp = "".join(ch for ch in decomp if ch not in ("\u0303", "\u0327"))  # til e cedilha combinantes
    return unicodedata.normalize("NFC", decomp)


def _normalize_date_ddmmaaaa(value: Any) -> str:
    if value is None:
        return ""
    if pd is not None and pd.isna(value):
        return ""
    if isinstance(value, datetime):
        return value.strftime("%d%m%Y")
    if isinstance(value, date):
        return value.strftime("%d%m%Y")

    s = cell_str(value)
    if not s:
        return ""

    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        yy, mm, dd = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return date(yy, mm, dd).strftime("%d%m%Y")

    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})", s)
    if m:
        dd, mm, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return date(yy, mm, dd).strftime("%d%m%Y")

    m = re.match(r"^(\d{2})-(\d{2})-(\d{4})", s)
    if m:
        dd, mm, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return date(yy, mm, dd).strftime("%d%m%Y")

    if re.fullmatch(r"\d{8}", s):
        # Já no formato de 8 dígitos (ddmmaaaa ou yyyymmdd).
        # Se começar por ano 19xx/20xx, converte para ddmmaaaa.
        if s.startswith(("19", "20")):
            yy, mm, dd = int(s[:4]), int(s[4:6]), int(s[6:8])
            return date(yy, mm, dd).strftime("%d%m%Y")
        return s

    return s


def _normalize_numeric(value: Any) -> str:
    s = cell_str(value)
    if not s:
        return ""
    # Remove espaços e normaliza para padrão SPED esperado aqui: vírgula decimal sem milhar.
    s = s.replace(" ", "")
    if "," in s and "." in s:
        # Se a vírgula está por último, entrada tipo BR: 16.664,42
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "")
        else:
            # Entrada tipo EN-US: 16,664.42
            s = s.replace(",", "").replace(".", ",")
    elif "," in s:
        # Apenas vírgula: pode ser decimal ("12,50") ou milhar ("1,234")
        if re.fullmatch(r"-?\d{1,3}(?:,\d{3})+", s):
            s = s.replace(",", "")
    elif "." in s:
        # Apenas ponto: pode ser decimal ("12.50") ou milhar ("1.234")
        if re.fullmatch(r"-?\d{1,3}(?:\.\d{3})+", s):
            s = s.replace(".", "")
        elif re.fullmatch(r"-?\d+\.\d+", s):
            s = s.replace(".", ",")
    return s


def _normalize_with_template(value: Any, template_value: str) -> str:
    t = template_value.strip()
    if not t:
        return cell_str(value)
    if re.fullmatch(r"\d{8}", t):
        return _normalize_date_ddmmaaaa(value)
    if _TEMPLATE_NUMERIC_RE.fullmatch(t):
        # Quando o template fiscal usa vírgula decimal, preservamos esse padrão.
        v = _normalize_numeric(value)
        if "," in t:
            return v.replace(".", ",")
        if "." in t:
            return v.replace(",", ".")
        # Template inteiro sem separador decimal.
        if "," in v:
            return v.split(",", 1)[0]
        if "." in v:
            return v.split(".", 1)[0]
        return v
    return cell_str(value)


def normalize_sped_field(field_name: str, value: Any, template_value: str | None = None) -> str:
    # Quando há template (SPED original), célula vazia no XLSX
    # deve manter o valor original para evitar perda estrutural.
    if template_value is not None and cell_str(value) == "":
        return template_value
    name = (field_name or "").upper()
    if name.startswith("DT_"):
        return _normalize_date_ddmmaaaa(value)
    if _NUMERIC_FIELD_RE.match(name):
        v = _normalize_numeric(value)
        if template_value:
            t = template_value.strip()
            if "." in t and "," not in t:
                return v.replace(",", ".")
            # Template inteiro (sem separador decimal) → remover decimais zerados
            # Ex: "0,00" → "0", "100,00" → "100", mas "16664,42" permanece "16664,42"
            if t and "," not in t and "." not in t and re.fullmatch(r"-?\d+", t):
                if "," in v:
                    inteiro, dec = v.split(",", 1)
                    if re.fullmatch(r"0+", dec):
                        return inteiro
                elif "." in v:
                    inteiro, dec = v.split(".", 1)
                    if re.fullmatch(r"0+", dec):
                        return inteiro
        return v.replace(".", ",")
    if template_value is not None:
        return _sanitize_text(_normalize_with_template(value, template_value))
    return _sanitize_text(cell_str(value))


def sorted_extra_keys(columns: list[str]) -> list[str]:
    extras: list[tuple[int, str]] = []
    for c in columns:
        if not isinstance(c, str) or not c.startswith("EXTRA_"):
            continue
        tail = c[6:]
        if tail.isdigit():
            extras.append((int(tail), c))
    extras.sort(key=lambda x: x[0])
    return [c for _, c in extras]


def inner_payload_for_register(reg: str, row: dict[str, Any], headers_rec: list[str]) -> list[str]:
    """
    Campos do arquivo .txt após split('|')[1:-1], na ordem do SPED físico.
    Colunas injetadas no Excel (NUM_DOC / CHV_*) não existem como pipes separados na linha.
    """
    return inner_payload_for_register_with_template(reg, row, headers_rec, None)


def inner_payload_for_register_with_template(
    reg: str, row: dict[str, Any], headers_rec: list[str], template_inner: list[str] | None
) -> list[str]:
    h = headers_rec
    if reg in ("C170", "C190", "D190"):
        names = [h[0]] + h[3:]
    elif reg in ("C590", "D590"):
        names = [h[0]] + h[2:]
    else:
        names = h

    out: list[str] = []
    for i, name in enumerate(names):
        template_value = template_inner[i] if template_inner is not None and i < len(template_inner) else None
        out.append(normalize_sped_field(name, row.get(name, ""), template_value))
    return out


def append_extras(
    inner: list[str], row: dict[str, Any], sheet_columns: list[str], template_inner: list[str] | None = None
) -> list[str]:
    base_len = len(inner)
    for idx, k in enumerate(sorted_extra_keys(sheet_columns)):
        if k in row:
            template_value = None
            if template_inner is not None and (base_len + idx) < len(template_inner):
                template_value = template_inner[base_len + idx]
            inner.append(normalize_sped_field(k, row[k], template_value))
    return inner


def build_sped_line(inner: list[str]) -> str:
    return "|" + "|".join(inner) + "|"
