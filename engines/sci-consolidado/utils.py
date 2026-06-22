# utils.py
import unicodedata
import pandas as pd

def remover_acentos(texto: str) -> str:
    return ''.join(
        c for c in unicodedata.normalize('NFKD', str(texto))
        if not unicodedata.combining(c)
    ).upper().strip()

def to_float_smart(s: pd.Series) -> pd.Series:
    """Converte série para float aceitando pontos de milhar e vírgula decimal."""
    if pd.api.types.is_numeric_dtype(s):
        return s.astype(float)
    return pd.to_numeric(
        s.astype(str)
         .str.replace(r'\.', '', regex=True)
         .str.replace(',', '.', regex=False)
         .str.replace(r'[^0-9\.\-]', '', regex=True),
        errors="coerce"
    ).fillna(0.0)

def require_columns(df: pd.DataFrame, cols: list[str], stage: str):
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"[{stage}] colunas ausentes: {missing}. Colunas recebidas: {list(df.columns)}")

def coerce_int_str(series: pd.Series) -> pd.Series:
    """Para números de nota: extrai dígitos e devolve INT (0 quando vazio)."""
    s = series.astype(str).str.extract(r'(\d+)')[0]
    return pd.to_numeric(s, errors="coerce").fillna(0).astype(int)

def coerce_cfop(series: pd.Series) -> pd.Series:
    """Mantém apenas os 4 primeiros dígitos do CFOP."""
    limpo = series.astype(str).str.replace(r'[^0-9]', '', regex=True).str.strip()
    return limpo.str[:4]

NUM_COLS = ["Vlr contábil", "Base de ICMS", "Valor do ICMS", "Base de IPI", "Valor do IPI"]
