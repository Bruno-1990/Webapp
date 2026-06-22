"""
Cabeçalhos e descrições a partir de `cabecalhos_sped.txt` (Guia / referência interna).
Sobrepõe `config.HEADERS` exceto registos com campos injetados pelo parser (NUM_DOC/CHV).
"""
from __future__ import annotations

import re
from pathlib import Path

_INJECT_REGS = frozenset({"C170", "C190", "C590", "D190", "D590"})
# Traço ASCII, en-dash (U+2013) ou em-dash (U+2014) entre código e descrição
_REG_LINE = re.compile(r"^([0-9A-Z]{4})\s*[\u2013\u2014\-]\s*(.+)$", re.I)
_SEP_LINE = re.compile(r"^=+$")


def _default_path() -> Path:
    return Path(__file__).resolve().parent / "cabecalhos_sped.txt"


def parse_cabecalhos_sped(path: Path | None = None) -> tuple[dict[str, list[str]], dict[str, str], dict[str, str]]:
    """
    Retorna (headers_por_reg, descricao_curta_por_reg, bloco_secao_por_reg).
    """
    p = path or _default_path()
    if not p.is_file():
        return {}, {}, {}
    lines = p.read_text(encoding="utf-8").splitlines()
    headers: dict[str, list[str]] = {}
    descriptions: dict[str, str] = {}
    block_by_reg: dict[str, str] = {}
    current_block = ""
    i = 0
    n = len(lines)
    while i < n:
        s = lines[i].strip()
        if _SEP_LINE.fullmatch(s):
            i += 1
            if i < n:
                nxt = lines[i].strip()
                if nxt and not _SEP_LINE.fullmatch(nxt):
                    current_block = nxt
                    i += 1
            while i < n and _SEP_LINE.fullmatch(lines[i].strip()):
                i += 1
            continue
        m = _REG_LINE.match(s)
        if m:
            reg = m.group(1).upper()
            descriptions[reg] = m.group(2).strip()
            if current_block:
                block_by_reg[reg] = current_block
            i += 1
            if i < n:
                hdr = lines[i].strip()
                if "REG" in hdr.upper() and "|" in hdr:
                    parts = [x.strip() for x in hdr.split("|")]
                    while parts and parts[0] == "":
                        parts.pop(0)
                    while parts and parts[-1] == "":
                        parts.pop()
                    if parts:
                        headers[reg] = parts
                i += 1
            continue
        i += 1
    return headers, descriptions, block_by_reg


def merge_headers(config_headers: dict, path: Path | None = None) -> dict:
    """Junta config + ficheiro; ficheiro ganha exceto registos com injeção no parser."""
    file_h, _, _ = parse_cabecalhos_sped(path)
    out = dict(config_headers)
    for reg, cols in file_h.items():
        if reg in _INJECT_REGS:
            continue
        out[reg] = list(cols)
    return out
