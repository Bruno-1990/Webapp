import re
import pandas as pd
from config import SHEET_ORDER

REG_RE = re.compile(r"^[0-9A-Z]{4}$")


def _resolve_export_regs(requested):
    """Lista de abas a exportar; vazio/None = os 11 blocos core. Aceita qualquer REG de 4 caracteres."""
    if not requested:
        return list(SHEET_ORDER)
    out = []
    seen = set()
    for x in requested:
        u = str(x).strip().upper()
        if not REG_RE.match(u) or u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out if out else list(SHEET_ORDER)


def minimal_context_regs(export_set):
    """Inclui pais no parse quando só os filhos são exportados (NUM_DOC/CHV coerentes)."""
    need = set()
    if "C170" in export_set or "C190" in export_set:
        need.add("C100")
    if "C590" in export_set:
        need.add("C500")
    if "D190" in export_set:
        need.add("D100")
    if "D590" in export_set:
        need.add("D500")
    return need


def build_parse_targets(export_regs):
    export_set = set(export_regs)
    ctx = minimal_context_regs(export_set)
    parse_set = set(SHEET_ORDER) | export_set | ctx
    tail = sorted(parse_set - set(SHEET_ORDER))
    return list(SHEET_ORDER) + tail


class Processor:
    def __init__(self, reader, parser, df_builder, writer, formatter, reporter, progress):
        self.reader = reader
        self.parser = parser
        self.df_builder = df_builder
        self.writer = writer
        self.formatter = formatter
        self.reporter = reporter
        self.progress = progress

    def run(self, sped_path, out_path, export_regs=None):
        export_regs = _resolve_export_regs(export_regs)
        export_set = set(export_regs)
        text = self.reader.read(sped_path)
        parse_targets = build_parse_targets(export_regs)
        data = self.parser.parse(text, parse_targets)
        razao, cnpj = self.parser.extract_razao_cnpj(text)

        summary, mismatches, dfs = [], [], {}
        total_steps = len(export_regs) + 2
        self.progress.start(total_steps)

        for rec in export_regs:
            rows = data.get(rec, [])
            df, mext, mm = self.df_builder.build(rec, rows)
            total_rows = len(rows)
            for i, r in enumerate(rows, start=1):
                self.progress.tick_local(i, total_rows, step_label=f"{rec}")
            dfs[rec] = df
            summary.append({"REGISTRO": rec, "LINHAS": len(rows), "MAX_EXTRAS": mext, "MISMATCH_REG": mm})
            self.progress.tick_global(step_label=f"Registro {rec}")
            self.progress.reset_local()
            if mm:
                for i, (_ln, r) in enumerate(rows, start=1):
                    if r and r[0].upper() != rec:
                        mismatches.append({"REGISTRO": rec, "LINHA_IDX": i, "VALOR_REG_ENCONTRADO": r[0]})

        from collections import defaultdict
        expected = defaultdict(list)
        current_num_doc = ""
        current_chv = ""
        current_num_doc_c500 = ""
        current_num_doc_d500 = ""

        for raw in text.splitlines():
            if "|" not in raw:
                continue
            fields = raw.rstrip("").split("|")
            if len(fields) < 2:
                continue
            regx = (fields[1] or "").upper()
            if regx == "C100":
                current_num_doc = fields[8] if len(fields) > 8 else ""
                current_chv = fields[9] if len(fields) > 9 else ""
            elif regx in ("C170", "C190"):
                expected[regx].append({"NUM_DOC": current_num_doc, "CHV_NFE": current_chv})
            elif regx == "C500":
                current_num_doc_c500 = fields[10] if len(fields) > 10 else ""
            elif regx == "C590":
                expected[regx].append({"NUM_DOC": current_num_doc_c500})
            elif regx == "D100":
                current_num_doc = fields[9] if len(fields) > 9 else ""
                current_chv = fields[10] if len(fields) > 10 else ""
            elif regx == "D190":
                expected[regx].append({"NUM_DOC": current_num_doc, "CHV_CTE": current_chv})
            elif regx == "D500":
                current_num_doc_d500 = fields[9] if len(fields) > 9 else ""
            elif regx == "D590":
                expected[regx].append({"NUM_DOC": current_num_doc_d500})

        link_checks = {}
        for _reg in ("C170", "C190", "C590", "D190", "D590"):
            try:
                df_tmp = dfs.get(_reg)
                exp_list = expected.get(_reg, [])
                if df_tmp is None:
                    link_checks[_reg] = {"present": False, "rows_excel": 0, "rows_expected": len(exp_list)}
                    continue
                has_num = "NUM_DOC" in df_tmp.columns
                has_chv = any(c in df_tmp.columns for c in ("CHV_NFE", "CHV_CTE"))
                n = min(len(df_tmp), len(exp_list))
                mismatches_list = []
                if has_num and has_chv and n > 0:
                    for i in range(n):
                        got_num = "" if pd.isna(df_tmp.iloc[i]["NUM_DOC"]) else str(df_tmp.iloc[i]["NUM_DOC"])
                        got_chv = ""
                        if "CHV_NFE" in df_tmp.columns:
                            got_chv = "" if pd.isna(df_tmp.iloc[i]["CHV_NFE"]) else str(df_tmp.iloc[i]["CHV_NFE"])
                        elif "CHV_CTE" in df_tmp.columns:
                            got_chv = "" if pd.isna(df_tmp.iloc[i]["CHV_CTE"]) else str(df_tmp.iloc[i]["CHV_CTE"])
                        exp_num = exp_list[i].get("NUM_DOC") or ""
                        exp_chv = exp_list[i].get("CHV_NFE") or exp_list[i].get("CHV_CTE") or ""
                        if got_num != exp_num or got_chv != exp_chv:
                            mismatches_list.append({
                                "index": i,
                                "expected_NUM_DOC": exp_num,
                                "got_NUM_DOC": got_num,
                                "expected_CHV": exp_chv,
                                "got_CHV": got_chv,
                            })
                if has_num and not has_chv and n > 0:
                    for i in range(n):
                        got_num = "" if pd.isna(df_tmp.iloc[i]["NUM_DOC"]) else str(df_tmp.iloc[i]["NUM_DOC"])
                        exp_num = exp_list[i].get("NUM_DOC") or ""
                        if got_num != exp_num:
                            mismatches_list.append({
                                "index": i,
                                "expected_NUM_DOC": exp_num,
                                "got_NUM_DOC": got_num,
                                "expected_CHV": "",
                                "got_CHV": "",
                            })
                link_checks[_reg] = {
                    "present": True,
                    "rows_excel": len(df_tmp),
                    "rows_expected": len(exp_list),
                    "has_NUM_DOC": has_num,
                    "has_CHV": has_chv,
                    "mismatch_count": len(mismatches_list),
                    "mismatches": mismatches_list[:500],
                }
            except Exception as _e:
                link_checks[_reg] = {"present": False, "error": str(_e)}

        dfs_out = {k: dfs[k] for k in export_regs if k in dfs}
        summary_out = [s for s in summary if s["REGISTRO"] in export_set]
        mismatches_out = [m for m in mismatches if m["REGISTRO"] in export_set]
        link_checks_out = {k: v for k, v in link_checks.items() if k in export_set}
        generic_export_regs = [r for r in export_regs if r not in self.df_builder.headers]

        self.writer.write(dfs_out, out_path)
        self.progress.animate_local("Gerando Excel", duration_ms=3000, steps=60)
        self.progress.tick_global("Gerando Excel")
        if self.reporter is not None:
            self.reporter.write_report(
                out_path,
                summary_out,
                mismatches_out,
                link_checks_out,
                razao,
                cnpj,
                generic_export_regs=generic_export_regs,
            )
            self.progress.animate_local("Gerando Relatório", duration_ms=3000, steps=60)
            self.progress.tick_global("Gerando Relatório")

        self.progress.animate_local("Finalizando", duration_ms=2000, steps=40)
        self.progress.tick_global("Finalizando…")
        self.progress.tick_global("Finalizado")
        return out_path
