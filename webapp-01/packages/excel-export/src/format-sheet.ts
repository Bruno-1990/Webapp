import type { Worksheet } from "exceljs";

const HEADER_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FF4169E1" },
};
const HEADER_FONT = { color: { argb: "FFFFFFFF" }, bold: true };
const ALIGN_CENTER = { vertical: "middle" as const, horizontal: "center" as const };
const ALIGN_LEFT = { vertical: "middle" as const, horizontal: "left" as const };
const LEFT_ALIGNED_HEADERS = new Set([
  "Descrição",
  "Descricao",
  "Presença do Comprador",
  "Presenca do Comprador",
  "Finalidade da NF-e",
  "Alerta Fiscal",
]);

/** Acima disso, evita O(linhas×colunas) em altura/alinhamento/largura (planilhas muito grandes). */
export const LARGE_SHEET_MIN_ROWS = 2500;

function headerToColMap(ws: Worksheet): Map<string, number> {
  const m = new Map<string, number>();
  const row = ws.getRow(1);
  row.eachCell((cell, colNumber) => {
    const v = cell.value;
    const key = v == null ? "" : String(v);
    m.set(key, colNumber);
  });
  return m;
}

function coerceNumericString(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  try {
    if (t.includes(",") && (t.match(/,/g) ?? []).length === 1) {
      const s2 = t.replace(/\./g, "").replace(",", ".");
      return Number.parseFloat(s2);
    }
    return Number.parseFloat(t);
  } catch {
    return null;
  }
}

const NUMERIC_HEADERS: Record<string, string> = {
  Qtde: "#,##0.####",
  "Vlr Unit.": "#,##0.####",
  "Vlr Total": "#,##0.00",
  "Aliq ICMS": "0.00",
  "Vlr ICMS": "#,##0.00",
  "Aliq IPI": "0.00",
  "Vlr IPI": "#,##0.00",
  "Aliq PIS": "0.00",
  "Vlr PIS": "#,##0.00",
  "Aliq COFINS": "0.00",
  "Vlr COFINS": "#,##0.00",
};

function applyNumericFormats(ws: Worksheet, headerToCol: Map<string, number>, maxRow: number): void {
  for (const [headerName, fmt] of Object.entries(NUMERIC_HEADERS)) {
    const cidx = headerToCol.get(headerName);
    if (!cidx) continue;
    for (let r = 2; r <= maxRow; r++) {
      const cell = ws.getRow(r).getCell(cidx);
      const v = cell.value;
      if (typeof v === "string") {
        const n = coerceNumericString(v);
        if (n !== null && !Number.isNaN(n)) cell.value = n;
      }
      cell.numFmt = fmt;
    }
  }
}

function formatProductsSheetSmall(ws: Worksheet): void {
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const maxRow = ws.rowCount || 1;
  const maxCol = ws.columnCount || 1;

  ws.getRow(1).height = 22;
  for (let r = 2; r <= maxRow; r++) {
    ws.getRow(r).height = 18;
  }

  const headerToCol = headerToColMap(ws);

  for (let c = 1; c <= maxCol; c++) {
    const cell = ws.getRow(1).getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = ALIGN_CENTER;
  }

  for (let r = 2; r <= maxRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      ws.getRow(r).getCell(c).alignment = ALIGN_CENTER;
    }
  }

  for (let c = 1; c <= maxCol; c++) {
    const header = String(ws.getRow(1).getCell(c).value ?? "");
    if (!LEFT_ALIGNED_HEADERS.has(header)) continue;
    for (let r = 2; r <= maxRow; r++) {
      ws.getRow(r).getCell(c).alignment = ALIGN_LEFT;
    }
  }

  applyNumericFormats(ws, headerToCol, maxRow);

  for (let c = 1; c <= maxCol; c++) {
    const hcell = ws.getRow(1).getCell(c);
    let maxLen = String(hcell.value ?? "").length;
    maxLen = Math.max(maxLen, 10);
    for (let r = 2; r <= maxRow; r++) {
      const val = ws.getRow(r).getCell(c).value;
      if (val == null) continue;
      const s = String(val);
      if (s.length > maxLen) maxLen = Math.min(120, s.length);
    }
    ws.getColumn(c).width = maxLen + 2;
  }
}

/** Planilhas grandes: sem altura por linha, alinhamento por coluna, larguras heurísticas. */
function formatProductsSheetLarge(ws: Worksheet): void {
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const maxRow = ws.rowCount || 1;
  const maxCol = ws.columnCount || 1;

  ws.getRow(1).height = 22;

  const headerToCol = headerToColMap(ws);

  for (let c = 1; c <= maxCol; c++) {
    const cell = ws.getRow(1).getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = ALIGN_CENTER;
  }

  for (let c = 1; c <= maxCol; c++) {
    const col = ws.getColumn(c);
    const h = String(ws.getRow(1).getCell(c).value ?? "");
    col.alignment = LEFT_ALIGNED_HEADERS.has(h) ? ALIGN_LEFT : ALIGN_CENTER;
    let w = Math.min(72, Math.max(10, Math.ceil(h.length * 1.05) + 3));
    if (h.includes("Chave")) w = 50;
    else if (h.includes("Nome") || h.includes("Emit") || h.includes("Dest")) w = 38;
    else if (h.includes("Descrição") || h.includes("Descricao") || h === "Desc. Prod.")
      w = 44;
    else if (h.includes("Presença") || h.includes("Presenca") || h.includes("Finalidade")) w = 34;
    else if (h.includes("Alerta")) w = 56;
    else if (h.includes("NCM") || h.includes("CFOP")) w = 12;
    col.width = w;
  }

  applyNumericFormats(ws, headerToCol, maxRow);
}

export function formatProductsSheet(ws: Worksheet): void {
  const maxRow = ws.rowCount || 1;
  if (maxRow > LARGE_SHEET_MIN_ROWS) {
    formatProductsSheetLarge(ws);
  } else {
    formatProductsSheetSmall(ws);
  }
}
