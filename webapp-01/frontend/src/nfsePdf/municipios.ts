/**
 * Resolve código IBGE de município → "Nome - UF".
 *
 * A UF vem dos 2 primeiros dígitos do código (tabela fixa de 27 entradas); o
 * nome vem da tabela IBGE completa (`municipios.json`, ~5570 municípios, ~140 KB),
 * carregada sob demanda via dynamic import para não pesar o bundle inicial —
 * mesmo padrão do `exceljs` no Editor de Extrato.
 */
import { fmtMunicipioUf } from "./format.js";

const UF_BY_PREFIX: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
  "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR",
  "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

let cache: Record<string, string> | null = null;
let loading: Promise<Record<string, string>> | null = null;

/** Pré-carrega a tabela (chamar uma vez antes de gerar vários PDFs). */
export async function loadMunicipios(): Promise<Record<string, string>> {
  if (cache) return cache;
  if (!loading) {
    loading = import("./municipios.json")
      .then((m) => {
        cache = ((m as { default?: Record<string, string> }).default ??
          (m as unknown as Record<string, string>)) as Record<string, string>;
        return cache;
      })
      .catch(() => {
        cache = {};
        return cache;
      });
  }
  return loading;
}

export function ufFromCodigo(cMun: string | null | undefined): string {
  const c = (cMun ?? "").trim();
  return UF_BY_PREFIX[c.slice(0, 2)] ?? "";
}

/**
 * "Nome - UF" a partir do código. Requer `loadMunicipios()` já resolvido;
 * se a tabela não carregou, devolve só a UF (derivada do prefixo) ou o código.
 */
export function municipioLabel(cMun: string | null | undefined): string {
  const c = (cMun ?? "").trim();
  if (!c) return "-";
  const nome = cache?.[c] ?? "";
  const uf = ufFromCodigo(c);
  if (!nome && !uf) return c;
  return fmtMunicipioUf(nome || c, uf);
}
