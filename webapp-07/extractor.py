"""Extrator de GNRE (PDF -> dados estruturados).

Pipeline:
1. Lê texto da página 1 do PDF com pdfplumber (preserva layout).
2. Divide em até 3 vias por marcadores "Nª via".
3. Extrai CNPJ destinatário e valor principal via regex anchored.
4. Cross-via: todas as vias parseadas precisam concordar nos campos críticos.
5. Validações finais (CPF/CNPJ checksum, valor > 0).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

import pdfplumber

from validators import (
    ValidationError,
    validate_cpf_cnpj,
    validate_valor_principal,
)


class ExtractionError(Exception):
    pass


_VIA_SPLIT = re.compile(r"\b([123])\s*[ªa]\s*via[^\n]*", re.IGNORECASE)
_RE_BR_VALOR = r"(\d{1,3}(?:\.\d{3})*,\d{2})"

_RE_CNPJ_DEST = re.compile(
    r"Dados\s+do\s+Destinat[áa]rio[\s\S]{0,200}?CNPJ/CPF/Insc\.\s*Est\.?\s*:\s*(\d{11,14})\b",
    re.IGNORECASE,
)
_RE_VALOR = re.compile(rf"Valor\s+principal[^\d]{{0,40}}{_RE_BR_VALOR}", re.IGNORECASE)
_RE_TOTAL = re.compile(rf"Total\s+a\s+recolher[^\d]{{0,80}}{_RE_BR_VALOR}", re.IGNORECASE)
_RE_VENC = re.compile(
    r"Data\s+de\s+vencimento[\s\S]{0,80}?(\d{2}/\d{2}/\d{4})", re.IGNORECASE
)
_RE_PERIODO = re.compile(
    r"Per[ií]odo\s+de\s+Refer[êe]ncia[\s\S]{0,80}?(\d{2}/\d{4})", re.IGNORECASE
)
_RE_CONTROLE = re.compile(
    r"No\s+de\s+Controle[\s\S]{0,80}?(\d{16})", re.IGNORECASE
)
_RE_UF = re.compile(
    r"UF\s+Favorecida[\s\S]{0,40}?\n\s*([A-Z]{2})\b", re.IGNORECASE
)


@dataclass
class ViaData:
    cnpj_destinatario: str
    valor_principal: Decimal
    total_recolher: Optional[Decimal]
    uf_favorecida: Optional[str]
    data_vencimento: Optional[str]  # ISO yyyy-mm-dd
    periodo_referencia: Optional[str]
    no_controle: Optional[str]


@dataclass
class GnreData:
    cnpj_destinatario: str
    valor_principal: Decimal
    uf_favorecida: Optional[str]
    data_vencimento: Optional[str]
    periodo_referencia: Optional[str]
    no_controle: Optional[str]
    vias_concordantes: int


def _read_page_text(path: str) -> str:
    with pdfplumber.open(path) as pdf:
        if not pdf.pages:
            raise ExtractionError("PDF sem páginas")
        return pdf.pages[0].extract_text() or ""


def _split_vias(text: str) -> list[str]:
    parts = _VIA_SPLIT.split(text)
    vias: list[str] = [parts[0]]
    for i in range(1, len(parts), 2):
        if i + 1 < len(parts):
            vias.append(parts[i + 1])
    return [v for v in vias if v.strip()]


def _parse_via(text: str) -> ViaData:
    m_cnpj = _RE_CNPJ_DEST.search(text)
    if not m_cnpj:
        raise ExtractionError("CNPJ/CPF do destinatário não encontrado")
    m_val = _RE_VALOR.search(text)
    if not m_val:
        raise ExtractionError("Valor principal não encontrado")

    cnpj = validate_cpf_cnpj(m_cnpj.group(1))
    valor = validate_valor_principal(m_val.group(1))

    m_tot = _RE_TOTAL.search(text)
    total = None
    if m_tot:
        try:
            total = validate_valor_principal(m_tot.group(1))
        except ValidationError:
            total = None

    m_venc = _RE_VENC.search(text)
    venc = None
    if m_venc:
        dd, mm, yyyy = m_venc.group(1).split("/")
        venc = f"{yyyy}-{mm}-{dd}"

    m_per = _RE_PERIODO.search(text)
    m_ctrl = _RE_CONTROLE.search(text)
    m_uf = _RE_UF.search(text)

    return ViaData(
        cnpj_destinatario=cnpj,
        valor_principal=valor,
        total_recolher=total,
        uf_favorecida=m_uf.group(1).upper() if m_uf else None,
        data_vencimento=venc,
        periodo_referencia=m_per.group(1) if m_per else None,
        no_controle=m_ctrl.group(1) if m_ctrl else None,
    )


def extract_gnre(path: str) -> GnreData:
    try:
        text = _read_page_text(path)
    except ExtractionError:
        raise
    except Exception as e:
        raise ExtractionError(f"falha ao abrir PDF: {e}") from e

    if not text.strip():
        raise ExtractionError("PDF sem texto extraível (provavelmente escaneado/imagem)")

    vias_text = _split_vias(text)
    if not vias_text:
        raise ExtractionError("nenhuma via detectada no PDF")

    parsed: list[ViaData] = []
    errors: list[str] = []
    for i, vt in enumerate(vias_text, 1):
        try:
            parsed.append(_parse_via(vt))
        except (ExtractionError, ValidationError) as e:
            errors.append(f"via {i}: {e}")

    if not parsed:
        raise ExtractionError(
            "nenhuma via pôde ser parseada — " + "; ".join(errors)
        )

    first = parsed[0]
    for i, v in enumerate(parsed[1:], 2):
        if v.cnpj_destinatario != first.cnpj_destinatario:
            raise ExtractionError(
                f"divergência entre vias: via 1 CNPJ={first.cnpj_destinatario} "
                f"vs via {i} CNPJ={v.cnpj_destinatario}"
            )
        if v.valor_principal != first.valor_principal:
            raise ExtractionError(
                f"divergência entre vias: via 1 valor={first.valor_principal} "
                f"vs via {i} valor={v.valor_principal}"
            )

    return GnreData(
        cnpj_destinatario=first.cnpj_destinatario,
        valor_principal=first.valor_principal,
        uf_favorecida=first.uf_favorecida,
        data_vencimento=first.data_vencimento,
        periodo_referencia=first.periodo_referencia,
        no_controle=first.no_controle,
        vias_concordantes=len(parsed),
    )
