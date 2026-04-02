import type { NfeRow } from "./cols.js";

/** Remove caracteres inválidos em nomes de arquivo no Windows e limita o tamanho. */
export function sanitizeWindowsFileBaseName(raw: string, maxLen = 72): string {
  const s = raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen).trim() : s;
}

export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Emitente mais frequente nas linhas (ignora linhas sem emit). */
export function pickDominantEmit(rows: NfeRow[]): {
  emitXNome?: string;
  emitCnpj?: string;
} {
  type Acc = { xNome: string; cnpj: string; n: number };
  const counts = new Map<string, Acc>();
  for (const r of rows) {
    const x = r.emit_xNome?.trim() ?? "";
    const c = r.emit_CNPJ?.replace(/\D/g, "") ?? "";
    if (!x && !c) continue;
    const key = x ? `x:${x}` : `c:${c}`;
    const prev = counts.get(key);
    if (prev) prev.n += 1;
    else counts.set(key, { xNome: x, cnpj: c, n: 1 });
  }
  if (counts.size === 0) return {};
  let best: Acc | undefined;
  for (const v of counts.values()) {
    if (!best || v.n > best.n) best = v;
  }
  return {
    emitXNome: best!.xNome || undefined,
    emitCnpj: best!.cnpj || undefined,
  };
}

/**
 * Nome sugerido para download: empresa (emit) + data da geração.
 * Prefixo e slug em maiúsculas para leitura clara (ex.: `NFE_OURO_PRETO_LTDA_2025-03-26.xlsx`).
 */
export function buildNfeExportFileName(
  emitXNome: string | undefined,
  emitCnpj: string | undefined,
  now: Date = new Date()
): string {
  const date = formatLocalDate(now);
  const base = sanitizeWindowsFileBaseName(emitXNome ?? "")
    .replace(/\s+/g, "_")
    .toUpperCase();
  if (base) return `NFE_${base}_${date}.xlsx`;
  const c = emitCnpj?.replace(/\D/g, "") ?? "";
  if (c) return `NFE_CNPJ_${c}_${date}.xlsx`;
  return `NFE_Itens_${date}.xlsx`;
}
