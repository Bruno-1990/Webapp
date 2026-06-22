/**
 * Leitura e normalização de um extrato/relatório .xlsx no navegador (ExcelJS).
 *
 * O relatório de origem (ex.: "Contas Pagas" do SIST) traz a data em *linhas*
 * separadoras (`DT. PAGAMENTO: <data>`) que regem os lançamentos abaixo delas,
 * cabeçalhos repetidos por bloco, um preâmbulo de metadados e linhas de
 * `Total do Dia`. Aqui colapsamos células mescladas, "explodimos" a data numa
 * coluna à esquerda de cada lançamento e descartamos preâmbulo, cabeçalhos
 * repetidos, totais e linhas em branco.
 *
 * Há um fallback genérico: se nenhum cabeçalho `Lanc.` for encontrado, a 1ª
 * linha não-vazia vira cabeçalho e as demais não-vazias viram dados — assim a
 * ferramenta ainda funciona com qualquer planilha.
 */
import type { Cell as ExcelCell, Row, Worksheet } from "exceljs";

export type Cell = string | number | boolean | Date | null;

export type ParseMeta = {
  sheetName: string;
  datesExploded: number;
  blankRemoved: number;
  totalsRemoved: number;
  headerRepeatsRemoved: number;
  hasDateColumn: boolean;
  usedFallback: boolean;
};

export type ParsedExtrato = {
  headers: string[];
  rows: Cell[][];
  meta: ParseMeta;
};

const DATE_SEP_RE = /pagamento/i;
const TOTAL_RE = /total\s+do\s+dia|t[íi]tulos\s+listados/i;
const HEADER_FIRST_COL_RE = /^lan[cç]/i; // "Lanc." / "Lançamento"
/** Início do rodapé de resumos ("Resumo por Banco/Usuário") — daqui pra baixo é só totalização. */
const SUMMARY_SECTION_RE = /resumo\s+por/i;

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
  const rowCount = ws.actualRowCount ? ws.rowCount : ws.rowCount;

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
    meta: {
      sheetName: ws.name,
      datesExploded,
      blankRemoved,
      totalsRemoved,
      headerRepeatsRemoved,
      hasDateColumn,
      usedFallback,
    },
  };
}
