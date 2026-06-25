
import re
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

import pandas as pd

# Formatação alinhada ao uso brasileiro (milhar . decimal ,).
# VL_* gravados como texto "x.xxx,xx" para o Excel não trocar vírgula/ponto conforme idioma.
# Datas: só dia/mês/ano (sem horário), a partir de DDMMAAAA no SPED.


def _int_part_thousands_br(digits: str) -> str:
    """Parte inteira só com dígitos; insere ponto a cada 3 da direita (69.574)."""
    d = digits.strip().lstrip("+")
    d = d.lstrip("0") or "0"
    n = len(d)
    chunks = []
    i = n
    while i > 0:
        st = max(0, i - 3)
        chunks.insert(0, d[st:i])
        i = st
    return ".".join(chunks)


def _format_br_money_text(value) -> str:
    """Sempre 2 decimais, padrão brasileiro: 114.665,81 ou 0,00."""
    try:
        if value is None or (isinstance(value, float) and pd.isna(value)):
            d = Decimal("0")
        else:
            d = Decimal(str(float(value)))
        d = d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError, ArithmeticError):
        d = Decimal("0.00")
    neg = d < 0
    if neg:
        d = abs(d)
    s = format(d, "f")
    if "." in s:
        intp, frac = s.split(".", 1)
    else:
        intp, frac = s, ""
    frac = (frac + "00")[:2]
    intp_fmt = _int_part_thousands_br(intp)
    prefix = "-" if neg else ""
    return f"{prefix}{intp_fmt},{frac}"


def _to_number(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        s = value.strip()
        if s == "":
            return None
        neg = False
        if s.startswith("(") and s.endswith(")"):
            neg = True
            s = s[1:-1]
        s = re.sub(r"[^0-9,.-]", "", s)
        if "," in s and "." in s:
            s = s.replace(".", "").replace(",", ".")
        elif "," in s:
            s = s.replace(",", ".")
        try:
            num = float(s)
            return -num if neg else num
        except ValueError:
            return None
    return None


def _parse_sped_date_ddmmaaaa(value):
    """Converte campo SPED com 8 dígitos DDMMAAAA em date (sem hora, para Excel)."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, pd.Timestamp):
        return value.date() if pd.notna(value) else None
    s = str(value).strip()
    if s == "" or s.lower() == "nan":
        return None
    if len(s) == 8 and s.isdigit():
        dd, mm, yy = int(s[:2]), int(s[2:4]), int(s[4:8])
        try:
            return date(yy, mm, dd)
        except ValueError:
            return None
    return None


def _excel_date_cell_value(value):
    """Valor para célula Excel só-data (None = vazio)."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, pd.Timestamp):
        return value.date() if pd.notna(value) else None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def _is_dt_col(name) -> bool:
    return isinstance(name, str) and name.startswith("DT_")


def _is_qty_col(name) -> bool:
    if not isinstance(name, str):
        return False
    u = name.upper()
    return u == "QTD" or u.startswith("QUANT_")


def _is_aliq_col(name) -> bool:
    return isinstance(name, str) and name.upper().startswith("ALIQ_")


def _series_all_whole_numbers(series: pd.Series) -> bool:
    s = pd.to_numeric(series, errors="coerce").dropna()
    if s.empty:
        return True
    try:
        return bool((s % 1 == 0).all())
    except TypeError:
        return False


class XlsxWriterExcelWriter:
    def __init__(self):
        pass

    def write(self, dataframes: dict, output):
        with pd.ExcelWriter(
            output,
            engine="xlsxwriter",
            date_format="dd/mm/yyyy",
            datetime_format="dd/mm/yyyy",
        ) as w:
            workbook = w.book
            header_fmt = workbook.add_format({
                "bold": True,
                "bg_color": "#4169E1",
                "font_color": "white",
                "align": "center",
                "valign": "vcenter",
            })
            cell_fmt = workbook.add_format({
                "align": "center",
                "valign": "vcenter",
            })
            # VL_* como texto "@": exibição fixa x.xxx,xx em qualquer idioma do Excel
            money_text_fmt = workbook.add_format({
                "align": "center",
                "valign": "vcenter",
                "num_format": "@",
            })
            br_dec2 = workbook.add_format({
                "align": "center",
                "valign": "vcenter",
                "num_format": "#.##0,00",
            })
            br_dec4 = workbook.add_format({
                "align": "center",
                "valign": "vcenter",
                "num_format": "#.##0,0000",
            })
            br_int = workbook.add_format({
                "align": "center",
                "valign": "vcenter",
                "num_format": "#.##0",
            })
            date_fmt = workbook.add_format({
                "align": "center",
                "valign": "vcenter",
                "num_format": "dd/mm/yyyy",
            })
            # Nº da linha no .txt: inteiro simples (sem separador de milhar)
            line_fmt = workbook.add_format({
                "align": "center",
                "valign": "vcenter",
                "num_format": "0",
            })

            for name, df in dataframes.items():
                df = df.copy()
                if "_LINHA" in df.columns:
                    df["_LINHA"] = pd.to_numeric(df["_LINHA"], errors="coerce")
                    if df["_LINHA"].notna().all():
                        df["_LINHA"] = df["_LINHA"].astype("int64")
                for col in list(df.columns):
                    if col == "_LINHA":
                        continue
                    if isinstance(col, str) and col.upper().startswith("VL_"):
                        df[col] = df[col].map(_to_number).fillna(0.0)
                    elif _is_dt_col(col):
                        df[col] = df[col].map(_parse_sped_date_ddmmaaaa)
                    elif _is_qty_col(col) or _is_aliq_col(col):
                        df[col] = df[col].map(_to_number)

                df.to_excel(w, index=False, sheet_name=name)
                ws = w.sheets[name]

                for col_num, value in enumerate(df.columns.values):
                    ws.write(0, col_num, value, header_fmt)

                    if not df.empty:
                        if _is_dt_col(value):
                            for r in range(len(df)):
                                ev = _excel_date_cell_value(df.iat[r, col_num])
                                ws.write(r + 1, col_num, ev, date_fmt)
                        elif value == "_LINHA":
                            for r in range(len(df)):
                                raw = df.iat[r, col_num]
                                iv = int(raw) if pd.notna(raw) else None
                                ws.write(r + 1, col_num, iv, line_fmt)
                        elif isinstance(value, str) and value.upper().startswith("VL_"):
                            for r in range(len(df)):
                                v = df.iat[r, col_num]
                                fv = float(v) if pd.notna(v) else 0.0
                                txt = _format_br_money_text(fv)
                                ws.write(r + 1, col_num, txt, money_text_fmt)
                        else:
                            # Demais colunas: regravar com alinhamento central (to_excel do pandas costuma alinhar à esquerda)
                            if not df.empty:
                                if isinstance(value, str) and _is_aliq_col(value):
                                    rfmt = br_dec4
                                elif isinstance(value, str) and _is_qty_col(value):
                                    rfmt = (
                                        br_int
                                        if _series_all_whole_numbers(df[value])
                                        else br_dec2
                                    )
                                else:
                                    rfmt = cell_fmt
                                for r in range(len(df)):
                                    v = df.iat[r, col_num]
                                    if pd.isna(v):
                                        ws.write(r + 1, col_num, "", rfmt)
                                    else:
                                        ws.write(r + 1, col_num, v, rfmt)

                    if not df.empty:
                        if isinstance(value, str) and value.upper().startswith("VL_"):
                            col_lens = df[value].map(
                                lambda x: len(_format_br_money_text(x if pd.notna(x) else 0.0))
                            )
                        else:
                            col_lens = df[value].map(lambda x: len(str(x)))
                        m = col_lens.max()
                        max_data = int(m) if pd.notna(m) else 0
                    else:
                        max_data = 0
                    maxlen = max(max_data, len(str(value)))

                    if value == "_LINHA":
                        ws.set_column(col_num, col_num, min(14, max(8, maxlen + 2)), line_fmt)
                    elif isinstance(value, str) and _is_dt_col(value):
                        ws.set_column(col_num, col_num, min(14, max(11, maxlen + 2)), date_fmt)
                    elif isinstance(value, str) and value.upper().startswith("VL_"):
                        ws.set_column(col_num, col_num, min(60, max(12, maxlen + 2)), money_text_fmt)
                    elif isinstance(value, str) and _is_aliq_col(value):
                        ws.set_column(col_num, col_num, min(24, max(10, maxlen + 2)), br_dec4)
                    elif isinstance(value, str) and _is_qty_col(value):
                        qfmt = br_int if _series_all_whole_numbers(df[value]) else br_dec2
                        ws.set_column(col_num, col_num, min(60, max(10, maxlen + 2)), qfmt)
                    else:
                        ws.set_column(col_num, col_num, min(60, max(10, maxlen + 2)), cell_fmt)

                ws.set_row(0, 25)
                for row_num in range(1, len(df) + 1):
                    ws.set_row(row_num, 28)

                ws.freeze_panes(1, 0)

        return output
