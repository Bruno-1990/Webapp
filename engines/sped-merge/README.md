# engines/sped-merge — XLSX → SPED (merge)

Mescla alterações feitas na planilha exportada pela ferramenta **SPED → XLSX** de volta no arquivo **.txt** SPED original. Linhas e registros que não existem na planilha permanecem intactos.

## Requisitos

- **Layout de pastas:** `engines/sped` e `engines/sped-merge` (irmãs) — importa `engines/sped/sped_engine/config.py`. Mapa completo em `docs/ARCHITECTURE.md`.
- Planilha **obrigatoriamente** com a coluna **`_LINHA`** em cada aba de dados (exportação atual do `sped_engine`).
- Python 3.10+ e dependências:

```bash
pip install -r requirements.txt
```

## Uso (CLI)

```bash
python cli_merge.py --sped original.txt --xlsx editado.xlsx --output saida.txt
```

Saída JSON no stdout (progresso / erro), compatível com o worker Node.

## Testes

```bash
pip install -r requirements.txt pytest
pytest tests/ -v
```
