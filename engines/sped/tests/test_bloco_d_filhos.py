"""D101/D105 — filhos do D100 (EFD Contribuições): parse, vínculo e colunas na exportação."""
from __future__ import annotations

from pathlib import Path

import pytest

from cabecalhos_sped import merge_headers
from config import HEADERS, SHEET_ORDER
from dataframe_builder import DefaultDataFrameBuilder
from parser import DefaultSpedParser
from processor import build_parse_targets, minimal_context_regs

FIXTURES = Path(__file__).parent / "fixtures"
TEXTO = (FIXTURES / "sped_bloco_d.txt").read_text(encoding="utf-8")

NUM_DOC_1 = "12345"
CHV_CTE_1 = "53240912345678000199570010000123451000123456"
NUM_DOC_2 = "67890"
CHV_CTE_2 = "53240912345678000199570010000678901000678902"


@pytest.fixture(scope="module")
def dados():
    return DefaultSpedParser().parse(TEXTO, build_parse_targets(list(SHEET_ORDER)))


def test_d101_d105_estao_nas_abas_core():
    assert "D101" in SHEET_ORDER and "D105" in SHEET_ORDER
    # imediatamente após o pai D100 e antes do D190
    assert SHEET_ORDER.index("D100") < SHEET_ORDER.index("D101") < SHEET_ORDER.index("D190")
    assert SHEET_ORDER.index("D100") < SHEET_ORDER.index("D105") < SHEET_ORDER.index("D190")


def test_headers_d101_d105_com_campos_do_layout():
    assert HEADERS["D101"] == [
        "REG", "NUM_DOC", "CHV_CTE", "IND_NAT_FRT", "VL_ITEM", "CST_PIS", "NAT_BC_CRED",
        "VL_BC_PIS", "ALIQ_PIS", "VL_PIS", "COD_CTA", "COD_CCUS",
    ]
    assert HEADERS["D105"] == [
        "REG", "NUM_DOC", "CHV_CTE", "IND_NAT_FRT", "VL_ITEM", "CST_COFINS", "NAT_BC_CRED",
        "VL_BC_COFINS", "ALIQ_COFINS", "VL_COFINS", "COD_CTA", "COD_CCUS",
    ]


def test_guia_nao_sobrescreve_colunas_injetadas():
    """merge_headers não pode remover NUM_DOC/CHV_CTE de D101/D105 (regs com injeção)."""
    merged = merge_headers(HEADERS)
    for reg in ("D101", "D105", "D190"):
        assert merged[reg][:3] == ["REG", "NUM_DOC", "CHV_CTE"], reg


@pytest.mark.parametrize("reg", ["D101", "D105"])
def test_parser_injeta_num_doc_e_chave_do_d100_pai(dados, reg):
    linhas = [parts for _ln, parts in dados[reg]]
    assert len(linhas) == 2
    assert linhas[0][:3] == [reg, NUM_DOC_1, CHV_CTE_1]
    assert linhas[1][:3] == [reg, NUM_DOC_2, CHV_CTE_2]


def test_valores_d101_d105_preservam_ordem_do_layout(dados):
    d101 = DefaultDataFrameBuilder(merge_headers(HEADERS)).build("D101", dados["D101"])[0]
    assert d101.loc[0, "VL_ITEM"] == "1000,00"
    assert d101.loc[0, "CST_PIS"] == "50"
    assert d101.loc[0, "ALIQ_PIS"] == "1,65"
    assert d101.loc[0, "VL_PIS"] == "16,50"
    assert d101.loc[0, "COD_CCUS"] == "CC01"

    d105 = DefaultDataFrameBuilder(merge_headers(HEADERS)).build("D105", dados["D105"])[0]
    assert d105.loc[1, "VL_BC_COFINS"] == "2000,00"
    assert d105.loc[1, "ALIQ_COFINS"] == "7,60"
    assert d105.loc[1, "VL_COFINS"] == "152,00"


@pytest.mark.parametrize("reg", ["D101", "D105", "D190"])
def test_contexto_minimo_inclui_o_pai_d100(reg):
    assert "D100" in minimal_context_regs({reg})


def test_d190_e_c170_seguem_intactos(dados):
    """Regressão: os filhos já existentes continuam com o vínculo correto."""
    d190 = [parts for _ln, parts in dados["D190"]]
    assert len(d190) == 2
    assert d190[0][:3] == ["D190", NUM_DOC_1, CHV_CTE_1]
    assert d190[1][:3] == ["D190", NUM_DOC_2, CHV_CTE_2]


def test_d100_pai_nao_ganha_colunas_injetadas(dados):
    pai = [parts for _ln, parts in dados["D100"]]
    assert len(pai) == 2
    assert pai[0][0] == "D100"
    assert pai[0][8] == NUM_DOC_1
    assert pai[0][9] == CHV_CTE_1
