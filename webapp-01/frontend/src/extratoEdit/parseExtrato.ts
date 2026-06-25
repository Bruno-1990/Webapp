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

export type ParseProfile = "contas-pagas" | "titulos-recebidos" | "generic";

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
  const ExcelJS = (await import("exceljs")).default;
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const ws: Worksheet | undefined = wb.worksheets.find((w) => w.actualRowCount > 0) ?? wb.worksheets[0];
  if (!ws) throw new Error("A planilha não tem nenhuma aba com dados.");

  const colCount = Math.max(1, ws.actualColumnCount || ws.columnCount || 1);
  const rowCount = ws.rowCount;

  if (isTitulosRecebidos(ws, rowCount, colCount)) {
    return parseTitulosRecebidos(ws, rowCount, colCount);
  }
  return parseContasPagas(ws, rowCount, colCount);
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
