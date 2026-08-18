/**
 * Leitura e normalização de um extrato/relatório .xlsx no navegador (ExcelJS).
 *
 * A ferramenta reconhece dois formatos do SIST e tem um fallback genérico:
 *
 *  - "Contas Pagas" (DOC PAGOS): a data vem em *linhas* separadoras
 *    (`DT. PAGAMENTO: <data>`) que regem os lançamentos abaixo; cabeçalho `Lanc.`,
 *    cabeçalhos repetidos por bloco, preâmbulo de metadados e `Total do Dia`.
 *    Colapsamos mescladas, "explodimos" a data numa coluna à esquerda e
 *    descartamos preâmbulo, cabeçalhos repetidos, totais e linhas em branco.
 *
 *  - "Títulos Recebidos - Analítico por RCA" (CARTÕES / SANTANDER): o agrupador
 *    é o RCA (vendedor) em linhas `RCA: <cód> <nome>`; o cabeçalho ocupa duas
 *    linhas e fica *desalinhado* das colunas de dados, então mapeamos por índice
 *    fixo de coluna. Explodimos o RCA numa coluna à esquerda e descartamos
 *    preâmbulo, cabeçalhos repetidos, `TOTAL POR RCA`/`TOTAL GERAL` e branco.
 *
 *  - Fallback genérico: se nenhum formato é reconhecido, a 1ª linha não-vazia vira
 *    cabeçalho e as demais não-vazias viram dados.
 *
 * A saída é sempre a mesma estrutura (cabeçalhos + linhas) e a mesma formatação
 * final — só a *entrada* muda de formato.
 */
import type { Cell as ExcelCell, Row, Worksheet } from "exceljs";

export type Cell = string | number | boolean | Date | null;

export type ParseProfile = "contas-pagas" | "titulos-recebidos" | "recebidas-baixa" | "generic";

export type ParseMeta = {
  profile: ParseProfile;
  sheetName: string;
  /** Rótulo da coluna agrupadora explodida à esquerda ("Data" / "RCA") ou null. */
  groupLabel: string | null;
  /** Quantos lançamentos receberam um valor da coluna agrupadora. */
  groupApplied: number;
  blankRemoved: number;
  totalsRemoved: number;
  headerRepeatsRemoved: number;
  usedFallback: boolean;
};

export type ParsedExtrato = {
  headers: string[];
  rows: Cell[][];
  /** Rótulos a marcar por padrão (ordem de planilha). Vazio = marcar todas. */
  recommended: string[];
  meta: ParseMeta;
};

const DATE_SEP_RE = /pagamento/i;
const TOTAL_RE = /total\s+do\s+dia|t[íi]tulos\s+listados/i;
const HEADER_FIRST_COL_RE = /^lan[cç]/i; // "Lanc." / "Lançamento"
/** Início do rodapé de resumos ("Resumo por Banco/Usuário") — daqui pra baixo é só totalização. */
const SUMMARY_SECTION_RE = /resumo\s+por/i;

/** Assinatura do relatório "Títulos Recebidos - Analítico por RCA". */
const TITULOS_RECEBIDOS_RE = /t[íi]tulos\s+recebidos|anal[íi]tico\s+por\s+rca/i;

/** Valor que representa um nº de lançamento (número ou string só de dígitos). */
function isLancamentoNumber(v: ExcelCell["value"]): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  const t = cellText(v).trim();
  return t.length > 0 && /^\d+$/.test(t);
}

/** Texto plano de qualquer valor de célula (rich text, fórmula, data, etc.). */
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

/** Valor "limpo" para exportar: preserva número/data, desembrulha fórmula/rich text. */
function cellOut(v: ExcelCell["value"]): Cell {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (o.result != null) return o.result as Cell;
    if (Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("");
    }
    if (o.text != null) return String(o.text);
    if (o.hyperlink != null) return String(o.text ?? o.hyperlink);
    return null;
  }
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return null;
}

/** Célula é a "mestre" da sua mesclagem (ou não mesclada) — evita colunas duplicadas. */
function isMaster(cell: ExcelCell): boolean {
  if (!cell.isMerged) return true;
  return cell.master?.address === cell.address;
}

type LogicalColumn = { col: number; label: string };

const GENERIC_CODE_RE = /^c[óo]d(igo)?\.?$/i; // "Cod." / "Cód." / "Codigo"

/** Colunas lógicas a partir de uma linha de cabeçalho: só células-mestre não-vazias. */
function logicalColumns(row: Row, colCount: number, smart: boolean): LogicalColumn[] {
  // 1) Coleta as células-mestre não-vazias.
  const raw: LogicalColumn[] = [];
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    if (!isMaster(cell)) continue;
    const label = cellText(cell.value).trim();
    if (!label) continue;
    raw.push({ col: c, label });
  }
  // 2) No formato reconhecido, renomeia "Cod." genérico pela coluna seguinte
  //    (no SIST a coluna de código vem antes de "Conta"/"Fornecedor").
  if (smart) {
    for (let i = 0; i < raw.length; i++) {
      const next = raw[i + 1];
      if (next && GENERIC_CODE_RE.test(raw[i].label)) {
        raw[i].label = `Cód. ${next.label}`;
      }
    }
  }
  // 3) Rótulos ainda repetidos ganham sufixo.
  const seenLabels = new Map<string, number>();
  return raw.map(({ col, label }) => {
    const n = seenLabels.get(label) ?? 0;
    seenLabels.set(label, n + 1);
    return { col, label: n === 0 ? label : `${label} (${n + 1})` };
  });
}

function isBlankRow(row: Row, cols: LogicalColumn[]): boolean {
  return cols.every(({ col }) => cellText(row.getCell(col).value).trim() === "");
}

/** Linha vazia em todas as colunas (1..colCount) — usada quando não há colunas lógicas. */
function isBlankRowAll(row: Row, colCount: number): boolean {
  for (let c = 1; c <= colCount; c++) {
    if (cellText(row.getCell(c).value).trim() !== "") return false;
  }
  return true;
}

function rowMatches(row: Row, colCount: number, re: RegExp): boolean {
  for (let c = 1; c <= colCount; c++) {
    if (re.test(cellText(row.getCell(c).value))) return true;
  }
  return false;
}

/** Extrai a data de uma linha separadora: primeiro valor Date, senão tenta texto. */
function extractDate(row: Row, colCount: number): Date | null {
  for (let c = 1; c <= colCount; c++) {
    const v = row.getCell(c).value;
    if (v instanceof Date) return v;
  }
  for (let c = 1; c <= colCount; c++) {
    const t = cellText(row.getCell(c).value).trim();
    const iso = /\d{4}-\d{2}-\d{2}/.exec(t);
    if (iso) {
      const d = new Date(iso[0]);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const br = /(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
    if (br) {
      const d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function formatDateBR(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function parseExtratoFile(file: File): Promise<ParsedExtrato> {
  const buf = await file.arrayBuffer();

  // `.xls` (BIFF binário) não é lido pelo ExcelJS — usamos SheetJS para gerar uma
  // grade 2D e daí parseamos. O ExcelJS segue exclusivo dos formatos `.xlsx`.
  if (/\.xls$/i.test(file.name)) {
    const { grid, sheetName } = await readGridWithSheetJS(buf);
    if (grid.length === 0) throw new Error("A planilha não tem nenhuma aba com dados.");
    if (isRecebidasBaixaGrid(grid)) return parseRecebidasBaixaGrid(grid, sheetName);
    return parseGenericGrid(grid, sheetName);
  }

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const ws: Worksheet | undefined = wb.worksheets.find((w) => w.actualRowCount > 0) ?? wb.worksheets[0];
  if (!ws) throw new Error("A planilha não tem nenhuma aba com dados.");

  const colCount = Math.max(1, ws.actualColumnCount || ws.columnCount || 1);
  const rowCount = ws.rowCount;

  // "Analítico por Dt. de Baixa" também pode chegar salvo como `.xlsx`. O título
  // contém "Títulos Recebidos" (que casaria com o perfil RCA), então checamos a
  // assinatura específica ANTES de `isTitulosRecebidos`.
  if (isRecebidasBaixaWorksheet(ws, rowCount, colCount)) {
    const grid = gridFromWorksheet(ws, rowCount, colCount);
    return parseRecebidasBaixaGrid(grid, ws.name);
  }
  if (isTitulosRecebidos(ws, rowCount, colCount)) {
    return parseTitulosRecebidos(ws, rowCount, colCount);
  }
  return parseContasPagas(ws, rowCount, colCount);
}

/** Lê o 1º sheet com dados via SheetJS numa grade 2D (datas preservadas). */
async function readGridWithSheetJS(buf: ArrayBuffer): Promise<{ grid: Cell[][]; sheetName: string }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName =
    wb.SheetNames.find((n) => {
      const ref = wb.Sheets[n]?.["!ref"];
      return typeof ref === "string" && ref.length > 0;
    }) ?? wb.SheetNames[0];
  if (!sheetName) return { grid: [], sheetName: "" };
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  const grid: Cell[][] = raw.map((row) =>
    (row ?? []).map((v) => {
      if (v == null) return null;
      if (v instanceof Date) return v;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
      return String(v);
    }),
  );
  return { grid, sheetName };
}

/** Monta uma grade 2D (índice 0-based) a partir de um Worksheet ExcelJS. */
function gridFromWorksheet(ws: Worksheet, rowCount: number, colCount: number): Cell[][] {
  const grid: Cell[][] = [];
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const arr: Cell[] = [];
    for (let c = 1; c <= colCount; c++) arr.push(cellOut(row.getCell(c).value));
    grid.push(arr);
  }
  return grid;
}

/** Detecta o relatório "Títulos Recebidos por RCA" pela assinatura nas 1ªs linhas. */
function isTitulosRecebidos(ws: Worksheet, rowCount: number, colCount: number): boolean {
  for (let r = 1; r <= Math.min(6, rowCount); r++) {
    if (rowMatches(ws.getRow(r), colCount, TITULOS_RECEBIDOS_RE)) return true;
  }
  return false;
}

// ── Perfil: Contas Pagas (DOC PAGOS) + fallback genérico ─────────────────────

const CONTAS_PAGAS_RECOMMENDED = [
  "Data",
  "Conta",
  "Fornecedor",
  "Histórico",
  "Nº Nota",
  "Vlr. Título",
  "Bco.",
];

function parseContasPagas(ws: Worksheet, rowCount: number, colCount: number): ParsedExtrato {
  // 1) Acha a linha de cabeçalho real ("Lanc."). Senão, usa a 1ª linha não-vazia (fallback).
  let headerRowIndex = -1;
  for (let r = 1; r <= rowCount; r++) {
    if (HEADER_FIRST_COL_RE.test(cellText(ws.getRow(r).getCell(1).value).trim())) {
      headerRowIndex = r;
      break;
    }
  }
  let usedFallback = false;
  if (headerRowIndex === -1) {
    usedFallback = true;
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const anyText = (() => {
        for (let c = 1; c <= colCount; c++) if (cellText(row.getCell(c).value).trim()) return true;
        return false;
      })();
      if (anyText) {
        headerRowIndex = r;
        break;
      }
    }
  }
  if (headerRowIndex === -1) throw new Error("Não foi possível identificar o cabeçalho da planilha.");

  const cols = logicalColumns(ws.getRow(headerRowIndex), colCount, !usedFallback);
  if (cols.length === 0) throw new Error("O cabeçalho identificado não tem colunas com título.");

  /**
   * No relatório SIST a 1ª coluna é o nº do lançamento (`Lanc.`). Exigir que ela
   * seja numérica descarta o total geral (`TOTAL:`) e a linha de rodapé/usuário no
   * fim — que escapam do filtro `Total do Dia`. Só no formato reconhecido (não no
   * fallback genérico, que pode ter texto na 1ª coluna).
   */
  const requireNumericFirstCol = !usedFallback && HEADER_FIRST_COL_RE.test(cols[0].label.trim());

  // 2) Varre todas as linhas; data separadora atualiza a data corrente (mesmo no preâmbulo).
  let currentDate: Date | null = null;
  let hasAnyDate = false;
  let datesExploded = 0;
  let blankRemoved = 0;
  let totalsRemoved = 0;
  let headerRepeatsRemoved = 0;

  type RawRow = { date: Date | null; values: Cell[] };
  const collected: RawRow[] = [];

  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);

    // Rodapé de resumos no fim do relatório — para de coletar a partir daqui.
    if (requireNumericFirstCol && rowMatches(row, colCount, SUMMARY_SECTION_RE)) break;

    if (rowMatches(row, colCount, DATE_SEP_RE)) {
      const d = extractDate(row, colCount);
      if (d) {
        currentDate = d;
        hasAnyDate = true;
      }
      continue;
    }

    if (r < headerRowIndex) continue; // preâmbulo de metadados
    if (r === headerRowIndex) continue; // o cabeçalho em si

    if (isBlankRow(row, cols)) {
      blankRemoved++;
      continue;
    }
    // Cabeçalho repetido por bloco.
    if (HEADER_FIRST_COL_RE.test(cellText(row.getCell(1).value).trim())) {
      headerRepeatsRemoved++;
      continue;
    }
    if (rowMatches(row, colCount, TOTAL_RE)) {
      totalsRemoved++;
      continue;
    }
    // Linha-resumo/rodapé (total geral, assinatura) sem nº de lançamento válido.
    if (requireNumericFirstCol && !isLancamentoNumber(row.getCell(cols[0].col).value)) {
      totalsRemoved++;
      continue;
    }

    const values = cols.map(({ col }) => cellOut(row.getCell(col).value));
    if (currentDate) datesExploded++;
    collected.push({ date: currentDate, values });
  }

  const hasDateColumn = hasAnyDate;
  const headers = hasDateColumn ? ["Data", ...cols.map((c) => c.label)] : cols.map((c) => c.label);
  const rows: Cell[][] = collected.map((r) =>
    hasDateColumn ? [r.date ? formatDateBR(r.date) : "", ...r.values] : r.values,
  );

  return {
    headers,
    rows,
    recommended: usedFallback ? [] : CONTAS_PAGAS_RECOMMENDED,
    meta: {
      profile: usedFallback ? "generic" : "contas-pagas",
      sheetName: ws.name,
      groupLabel: hasDateColumn ? "Data" : null,
      groupApplied: datesExploded,
      blankRemoved,
      totalsRemoved,
      headerRepeatsRemoved,
      usedFallback,
    },
  };
}

// ── Perfil: Títulos Recebidos - Analítico por RCA (CARTÕES / SANTANDER) ───────

/** Linha agrupadora de vendedor: `RCA: <cód> <nome>` na 1ª coluna. */
const RCA_LABEL_RE = /^rca:?$/i;
/** Cabeçalho principal do bloco (R19): 1ª coluna "Cliente". */
const TR_HEADER_C1_RE = /^cliente$/i;
/** Linhas de totalização/resumo do relatório de recebidos. */
const TR_TOTAL_RE = /total\s+(por\s+rca|geral)|presta[cç][õo]es\s+listadas/i;

/**
 * Esquema fixo por *índice de coluna de dados*. O cabeçalho ocupa duas linhas
 * (R18 + R19) e fica desalinhado das colunas de dados — então não dá pra ler os
 * rótulos das células de cabeçalho. O layout deste relatório SIST é estável,
 * então mapeamos coluna→rótulo diretamente.
 */
const TR_SCHEMA: ReadonlyArray<{ col: number; label: string }> = [
  { col: 1, label: "Cód. Cliente" },
  { col: 3, label: "Cliente" },
  { col: 7, label: "Fil." },
  { col: 8, label: "Duplicata" },
  { col: 10, label: "Parcela" },
  { col: 11, label: "Vencto." },
  // O cabeçalho mesclado "Vlr.Total Juros/Despesas" cobre DUAS colunas de dados:
  // col 12 = Valor (valor cheio), col 13 = Juros. Mapeamos as duas separadas.
  { col: 12, label: "Valor" },
  { col: 13, label: "Juros" },
  { col: 14, label: "Desc." },
  { col: 15, label: "Vlr Pago" },
  { col: 17, label: "Cob." },
  { col: 18, label: "Dt.Pagto." },
  { col: 19, label: "Dt.Emissão" },
  { col: 21, label: "Func. Baixa" },
  { col: 22, label: "Dt. Baixa" },
  { col: 23, label: "Banco" },
  { col: 24, label: "Moeda" },
];

const TR_RECOMMENDED = ["RCA", "Cliente", "Duplicata", "Vencto.", "Valor", "Juros", "Vlr Pago", "Dt.Pagto.", "Banco"];

function parseTitulosRecebidos(ws: Worksheet, rowCount: number, colCount: number): ParsedExtrato {
  let currentRca: string | null = null;
  let started = false; // só coleta depois do 1º bloco de RCA (ignora preâmbulo)
  let groupApplied = 0;
  let blankRemoved = 0;
  let totalsRemoved = 0;
  let headerRepeatsRemoved = 0;

  type RawRow = { rca: string | null; values: Cell[] };
  const collected: RawRow[] = [];
  const DIGITS_RE = /^\d+$/;

  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const c1 = cellText(row.getCell(1).value).trim();

    // Separador de vendedor — atualiza o RCA corrente e abre a coleta.
    if (RCA_LABEL_RE.test(c1)) {
      const code = cellText(row.getCell(2).value).trim();
      const name = cellText(row.getCell(3).value).trim();
      currentRca = [code, name].filter(Boolean).join(" - ") || null;
      started = true;
      continue;
    }

    if (!started) continue; // preâmbulo de metadados/filtros

    // Cabeçalho principal repetido por bloco ("Cliente").
    if (TR_HEADER_C1_RE.test(c1)) {
      headerRepeatsRemoved++;
      continue;
    }
    // Totais ("TOTAL POR RCA", "TOTAL GERAL", "Prestações Listadas").
    if (rowMatches(row, colCount, TR_TOTAL_RE)) {
      totalsRemoved++;
      continue;
    }
    if (isBlankRowAll(row, colCount)) {
      blankRemoved++;
      continue;
    }
    // Linha de dados sempre tem o cód. do cliente (numérico) na 1ª coluna; o resto
    // (sub-cabeçalho R18, nota de rodapé `* Título...`) é ignorado silenciosamente.
    if (!DIGITS_RE.test(c1)) continue;

    const values = TR_SCHEMA.map(({ col }) => cellOut(row.getCell(col).value));
    if (currentRca) groupApplied++;
    collected.push({ rca: currentRca, values });
  }

  const headers = ["RCA", ...TR_SCHEMA.map((s) => s.label)];
  const rows: Cell[][] = collected.map((c) => [c.rca ?? "", ...c.values]);

  return {
    headers,
    rows,
    recommended: TR_RECOMMENDED,
    meta: {
      profile: "titulos-recebidos",
      sheetName: ws.name,
      groupLabel: "RCA",
      groupApplied,
      blankRemoved,
      totalsRemoved,
      headerRepeatsRemoved,
      usedFallback: false,
    },
  };
}

// ── Perfil: Títulos Recebidos - Analítico por Dt. de Baixa (SIST 1220) ────────
//
// Relatório `.xls` paginado (repete título + preâmbulo de filtros a cada página).
// O agrupador é a data de baixa em linhas `DATA BAIXA: <data>`. O cabeçalho ocupa
// três linhas desalinhadas das colunas de dados, então mapeamos por índice fixo
// (validado: a soma de "Vlr Pago" bate com o TOTAL GERAL do próprio relatório).

/** Assinatura do relatório (título na 1ª coluna das primeiras linhas). */
const RB_TITLE_RE = /an[aá]l[ií]tico\s+por\s+dt\.?\s+de\s+baixa/i;
const RB_DATA_BAIXA_RE = /^data\s+baixa/i;
const RB_HEADER_C1_RE = /^cliente$/i;
const RB_TOTAL_RE = /total\s+por\s+dia|total\s+geral|presta[cç][õo]es\s+listadas/i;
const RB_DIGITS_RE = /^\d+$/;

/** Esquema fixo por índice de coluna de dados (0-based) → rótulo. */
const RB_SCHEMA: ReadonlyArray<{ col: number; label: string }> = [
  { col: 0, label: "Cód. Cliente" },
  { col: 2, label: "Cliente" },
  { col: 6, label: "Fil." },
  { col: 7, label: "Duplicata" },
  { col: 9, label: "Parc." },
  { col: 10, label: "Carteira" },
  { col: 11, label: "Nosso N. Bco." },
  { col: 13, label: "Vlr Dupl." },
  { col: 14, label: "Juros/Desp." },
  { col: 16, label: "Desc." },
  { col: 17, label: "Vlr Pago" },
  { col: 19, label: "Cob." },
  { col: 20, label: "Dt.Pagto" },
  { col: 22, label: "Cód. Baixa" },
  { col: 23, label: "Banco Baixa" },
  { col: 24, label: "Moeda" },
];

const RB_RECOMMENDED = [
  "Data Baixa",
  "Cód. Cliente",
  "Cliente",
  "Duplicata",
  "Vlr Dupl.",
  "Juros/Desp.",
  "Desc.",
  "Vlr Pago",
  "Cob.",
  "Dt.Pagto",
  "Banco Baixa",
];

function cellStr(v: Cell): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function gridRowText(row: Cell[]): string {
  return row.map(cellStr).join(" ");
}

function gridRowBlank(row: Cell[]): boolean {
  return row.every((v) => cellStr(v) === "");
}

function gridRowDate(row: Cell[]): Date | null {
  for (const v of row) if (v instanceof Date) return v;
  return null;
}

/** Detecta a assinatura do relatório numa grade 2D (primeiras linhas). */
function isRecebidasBaixaGrid(grid: Cell[][]): boolean {
  for (let r = 0; r < Math.min(8, grid.length); r++) {
    if (RB_TITLE_RE.test(cellStr(grid[r]?.[0]))) return true;
  }
  return false;
}

/** Mesma assinatura, mas varrendo um Worksheet ExcelJS (caso `.xlsx`). */
function isRecebidasBaixaWorksheet(ws: Worksheet, rowCount: number, colCount: number): boolean {
  for (let r = 1; r <= Math.min(8, rowCount); r++) {
    if (rowMatches(ws.getRow(r), colCount, RB_TITLE_RE)) return true;
  }
  return false;
}

function parseRecebidasBaixaGrid(grid: Cell[][], sheetName: string): ParsedExtrato {
  let currentDate: Date | null = null;
  let collecting = false; // só coleta após um `DATA BAIXA:` — descarta o preâmbulo de cada página
  let groupApplied = 0;
  let blankRemoved = 0;
  let totalsRemoved = 0;
  let headerRepeatsRemoved = 0;

  type RawRow = { date: Date | null; values: Cell[] };
  const collected: RawRow[] = [];

  for (const row of grid) {
    const c0 = cellStr(row[0]);

    // Título de página: fecha a coleta até o próximo `DATA BAIXA` (mata o preâmbulo abaixo).
    if (RB_TITLE_RE.test(c0)) {
      collecting = false;
      continue;
    }
    if (RB_DATA_BAIXA_RE.test(c0)) {
      const d = gridRowDate(row);
      if (d) currentDate = d;
      collecting = true;
      continue;
    }
    if (!collecting) continue; // preâmbulo de filtros entre o título e o 1º `DATA BAIXA`
    if (gridRowBlank(row)) {
      blankRemoved++;
      continue;
    }
    if (RB_HEADER_C1_RE.test(c0)) {
      headerRepeatsRemoved++;
      continue;
    }
    if (RB_TOTAL_RE.test(gridRowText(row))) {
      totalsRemoved++;
      continue;
    }
    // Linha de dados sempre tem o cód. do cliente (numérico) na 1ª coluna; o resto
    // (sub-cabeçalho, nota de rodapé `* Título...`) é ignorado silenciosamente.
    if (!RB_DIGITS_RE.test(c0)) continue;

    const values = RB_SCHEMA.map(({ col }) => row[col] ?? null);
    if (currentDate) groupApplied++;
    collected.push({ date: currentDate, values });
  }

  if (collected.length === 0) {
    throw new Error("Nenhum lançamento foi encontrado após as linhas de DATA BAIXA.");
  }

  const headers = ["Data Baixa", ...RB_SCHEMA.map((s) => s.label)];
  const rows: Cell[][] = collected.map((r) => [r.date ? formatDateBR(r.date) : "", ...r.values]);

  return {
    headers,
    rows,
    recommended: RB_RECOMMENDED,
    meta: {
      profile: "recebidas-baixa",
      sheetName,
      groupLabel: "Data Baixa",
      groupApplied,
      blankRemoved,
      totalsRemoved,
      headerRepeatsRemoved,
      usedFallback: false,
    },
  };
}

// ── Fallback genérico sobre grade 2D (para `.xls` de formato não reconhecido) ──

function parseGenericGrid(grid: Cell[][], sheetName: string): ParsedExtrato {
  // 1ª linha não-vazia vira cabeçalho; colunas = células não-vazias dessa linha.
  let headerRow = -1;
  for (let r = 0; r < grid.length; r++) {
    if (!gridRowBlank(grid[r])) {
      headerRow = r;
      break;
    }
  }
  if (headerRow === -1) throw new Error("A planilha não tem nenhuma linha com dados.");

  const cols: Array<{ col: number; label: string }> = [];
  const seen = new Map<string, number>();
  grid[headerRow].forEach((v, i) => {
    const label = cellStr(v);
    if (!label) return;
    const n = seen.get(label) ?? 0;
    seen.set(label, n + 1);
    cols.push({ col: i, label: n === 0 ? label : `${label} (${n + 1})` });
  });
  if (cols.length === 0) throw new Error("O cabeçalho identificado não tem colunas com título.");

  let blankRemoved = 0;
  const rows: Cell[][] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    if (gridRowBlank(grid[r])) {
      blankRemoved++;
      continue;
    }
    rows.push(cols.map(({ col }) => grid[r][col] ?? null));
  }

  return {
    headers: cols.map((c) => c.label),
    rows,
    recommended: [],
    meta: {
      profile: "generic",
      sheetName,
      groupLabel: null,
      groupApplied: 0,
      blankRemoved,
      totalsRemoved: 0,
      headerRepeatsRemoved: 0,
      usedFallback: true,
    },
  };
}
