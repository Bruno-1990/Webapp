import pandas as pd
from utils import remover_acentos, to_float_smart, require_columns, coerce_int_str, coerce_cfop, NUM_COLS

class PlanilhaBase:
    def __init__(self, caminho: str):
        self.caminho = caminho
        self.raw: pd.DataFrame | None = None
        self.base: pd.DataFrame | None = None
        self.final: pd.DataFrame | None = None

    def _padronizar_nomes(self, df: pd.DataFrame, mapa: dict) -> pd.DataFrame:
        df = df.copy()
        df.columns = [remover_acentos(c) for c in df.columns]
        ren = {c: mapa[c] for c in df.columns if c in mapa}
        return df.rename(columns=ren)

    def _converter_numericos(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        for col in NUM_COLS:
            if col in df.columns:
                df[col] = to_float_smart(df[col])
        return df


class PlanilhaSCI(PlanilhaBase):
    """Reproduz Produtos/Base/Final conforme o seu script original."""
    def processar(self, df: pd.DataFrame) -> "PlanilhaSCI":
        self.raw = df.copy()

        mapa = {
            # chaves
            "CNPJ DO PARTICIPANTE": "CNPJ", "CNPJ": "CNPJ",
            "Nº NF.": "Nº NF.", "Nº NF": "Nº NF.", "NO NF": "Nº NF.", "NO NF.": "Nº NF.",
            "NUM NF": "Nº NF.", "NUMERO NF": "Nº NF.", "NF": "Nº NF.", "NOTA": "Nº NF.",
            "CFOP": "CFOP",
            # valores
            "VLR CONTABIL": "Vlr contábil", "VLR CONTÁBIL": "Vlr contábil",
            "VALOR CONTABIL": "Vlr contábil", "VALOR CONTÁBIL": "Vlr contábil",
            "BASE DE ICMS": "Base de ICMS", "BASE ICMS": "Base de ICMS",
            "VALOR DO ICMS": "Valor do ICMS", "VALOR ICMS": "Valor do ICMS",
            "BASE DE IPI": "Base de IPI", "BASE IPI": "Base de IPI",
            "VALOR DO IPI": "Valor do IPI", "VALOR IPI": "Valor do IPI",
        }

        base_full = self._padronizar_nomes(self.raw, mapa)

        # Garante existência das colunas mínimas
        min_cols = ["CNPJ", "Nº NF.", "CFOP"] + NUM_COLS
        for c in min_cols:
            if c not in base_full.columns:
                base_full[c] = 0.0 if c in NUM_COLS else ""

        # Converte numéricas e normaliza chaves
        base_full = self._converter_numericos(base_full)
        base_full["CNPJ"]   = base_full["CNPJ"].astype(str).str.strip()
        base_full["Nº NF."] = coerce_int_str(base_full["Nº NF."])
        base_full["CFOP"]   = coerce_cfop(base_full["CFOP"])

        # 🔹 Base ENXUTA: somente os campos necessários
        slim_cols = ["CNPJ", "Nº NF.", "CFOP"] + NUM_COLS
        self.base = base_full[slim_cols].copy()

        # 🔹 Final calculada A PARTIR DA BASE ENXUTA
        self.final = (
            self.base.groupby(["CNPJ", "Nº NF.", "CFOP"], as_index=False)[NUM_COLS]
                     .sum()
                     .sort_values(by=["Nº NF.", "CFOP"], kind="mergesort")
                     .reset_index(drop=True)
        )
        return self
