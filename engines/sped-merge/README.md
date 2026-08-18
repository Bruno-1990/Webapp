# engines/sped-merge — XLSX → SPED (merge)

Mescla alterações feitas na planilha exportada pela ferramenta **SPED → XLSX** de volta no arquivo **.txt** SPED original. Linhas e registros que não existem na planilha permanecem intactos.

## Requisitos

- **Layout de pastas:** `engines/sped` e `engines/sped-merge` (irmãs) — importa `engines/sped/sped_engine/config.py`. Mapa completo em `docs/ARCHITECTURE.md`.
- Planilha **obrigatoriamente** com a coluna **`_LINHA`** em cada aba de dados (exportação atual do `sped_engine`).
- Python 3.10+ e dependências:

```bash
pip install -r requirements.txt
```

## Colunas injetadas (não existem no `.txt`)

O exportador acrescenta o vínculo do registro pai como primeiras colunas dos
filhos (`C170`/`C190` → `NUM_DOC`,`CHV_NFE`; `C590` → `NUM_DOC`;
`D101`/`D105`/`D190` → `NUM_DOC`,`CHV_CTE`; `D590` → `NUM_DOC`). Ao remontar a
linha SPED elas precisam ser **descartadas** — feito em
`inner_payload_for_register` (`line_builders.py`). Um REG novo com coluna
injetada tem que entrar lá **e** em `CORE_SHEETS` (`inspect_xlsx.py`); caso
contrário o merge grava linhas com campos a mais. Lista completa dos vínculos no
[README do engines/sped](../sped/README.md).

## Modo sem o `.txt` original

`inspect_xlsx.py` decide se a planilha basta por si só (`complete`) ou se o SPED
original é obrigatório (`requiresOriginal`): exige `_LINHA` em toda aba de
registro, os cabeçalhos esperados e a sequência `1..N` de `_LINHA` **sem
buracos** — é essa checagem que garante que nenhuma linha do arquivo se perdeu.

`CORE_SHEETS` é derivado de `SHEET_ORDER` (`engines/sped/sped_engine/config.py`),
não copiado — um REG novo no exportador entra aqui sozinho.

`CORE_SHEETS_OPCIONAIS` (hoje `D101`/`D105`) lista abas core acrescentadas depois
que planilhas já circulavam: a ausência **não** invalida a planilha, porque se o
`.txt` de origem tivesse essas linhas a checagem de sequência acusaria o buraco.
Ao acrescentar uma aba core nova, coloque-a aqui também — senão toda planilha
exportada antes passa a exigir o `.txt` original.

## Normalização numérica

Campo cujo valor **não mudou** volta com o texto exato do `.txt` original. Isso
importa porque o Excel guarda `ALIQ_*`/`QTD` como número: `7,60` é lido como
`7.6` e, sem essa regra, o arquivo remontado teria diferenças puramente de
formatação. Campo editado usa o valor novo, ajustado ao separador decimal do
original (`_numeros_iguais` / `normalize_sped_field` em `line_builders.py`).

## Uso (CLI)

```bash
python cli_merge.py --sped original.txt --xlsx editado.xlsx --output saida.txt
```

Saída JSON no stdout (progresso / erro), compatível com o worker Node.

## Testes

```bash
pip install -r requirements.txt pytest
pytest tests/ -v          # ou, de webapp-01/: npm run test:sped-merge-py
```

Cobre round-trip byte a byte do `sped_minimo.txt` e do `sped_bloco_d.txt` (bloco
D com D101/D105), edição de célula, normalização numérica, descarte das colunas
injetadas e o inspetor (planilha antiga sem D101/D105 segue completa).
