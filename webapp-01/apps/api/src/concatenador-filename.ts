/**
 * Nome do XLSX do Concatenador, derivado dos nomes dos arquivos de entrada.
 *
 * As exportações da SEFAZ chegam como
 *   `<CNPJ>_NFEs_<Emitente|Destinatario>_periodo_<dd-mm-aaaa>_a_<dd-mm-aaaa>.xlsx`
 * e, quando o relatório é quebrado em partes, o navegador acrescenta " (1)",
 * " (2)"… ao mesmo nome. O resultado deve ser um só arquivo cobrindo o período
 * inteiro: mantemos o prefixo (CNPJ + tipo) e recalculamos o intervalo com a
 * MENOR data inicial e a MAIOR data final entre as partes.
 *
 *   35060827000175_NFEs_Emitente_periodo_01-06-2026_a_15-06-2026.xlsx
 *   35060827000175_NFEs_Emitente_periodo_16-06-2026_a_30-06-2026.xlsx
 *   → 35060827000175_NFEs_Emitente_periodo_01-06-2026_a_30-06-2026.xlsx
 *
 * O prefixo é copiado tal como veio (não é reescrito): se a SEFAZ mudar
 * "NFEs"/"Emitente", o nome de saída acompanha sozinho.
 */

import { normalizeNfeTipoNoNome } from "@webapp/contracts";

/** Usado quando os nomes de entrada não seguem o padrão ou divergem entre si. */
export const CONCATENADOR_FALLBACK_FILE_NAME = "Planilha Unificada.xlsx";

const PERIODO_RE =
  /^(?<prefixo>.+?)_periodo_(?<inicio>\d{2}-\d{2}-\d{4})_a_(?<fim>\d{2}-\d{2}-\d{4})/i;

export type PeriodoExportName = {
  /** Tudo antes de `_periodo_` — normalmente `<CNPJ>_NFEs_<Emitente|Destinatario>`. */
  prefixo: string;
  /** `dd-mm-aaaa`, como aparece no nome. */
  inicio: string;
  fim: string;
};

/** Extrai prefixo + intervalo do nome. Devolve null se não seguir o padrão. */
export function parsePeriodoExportName(fileName: string): PeriodoExportName | null {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  const m = PERIODO_RE.exec(base);
  if (!m?.groups) return null;
  // Normaliza o acento corrompido ANTES de comparar: assim `Destinatario` e
  // `DestinatxE1rio` contam como o mesmo prefixo e o nome de saída sai limpo.
  const prefixo = normalizeNfeTipoNoNome(m.groups.prefixo.trim());
  if (prefixo.length === 0) return null;
  return { prefixo, inicio: m.groups.inicio, fim: m.groups.fim };
}

/** `dd-mm-aaaa` → `aaaammdd`, comparável como string. Null se a data não existir. */
function toSortableDate(ddmmaaaa: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(ddmmaaaa);
  if (!m) return null;
  const [, d, mo, y] = m;
  const dia = Number(d);
  const mes = Number(mo);
  const ano = Number(y);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  // Rejeita 31-02 e afins — um nome inválido deve cair no fallback, não gerar
  // um período que não existe.
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  if (dt.getUTCFullYear() !== ano || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== dia) {
    return null;
  }
  return `${y}${mo}${d}`;
}

/** Remove caracteres proibidos em nomes de ficheiro no Windows.
 *  O hífen e o underscore FICAM — eles estruturam o nome (`01-06-2026`). */
function sanitize(name: string): string {
  return name
    .replace(/[<>:"|?*]/g, "")
    .replace(/[/\\]/g, "_")
    .replace(/\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Nome do arquivo final a partir dos nomes enviados. Cai no fallback se algum
 * nome fugir do padrão ou se os prefixos divergirem (CNPJs diferentes, ou
 * Emitente misturado com Destinatario) — nesse caso um nome específico mentiria
 * sobre o conteúdo.
 */
export function buildConcatenadorFileName(fileNames: string[]): string {
  if (fileNames.length === 0) return CONCATENADOR_FALLBACK_FILE_NAME;

  const parsed: PeriodoExportName[] = [];
  for (const nome of fileNames) {
    const p = parsePeriodoExportName(nome);
    if (!p) return CONCATENADOR_FALLBACK_FILE_NAME;
    parsed.push(p);
  }

  const prefixo = parsed[0].prefixo;
  if (parsed.some((p) => p.prefixo !== prefixo)) return CONCATENADOR_FALLBACK_FILE_NAME;

  let inicio = parsed[0].inicio;
  let fim = parsed[0].fim;
  let inicioKey = toSortableDate(inicio);
  let fimKey = toSortableDate(fim);
  if (!inicioKey || !fimKey) return CONCATENADOR_FALLBACK_FILE_NAME;

  for (const p of parsed.slice(1)) {
    const iKey = toSortableDate(p.inicio);
    const fKey = toSortableDate(p.fim);
    if (!iKey || !fKey) return CONCATENADOR_FALLBACK_FILE_NAME;
    if (iKey < inicioKey) {
      inicioKey = iKey;
      inicio = p.inicio;
    }
    if (fKey > fimKey) {
      fimKey = fKey;
      fim = p.fim;
    }
  }

  const base = sanitize(`${prefixo}_periodo_${inicio}_a_${fim}`);
  return base.length > 0 ? `${base}.xlsx` : CONCATENADOR_FALLBACK_FILE_NAME;
}
