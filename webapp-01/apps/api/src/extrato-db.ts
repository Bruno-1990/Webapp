/**
 * Cadastro de clientes/fornecedores do Editor de Extrato (SQLite via better-sqlite3).
 *
 * O usuário sobe uma planilha de cadastro com 3 colunas (Cód., Nome, CNPJ) e os
 * dados ficam aqui. Quando processa um extrato (que tem nome mas não tem CNPJ), a
 * ferramenta busca o CNPJ pelo código do cliente/fornecedor e o anexa na saída.
 *
 * Banco compartilhado na intranet: vive num volume persistente
 * (`EXTRATO_DB_PATH`), igual ao dedupe SQLite do GNRE. Conexão síncrona única
 * (better-sqlite3) — simples e suficiente para o volume de um escritório.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type EntidadeTipo = "cliente" | "fornecedor";

export type Entidade = {
  tipo: EntidadeTipo;
  codigo: string;
  nome: string;
  cnpj: string;
  updatedAt: string;
};

export type EntidadeInput = {
  codigo: string;
  nome?: string | null;
  cnpj?: string | null;
};

let db: Database.Database | null = null;

/** Abre (e cria, se preciso) o banco. Idempotente. */
export function getExtratoDb(dbPath: string): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const conn = new Database(dbPath);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  // A chave primária é o código (por tipo): (tipo, codigo_key). O código identifica
  // o cliente/fornecedor; reenviar o mesmo código atualiza o registro (upsert).
  conn.exec(`
    CREATE TABLE IF NOT EXISTS entidades (
      tipo       TEXT NOT NULL CHECK (tipo IN ('cliente','fornecedor')),
      codigo     TEXT NOT NULL,
      codigo_key TEXT NOT NULL,
      nome       TEXT NOT NULL DEFAULT '',
      cnpj       TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tipo, codigo_key)
    );
  `);
  db = conn;
  return conn;
}

/**
 * Chave de busca tolerante: zeros à esquerda e caixa não devem separar "001" de
 * "1" ou "abc" de "ABC". Códigos puramente numéricos perdem zeros à esquerda;
 * os demais ficam em maiúsculas sem espaços nas pontas.
 */
export function normalizeCodigo(raw: string): string {
  const t = String(raw ?? "").trim();
  if (t === "") return "";
  if (/^\d+$/.test(t)) return String(Number(t));
  return t.toUpperCase();
}

/** CNPJ formatado quando tem 14 dígitos; senão devolve o texto limpo. */
export function formatCnpj(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  if (t === "") return "";
  const digits = t.replace(/\D/g, "");
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return t;
}

function rowToEntidade(r: Record<string, unknown>): Entidade {
  return {
    tipo: r.tipo as EntidadeTipo,
    codigo: r.codigo as string,
    nome: r.nome as string,
    cnpj: r.cnpj as string,
    updatedAt: r.updated_at as string,
  };
}

export type ImportResult = { inserted: number; updated: number; ignored: number };

/**
 * Upsert em lote (uma transação). Registros sem código são ignorados. Quando o
 * mesmo (tipo, código) já existe, atualiza nome/CNPJ — a última carga vence.
 */
export function importEntidades(
  conn: Database.Database,
  tipo: EntidadeTipo,
  rows: EntidadeInput[],
  nowIso: string,
): ImportResult {
  const find = conn.prepare(
    "SELECT 1 FROM entidades WHERE tipo = ? AND codigo_key = ?",
  );
  const insert = conn.prepare(
    `INSERT INTO entidades (tipo, codigo, codigo_key, nome, cnpj, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const update = conn.prepare(
    `UPDATE entidades SET codigo = ?, nome = ?, cnpj = ?, updated_at = ?
     WHERE tipo = ? AND codigo_key = ?`,
  );

  const run = conn.transaction((items: EntidadeInput[]): ImportResult => {
    let inserted = 0;
    let updated = 0;
    let ignored = 0;
    for (const item of items) {
      const codigo = String(item.codigo ?? "").trim();
      const key = normalizeCodigo(codigo);
      if (key === "") {
        ignored++;
        continue;
      }
      const nome = String(item.nome ?? "").trim();
      const cnpj = formatCnpj(item.cnpj);
      const exists = find.get(tipo, key) !== undefined;
      if (exists) {
        update.run(codigo, nome, cnpj, nowIso, tipo, key);
        updated++;
      } else {
        insert.run(tipo, codigo, key, nome, cnpj, nowIso);
        inserted++;
      }
    }
    return { inserted, updated, ignored };
  });

  return run(rows);
}

/** Busca CNPJ/nome por código para um tipo. Devolve só os que casaram. */
export function lookupByCodigos(
  conn: Database.Database,
  tipo: EntidadeTipo,
  codigos: string[],
): Record<string, { cnpj: string; nome: string }> {
  const stmt = conn.prepare(
    "SELECT cnpj, nome FROM entidades WHERE tipo = ? AND codigo_key = ?",
  );
  const out: Record<string, { cnpj: string; nome: string }> = {};
  for (const codigo of codigos) {
    const key = normalizeCodigo(codigo);
    if (key === "" || out[codigo] !== undefined) continue;
    const row = stmt.get(tipo, key) as { cnpj: string; nome: string } | undefined;
    if (row) out[codigo] = { cnpj: row.cnpj, nome: row.nome };
  }
  return out;
}

export type ListResult = { items: Entidade[]; total: number };

/** Lista paginada com busca opcional (código, nome ou CNPJ) e filtro por tipo. */
export function listEntidades(
  conn: Database.Database,
  opts: { tipo?: EntidadeTipo; q?: string; limit: number; offset: number },
): ListResult {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.tipo) {
    where.push("tipo = ?");
    params.push(opts.tipo);
  }
  if (opts.q && opts.q.trim() !== "") {
    const like = `%${opts.q.trim()}%`;
    where.push("(codigo LIKE ? OR nome LIKE ? OR cnpj LIKE ?)");
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (
    conn.prepare(`SELECT COUNT(*) AS n FROM entidades ${clause}`).get(...params) as {
      n: number;
    }
  ).n;
  const rows = conn
    .prepare(
      `SELECT * FROM entidades ${clause} ORDER BY tipo, nome, codigo LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.limit, opts.offset) as Record<string, unknown>[];
  return { items: rows.map(rowToEntidade), total };
}

export function countEntidades(conn: Database.Database): Record<EntidadeTipo, number> {
  const rows = conn
    .prepare("SELECT tipo, COUNT(*) AS n FROM entidades GROUP BY tipo")
    .all() as { tipo: EntidadeTipo; n: number }[];
  const out: Record<EntidadeTipo, number> = { cliente: 0, fornecedor: 0 };
  for (const r of rows) out[r.tipo] = r.n;
  return out;
}

export function deleteEntidade(
  conn: Database.Database,
  tipo: EntidadeTipo,
  codigo: string,
): boolean {
  const key = normalizeCodigo(codigo);
  if (key === "") return false;
  return (
    conn
      .prepare("DELETE FROM entidades WHERE tipo = ? AND codigo_key = ?")
      .run(tipo, key).changes > 0
  );
}

/** Limpa todo um tipo (usado quando o usuário quer recarregar do zero). */
export function clearTipo(conn: Database.Database, tipo: EntidadeTipo): number {
  return conn.prepare("DELETE FROM entidades WHERE tipo = ?").run(tipo).changes;
}
