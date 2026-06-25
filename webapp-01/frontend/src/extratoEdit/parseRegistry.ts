/**
 * Leitura da planilha de cadastro de clientes/fornecedores no navegador (ExcelJS).
 *
 * Suporta os exports do **Totvs/Winthor PC** (PCCLIENT / PC_FORNEC), que vêm com:
 *  - cabeçalho em várias linhas (R1 = nome do campo, R2 = tipo, R3 = descrição,
 *    R4 = nomes de coluna do Excel) e **dados a partir da linha 5**;
 *  - colunas separadoras (`,'`) intercaladas (a planilha monta um SQL);
 *  - nomes de campo `CODFORNEC`/`CODCLI` (código), `FORNECEDOR`/`CLIENTE` (nome),
 *    `CGC`/`CGCENT` (CNPJ/CPF).
 *
 * Também aceita uma planilha simples com colunas "Código", "Nome" e "CNPJ".
 * Guarda só as 3 colunas (código, nome, CNPJ) e detecta o tipo pelo cabeçalho.
 */
import type { Cell as ExcelCell, Row, Worksheet } from "exceljs";

export type RegistryTipo = "cliente" | "fornecedor";
export type RegistryRow = { codigo: string; nome: string; cnpj: string };

export type ParsedRegistry = {
  rows: RegistryRow[];
  /** Linhas de dados varridas (após o cabeçalho). */
  scanned: number;
  /** Linhas descartadas por não ter código. */
  semCodigo: number;
  /** Tipo inferido pelo cabeçalho (CODFORNEC→fornecedor, CODCLI→cliente) ou null. */
  detectedTipo: RegistryTipo | null;
  /** Rótulos das colunas usadas (para exibir ao usuário). */
  labels: { codigo: string; nome: string; cnpj: string };
};

function cellText(v: ExcelCell["value"]): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("");
    }
    if (o.text != null) return String(o.text);
    if (o.result != null) return String(o.result);
    if (o.hyperlink != null) return String(o.hyperlink);
    return "";
  }
  return String(v);
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

type ColMap = {
  codigo: number;
  nome: number;
  cnpj: number;
  labels: { codigo: string; nome: string; cnpj: string };
  tipo: RegistryTipo | null;
  /** Layout Totvs (CODFORNEC/CODCLI/CGC) — dados começam após linhas de metadados. */
  totvs: boolean;
};

/**
 * Padrões por coluna, em ordem de prioridade (índice menor = melhor casamento).
 * Campos do Totvs vêm primeiro para não confundir com homônimos (ex.: CODPAIS).
 */
const CODE_PATTERNS = [/^codfornec/, /^codcli/, /^codigo$/, /^cod$/];
const CNPJ_PATTERNS = [/^cgcent$/, /^cgc$/, /^cnpj/, /^cpf/, /^cgccpf/, /^documento$/];
const NAME_PATTERNS = [/^fornecedor$/, /^cliente$/, /^razao/, /^nome$/, /^fantasia$/];

function bestCol(
  cols: Array<{ c: number; n: string; raw: string }>,
  patterns: RegExp[],
): { col: number; label: string; rank: number } | null {
  let best: { col: number; label: string; rank: number } | null = null;
  for (const { c, n, raw } of cols) {
    for (let p = 0; p < patterns.length; p++) {
      if (patterns[p].test(n)) {
        if (!best || p < best.rank) best = { col: c, label: raw, rank: p };
        break;
      }
    }
  }
  return best;
}

function mapHeaderRow(row: Row, colCount: number): ColMap | null {
  const cols: Array<{ c: number; n: string; raw: string }> = [];
  for (let c = 1; c <= colCount; c++) {
    const raw = cellText(row.getCell(c).value).trim();
    const n = normalizeLabel(raw);
    if (n) cols.push({ c, n, raw });
  }
  const code = bestCol(cols, CODE_PATTERNS);
  const cnpj = bestCol(cols, CNPJ_PATTERNS);
  if (!code || !cnpj) return null;
  const nome = bestCol(cols, NAME_PATTERNS);

  // Tipo pelo código (CODFORNEC/CODCLI) ou pelo nome (FORNECEDOR/CLIENTE).
  let tipo: RegistryTipo | null = null;
  const codeN = normalizeLabel(code.label);
  if (codeN.startsWith("codfornec")) tipo = "fornecedor";
  else if (codeN.startsWith("codcli")) tipo = "cliente";
  else if (nome) {
    const nomeN = normalizeLabel(nome.label);
    if (nomeN.startsWith("fornecedor")) tipo = "fornecedor";
    else if (nomeN.startsWith("cliente")) tipo = "cliente";
  }

  const totvs = /^(cgc|cgcent)$/.test(normalizeLabel(cnpj.label)) || /^cod(fornec|cli)/.test(codeN);

  return {
    codigo: code.col,
    nome: nome ? nome.col : -1,
    cnpj: cnpj.col,
    labels: { codigo: code.label, nome: nome?.label ?? "", cnpj: cnpj.label },
    tipo,
    totvs,
  };
}

export async function parseRegistryFile(file: File): Promise<ParsedRegistry> {
  const ExcelJS = (await import("exceljs")).default;
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const ws: Worksheet | undefined = wb.worksheets.find((w) => w.actualRowCount > 0) ?? wb.worksheets[0];
  if (!ws) throw new Error("A planilha não tem nenhuma aba com dados.");

  const colCount = Math.max(3, ws.actualColumnCount || ws.columnCount || 3);

  // Acha o cabeçalho (linha com campos de código E de CNPJ) entre as 1 as linhas.
  let header: ColMap | null = null;
  let headerRow = -1;
  const maxScan = Math.min(15, ws.rowCount);
  for (let r = 1; r <= maxScan; r++) {
    const m = mapHeaderRow(ws.getRow(r), colCount);
    if (m) {
      header = m;
      headerRow = r;
      break;
    }
  }
  if (!header) {
    throw new Error(
      "Não foi possível identificar as colunas de Código e CNPJ na planilha. " +
        "Esperado um cabeçalho com Código (ou CODCLI/CODFORNEC) e CNPJ (ou CGC/CGCENT).",
    );
  }

  const isBlank = (row: Row): boolean => {
    for (let c = 1; c <= colCount; c++) {
      if (cellText(row.getCell(c).value).trim() !== "") return false;
    }
    return true;
  };

  const rows: RegistryRow[] = [];
  let scanned = 0;
  let semCodigo = 0;

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (isBlank(row)) continue;
    const codigo = cellText(row.getCell(header.codigo).value).trim();
    // No layout Totvs, as linhas de metadados (tipo/descrição/nomes de coluna)
    // ficam logo abaixo do cabeçalho; o código real é sempre numérico, então
    // filtrar por código numérico pula esses cabeçalhos extras com segurança.
    if (header.totvs && !/^\d+$/.test(codigo)) continue;
    scanned++;
    if (codigo === "") {
      semCodigo++;
      continue;
    }
    const nome = header.nome > 0 ? cellText(row.getCell(header.nome).value).trim() : "";
    const cnpj = cellText(row.getCell(header.cnpj).value).trim();
    rows.push({ codigo, nome, cnpj });
  }

  if (rows.length === 0) {
    throw new Error("Nenhuma linha com código foi encontrada após o cabeçalho.");
  }

  return { rows, scanned, semCodigo, detectedTipo: header.tipo, labels: header.labels };
}
