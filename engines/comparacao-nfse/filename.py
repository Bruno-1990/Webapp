"""Geracao do nome do XLSX de saida baseada em razao social do tomador.

Padrao:
  "Comparacao NFSE - <razao_tomador> - YYYY-MM-DD HHhMM.xlsx"

Quando nenhum entry tem razao social do tomador, omite essa parte:
  "Comparacao NFSE - YYYY-MM-DD HHhMM.xlsx"
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Iterable

from xml_parser import NfseEntry

# Caracteres invalidos em nome de arquivo no Windows e em geral inseguros pra
# Content-Disposition. Mapeamos pra "_".
_INVALID_FILE_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_MULTISPACE = re.compile(r"\s+")
_MAX_RAZAO_LEN = 80
_PREFIX = "Comparacao NFSE"


def sanitize_filename_part(value: str | None) -> str:
    if not value:
        return ""
    s = _INVALID_FILE_CHARS.sub("_", str(value))
    s = _MULTISPACE.sub(" ", s).strip()
    return s


def _pick_razao_social_tomador(entries: Iterable[NfseEntry]) -> str | None:
    """Primeira razao social do tomador nao-vazia que aparecer nos entries.

    Premissa: usuario rodando comparacao tem todas as notas de UM tomador
    (a empresa dele). Se houver mais de uma razao por engano, pega a primeira.
    """
    for e in entries:
        razao = sanitize_filename_part(getattr(e, "razao_social_tomador", None))
        if razao:
            return razao[:_MAX_RAZAO_LEN]
    return None


def build_xlsx_filename(
    entries: Iterable[NfseEntry],
    *,
    now: datetime | None = None,
) -> str:
    """Compoe nome do arquivo XLSX de saida.

    `entries` deve incluir tanto soPdf quanto soXml (tipicamente concatenados);
    o helper procura a primeira razao_social_tomador nao vazia.
    """
    ts = (now or datetime.now()).strftime("%Y-%m-%d %Hh%M")
    razao = _pick_razao_social_tomador(entries)
    if razao:
        return f"{_PREFIX} - {razao} - {ts}.xlsx"
    return f"{_PREFIX} - {ts}.xlsx"
