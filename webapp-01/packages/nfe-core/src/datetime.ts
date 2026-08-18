/** Formata data/hora da NF-e (ISO ou já BR) no padrão `dd/mm/aaaa - hh:mm:ss`. */
export function formatDhEmiBr(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  // ISO comum da NF-e: 2025-09-22T12:42:01-03:00
  const mIso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2}))?/);
  if (mIso) {
    const yyyy = mIso[1]!;
    const mm = mIso[2]!;
    const dd = mIso[3]!;
    const hh = mIso[4];
    const mi = mIso[5];
    const ss = mIso[6];
    if (hh && mi && ss) return `${dd}/${mm}/${yyyy} - ${hh}:${mi}:${ss}`;
    return `${dd}/${mm}/${yyyy}`;
  }
  // Quando já vier sem timezone, só normaliza o separador de data/hora.
  const mBr = t.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T-]+(\d{2})[:/](\d{2})[:/](\d{2}))?$/);
  if (mBr) {
    const dd = mBr[1]!;
    const mm = mBr[2]!;
    const yyyy = mBr[3]!;
    const hh = mBr[4];
    const mi = mBr[5];
    const ss = mBr[6];
    if (hh && mi && ss) return `${dd}/${mm}/${yyyy} - ${hh}:${mi}:${ss}`;
    return `${dd}/${mm}/${yyyy}`;
  }
  return t;
}
