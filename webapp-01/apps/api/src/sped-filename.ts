/**
 * Nome do XLSX exportado: razão social do |0000| + data/hora (fuso America/Sao_Paulo).
 * Índices alinhados a `parser.py` `extract_razao_cnpj` (parts[6] = NOME).
 */

const SPED_SNIFF_MAX_BYTES = 512 * 1024;

export function extractSpedRazaoFromBuffer(buf: Buffer): string | null {
  const slice = buf.subarray(0, Math.min(buf.length, SPED_SNIFF_MAX_BYTES));
  return extractSpedRazaoFromText(slice.toString("utf8"));
}

export function extractSpedRazaoFromText(text: string): string | null {
  const idx = text.indexOf("|0000|");
  if (idx === -1) return null;
  const lineEnd = text.indexOf("\n", idx + 1);
  const line = (lineEnd === -1 ? text.slice(idx) : text.slice(idx, lineEnd)).replace(/\r$/, "");
  const parts = line.split("|");
  if (parts.length < 8) return null;
  const razao = (parts[6] ?? "").trim();
  return razao.length > 0 ? razao : null;
}

/** Remove caracteres inválidos em nomes de ficheiro no Windows. */
export function sanitizeWindowsFileBase(name: string, maxLen = 120): string {
  let s = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s.length > 0 ? s : "SPED";
}

/** `28-03-2026_14-30-45` em horário de Brasília (America/Sao_Paulo). */
export function formatSpedExportTimestamp(now: Date): string {
  const s = now.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return `export_${Date.now()}`;
  const [, y, mo, d, h, mi, se] = m;
  return `${d}-${mo}-${y}_${h}-${mi}-${se}`;
}

export function buildSpedXlsxFileName(razao: string | null, now: Date): string {
  const base = sanitizeWindowsFileBase(razao ?? "SPED").replace(/\s+/g, "_");
  const stamp = formatSpedExportTimestamp(now);
  return `${base}_${stamp}.xlsx`;
}
