# engines/sci-consolidado — Consolidado SCI (planilha → Excel)

Engine do monorepo: transforma exportação **SCI** (CSV ou Excel) em **ProdutosSCI.xlsx** com abas *Produtos*, *Base* e *Consolidado (SCI)*.

## Localização

Engine Python em `engines/sci-consolidado`. O worker Node fica em `webapp-01/apps/worker-sci-consolidado` e executa este código via `SCI_CONSOLIDADO_PY_DIR` (padrão: esta pasta). Mapa completo em `docs/ARCHITECTURE.md`.

## Requisitos

- Python 3.10+
- Dependências:

```bash
pip install -r requirements.txt
```

## Testes

Na pasta `webapp-01`:

```bash
npm run test:sci-py
```

Ou diretamente:

```bash
cd engines/sci-consolidado
py -m pytest tests/ -q
```

## CLI (manual)

```bash
py cli.py --input entrada.csv --output saida.xlsx
```

Saída JSON no stdout (progresso / erro), compatível com o worker.
