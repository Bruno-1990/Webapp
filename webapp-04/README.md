# webapp-04 — Consolidado SCI (planilha → Excel)

Quarta ferramenta do monorepo: transforma exportação **SCI** (CSV ou Excel) em **ProdutosSCI.xlsx** com abas *Produtos*, *Base* e *Consolidado (SCI)*.

## Pastas irmãs

No mesmo diretório pai: `webapp-01`, `webapp-02`, `webapp-03`, **webapp-04**.

O worker Node fica em `webapp-01/apps/worker-sci-consolidado` e executa este código via `SCI_CONSOLIDADO_PY_DIR` (padrão: esta pasta).

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
cd webapp-04
py -m pytest tests/ -q
```

## CLI (manual)

```bash
py cli.py --input entrada.csv --output saida.xlsx
```

Saída JSON no stdout (progresso / erro), compatível com o worker.
