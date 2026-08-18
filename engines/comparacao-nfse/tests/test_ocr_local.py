"""Extracao por posicao (bounding box) do OCR local.

Estes testes montam Box sinteticos e nao carregam PyMuPDF/RapidOCR — as
dependencias pesadas sao importadas lazy dentro das funcoes de render/OCR.
Assim a logica de layout, que e onde moram os bugs, roda em CI leve.

O caso que motivou tudo isso: em DANFSe o rotulo ("N da Nota Fiscal") fica numa
celula e o valor noutra, logo ABAIXO. Texto linearizado perde essa relacao e o
regex acaba pescando digito do vizinho — ja capturou "59" de dentro do CNPJ
"59.955.346/0001-96" e dia de data de emissao.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ocr_local
from ocr_local import (
    Box,
    entry_from_boxes,
    find_chave,
    find_cnpj_em_secao,
    find_numero,
    linear_text,
)

CHAVE_REAL = "32051011234585211000155260000000031226030000654608"


def box(text, x0, y0, x1=None, y1=None):
    """Helper: caixa com tamanho plausivel quando nao especificado."""
    return Box(text, x0, y0, x1 if x1 is not None else x0 + 10 * len(text), y1 if y1 is not None else y0 + 12)


# ─── numero: rotulo -> valor por posicao ─────────────────────────────────────


def test_numero_pega_valor_abaixo_do_rotulo():
    """Layout dominante em DANFSe: cabecalho de coluna, valor na linha de baixo."""
    boxes = [
        box("Nº da Nota Fiscal", 800, 100, 950, 112),
        box("312", 850, 140, 890, 152),
    ]
    assert find_numero(boxes) == "312"


def test_numero_pega_valor_a_direita_do_rotulo():
    boxes = [
        box("Numero da Nota", 100, 100, 220, 112),
        box("4693", 240, 100, 290, 112),
    ]
    assert find_numero(boxes) == "4693"


def test_numero_ignora_rps_e_integral():
    """'Numero RPS' e 'N Integral' convivem na mesma tabela e nao sao a nota."""
    boxes = [
        box("Numero RPS", 400, 100, 500, 112),
        box("777", 420, 140, 460, 152),
        box("Nº Integral", 600, 100, 700, 112),
        box("202600000000043", 610, 140, 760, 152),
    ]
    assert find_numero(boxes) is None


def test_numero_nao_vem_de_cnpj_vizinho():
    """O bug real: numero capturado de dentro de 59.955.346/0001-96."""
    boxes = [
        box("Numero NFS-e", 100, 100, 210, 112),
        box("59.955.346/0001-96", 100, 140, 300, 152),
        box("322", 100, 180, 140, 192),
    ]
    assert find_numero(boxes) == "322"


def test_numero_aceita_formato_com_ano():
    """'43/2026' -> 43 (o /2026 e o exercicio, nao parte do numero)."""
    boxes = [
        box("Nº da Nota", 100, 100, 200, 112),
        box("43/2026", 100, 140, 180, 152),
    ]
    assert find_numero(boxes) == "43"


def test_numero_descarta_zeros_a_esquerda():
    boxes = [box("Numero da Nota", 100, 100, 220, 112), box("000130", 100, 140, 170, 152)]
    assert find_numero(boxes) == "130"


# ─── secoes: CNPJ do tomador x do prestador ──────────────────────────────────


def _boxes_com_duas_secoes():
    return [
        box("PRESTADOR", 100, 100, 200, 112),
        box("CNPJ: 34.585.211/0001-55", 100, 130, 320, 142),
        box("TOMADOR", 100, 200, 190, 212),
        box("CNPJ: 02.184.341/0002-70", 100, 230, 320, 242),
        box("DISCRIMINACAO", 100, 300, 240, 312),
        box("CNPJ: 99.999.999/9999-99", 100, 330, 320, 342),
    ]


def test_cnpj_tomador_vem_do_bloco_do_tomador():
    boxes = _boxes_com_duas_secoes()
    assert find_cnpj_em_secao(boxes, ("tomador",)) == "02184341000270"


def test_cnpj_prestador_vem_do_bloco_do_prestador():
    boxes = _boxes_com_duas_secoes()
    assert find_cnpj_em_secao(boxes, ("prestador", "emitente")) == "34585211000155"


def test_bloco_do_tomador_nao_vaza_para_secao_seguinte():
    """O CNPJ sob DISCRIMINACAO nao pode ser lido como do tomador."""
    boxes = _boxes_com_duas_secoes()
    assert find_cnpj_em_secao(boxes, ("tomador",)) != "99999999999999"


def test_secao_ausente_devolve_none():
    boxes = [box("PRESTADOR", 100, 100), box("CNPJ: 34.585.211/0001-55", 100, 130)]
    assert find_cnpj_em_secao(boxes, ("tomador",)) is None


def test_frase_longa_nao_conta_como_cabecalho_de_secao():
    """'RECEBEMOS DO TOMADOR OS SERVICOS...' e texto corrido, nao secao."""
    boxes = [
        box("RECEBEMOS DO TOMADOR OS PRODUTOS E SERVICOS CONSTANTES DA NOTA", 100, 50),
        box("CNPJ: 11.111.111/1111-11", 100, 80),
        box("TOMADOR", 100, 200, 190, 212),
        box("CNPJ: 02.184.341/0002-70", 100, 230, 320, 242),
    ]
    assert find_cnpj_em_secao(boxes, ("tomador",)) == "02184341000270"


# ─── chave ───────────────────────────────────────────────────────────────────


def test_chave_em_caixa_unica():
    assert find_chave([box(CHAVE_REAL, 100, 100)]) == CHAVE_REAL


def test_chave_quebrada_em_varias_caixas_da_mesma_linha():
    """OCR costuma partir sequencias longas em pedacos."""
    boxes = [
        box(CHAVE_REAL[:20], 100, 100, 300, 112),
        box(CHAVE_REAL[20:35], 310, 101, 450, 113),
        box(CHAVE_REAL[35:], 460, 100, 600, 112),
    ]
    assert find_chave(boxes) == CHAVE_REAL


def test_chave_ignora_numeros_curtos():
    assert find_chave([box("312", 100, 100), box("02184341000270", 100, 130)]) is None


# ─── montagem do entry ───────────────────────────────────────────────────────


def test_entry_exige_identidade_minima():
    """Sem chave e sem (cnpj + numero), o arquivo tem de ser reportado como
    nao lido — nunca virar entry pela metade."""
    assert entry_from_boxes([box("NOTA FISCAL DE SERVICOS", 100, 100)], "x.pdf") is None


def test_entry_por_cnpj_e_numero():
    boxes = [
        box("TOMADOR", 100, 200, 190, 212),
        box("CNPJ: 02.184.341/0002-70", 100, 230, 320, 242),
        box("Numero da Nota", 600, 100, 720, 112),
        box("136", 600, 140, 640, 152),
    ]
    e = entry_from_boxes(boxes, "nota.pdf")
    assert e is not None
    assert e.cnpj_tomador == "02184341000270"
    assert e.numero_nf == "136"
    assert e.method == "ocr-local"
    assert e.source_file == "nota.pdf"


def test_entry_rejeita_chave_que_nao_confere():
    """Chave corrompida + prestador/numero legiveis -> chave descartada, mas o
    entry sobrevive pelo par (cnpj, numero). Esse e o ganho: em vez de sumir,
    a nota volta a poder casar pelo fallback."""
    corrompida = "3205101" + "9" * 43
    boxes = [
        box(corrompida, 100, 60, 700, 72),
        box("PRESTADOR", 100, 100, 200, 112),
        box("CNPJ: 34.585.211/0001-55", 100, 130, 320, 142),
        box("TOMADOR", 100, 200, 190, 212),
        box("CNPJ: 02.184.341/0002-70", 100, 230, 320, 242),
        box("Numero da Nota", 600, 100, 720, 112),
        box("312", 600, 140, 640, 152),
    ]
    e = entry_from_boxes(boxes, "nota.pdf")
    assert e is not None
    assert e.chave_nf is None
    assert e.numero_nf == "312"
    assert e.cnpj_tomador == "02184341000270"


def test_entry_mantem_chave_que_confere():
    boxes = [
        box(CHAVE_REAL, 100, 60, 700, 72),
        box("PRESTADOR", 100, 100, 200, 112),
        box("CNPJ: 34.585.211/0001-55", 100, 130, 320, 142),
        box("TOMADOR", 100, 200, 190, 212),
        box("CNPJ: 02.184.341/0002-70", 100, 230, 320, 242),
    ]
    e = entry_from_boxes(boxes, "nota.pdf")
    assert e is not None
    assert e.chave_nf == CHAVE_REAL


def test_entry_vazio_sem_caixas():
    assert entry_from_boxes([], "x.pdf") is None


# ─── texto linearizado (rede de seguranca) ───────────────────────────────────


def test_linear_text_agrupa_por_linha():
    boxes = [
        box("PREFEITURA", 100, 100, 200, 112),
        box("DE VIANA", 210, 101, 300, 113),
        box("TOMADOR", 100, 200, 190, 212),
    ]
    linhas = linear_text(boxes).splitlines()
    assert linhas[0] == "PREFEITURA DE VIANA"
    assert linhas[1] == "TOMADOR"


def test_linear_text_vazio():
    assert linear_text([]) == ""


# ─── configuracao ────────────────────────────────────────────────────────────


def test_dpi_ladder_sobe_e_respeita_env(monkeypatch):
    monkeypatch.delenv("NFSE_OCR_LOCAL_DPI", raising=False)
    monkeypatch.delenv("NFSE_OCR_LOCAL_DPI_RETRY", raising=False)
    assert ocr_local.dpi_ladder() == (300, 400)

    monkeypatch.setenv("NFSE_OCR_LOCAL_DPI", "150")
    monkeypatch.setenv("NFSE_OCR_LOCAL_DPI_RETRY", "220")
    assert ocr_local.dpi_ladder() == (150, 220)


def test_dpi_ladder_ignora_retry_menor_que_o_inicial(monkeypatch):
    monkeypatch.setenv("NFSE_OCR_LOCAL_DPI", "400")
    monkeypatch.setenv("NFSE_OCR_LOCAL_DPI_RETRY", "200")
    assert ocr_local.dpi_ladder() == (400,)


def test_concurrency_e_cpu_bound(monkeypatch):
    """Diferente do Gemini (I/O bound, default 8), OCR local disputa nucleo."""
    monkeypatch.delenv("NFSE_OCR_LOCAL_CONCURRENCY", raising=False)
    monkeypatch.setattr(ocr_local.os, "cpu_count", lambda: 8)
    assert ocr_local.concurrency() == 7

    monkeypatch.setenv("NFSE_OCR_LOCAL_CONCURRENCY", "3")
    assert ocr_local.concurrency() == 3


def test_concurrency_nunca_zero(monkeypatch):
    monkeypatch.delenv("NFSE_OCR_LOCAL_CONCURRENCY", raising=False)
    monkeypatch.setattr(ocr_local.os, "cpu_count", lambda: 1)
    assert ocr_local.concurrency() == 1
