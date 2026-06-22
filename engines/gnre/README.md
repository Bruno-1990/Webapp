# engines/gnre — Extrator GNRE (PDF → XLSX)

Engine do monorepo: extrai dados das guias GNRE (PDF) e gera planilha
consolidada com 2 abas (`Lançamentos` e `Falhas`).

## Localização

Engine Python em `engines/gnre`. O worker Node fica em
`webapp-01/apps/worker-gnre-bridge` e executa este código via `GNRE_PY_DIR`
(padrão: esta pasta). Ver o mapa completo em `docs/ARCHITECTURE.md`.

## Persistência

SQLite local. Dedupe por nome de arquivo (constraint `UNIQUE`). Caminho do banco
configurável via env `GNRE_DB_PATH` (default: `engines/gnre/data/gnre.db`).

## Requisitos

- Python 3.10+
- `pip install -r requirements.txt`

## CLI

```bash
python cli.py --pdfs-dir <pasta> --output <saida.xlsx> [--db <gnre.db>]
```

Protocolo JSON-lines no stdout (consumido pelo worker Node):

- `{"kind":"progress","value":0..100}`
- `{"kind":"file","ok":true|false,"arquivo":"…","duplicate":bool,"motivo":"…"}`
- `{"kind":"error","message":"…"}`
- `{"kind":"done","output":"<xlsx>","result":{…}}`

## Testes

```bash
pytest tests/ -v
```
