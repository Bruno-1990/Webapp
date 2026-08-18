import ExcelJS from "exceljs";
import {
  COLS,
  EVENTO_COLS,
  EVENTO_HEADER_MAP,
  HEADER_MAP,
  chavesCanceladas,
  vincularEventos,
  type EventoRow,
  type NfeRow,
} from "@webapp/nfe-core";
import {
  formatEventosSheet,
  formatProductsSheet,
  paintCanceladasRows,
} from "./format-sheet.js";

const SHEET = "PRODUTOS";
const SHEET_EVENTOS = "Cancelamentos";

/** Escapa aspas para embutir texto com segurança numa fórmula do Excel. */
function quoteFormulaText(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function addEventosSheet(
  wb: ExcelJS.Workbook,
  eventos: EventoRow[],
  rows: NfeRow[]
): void {
  const ws = wb.addWorksheet(SHEET_EVENTOS);
  ws.addRow(EVENTO_COLS.map((k) => EVENTO_HEADER_MAP[k]));

  const linkColIdx = EVENTO_COLS.indexOf("link") + 1;

  for (const { values, produtoRowIndex } of vincularEventos(eventos, rows)) {
    const row = ws.addRow(EVENTO_COLS.map((k) => values[k] ?? ""));
    if (produtoRowIndex === null) continue;

    // Hyperlink nativo do ExcelJS 4.x sempre vira relação externa e o Excel
    // acusa arquivo corrompido; a fórmula HYPERLINK é o caminho seguro.
    const target = `#${SHEET}!A${produtoRowIndex + 2}`;
    const label = values.link || "ver NF";
    row.getCell(linkColIdx).value = {
      formula: `HYPERLINK(${quoteFormulaText(target)},${quoteFormulaText(label)})`,
      result: label,
    };
    row.getCell(linkColIdx).font = {
      color: { argb: "FF0563C1" },
      underline: true,
    };
  }

  formatEventosSheet(ws);
}

export async function buildXlsx(
  rows: NfeRow[],
  outPath: string,
  eventos: EventoRow[] = []
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET);

  const headerRow = COLS.map((k) => HEADER_MAP[k]);
  ws.addRow(headerRow);

  for (const row of rows) {
    ws.addRow(COLS.map((k) => row[k] ?? ""));
  }

  formatProductsSheet(ws);

  if (eventos.length > 0) {
    const canceladas = chavesCanceladas(eventos);
    if (canceladas.size > 0) {
      const alvos: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const ch = (rows[i]!.chNFe ?? "").replace(/\D/g, "");
        // +2: cabeçalho na linha 1 e índice 0-based -> linha do Excel.
        if (canceladas.has(ch)) alvos.push(i + 2);
      }
      paintCanceladasRows(ws, alvos, COLS.length);
    }
    addEventosSheet(wb, eventos, rows);
  }

  await wb.xlsx.writeFile(outPath);
}
