/**
 * Formatadores pt-BR usados na montagem do DANFSe (CNPJ/CPF, CEP, telefone,
 * moeda, percentual, datas). Tudo tolerante a entrada vazia/parcial — devolve
 * o traço padrão `DASH` quando não há valor, igual ao DANFSe oficial.
 */

export const DASH = "-";

function onlyDigits(s: string): string {
  return (s ?? "").replace(/\D+/g, "");
}

/** `06227329000176` → `06.227.329/0001-76`; CPF (11) → `000.000.000-00`. */
export function fmtCnpjCpf(value: string | null | undefined): string {
  const d = onlyDigits(value ?? "");
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return d || DASH;
}

/** `29050360` → `29050-360`. */
export function fmtCep(value: string | null | undefined): string {
  const d = onlyDigits(value ?? "");
  if (d.length === 8) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return d || DASH;
}

/** `2721227447` → `(27) 2122-7447`; 11 dígitos → `(27) 99900-7840`. */
export function fmtFone(value: string | null | undefined): string {
  const d = onlyDigits(value ?? "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || DASH;
}

/** Número → `R$ 1.234,56`. Aceita string ("10000.00") ou number. */
export function fmtBRL(value: string | number | null | undefined): string {
  const n = toNumber(value);
  if (n == null) return DASH;
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `3.65` → `3,65 %`. */
export function fmtPct(value: string | number | null | undefined): string {
  const n = toNumber(value);
  if (n == null) return DASH;
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

export function toNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** ISO (`2026-05-01T00:05:36-03:00`) → `01/05/2026 00:05:36`. */
export function fmtDataHora(iso: string | null | undefined): string {
  const p = splitIso(iso);
  if (!p) return DASH;
  return `${p.dd}/${p.mm}/${p.yyyy} ${p.hh}:${p.mi}:${p.ss}`;
}

/** ISO ou `yyyy-mm-dd` → `dd/mm/aaaa`. */
export function fmtData(iso: string | null | undefined): string {
  const p = splitIso(iso);
  if (!p) return DASH;
  return `${p.dd}/${p.mm}/${p.yyyy}`;
}

function splitIso(
  iso: string | null | undefined,
): { yyyy: string; mm: string; dd: string; hh: string; mi: string; ss: string } | null {
  if (!iso) return null;
  const m = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!m) return null;
  return {
    yyyy: m[1],
    mm: m[2],
    dd: m[3],
    hh: m[4] ?? "00",
    mi: m[5] ?? "00",
    ss: m[6] ?? "00",
  };
}

/** `171401` → `17.14.01` (código de tributação nacional / item LC 116). */
export function fmtCodTrib(code: string | null | undefined): string {
  const d = onlyDigits(code ?? "");
  if (d.length === 6) return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`;
  return code?.trim() || DASH;
}

/** Junta partes de endereço em uma linha, ignorando vazios. */
export function joinEndereco(parts: Array<string | null | undefined>): string {
  const out = parts.map((p) => (p ?? "").trim()).filter((p) => p.length > 0);
  return out.length ? out.join(", ") : DASH;
}

/** "Vila Velha" + "ES" → "Vila Velha - ES"; tolera ausências. */
export function fmtMunicipioUf(nome: string | null | undefined, uf: string | null | undefined): string {
  const n = (nome ?? "").trim();
  const u = (uf ?? "").trim();
  if (n && u) return `${n} - ${u}`;
  if (n) return n;
  if (u) return u;
  return DASH;
}

/** Devolve `value` se houver conteúdo, senão o traço padrão. */
export function orDash(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v.length ? v : DASH;
}
