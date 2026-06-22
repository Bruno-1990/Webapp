# excel.py
import csv
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook

import format


class ExcelManager:
    """Leitura/gravação de planilhas com checkpoints de progresso."""

    @staticmethod
    def _sniff_encoding_and_delim(path: str):
        encodings = ["utf-8", "utf-8-sig", "cp1252", "latin1"]
        with open(path, "rb") as f:
            raw = f.read(8192)

        try:
            chosen_text = None
            chosen_enc = None
            for enc in encodings:
                try:
                    txt = raw.decode(enc)
                    chosen_text, chosen_enc = txt, enc
                    break
                except UnicodeDecodeError:
                    continue
            if chosen_text is None:
                chosen_text, chosen_enc = raw.decode("latin1"), "latin1"
        except Exception:
            chosen_text, chosen_enc = raw.decode("latin1", errors="ignore"), "latin1"

        candidates = [";", ",", "|", "\t"]
        counts = {d: chosen_text.count(d) for d in candidates}
        delim = max(counts, key=counts.get) if max(counts.values()) > 0 else ";"

        try:
            dialect = csv.Sniffer().sniff(chosen_text, delimiters=";,|\t")
            delim = dialect.delimiter
        except Exception:
            pass

        return chosen_enc, delim

    @staticmethod
    def _read_csv_robusto(path: str) -> pd.DataFrame:
        enc, delim = ExcelManager._sniff_encoding_and_delim(path)

        combos = [
            dict(encoding=enc, sep=delim, engine="python", quotechar='"', doublequote=True,
                 escapechar="\\", on_bad_lines="skip", skipinitialspace=True),
            dict(encoding=enc, sep=delim, engine="python", quoting=csv.QUOTE_NONE,
                 escapechar="\\", on_bad_lines="skip", skipinitialspace=True),
        ]
        for aenc in ["utf-8", "utf-8-sig", "cp1252", "latin1"]:
            combos.append(dict(encoding=aenc, sep=delim, engine="python", quotechar='"',
                               doublequote=True, escapechar="\\", on_bad_lines="skip",
                               skipinitialspace=True))
            combos.append(dict(encoding=aenc, sep=delim, engine="python", quoting=csv.QUOTE_NONE,
                               escapechar="\\", on_bad_lines="skip", skipinitialspace=True))

        last_err = None
        for opts in combos:
            try:
                return pd.read_csv(path, **opts)
            except Exception as e:
                last_err = e
                continue

        return pd.read_csv(path, sep=";", engine="python", encoding="latin1",
                           quoting=csv.QUOTE_NONE, escapechar="\\",
                           on_bad_lines="skip", skipinitialspace=True)

    @staticmethod
    def carregar(caminho: str, sheet_name: str | None = None):
        sufixo = Path(caminho).suffix.lower()
        if sufixo in (".csv", ".txt"):
            return ExcelManager._read_csv_robusto(caminho)

        if sheet_name is None:
            return pd.read_excel(caminho, sheet_name=None)
        return pd.read_excel(caminho, sheet_name=sheet_name)

    @staticmethod
    def salvar(caminho_saida: str, on_progress=None, **abas: pd.DataFrame):
        def emit(percent=None, msg=None, pulse=None):
            if on_progress is None:
                return
            kw = {}
            if msg is not None:
                kw["msg"] = msg
            if pulse is not None:
                kw["pulse"] = pulse
            if percent is not None:
                kw["total"] = percent
            on_progress(**kw)

        dfs = [(n, d) for n, d in abas.items() if d is not None and not (hasattr(d, "empty") and d.empty)]
        n = max(1, len(dfs))

        emit(5, "Criando arquivo…", pulse=False)

        with pd.ExcelWriter(caminho_saida, engine="openpyxl") as writer:
            for i, (nome, df) in enumerate(dfs, start=1):
                emit(10 + (75 * (i - 1) / n), f"Gravando aba: {nome}", pulse=False)
                df.to_excel(writer, sheet_name=str(nome)[:31], index=False)

        emit(90, "Aplicando formatação…", pulse=True)
        wb = load_workbook(caminho_saida)
        try:
            format.format_workbook(wb)
        except Exception:
            pass

        emit(97, "Salvando arquivo…", pulse=True)
        wb.save(caminho_saida)
        emit(100, "Concluído.", pulse=False)
