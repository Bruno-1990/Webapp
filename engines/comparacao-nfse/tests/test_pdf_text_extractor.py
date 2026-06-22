"""Tests do extrator local (pdfplumber + heuristicas regex).

Mocka `extract_text` para nao depender de pdfplumber/PDFs reais — o objetivo
aqui e validar a logica de _find_* e o threshold de confianca.
"""
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pdf_text_extractor as pte


# Texto colado tipico do pdfplumber em NFS-e Curvelo (encoding mangled).
SAMPLE_TEXT_CURVELO = """MUNIC PIODECURVELO
DANFSev1.0 (38)3722-2921
DocumentoAuxiliardaNFS-e cadastroeconomico@curvelo.mg.gov.br
ChavedeAcessodaNFS-e
31209042202875317000105000000000013026039978146425
N meroDaNFS-e Compet ncia DataeHora
130 03/03/2026 03/03/202620:35:38
EMITENTEDANFS-e CNPJ/CPF/NIF Inscri o Telefone
PrestadordoServi o 02.875.317/0001-05 - -
TOMADORDOSERVI O CNPJ/CPF/NIF Inscri o Telefone
02.184.341/0002-70 - (28)3539-1357
INTERMEDI RIODOSERVI O ...
"""


def _patched_text(text):
    return patch.object(pte, "extract_text", return_value=text)


def test_extract_local_curvelo_completo():
    with _patched_text(SAMPLE_TEXT_CURVELO):
        entry = pte.extract_from_pdf_local(Path("nota.pdf"))
    assert entry is not None
    assert entry.chave_nf == "31209042202875317000105000000000013026039978146425"
    assert entry.numero_nf == "130"
    assert entry.cnpj_tomador == "02184341000270"
    assert entry.source_file == "nota.pdf"


def test_ignora_cnpj_do_prestador():
    """CNPJ do Prestador (02.875.317/0001-05) NAO deve sair como tomador."""
    with _patched_text(SAMPLE_TEXT_CURVELO):
        entry = pte.extract_from_pdf_local(Path("nota.pdf"))
    assert entry is not None
    assert entry.cnpj_tomador != "02875317000105"


def test_pdf_sem_texto_retorna_none():
    """Quando o PDF e scan (sem texto), extract_text retorna None -> entry None."""
    with _patched_text(None):
        entry = pte.extract_from_pdf_local(Path("scan.pdf"))
    assert entry is None


def test_texto_curto_descartado():
    """Texto < limiar minimo nao gera entry (= delegar para OCR)."""
    with _patched_text("muito pouco"):
        entry = pte.extract_from_pdf_local(Path("ruim.pdf"))
    assert entry is None


def test_apenas_chave_e_suficiente():
    """Se acharmos a chave, mesmo sem CNPJ/numero, e considerado match-suficiente."""
    txt = "Documento qualquer\n" + ("Lorem ipsum " * 20) + (
        "\nChave de acesso da NFS-e\n31209042202875317000105000000000013026039978146425\n"
    )
    with _patched_text(txt):
        entry = pte.extract_from_pdf_local(Path("a.pdf"))
    assert entry is not None
    assert entry.chave_nf == "31209042202875317000105000000000013026039978146425"


def test_so_cnpj_sem_numero_nem_chave_descarta():
    """Confianca minima: cnpj sozinho nao basta — cai pro OCR."""
    txt = (
        "Documento\n" + ("preenchimento " * 20) +
        "\nTomador\n02.184.341/0002-70\n"
    )
    with _patched_text(txt):
        entry = pte.extract_from_pdf_local(Path("a.pdf"))
    assert entry is None


def test_normalize_cnpj():
    assert pte._normalize_cnpj("02.184.341/0002-70") == "02184341000270"
    assert pte._normalize_cnpj("02184341000270") == "02184341000270"
    assert pte._normalize_cnpj("123") is None


def test_chave_44_digitos_aceita():
    """Chave NFe (44 digitos) tambem e aceita."""
    txt = "Chave de acesso\n" + "1" * 44 + "\n" + ("info " * 30)
    with _patched_text(txt):
        entry = pte.extract_from_pdf_local(Path("a.pdf"))
    assert entry is not None
    assert entry.chave_nf == "1" * 44
