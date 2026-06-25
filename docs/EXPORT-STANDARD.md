# Padrão de planilha de exportação (.xlsx) — todo o sistema

Padrão visual e técnico **único** para todo `.xlsx` gerado por qualquer ferramenta
do webapp (Node/ExcelJS ou Python/openpyxl/xlsxwriter). Objetivo: toda planilha
entregue ao usuário ter a mesma cara, independentemente da ferramenta.

> **Implementação de referência:** `webapp-01/frontend/src/extratoEdit/exportExtrato.ts`
> (Editor de Extrato). É a "nossa planilha" que define este padrão.

---

## 1. Tokens canônicos

Use **exatamente** estes valores. Em ExcelJS as cores são **ARGB** (com `FF` de
alfa na frente); em openpyxl/xlsxwriter são **RGB** (sem o `FF`).

| Token | Valor (RGB) | ARGB (ExcelJS) | Onde |
|---|---|---|---|
| **Azul cabeçalho** (Royal Blue) | `4169E1` | `FF4169E1` | fundo da linha 1 |
| **Texto cabeçalho** (branco) | `FFFFFF` | `FFFFFFFF` | fonte da linha 1 |
| **Texto dados** (quase-preto) | `1A1A1F` | `FF1A1A1F` | fonte das células de dados |
| **Borda** (cinza claro) | `CECECE` | `FFCECECE` | todas as bordas, todas as células |

| Parâmetro | Valor |
|---|---|
| Fonte (cabeçalho e dados) | **Calibri 11** |
| Cabeçalho | **negrito**, cor branca |
| Dados | normal, cor `1A1A1F` |
| **Alinhamento (tudo)** | horizontal **center**, vertical **middle** — cabeçalho **e** dados |
| Altura da linha de cabeçalho | **30** |
| Altura das linhas de dados | **22** |
| Borda | `thin` cinza `CECECE` nos **4 lados**, em **todas** as células (cabeçalho + dados) |
| Linhas de grade (gridlines) | **desligadas** na visualização |
| Congelar cabeçalho | **sim** — congela a linha 1 (freeze panes / `frozen ySplit:1`) |
| Largura das colunas | **automática**: `clamp(10, maiorConteúdoDaColuna + 2, 60)` (datas contam como 10) |
| Nome da aba | curto e descritivo (ex.: `Extrato`, `Lançamentos`) |

### Tipos de célula (não jogue tudo como texto)
- **Números** entram como **número real** (não string), com `numFmt`:
  - moeda/valor: `#,##0.00`
  - quantidade: `#,##0.####`
  - alíquota/percentual: `0.00`
- **Datas** entram como **data real**, formato de exibição `dd/mm/yyyy`.
- Texto puro fica como texto. (Centralizado, conforme alinhamento acima.)

### Nome do arquivo
- Legível, com espaços e maiúsculas iniciais; **sem** os caracteres proibidos no
  Windows (`\ / : * ? " < > |`).
- Forma sugerida: `<Relatório> - <identificador> - <AAAA-MM-DD>.xlsx`
  (partes opcionais). Ex.: `Extrato Bancário - editado.xlsx`,
  `GNRE - Extração - 2026-06-25.xlsx`.

---

## 2. Receita ExcelJS (Node/TypeScript)

Cópia fiel de `exportExtrato.ts`. Aplique a **todas** as abas.

```ts
import ExcelJS from "exceljs";

const HEADER_FILL_ARGB = "FF4169E1";
const HEADER_FONT_ARGB = "FFFFFFFF";
const DATA_FONT_ARGB = "FF1A1A1F";
const BORDER_ARGB = "FFCECECE";
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 22;
const FONT_NAME = "Calibri";
const FONT_SIZE = 11;

const THIN_BORDER = {
  top: { style: "thin", color: { argb: BORDER_ARGB } },
  left: { style: "thin", color: { argb: BORDER_ARGB } },
  bottom: { style: "thin", color: { argb: BORDER_ARGB } },
  right: { style: "thin", color: { argb: BORDER_ARGB } },
} as const;

const ALIGN = { horizontal: "center", vertical: "middle" } as const;

function columnWidth(header: string, rows: unknown[][], i: number): number {
  let max = header.length;
  for (const row of rows) {
    const v = row[i];
    const len = v == null ? 0 : v instanceof Date ? 10 : String(v).length;
    if (len > max) max = len;
  }
  return Math.min(60, Math.max(10, max + 2));
}

/** Formata uma aba já preenchida (linha 1 = cabeçalho). Padrão do sistema. */
export function applyExportStandard(ws: ExcelJS.Worksheet, rows: unknown[][]): void {
  ws.views = [{ showGridLines: false, state: "frozen", ySplit: 1 }];

  const header = ws.getRow(1);
  header.height = HEADER_HEIGHT;
  header.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL_ARGB } };
    cell.font = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: HEADER_FONT_ARGB } };
    cell.alignment = ALIGN;
    cell.border = THIN_BORDER;
  });

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    row.height = ROW_HEIGHT;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: FONT_NAME, size: FONT_SIZE, color: { argb: DATA_FONT_ARGB } };
      cell.alignment = ALIGN;
      cell.border = THIN_BORDER;
    });
  }

  ws.columns.forEach((col, i) => {
    col.width = columnWidth(String(ws.getRow(1).getCell(i + 1).value ?? ""), rows, i);
  });
}
```

Uso:
```ts
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Extrato");
ws.columns = headers.map((h) => ({ header: h }));
for (const r of rows) ws.addRow(r);
applyExportStandard(ws, rows);
```

---

## 3. Receita openpyxl (Python)

```python
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side

HEADER_FILL = PatternFill("solid", fgColor="4169E1")
HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
DATA_FONT   = Font(name="Calibri", size=11, color="1A1A1F")
CENTER      = Alignment(horizontal="center", vertical="center")
_thin       = Side(border_style="thin", color="CECECE")
BORDER      = Border(top=_thin, left=_thin, bottom=_thin, right=_thin)
HEADER_H, ROW_H = 30, 22

def apply_export_standard(ws):
    ws.sheet_view.showGridLines = False
    ws.freeze_panes = "A2"  # congela a linha 1
    max_col = ws.max_column

    ws.row_dimensions[1].height = HEADER_H
    for c in range(1, max_col + 1):
        cell = ws.cell(row=1, column=c)
        cell.fill, cell.font, cell.alignment, cell.border = HEADER_FILL, HEADER_FONT, CENTER, BORDER

    for r in range(2, ws.max_row + 1):
        ws.row_dimensions[r].height = ROW_H
        for c in range(1, max_col + 1):
            cell = ws.cell(row=r, column=c)
            cell.font, cell.alignment, cell.border = DATA_FONT, CENTER, BORDER

    from openpyxl.utils import get_column_letter
    for c in range(1, max_col + 1):
        longest = max([len(str(ws.cell(1, c).value or ""))] +
                      [len(str(ws.cell(r, c).value or "")) for r in range(2, ws.max_row + 1)])
        ws.column_dimensions[get_column_letter(c)].width = min(60, max(10, longest + 2))
```

Formatos numéricos/data: `cell.number_format = "#,##0.00"` (valor), `"0.00"`
(alíquota), `"dd/mm/yyyy"` (data). Grave números como `int/float` e datas como
`datetime`, nunca como string.

---

## 4. Receita xlsxwriter (Python)

```python
fmt_header = wb.add_format({
    "bold": True, "font_name": "Calibri", "font_size": 11, "font_color": "#FFFFFF",
    "bg_color": "#4169E1", "align": "center", "valign": "vcenter", "border": 1, "border_color": "#CECECE",
})
fmt_data = wb.add_format({
    "font_name": "Calibri", "font_size": 11, "font_color": "#1A1A1F",
    "align": "center", "valign": "vcenter", "border": 1, "border_color": "#CECECE",
})
ws.hide_gridlines(2)        # esconde na tela e na impressão
ws.freeze_panes(1, 0)       # congela a linha 1
ws.set_row(0, 30)           # altura do cabeçalho
# por linha de dados: ws.set_row(r, 22)
```
> `xlsxwriter` aplica formato por célula na escrita (`write(r, c, val, fmt)`),
> não depois. Mantenha os mesmos tokens.

---

## 5. Planilhas grandes (performance)

Acima de ~**2.500 linhas**, não faça laços O(linhas×colunas) de altura e
alinhamento por célula (trava o navegador / estoura memória). Em vez disso:
- estilize **só o cabeçalho** célula a célula;
- defina **alinhamento e largura por coluna** (não por célula);
- pule a altura por linha (deixe a padrão).

(Já é o que o NFe faz em `packages/excel-export/src/format-sheet.ts` ao passar de
`LARGE_SHEET_MIN_ROWS`.)

---

## 6. Checklist de conformidade

- [ ] Cabeçalho com fundo `4169E1`, texto branco, **negrito**, Calibri 11.
- [ ] Cabeçalho e dados **centralizados** (horizontal + vertical).
- [ ] Borda `thin` `CECECE` em **todas** as células.
- [ ] Altura: cabeçalho **30**, linhas **22**.
- [ ] Linha 1 **congelada**; **gridlines desligadas**.
- [ ] Larguras automáticas `clamp(10, conteúdo+2, 60)`.
- [ ] Números/datas como **tipo real** com `numFmt`, não string.
- [ ] Nome do arquivo legível, sem caracteres proibidos no Windows.

---

## 7. Estado atual × padrão (migração)

**Cores já unificadas** (2026-06-25): o **fundo do cabeçalho** foi padronizado em
`4169E1` em **todos** os exportadores (e a cor de borda divergente do Comparador
SEFAZ×SCI passou para `CECECE`), sem refatorar a estrutura de cada arquivo.

| Ferramenta | Arquivo | Cabeçalho | Falta (estrutura — opcional) |
|---|---|---|---|
| **Editor de Extrato** | `extratoEdit/exportExtrato.ts` | ✅ `4169E1` (referência) | — |
| **NFe** | `packages/excel-export/src/format-sheet.ts` | ✅ `4169E1` | bordas, alturas 30/22, fonte `1A1A1F` |
| **NFS-e → PDF (retenções)** | `nfsePdf/retencaoReport.ts` | ✅ `4169E1` | alturas 30/22 |
| **Conciliador NFS-e** | `engines/sci-portal-nacional/cli.mjs` | ✅ `4169E1` | alturas 30/22 |
| **GNRE** | `engines/gnre/xlsx_export.py` | ✅ `4169E1` | alturas 25/20→30/22, congelar linha 1 |
| **SPED** | `sped_engine/{config,report,writer_xlsxwriter}.py` | ✅ `4169E1` | alturas, zebra, congelar |
| **Consolidado SCI** | `engines/sci-consolidado/format.py` | ✅ `4169E1` | zebra/alturas |
| **Comparador SEFAZ×SCI** | `engines/comparacao-planilhas/cli.py` | ✅ `4169E1` (borda→`CECECE`) | alturas |
| **Comparador NFS-e** | `engines/comparacao-nfse/excel.py` | ✅ `4169E1` | alturas 25/20→30/22 |

> A coluna "Falta" lista o que ainda diverge do padrão (alturas, bordas, zebra,
> freeze) — são mudanças de **estrutura/comportamento**, deixadas para depois.
> Para conformidade total no futuro: aplicar o helper das seções 2–4 (idealmente
> centralizado em `packages/excel-export` + um módulo Python compartilhado).
