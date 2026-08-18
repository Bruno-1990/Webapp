"""Gera XLSX com ate 3 abas: 'So em PDFs', 'So em XMLs' e 'Nao lidos'.

A aba 'Nao lidos' so aparece quando houve falha de extracao. Ela existe porque
a tela lista apenas os 10 primeiros arquivos que falharam — quem precisa
conferir o lote inteiro precisa da lista completa em algum lugar, e o XLSX e
o artefato que fica.

Formatacao visual:
  - Cabecalho: fundo azul (#4169E1, padrão do sistema), texto branco, negrito, altura 25, centralizado
  - Linhas de dados: altura 20, centralizadas
  - Bordas finas em todas as celulas, cor #CECECE
"""
from __future__ import annotations

from pathlib import Path

import xlsxwriter

from xml_parser import NfseEntry

HEADERS = (
    "Razao Social",
    "CNPJ Prestador",
    "CNPJ Tomador",
    "Numero NF",
    "Chave NF",
    "Arquivo",
)

# Largura das colunas (em chars). Mantem ordem de HEADERS.
_LARGURAS = (32, 20, 20, 14, 52, 40)

# Paleta:
#   - Header azul "bonito" (mesmo tom do branding interno)
#   - Texto branco
#   - Bordas finas cinza claro
_HEADER_BG = "#4169E1"
_HEADER_FG = "#FFFFFF"
_BORDER_COLOR = "#CECECE"
_HEADER_HEIGHT = 25
_ROW_HEIGHT = 20


def _build_formats(wb: xlsxwriter.Workbook):
    header = wb.add_format(
        {
            "bold": True,
            "bg_color": _HEADER_BG,
            "font_color": _HEADER_FG,
            "align": "center",
            "valign": "vcenter",
            "border": 1,
            "border_color": _BORDER_COLOR,
        }
    )
    body = wb.add_format(
        {
            "align": "center",
            "valign": "vcenter",
            "border": 1,
            "border_color": _BORDER_COLOR,
        }
    )
    body_mono = wb.add_format(
        {
            "align": "center",
            "valign": "vcenter",
            "border": 1,
            "border_color": _BORDER_COLOR,
            "font_name": "Consolas",
        }
    )
    return header, body, body_mono


def _write_sheet(ws, entries: list[NfseEntry], header_fmt, body_fmt, mono_fmt):
    ws.set_row(0, _HEADER_HEIGHT)
    for col, h in enumerate(HEADERS):
        ws.write(0, col, h, header_fmt)
    for row_idx, e in enumerate(entries, start=1):
        ws.set_row(row_idx, _ROW_HEIGHT)
        ws.write(row_idx, 0, e.razao_social_prestador or "", body_fmt)
        ws.write(row_idx, 1, e.cnpj_prestador or "", body_fmt)
        ws.write(row_idx, 2, e.cnpj_tomador or "", body_fmt)
        ws.write(row_idx, 3, e.numero_nf or "", body_fmt)
        # Chave NF em monospace ajuda a ler 50 digitos
        ws.write(row_idx, 4, e.chave_nf or "", mono_fmt)
        ws.write(row_idx, 5, e.source_file, body_fmt)

    for col, w in enumerate(_LARGURAS):
        ws.set_column(col, col, w)
    ws.freeze_panes(1, 0)


HEADERS_NAO_LIDOS = ("Arquivo", "Motivo")
_LARGURAS_NAO_LIDOS = (46, 90)


def _write_nao_lidos(ws, falhas: list[dict], header_fmt, left_fmt):
    ws.set_row(0, _HEADER_HEIGHT)
    for col, h in enumerate(HEADERS_NAO_LIDOS):
        ws.write(0, col, h, header_fmt)
    for row_idx, f in enumerate(falhas, start=1):
        ws.set_row(row_idx, _ROW_HEIGHT)
        # Aceita tanto {"file","reason"} quanto string pura (formato legado).
        if isinstance(f, str):
            arquivo, motivo = f, ""
        else:
            arquivo, motivo = f.get("file", ""), f.get("reason", "")
        ws.write(row_idx, 0, arquivo, left_fmt)
        ws.write(row_idx, 1, motivo, left_fmt)
    for col, w in enumerate(_LARGURAS_NAO_LIDOS):
        ws.set_column(col, col, w)
    ws.freeze_panes(1, 0)


def gerar_xlsx(
    output_path: str | Path,
    so_pdf: list[NfseEntry],
    so_xml: list[NfseEntry],
    nao_lidos: list[dict] | None = None,
) -> Path:
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb = xlsxwriter.Workbook(str(out))
    try:
        header_fmt, body_fmt, mono_fmt = _build_formats(wb)
        _write_sheet(wb.add_worksheet("So em PDFs"), so_pdf, header_fmt, body_fmt, mono_fmt)
        _write_sheet(wb.add_worksheet("So em XMLs"), so_xml, header_fmt, body_fmt, mono_fmt)
        if nao_lidos:
            # Motivo e texto corrido — alinhar a esquerda le muito melhor que
            # centralizado, que e o padrao das outras abas.
            left_fmt = wb.add_format({
                "align": "left",
                "valign": "vcenter",
                "border": 1,
                "border_color": _BORDER_COLOR,
            })
            _write_nao_lidos(wb.add_worksheet("Nao lidos"), nao_lidos, header_fmt, left_fmt)
    finally:
        wb.close()
    return out
