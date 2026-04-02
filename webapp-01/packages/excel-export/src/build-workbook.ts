import ExcelJS from "exceljs";
import { COLS, HEADER_MAP, type NfeRow } from "@webapp/nfe-core";
import { formatProductsSheet } from "./format-sheet.js";

const SHEET = "PRODUTOS";

export async function buildXlsx(rows: NfeRow[], outPath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET);

  const headerRow = COLS.map((k) => HEADER_MAP[k]);
  ws.addRow(headerRow);

  for (const row of rows) {
    ws.addRow(COLS.map((k) => row[k] ?? ""));
  }

  formatProductsSheet(ws);

  await wb.xlsx.writeFile(outPath);
}
