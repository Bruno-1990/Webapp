/**
 * Relatório .xlsx das retenções das NFS-e processadas (gerado no navegador via
 * ExcelJS, carregado sob demanda). Uma linha por nota com retenção + totais.
 */
import type { RetencaoItem } from "./generateZip.js";
import { fmtBRL } from "./format.js";
import { renderPdf } from "./pdf.js";

const HEADER_ARGB = "FF4169E1";
const BORDER_ARGB = "FFCECECE";

const THIN_BORDER = {
  top: { style: "thin", color: { argb: BORDER_ARGB } },
  left: { style: "thin", color: { argb: BORDER_ARGB } },
  bottom: { style: "thin", color: { argb: BORDER_ARGB } },
  right: { style: "thin", color: { argb: BORDER_ARGB } },
} as const;

const BRL = '"R$" #,##0.00';

type Col = {
  header: string;
  key: keyof RetencaoItem;
  width: number;
  money?: boolean;
  text?: boolean;
};

const COLS: Col[] = [
  { header: "Nº NFS-e", key: "numero", width: 12, text: true },
  { header: "Chave de Acesso", key: "chave", width: 52, text: true },
  { header: "CNPJ Prestador", key: "prestadorCnpj", width: 20, text: true },
  { header: "Prestador", key: "prestadorNome", width: 34 },
  { header: "CNPJ Tomador", key: "tomadorCnpj", width: 20, text: true },
  { header: "Tomador", key: "tomadorNome", width: 34 },
  { header: "Município Incidência ISSQN", key: "municipioIncidencia", width: 26 },
  { header: "Valor do Serviço", key: "vServ", width: 16, money: true },
  { header: "ISSQN Retido", key: "issqnRetido", width: 14, money: true },
  { header: "IRRF Retido", key: "irrf", width: 14, money: true },
  { header: "Previdenciária (INSS) Retida", key: "previdenciaria", width: 18, money: true },
  { header: "Contrib. Sociais Retidas", key: "contribSociais", width: 18, money: true },
  { header: "Descrição Contrib. Sociais", key: "descContribSociais", width: 30 },
  { header: "Total Retenções Federais", key: "totalFederais", width: 18, money: true },
  { header: "Valor Líquido", key: "vLiq", width: 16, money: true },
];

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Monta o workbook ExcelJS (separado do download p/ ser testável fora do browser). */
export async function buildRetencaoWorkbook(items: RetencaoItem[]): Promise<import("exceljs").Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "NFS-e → PDF (DANFSe)";
  const ws = wb.addWorksheet("Retenções");
  ws.views = [{ showGridLines: false, state: "frozen", ySplit: 1 }];

  ws.columns = COLS.map((c) => ({ header: c.header, key: c.key as string, width: c.width }));

  const header = ws.getRow(1);
  header.height = 26;
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_ARGB } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = THIN_BORDER;
  });

  for (const it of items) {
    const row = ws.addRow(it);
    row.eachCell((cell, col) => {
      const def = COLS[col - 1];
      cell.border = THIN_BORDER;
      cell.alignment = { vertical: "middle", horizontal: def?.money ? "right" : "left" };
      if (def?.money) cell.numFmt = BRL;
      if (def?.text) cell.numFmt = "@";
    });
  }

  // Linha de totais.
  const sum = (k: keyof RetencaoItem) =>
    items.reduce((s, it) => s + (typeof it[k] === "number" ? (it[k] as number) : 0), 0);
  const totalRow = ws.addRow({
    prestadorNome: "TOTAL",
    vServ: sum("vServ"),
    issqnRetido: sum("issqnRetido"),
    irrf: sum("irrf"),
    previdenciaria: sum("previdenciaria"),
    contribSociais: sum("contribSociais"),
    totalFederais: sum("totalFederais"),
    vLiq: sum("vLiq"),
  } as Partial<RetencaoItem>);
  totalRow.eachCell((cell, col) => {
    const def = COLS[col - 1];
    cell.font = { bold: true };
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: "middle", horizontal: def?.money ? "right" : "left" };
    if (def?.money) cell.numFmt = BRL;
  });

  return wb;
}

export async function downloadRetencaoReport(
  items: RetencaoItem[],
  filename = "Retencoes NFS-e.xlsx",
): Promise<void> {
  const wb = await buildRetencaoWorkbook(items);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, filename);
}

/* ── Relatório em PDF (paisagem) ──────────────────────────────────────────── */

/** Colunas do PDF: subconjunto enxuto do .xlsx, escolhido p/ caber em A4 paisagem. */
type PdfCol = { header: string; key: keyof RetencaoItem; money?: boolean; always?: boolean; width: string | number };

const PDF_COLS: PdfCol[] = [
  { header: "Nº NFS-e", key: "numero", width: "auto" },
  { header: "Prestador", key: "prestadorNome", width: "*" },
  { header: "Mun. Incid. ISSQN", key: "municipioIncidencia", width: "auto" },
  { header: "Valor Bruto", key: "vServ", money: true, always: true, width: "auto" },
  { header: "Valor Líquido", key: "vLiq", money: true, always: true, width: "auto" },
  { header: "ISSQN", key: "issqnRetido", money: true, width: "auto" },
  { header: "IRRF", key: "irrf", money: true, width: "auto" },
  { header: "Prev. (INSS)", key: "previdenciaria", money: true, width: "auto" },
  { header: "Contrib. Sociais", key: "contribSociais", money: true, width: "auto" },
  { header: "Total Federais", key: "totalFederais", money: true, width: "auto" },
];

/** Valor monetário ou travessão quando zero (exceto colunas `always`, sempre exibidas). */
function pdfMoney(v: number, always: boolean): string {
  return v > 0 || always ? fmtBRL(v) : "—";
}

/** Monta a definição pdfmake do relatório (separada do download p/ testar). */
export function buildRetencaoPdfDoc(items: RetencaoItem[]): Record<string, unknown> {
  const headerRow = PDF_COLS.map((c) => ({
    text: c.header,
    bold: true,
    color: "#FFFFFF",
    fillColor: "#4169E1",
    alignment: c.money ? "right" : "left",
  }));

  const dataRows = items.map((it) =>
    PDF_COLS.map((c) => {
      const val = it[c.key];
      if (c.money) {
        return { text: pdfMoney(typeof val === "number" ? val : 0, !!c.always), alignment: "right" };
      }
      return { text: (val == null ? "" : String(val)) || "—", alignment: "left" };
    }),
  );

  const sum = (k: keyof RetencaoItem) =>
    items.reduce((s, it) => s + (typeof it[k] === "number" ? (it[k] as number) : 0), 0);
  const totalRow = PDF_COLS.map((c, i) => {
    if (i === 0) return { text: "TOTAL", bold: true, fillColor: "#EEF6FB" };
    if (c.money) return { text: fmtBRL(sum(c.key)), bold: true, alignment: "right", fillColor: "#EEF6FB" };
    return { text: "", bold: true, fillColor: "#EEF6FB" };
  });

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [24, 44, 24, 32],
    content: [
      { text: "Relatório de Retenções — NFS-e", style: "title" },
      { text: `${items.length} nota(s) com retenção`, style: "subtitle" },
      {
        table: {
          headerRows: 1,
          widths: PDF_COLS.map((c) => c.width),
          body: [headerRow, ...dataRows, totalRow],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => "#CECECE",
          vLineColor: () => "#CECECE",
          paddingTop: () => 3,
          paddingBottom: () => 3,
          paddingLeft: () => 5,
          paddingRight: () => 5,
        },
      },
    ],
    styles: {
      title: { fontSize: 14, bold: true, color: "#183844", margin: [0, 0, 0, 2] },
      subtitle: { fontSize: 9, color: "#52636B", margin: [0, 0, 0, 10] },
    },
    defaultStyle: { fontSize: 8 },
  };
}

export async function downloadRetencaoPdf(
  items: RetencaoItem[],
  filename = "Retencoes NFS-e.pdf",
): Promise<void> {
  const blob = await renderPdf(buildRetencaoPdfDoc(items));
  triggerDownload(blob, filename);
}
