/**
 * Cliente HTTP do cadastro de clientes/fornecedores (rotas
 * /api/v1/tools/extrato-edit/* na API Fastify). O Vite faz proxy de /api quando
 * VITE_API_URL está vazio; senão chama a API direto.
 */
import type { RegistryRow } from "./parseRegistry.js";

const API_PREFIX = "/api/v1";

function baseUrl(): string {
  const b = import.meta.env.VITE_API_URL as string | undefined;
  return (b ?? "").replace(/\/$/, "");
}

export type EntidadeTipo = "cliente" | "fornecedor";

export type Entidade = {
  tipo: EntidadeTipo;
  codigo: string;
  nome: string;
  cnpj: string;
  updatedAt: string;
};

export type Counts = { cliente: number; fornecedor: number };

export type ImportResult = {
  inserted: number;
  updated: number;
  ignored: number;
  counts: Counts;
};

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? res.statusText;
}

const offlineMsg =
  "Não foi possível falar com a API em :8000 (o Vite faz proxy de /api para lá). " +
  "Na raiz do projeto: npm run redis:up e npm run dev — ou docker compose up -d.";

function wrapNetworkError(e: unknown): never {
  if (!baseUrl() && (e instanceof TypeError || e instanceof Error)) {
    throw new Error(offlineMsg);
  }
  throw e;
}

/** Grava o cadastro no banco. `replace` apaga o tipo antes de inserir (recarga do zero). */
export async function importEntidades(
  tipo: EntidadeTipo,
  rows: RegistryRow[],
  replace = false,
): Promise<ImportResult> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/extrato-edit/entidades/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, rows, replace }),
    });
  } catch (e) {
    wrapNetworkError(e);
  }
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<ImportResult>;
}

/** Busca CNPJ/nome por código (só os que casaram entram no mapa de retorno). */
export async function lookupCnpj(
  tipo: EntidadeTipo,
  codigos: string[],
): Promise<Record<string, { cnpj: string; nome: string }>> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/extrato-edit/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, codigos }),
    });
  } catch (e) {
    wrapNetworkError(e);
  }
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { matches: Record<string, { cnpj: string; nome: string }> };
  return data.matches ?? {};
}

export async function fetchCounts(): Promise<Counts> {
  try {
    const res = await fetch(`${baseUrl()}${API_PREFIX}/tools/extrato-edit/entidades/counts`);
    if (!res.ok) throw new Error(await readError(res));
    const data = (await res.json()) as { counts: Counts };
    return data.counts ?? { cliente: 0, fornecedor: 0 };
  } catch (e) {
    wrapNetworkError(e);
  }
}

export type ListResult = { items: Entidade[]; total: number; counts: Counts };

export async function listEntidades(opts: {
  tipo?: EntidadeTipo;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<ListResult> {
  const qs = new URLSearchParams();
  if (opts.tipo) qs.set("tipo", opts.tipo);
  if (opts.q) qs.set("q", opts.q);
  if (opts.limit != null) qs.set("limit", String(opts.limit));
  if (opts.offset != null) qs.set("offset", String(opts.offset));
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/extrato-edit/entidades?${qs.toString()}`);
  } catch (e) {
    wrapNetworkError(e);
  }
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<ListResult>;
}

export async function deleteEntidade(tipo: EntidadeTipo, codigo: string): Promise<Counts> {
  const qs = new URLSearchParams({ tipo, codigo });
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/extrato-edit/entidades/item?${qs.toString()}`, {
      method: "DELETE",
    });
  } catch (e) {
    wrapNetworkError(e);
  }
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { counts: Counts };
  return data.counts;
}

export async function clearTipo(tipo: EntidadeTipo): Promise<Counts> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/extrato-edit/entidades?tipo=${tipo}`, {
      method: "DELETE",
    });
  } catch (e) {
    wrapNetworkError(e);
  }
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { counts: Counts };
  return data.counts;
}
