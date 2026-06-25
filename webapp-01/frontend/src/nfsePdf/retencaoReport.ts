/**
 * Relatório .xlsx das retenções das NFS-e processadas (gerado no navegador via
 * ExcelJS, carregado sob demanda). Uma linha por nota com retenção + totais.
 */
import type { RetencaoItem } from "./generateZip.js";

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
