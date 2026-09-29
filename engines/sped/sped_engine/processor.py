import re

from config import SHEET_ORDER

REG_RE = re.compile(r"^[0-9A-Z]{4}$")


def _resolve_export_regs(requested):
    """Lista de abas a exportar; vazio/None = os blocos core (SHEET_ORDER). Aceita qualquer REG de 4 caracteres."""
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
    if export_set & {"D101", "D105", "D190"}:
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
    def __init__(self, reader, parser, df_builder, writer, progress):
        self.reader = reader
        self.parser = parser
        self.df_builder = df_builder
        self.writer = writer
        self.progress = progress

    def run(self, sped_path, out_path, export_regs=None):
        export_regs = _resolve_export_regs(export_regs)
        text = self.reader.read(sped_path)
        data = self.parser.parse(text, build_parse_targets(export_regs))

        # Um passo por aba + a gravação do Excel.
        self.progress.start(len(export_regs) + 1)
        dfs = {}
        for rec in export_regs:
            dfs[rec] = self.df_builder.build(rec, data.get(rec, []))
            self.progress.tick_global(step_label=f"Registro {rec}")

        self.progress.tick_global("Gerando Excel")
        self.writer.write(dfs, out_path)
        return out_path
