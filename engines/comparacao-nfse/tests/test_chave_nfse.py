"""Validacao estrutural / cruzamento da chave de acesso.

O que esta em jogo: pela regra do comparador, um PDF COM chave nao cai no
fallback de (cnpj, numero). Uma chave lida errada pelo OCR portanto ELIMINA a
nota do match silenciosamente. Estes testes travam o comportamento que evita
isso — e, no outro sentido, travam que nao somos agressivos demais a ponto de
descartar chave boa.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chave_nfse import aceitar_chave_ocr, cruzar, estrutura_ok

# Chave real do lote de exemplo (Viana-ES). Contem, embutidos:
#   3205101         -> IBGE de Viana
#   34585211000155  -> CNPJ do prestador
#   0000000312      -> numero da nota (312)
CHAVE_REAL = "32051011234585211000155260000000031226030000654608"


# ─── estrutura ───────────────────────────────────────────────────────────────


def test_estrutura_aceita_44_e_50_digitos():
    assert estrutura_ok(CHAVE_REAL) is True
    assert estrutura_ok("1" * 43 + "2") is True  # 44 digitos, nao degenerada


def test_estrutura_rejeita_comprimento_errado():
    assert estrutura_ok("123") is False
    assert estrutura_ok("1" * 45) is False
    assert estrutura_ok(None) is False
    assert estrutura_ok("") is False


def test_estrutura_rejeita_nao_digitos():
    assert estrutura_ok("3205101X234585211000155260000000031226030000654608") is False


def test_estrutura_rejeita_sequencia_degenerada():
    """0000... e 9999... sao lixo tipico de OCR, nao chave."""
    assert estrutura_ok("0" * 50) is False
    assert estrutura_ok("9" * 44) is False


def test_estrutura_rejeita_ibge_impossivel():
    """Municipio brasileiro tem codigo IBGE de 1000000 a 5999999."""
    assert estrutura_ok("9" + CHAVE_REAL[1:]) is False
    assert estrutura_ok("0" + CHAVE_REAL[1:]) is False


# ─── cruzamento ──────────────────────────────────────────────────────────────


def test_cruzamento_corrobora_com_cnpj_e_numero():
    r = cruzar(CHAVE_REAL, cnpj_prestador="34585211000155", numero_nf="312")
    assert "cnpj_prestador" in r.corroboracoes
    assert "numero_nf" in r.corroboracoes
    assert r.suspeita is False


def test_cruzamento_sem_fatos_nao_acusa():
    """Sem nada para cruzar, a chave passa — nao inventamos suspeita."""
    r = cruzar(CHAVE_REAL)
    assert r.corroboracoes == ()
    assert r.contradicoes == ()
    assert r.suspeita is False


def test_cruzamento_com_uma_corroboracao_basta():
    """CNPJ confere mas numero nao: corroborado o suficiente, nao e suspeita."""
    r = cruzar(CHAVE_REAL, cnpj_prestador="34585211000155", numero_nf="99999")
    assert r.corroboracoes == ("cnpj_prestador",)
    assert r.contradicoes == ("numero_nf",)
    assert r.suspeita is False


def test_cruzamento_acusa_quando_nada_corrobora():
    r = cruzar(CHAVE_REAL, cnpj_prestador="11111111000111", numero_nf="99999")
    assert r.corroboracoes == ()
    assert r.suspeita is True


def test_cnpj_prestador_ausente_veta_mesmo_com_numero_corroborando():
    """Caso real do lote: OCR trocou digitos da chave do CAIPIRAO 7095.

    O numero "7095" ainda aparecia na chave corrompida (4 digitos casam por
    acaso com facilidade), entao a chave passava como boa. Resultado: a nota
    caiu em "So em PDFs" e o XML correspondente em "So em XMLs" — um match
    perdido. Os 14 digitos do CNPJ do prestador precisam ter poder de veto.
    """
    chave_ocr_errada = "33024037204708691000700000000000709526071548737839"
    r = cruzar(chave_ocr_errada, cnpj_prestador="04108691000100", numero_nf="7095")
    assert "numero_nf" in r.corroboracoes
    assert "cnpj_prestador" in r.contradicoes
    assert r.suspeita is True

    chave, motivo = aceitar_chave_ocr(
        chave_ocr_errada, cnpj_prestador="04108691000100", numero_nf="7095"
    )
    assert chave is None  # descartada -> volta a casar por (cnpj_tomador, numero)
    assert motivo is not None


def test_chave_correta_do_mesmo_caso_e_aceita():
    """Contraprova: a chave verdadeira do CAIPIRAO 7095 tem de passar."""
    chave_boa = "33024031204108691000100000000000709526071548737839"
    chave, motivo = aceitar_chave_ocr(
        chave_boa, cnpj_prestador="04108691000100", numero_nf="7095"
    )
    assert chave == chave_boa
    assert motivo is None


# ─── decisao de aceite (o que o OCR usa) ─────────────────────────────────────


def test_aceita_chave_boa():
    chave, motivo = aceitar_chave_ocr(
        CHAVE_REAL, cnpj_prestador="34585211000155", numero_nf="312"
    )
    assert chave == CHAVE_REAL
    assert motivo is None


def test_rejeita_chave_com_digito_trocado():
    """Um digito errado no CNPJ embutido derruba a corroboracao."""
    corrompida = CHAVE_REAL.replace("34585211000155", "34585211000156")
    chave, motivo = aceitar_chave_ocr(
        corrompida, cnpj_prestador="34585211000155", numero_nf="99999"
    )
    assert chave is None
    assert motivo is not None


def test_rejeitar_devolve_none_para_cair_no_fallback():
    """Rejeicao precisa devolver None (e nao levantar): e assim que o entry
    volta a poder casar por (cnpj_tomador, numero)."""
    chave, _ = aceitar_chave_ocr("0" * 50, cnpj_prestador=None, numero_nf=None)
    assert chave is None


def test_chave_ausente_nao_vira_erro():
    assert aceitar_chave_ocr(None) == (None, None)
