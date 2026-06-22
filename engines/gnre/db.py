"""Persistência SQLite com dedupe por nome de arquivo.

O caminho do banco é configurável via env `GNRE_DB_PATH`. Default: ./data/gnre.db
relativo a este módulo. O caminho do pai é criado se não existir.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable, Iterator, Optional

_DEFAULT_DB = Path(__file__).parent / "data" / "gnre.db"


def _db_path() -> Path:
    env = os.environ.get("GNRE_DB_PATH", "").strip()
    return Path(env) if env else _DEFAULT_DB


_SCHEMA = """
CREATE TABLE IF NOT EXISTS lancamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arquivo TEXT NOT NULL UNIQUE,
  cnpj_destinatario TEXT NOT NULL,
  valor_principal REAL NOT NULL,
  uf_favorecida TEXT,
  data_vencimento TEXT,
  periodo_referencia TEXT,
  no_controle TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lanc_criado ON lancamentos(criado_em DESC);

CREATE TABLE IF NOT EXISTS falhas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arquivo TEXT NOT NULL,
  motivo TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_falhas_criado ON falhas(criado_em DESC);
"""


@contextmanager
def _conn() -> Iterator[sqlite3.Connection]:
    p = _db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(p)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


def init_db() -> None:
    with _conn() as c:
        c.executescript(_SCHEMA)


def insert_lancamento(
    *,
    arquivo: str,
    cnpj_destinatario: str,
    valor_principal: float,
    uf_favorecida: Optional[str] = None,
    data_vencimento: Optional[str] = None,
    periodo_referencia: Optional[str] = None,
    no_controle: Optional[str] = None,
) -> str:
    with _conn() as c:
        cur = c.execute(
            """INSERT OR IGNORE INTO lancamentos
               (arquivo, cnpj_destinatario, valor_principal, uf_favorecida,
                data_vencimento, periodo_referencia, no_controle)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (arquivo, cnpj_destinatario, float(valor_principal), uf_favorecida,
             data_vencimento, periodo_referencia, no_controle),
        )
    return "inserted" if cur.rowcount == 1 else "duplicate"


def insert_falha(arquivo: str, motivo: str) -> None:
    with _conn() as c:
        c.execute(
            "INSERT INTO falhas (arquivo, motivo) VALUES (?, ?)",
            (arquivo, motivo),
        )


def fetch_lancamentos_by_files(arquivos: Iterable[str]) -> list[dict]:
    nomes = [a for a in arquivos if a]
    if not nomes:
        return []
    placeholders = ",".join(["?"] * len(nomes))
    with _conn() as c:
        rows = c.execute(
            f"""SELECT arquivo, cnpj_destinatario, valor_principal, uf_favorecida,
                       data_vencimento, periodo_referencia, no_controle, criado_em
                FROM lancamentos
                WHERE arquivo IN ({placeholders})
                ORDER BY id ASC""",
            tuple(nomes),
        ).fetchall()
    return [dict(r) for r in rows]


def fetch_falhas_by_files(arquivos: Iterable[str]) -> list[dict]:
    nomes = [a for a in arquivos if a]
    if not nomes:
        return []
    placeholders = ",".join(["?"] * len(nomes))
    with _conn() as c:
        rows = c.execute(
            f"""SELECT arquivo, motivo, criado_em
                FROM falhas
                WHERE arquivo IN ({placeholders})
                ORDER BY id ASC""",
            tuple(nomes),
        ).fetchall()
    return [dict(r) for r in rows]
