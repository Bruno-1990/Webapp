# engines/sped — SPED EFD → XLSX

Engine Python da ferramenta **SPED → XLSX** (`sped_engine/`). Recebe o `.txt` da
EFD e devolve um `.xlsx` com uma aba por registro. Mapa do ecossistema em
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md); atalhos de arquivo em
[`docs/TOOLS.md`](../../docs/TOOLS.md).

Consumido pelo [`worker-sped-bridge`](../../webapp-01/apps/worker-sped-bridge)
(env `SPED_ENGINE_DIR`) e importado por [`engines/sped-merge`](../sped-merge)
para o caminho inverso (XLSX → SPED).

## CLI

```bash
python cli.py --input arquivo.txt --output saida.xlsx [--sheets C100,C170]
```

`--sheets` omitido = abas core (`SHEET_ORDER`). Qualquer REG de 4 caracteres é
aceito; REG sem cabeçalho conhecido sai em layout genérico (`COL_01`, `COL_02`, …).
Stdout em JSON lines (`progress` / `error` / `done`), consumido pelo worker.

## Abas core (`config.py` → `SHEET_ORDER`)

`0150` · `0200` · `C100` · `C170` · `C190` · `C500` · `C590` · `D100` · **`D101`** ·
**`D105`** · `D190` · `D500` · `D590`

Devem ser **iguais** a `SPED_EXPORT_SHEET_KEYS` em
[`packages/contracts/src/index.ts`](../../webapp-01/packages/contracts/src/index.ts)
(a API valida contra essa lista e o frontend monta os checkboxes a partir dela).

### Registros filhos e colunas injetadas

Registros analíticos/complementares não repetem o documento a que pertencem no
`.txt`. O parser injeta o vínculo do pai como as primeiras colunas do Excel:

| Filho | Pai | Colunas injetadas |
|-------|-----|-------------------|
| `C170`, `C190` | `C100` | `NUM_DOC`, `CHV_NFE` |
| `C590` | `C500` | `NUM_DOC` |
| `D101` (PIS/PASEP), `D105` (COFINS), `D190` | `D100` | `NUM_DOC`, `CHV_CTE` |
| `D590` | `D500` | `NUM_DOC` |

`D101`/`D105` são os complementos do CT-e na **EFD Contribuições** (o D100 em si
é o mesmo registro de documento de transporte). Estrutura idêntica entre os dois,
mudando só a contribuição: `IND_NAT_FRT`, `VL_ITEM`, `CST_*`, `NAT_BC_CRED`,
`VL_BC_*`, `ALIQ_*`, `VL_*`, `COD_CTA`, `COD_CCUS`.

Essas colunas **não existem** como campos do `.txt` — quem faz o caminho inverso
precisa removê-las (ver `inner_payload_for_register` em `engines/sped-merge`).

## Checklist — adicionar um REG às abas core

1. `sped_engine/config.py` — entrada em `HEADERS` + posição em `SHEET_ORDER`.
2. `sped_engine/parser.py` — se for filho, injetar o vínculo do pai.
3. `sped_engine/processor.py` — `minimal_context_regs` (puxa o pai no parse
   quando só o filho é exportado) e a tupla de `link_checks`.
4. `sped_engine/report.py` — as duas tuplas da validação de vínculos.
5. `sped_engine/cabecalhos_sped.py` — `_INJECT_REGS` se tiver coluna injetada
   (senão o guia sobrescreve os cabeçalhos e as colunas do pai somem).
6. `sped_engine/cabecalhos_sped.txt` — título + linha `REG | CAMPO | …`;
   **copiar** para `webapp-01/apps/api/src/data/cabecalhos-sped.txt`.
7. `packages/contracts/src/index.ts` — `SPED_EXPORT_SHEET_KEYS` +
   `SPED_EXPORT_SHEET_LABELS` (frontend e API herdam daqui).
8. `engines/sped-merge` — `line_builders.py` (`inner_payload_for_register`, se
   houver coluna injetada) e `CORE_SHEETS_OPCIONAIS` em `inspect_xlsx.py`, se a
   aba for nova (senão planilhas já exportadas passam a exigir o `.txt`).
9. `npm run check:sync` (de `webapp-01/`) — confere os passos 1, 6 e 7. Já roda
   dentro do `npm run lint` e no CI.
10. **Rebuild da imagem Docker** — o `sped_engine/` é copiado para dentro do
    container; editar o arquivo no host não muda nada até o rebuild
    (`docker compose --profile sped up -d --build api worker-sped worker-sped-merge`).

Não precisam de edição manual (derivam da fonte): `CORE_SHEETS` em
`inspect_xlsx.py` (vem de `SHEET_ORDER`) e a lista do
`scripts/run-sped-smoke.cjs` (vem dos contracts — por isso o smoke também vale
como checagem cruzada Python × TypeScript).

## Guia de registros (documentação)

O ficheiro **[sped_engine/cabecalhos_sped.txt](sped_engine/cabecalhos_sped.txt)**
descreve os **REG** do layout EFD (blocos 0, 1, 9, B, C, D, E, G, H, K), com
**título** e, quando aplicável, **linha de cabeçalho** (`REG | CAMPO | …`)
alinhada a `config.py`.

- Lido pelo Python (`cabecalhos_sped.py` → `merge_headers`; o ficheiro ganha do
  `config.py` **exceto** nos REG de `_INJECT_REGS`) e pela API
  (`GET /api/v1/tools/sped/reg-meta`), que alimenta os tooltips na UI.
- Cópia em **`webapp-01/apps/api/src/data/cabecalhos-sped.txt`** — manter
  **igual** ao ficheiro em `sped_engine` ao alterar o guia.

## Testes

```bash
pip install -r requirements.txt
pytest tests/ -q
```

Ou, da pasta `webapp-01/`:

| Comando | O que cobre |
|---------|-------------|
| `npm run test:sped-py` | parser/headers/vínculos + e2e do `cli.py` (`engines/sped/tests`) |
| `npm run test:sped-merge-py` | round-trip XLSX → SPED (`engines/sped-merge/tests`) |
| `npm run test:sped-smoke` | `cli.py` de ponta a ponta e a lista de abas do export completo |
| `npm run check:sync` | abas Python × TS e o guia × cópia da API (embutido no `lint`) |

Tudo isso roda no CI (`.github/workflows/ci.yml`) a cada push/PR.

Fixtures: `tests/fixtures/sped_bloco_d.txt` (bloco D completo, com D101/D105) e
`webapp-01/tests/fixtures/sped_minimo.txt` (só o `0000`).

`VL_*` é gravado no Excel como **texto** (`1.000,00`) para o Excel não trocar
vírgula por ponto conforme o idioma; `ALIQ_*` e `QTD`/`QUANT_*` vão como
**número**, então `7,60` é lido de volta como `7.6` — o merge reconhece que o
valor não mudou e devolve o texto original (ver `engines/sped-merge`).
