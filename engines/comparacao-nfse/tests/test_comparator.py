"""Match entre entries vindas de PDFs (Gemini) e XMLs."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from comparator import comparar
from xml_parser import NfseEntry


def e(num=None, cnpj=None, chave=None, source="x"):
    return NfseEntry(
        cnpj_tomador=cnpj, numero_nf=num, chave_nf=chave, source_file=source
    )


def test_match_por_chave_mesmo_com_numeros_diferentes():
    pdfs = [e(num="1", cnpj="A", chave="CHV1", source="a.pdf")]
    xmls = [e(num="X", cnpj="B", chave="CHV1", source="a.xml")]
    r = comparar(pdfs, xmls)
    assert r.matched_count == 1
    assert r.so_pdf == []
    assert r.so_xml == []


def test_match_por_cnpj_numero_quando_nao_tem_chave():
    pdfs = [e(num="10", cnpj="CNPJ_A", source="a.pdf")]
    xmls = [e(num="10", cnpj="CNPJ_A", source="a.xml")]
    r = comparar(pdfs, xmls)
    assert r.matched_count == 1


def test_so_em_pdf():
    pdfs = [e(num="1", cnpj="A", chave="C1", source="a.pdf")]
    xmls = []
    r = comparar(pdfs, xmls)
    assert r.matched_count == 0
    assert len(r.so_pdf) == 1
    assert r.so_pdf[0].numero_nf == "1"
    assert r.so_xml == []


def test_so_em_xml():
    pdfs = []
    xmls = [e(num="2", cnpj="B", chave="C2", source="a.xml")]
    r = comparar(pdfs, xmls)
    assert r.matched_count == 0
    assert r.so_pdf == []
    assert len(r.so_xml) == 1


def test_listas_vazias():
    r = comparar([], [])
    assert r.matched_count == 0
    assert r.so_pdf == []
    assert r.so_xml == []


def test_mistura_parcial():
    pdfs = [
        e(num="1", cnpj="A", chave="C1", source="1.pdf"),
        e(num="2", cnpj="A", chave="C2", source="2.pdf"),
        e(num="3", cnpj="A", source="3.pdf"),
    ]
    xmls = [
        e(num="1", cnpj="A", chave="C1", source="1.xml"),
        e(num="99", cnpj="A", chave="C99", source="99.xml"),
        e(num="3", cnpj="A", source="3.xml"),
    ]
    r = comparar(pdfs, xmls)
    assert r.matched_count == 2
    assert [x.numero_nf for x in r.so_pdf] == ["2"]
    assert [x.numero_nf for x in r.so_xml] == ["99"]


def test_pdf_com_chave_nao_cai_em_fallback_cnpj_numero():
    """Regra do negocio: se PDF tem chave e ela nao bate, NAO tenta (cnpj+numero).
    Ex.: PDF com chave erradinha mas cnpj+numero corretos -> ainda asim sem match.
    """
    pdfs = [e(num="42", cnpj="A", chave="DIFERENTE", source="a.pdf")]
    xmls = [e(num="42", cnpj="A", chave="C1", source="a.xml")]
    r = comparar(pdfs, xmls)
    assert r.matched_count == 0
    assert len(r.so_pdf) == 1
    assert len(r.so_xml) == 1


def test_pdf_sem_chave_casa_com_xml_que_tem_chave_via_cnpj_numero():
    """OCR de imagem nao pegou chave; XML do mesmo nota tem chave. Como o PDF
    nao tem chave, cai em pass 2 e casa por (cnpj+numero) — mesmo que XML
    tenha chave.
    """
    pdfs = [e(num="42", cnpj="A", source="img.pdf")]
    xmls = [e(num="42", cnpj="A", chave="C1", source="a.xml")]
    r = comparar(pdfs, xmls)
    assert r.matched_count == 1
    assert r.so_pdf == []
    assert r.so_xml == []


def test_xml_consumido_uma_vez_por_match_de_chave():
    """Dois PDFs com mesma chave: so o primeiro casa, segundo fica em so_pdf."""
    pdfs = [
        e(num="1", cnpj="A", chave="C1", source="a.pdf"),
        e(num="1", cnpj="A", chave="C1", source="b.pdf"),
    ]
    xmls = [e(num="1", cnpj="A", chave="C1", source="a.xml")]
    r = comparar(pdfs, xmls)
    assert r.matched_count == 1
    assert len(r.so_pdf) == 1


def test_pass2_nao_consome_xml_ja_matcheado_em_pass1():
    """XML matcheado por chave em pass 1 nao deve aparecer como candidato em pass 2."""
    pdfs = [
        e(num="42", cnpj="A", chave="C1", source="com_chave.pdf"),
        e(num="42", cnpj="A", source="sem_chave.pdf"),  # nao deve casar; XML ja foi
    ]
    xmls = [e(num="42", cnpj="A", chave="C1", source="a.xml")]
    r = comparar(pdfs, xmls)
    assert r.matched_count == 1
    assert [p.source_file for p in r.so_pdf] == ["sem_chave.pdf"]
    assert r.so_xml == []


# ─── Detecção de duplicados de PDF ──────────────────────────────────────────

def test_sem_duplicados_grupo_vazio():
    pdfs = [
        e(num="1", cnpj="A", chave="C1", source="1.pdf"),
        e(num="2", cnpj="A", chave="C2", source="2.pdf"),
    ]
    xmls = []
    r = comparar(pdfs, xmls)
    assert r.duplicados_pdf == []


def test_duplicados_por_chave():
    """Dois PDFs com a mesma chave: um casa, outro fica em so_pdf,
    e o grupo de duplicados eh reportado."""
    pdfs = [
        e(num="1", cnpj="A", chave="C1", source="a.pdf"),
        e(num="1", cnpj="A", chave="C1", source="b.pdf"),
    ]
    xmls = [e(num="1", cnpj="A", chave="C1", source="a.xml")]
    r = comparar(pdfs, xmls)
    assert r.matched_count == 1
    assert len(r.so_pdf) == 1
    assert len(r.duplicados_pdf) == 1
    g = r.duplicados_pdf[0]
    assert g.chave_nf == "C1"
    assert g.cnpj_tomador is None and g.numero_nf is None
    assert {x.source_file for x in g.entries} == {"a.pdf", "b.pdf"}


def test_duplicados_por_cnpj_numero():
    """Tres PDFs sem chave compartilham (cnpj, numero). Apenas 1 casa,
    2 ficam em so_pdf, e o grupo lista os 3."""
    pdfs = [
        e(num="42", cnpj="A", source="a.pdf"),
        e(num="42", cnpj="A", source="b.pdf"),
        e(num="42", cnpj="A", source="c.pdf"),
    ]
    xmls = [e(num="42", cnpj="A", source="x.xml")]
    r = comparar(pdfs, xmls)
    assert r.matched_count == 1
    assert len(r.so_pdf) == 2
    assert len(r.duplicados_pdf) == 1
    g = r.duplicados_pdf[0]
    assert g.chave_nf is None
    assert g.cnpj_tomador == "A" and g.numero_nf == "42"
    assert len(g.entries) == 3


def test_duplicados_por_chave_tem_prioridade_sobre_cnpj_numero():
    """Quando dois PDFs ja foram agrupados por chave, eles nao reaparecem
    no agrupamento por (cnpj, numero) — mesmo que tambem coincidam la."""
    pdfs = [
        e(num="1", cnpj="A", chave="C1", source="a.pdf"),
        e(num="1", cnpj="A", chave="C1", source="b.pdf"),
    ]
    r = comparar(pdfs, [])
    assert len(r.duplicados_pdf) == 1
    assert r.duplicados_pdf[0].chave_nf == "C1"


def test_duplicados_invariante_de_fechamento():
    """Mesmo com duplicados, len(so_pdf) + matched == len(pdfs)."""
    pdfs = [
        e(num="1", cnpj="A", chave="C1", source="a.pdf"),
        e(num="1", cnpj="A", chave="C1", source="b.pdf"),
        e(num="1", cnpj="A", chave="C1", source="c.pdf"),
    ]
    xmls = [e(num="1", cnpj="A", chave="C1", source="x.xml")]
    r = comparar(pdfs, xmls)
    assert r.matched_count + len(r.so_pdf) == len(pdfs)
    assert r.matched_count + len(r.so_xml) == len(xmls)
