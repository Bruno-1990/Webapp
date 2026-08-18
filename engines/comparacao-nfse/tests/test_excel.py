"""Verifica que o XLSX inclui as colunas Razao Social e CNPJ Prestador."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from excel import HEADERS, HEADERS_NAO_LIDOS, gerar_xlsx
from xml_parser import NfseEntry


# ─── Aba "Nao lidos" ─────────────────────────────────────────────────────────
# A tela lista so os 10 primeiros arquivos que falharam. Quem precisa auditar o
# lote inteiro depende desta aba — ela e o unico lugar com a lista completa.


def test_aba_nao_lidos_lista_todos_com_motivo(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")

    falhas = [
        {"file": "scan.pdf", "reason": "OCR local nao encontrou chave nem CNPJ + numero"},
        {"file": "quebrado.xml", "reason": "XML invalido ou sem dados de NFS-e reconheciveis"},
    ]
    out = tmp_path / "com_falhas.xlsx"
    gerar_xlsx(out, [], [], falhas)

    wb = openpyxl.load_workbook(out)
    assert "Nao lidos" in wb.sheetnames
    ws = wb["Nao lidos"]
    assert [c.value for c in ws[1]] == list(HEADERS_NAO_LIDOS)
    assert [c.value for c in ws[2]] == ["scan.pdf", falhas[0]["reason"]]
    assert [c.value for c in ws[3]] == ["quebrado.xml", falhas[1]["reason"]]


def test_aba_nao_lidos_nao_aparece_quando_tudo_foi_lido(tmp_path):
    """Sem falha, a aba nao existe — nao poluir o resultado do caso feliz."""
    openpyxl = pytest.importorskip("openpyxl")

    out = tmp_path / "sem_falhas.xlsx"
    gerar_xlsx(out, [], [], [])
    assert "Nao lidos" not in openpyxl.load_workbook(out).sheetnames

    out2 = tmp_path / "sem_arg.xlsx"
    gerar_xlsx(out2, [], [])
    assert "Nao lidos" not in openpyxl.load_workbook(out2).sheetnames


def test_aba_nao_lidos_aceita_formato_legado_de_string(tmp_path):
    """`pdfFalhos` ja foi lista de string antes de virar {file, reason}."""
    openpyxl = pytest.importorskip("openpyxl")

    out = tmp_path / "legado.xlsx"
    gerar_xlsx(out, [], [], ["antigo.pdf"])

    ws = openpyxl.load_workbook(out)["Nao lidos"]
    assert [c.value for c in ws[2]] == ["antigo.pdf", None]


def test_headers_incluem_prestador():
    assert "Razao Social" in HEADERS
    assert "CNPJ Prestador" in HEADERS
    # Ordem: Razao Social vem antes (mais legivel ao olhar a planilha)
    assert HEADERS.index("Razao Social") < HEADERS.index("CNPJ Prestador")


def test_xlsx_escreve_campos_do_prestador(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")  # so para ler de volta o xlsx

    so_pdf = [
        NfseEntry(
            cnpj_tomador="11111111000111",
            numero_nf="42",
            chave_nf=None,
            source_file="a.pdf",
            cnpj_prestador="22222222000122",
            razao_social_prestador="Prestador A LTDA",
        ),
    ]
    so_xml = [
        NfseEntry(
            cnpj_tomador=None,
            numero_nf="99",
            chave_nf="C99",
            source_file="b.xml",
            cnpj_prestador=None,
            razao_social_prestador=None,
        ),
    ]
    out = tmp_path / "result.xlsx"
    gerar_xlsx(out, so_pdf, so_xml)

    wb = openpyxl.load_workbook(out)
    ws_pdf = wb["So em PDFs"]
    headers = [c.value for c in ws_pdf[1]]
    assert "Razao Social" in headers
    assert "CNPJ Prestador" in headers
    row = [c.value for c in ws_pdf[2]]
    assert "Prestador A LTDA" in row
    assert "22222222000122" in row

    ws_xml = wb["So em XMLs"]
    row_x = [c.value for c in ws_xml[2]]
    # CNPJ Prestador / Razao Social ausentes devem virar string vazia (nao None)
    razao_idx = headers.index("Razao Social")
    cnpj_pres_idx = headers.index("CNPJ Prestador")
    assert row_x[razao_idx] in ("", None)
    assert row_x[cnpj_pres_idx] in ("", None)


def test_xlsx_formatacao_visual(tmp_path):
    """Header azul/bold, linhas altura 20, header altura 25, bordas finas #CECECE, centralizado."""
    openpyxl = pytest.importorskip("openpyxl")

    so_pdf = [
        NfseEntry(
            cnpj_tomador="11111111000111",
            numero_nf="42",
            chave_nf=None,
            source_file="a.pdf",
            cnpj_prestador="22222222000122",
            razao_social_prestador="Prestador A LTDA",
        ),
    ]
    out = tmp_path / "fmt.xlsx"
    gerar_xlsx(out, so_pdf, [])

    wb = openpyxl.load_workbook(out)
    ws = wb["So em PDFs"]

    # Altura do cabecalho (linha 1) = 25
    assert ws.row_dimensions[1].height == 25
    # Altura da linha de dados (2) = 20
    assert ws.row_dimensions[2].height == 20

    header_cell = ws.cell(row=1, column=1)
    # Header em negrito
    assert header_cell.font.bold is True
    # Header centralizado horizontal e vertical
    assert header_cell.alignment.horizontal == "center"
    assert header_cell.alignment.vertical == "center"
    # Header com fill azul (qualquer azul "bonito"; conferimos prefixo do FFsolid e nao ser branco)
    fill = header_cell.fill
    assert fill.patternType == "solid"
    fg = fill.fgColor.rgb
    # FF + 6 hex; nao pode ser branco ou padrao
    assert fg and fg.upper() not in ("00000000", "FFFFFFFF")
    # Cor texto do header — branco (legivel sobre azul)
    assert header_cell.font.color.rgb.upper() in ("FFFFFFFF", "00FFFFFF")

    # Borda fina cor #CECECE em todas as 4 direcoes
    border = header_cell.border
    for side_name in ("left", "right", "top", "bottom"):
        side = getattr(border, side_name)
        assert side.style == "thin", f"{side_name} nao eh thin"
        # openpyxl pode normalizar #CECECE como FFCECECE ou 00CECECE
        rgb = (side.color.rgb if side.color else "").upper()
        assert rgb.endswith("CECECE"), f"{side_name} cor={rgb}"

    # Cell de dados tambem centralizada
    data_cell = ws.cell(row=2, column=1)
    assert data_cell.alignment.horizontal == "center"
    assert data_cell.alignment.vertical == "center"
    # Data tambem com bordas
    db = data_cell.border
    assert db.left.style == "thin"
