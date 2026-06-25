/**
 * Geração do .xlsx final, formatado, no navegador (ExcelJS) + download via Blob.
 *
 * Segue o padrão de exportação do sistema (docs/EXPORT-STANDARD.md):
 *  - altura do cabeçalho 30, altura das linhas 22;
 *  - cabeçalho: negrito, centralizado (horizontal + vertical), fundo Azul Royal
 *    (4169E1), fonte branca;
 *  - células de dados centralizadas (horizontal + vertical);
 *  - bordas thin cinza (CECECE) em todas as células; sem linhas de grade.
 */
import type { Cell } from "./parseExtrato.js";

const ROYAL_BLUE_ARGB = "FF4169E1";
const BORDER_ARGB = "FFCECECE";
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 22;

const THIN_BORDER = {
  top: { style: "thin", color: { argb: BORDER_ARGB } },
  left: { style: "thin", color: { argb: BORDER_ARGB } },
  bottom: { style: "thin", color: { argb: BORDER_ARGB } },
  right: { style: "thin", color: { argb: BORDER_ARGB } },
} as const;

function columnWidth(header: string, rows: Cell[][], colIndex: number): number {
  let max = header.length;
  for (const row of rows) {
    const v = row[colIndex];
    const len = v == null ? 0 : (v instanceof Date ? 10 : String(v).length);
    if (len > max) max = len;
  }
  // Padding leve; limites para não estourar.
  return Math.min(60, Math.max(10, max + 2));
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoga depois do clique para não cancelar o download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportExtrato(
  headers: string[],
  rows: Cell[][],
  filename: string,
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Extrato");
  // Sem linhas de grade na visualização.
  ws.views = [{ showGridLines: false }];

  ws.columns = headers.map((h, i) => ({ header: h, width: columnWidth(h, rows, i) }));

  const headerRow = ws.getRow(1);
  headerRow.height = HEADER_HEIGHT;
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROYAL_BLUE_ARGB } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = THIN_BORDER;
  });

  for (const r of rows) {
    const added = ws.addRow(r);
    added.height = ROW_HEIGHT;
    added.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = THIN_BORDER;
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, filename);
}
