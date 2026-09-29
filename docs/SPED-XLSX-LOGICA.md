# SPED ⇄ XLSX — lógica completa (base para a refatoração em Python)

> Documento descritivo das duas ferramentas irmãs:
>
> - **SPED → XLSX** (`id: sped`) — converte o `.txt` da EFD numa planilha, uma aba por registro.
> - **XLSX → SPED** (`id: sped-merge`) — devolve para o `.txt` o que foi editado na planilha.
>
> Levantado em 18/09/2026 a partir do código em `engines/sped`, `engines/sped-merge`,
> `apps/worker-sped-bridge`, `apps/worker-sped-merge-bridge`, `apps/api/src/server.ts`,
> `packages/contracts` e das páginas `SpedHomePage.tsx` / `SpedMergeHomePage.tsx`.
> Os comportamentos marcados como **verificado** foram reproduzidos rodando os CLIs reais.

---

## 1. Visão geral

As duas ferramentas formam um **ciclo de edição**: o usuário exporta o SPED para Excel, corrige
valores na planilha e mescla a planilha de volta no SPED. O fio que amarra ida e volta é a coluna
**`_LINHA`**: cada linha da planilha carrega o número da linha do `.txt` de onde veio. No caminho de
volta, o merge usa `_LINHA` para saber qual linha do arquivo substituir.

```
                 ┌────────────── SPED → XLSX ──────────────┐
 arquivo.txt ──► │ leitura → parser → DataFrame → xlsxwriter │ ──► planilha.xlsx
                 └──────────────────────────────────────────┘          │
                                                                        │ usuário edita
                 ┌────────────── XLSX → SPED ──────────────┐           ▼
 arquivo.txt ──► │ inspeção → para cada linha da planilha:  │ ◄── planilha editada
  (opcional)     │  _LINHA → remonta a linha → substitui    │
                 └──────────────────────────────────────────┘ ──► SPED_mesclado.txt
```

Tudo o que não aparece na planilha (registros de outras abas, linhas de abertura e encerramento
de bloco, `9900`, etc.) passa **intacto** do original para a saída.

---

## 2. O formato SPED que o código assume

- Arquivo texto, uma linha por registro, campos separados por `|`, com `|` também no início e no
  fim: `|C100|0|1|F1|55|...|`.
- `line.split("|")` gera `["", "C100", "0", "1", ..., ""]`. O código chama de **`fields`** esse
  vetor completo e de **`payload`** (ou `inner`) o miolo `fields[1:-1]`, ou seja, os campos reais,
  começando pelo `REG`.
- O código do registro é o primeiro campo do miolo (`payload[0]`), sempre com 4 caracteres
  `[0-9A-Z]` (regex `^[0-9A-Z]{4}$`, usada no Python, na API e no frontend).
- Linhas sem `|`, ou com menos de 3 pedaços após o split, são ignoradas.
- Datas vêm como `DDMMAAAA`. Valores vêm com vírgula decimal e sem separador de milhar (`1000,00`).
- Encoding: tenta `utf-8`, depois `cp1252`, depois `latin-1` (este último nunca falha).

### Hierarquia pai → filho

Registros filhos não repetem o documento a que pertencem; o vínculo é **posicional** (o filho
pertence ao último pai visto acima dele). O parser guarda o pai corrente e **injeta** os dados dele
nas colunas do filho:

| Filho | Pai | Colunas injetadas (existem só no Excel) | De onde vêm no pai (índice em `fields`) |
|-------|-----|------------------------------------------|-------------------------------------------|
| `C170`, `C190` | `C100` | `NUM_DOC`, `CHV_NFE` | `fields[8]`, `fields[9]` |
| `C590` | `C500` | `NUM_DOC` | `fields[10]` |
| `D101`, `D105`, `D190` | `D100` | `NUM_DOC`, `CHV_CTE` | `fields[9]`, `fields[10]` |
| `D590` | `D500` | `NUM_DOC` | `fields[9]` |

As colunas injetadas entram **logo depois do `REG`**: `[REG, NUM_DOC, CHV_NFE, <resto do payload>]`.
No caminho de volta precisam ser descartadas; se não forem, a linha remontada ganha campos a mais.

---

## 3. SPED → XLSX

### 3.1 Fluxo de ponta a ponta

1. **Usuário solta o `.txt`** na `SpedHomePage`. O frontend valida só pela extensão `.txt`
   (sem filtro de MIME, porque no Windows o MIME do `.txt` costuma vir vazio).
2. **Inspeção** — o frontend faz `POST /api/v1/tools/sped/inspect` com o arquivo. A API lê o
   arquivo linha a linha em streaming (`readline`), extrai o `REG` de cada linha e devolve
   `{ presentRegs: [...] }`, ordenado com `localeCompare(..., { numeric: true })`. Limite:
   `MAX_UPLOAD_MB`.
   - *Fallback*: se a rota não existir (404), o navegador varre sozinho os primeiros **80 MB** do
     arquivo e mostra um aviso.
3. **Tela de seleção de abas** — por padrão, marca as 13 abas core **mais** todos os REGs extras
   encontrados no arquivo. Os rótulos vêm de `SPED_EXPORT_SHEET_LABELS` (contracts) e os tooltips
   de `GET /tools/sped/reg-meta`, que lê o guia `cabecalhos-sped.txt`.
4. **Envio** — `POST /api/v1/tools/sped/jobs` (multipart):
   - `file`: o `.txt` (apenas um por vez)
   - `sheets`: JSON com a lista de abas, **omitido** quando a seleção é exatamente o conjunto core
     (comportamento legado = exportar o core)
   - `presentRegs`: JSON, **obrigatório** quando `sheets` tem algum REG fora do core
5. **API** (`server.ts`):
   - `ping` no Redis; se falhar → 503.
   - Cria `TEMP_JOBS_ROOT/{uuid}/in/sped.txt` e `.../out/`.
   - `validateSpedJobSheetsAndPresent`: normaliza e deduplica os REGs; exige no máximo 128
     abas; exige `presentRegs` se houver REG fora do core; recusa REG extra que não esteja em
     `presentRegs`; limita o CSV a 8192 bytes; **reordena**: primeiro os core na ordem canônica,
     depois os extras na ordem pedida.
   - Nome do arquivo de saída: razão social tirada do `|0000|` (`parts[6]`, lido dos primeiros
     512 KB como UTF-8), limpa de caracteres proibidos no Windows, espaços viram `_`, mais
     carimbo `DD-MM-AAAA_HH-MM-SS` no fuso de Brasília. Ex.: `EMPRESA_X_18-09-2026_14-30-45.xlsx`.
   - Enfileira `{ jobId, inputPath, outputPath, sheets?, presentRegs? }` na fila `sped-convert`
     (timeout de 15 s para enfileirar, senão 503).
6. **Worker** (`worker-sped-bridge`, concorrência 1): transforma caminhos relativos em
   absolutos, roda `python cli.py --input ... --output ... [--sheets C100,C170,...]` com
   `cwd = engines/sped/sped_engine`, lê o stdout linha a linha e repassa `progress` para o
   BullMQ. Um `{"kind":"error"}` no stdout ou código de saída ≠ 0 falha o job (a mensagem de erro
   leva até 800 caracteres do stderr).
7. **Polling e download** — o frontend consulta `GET /tools/sped/jobs/:id` a cada 1 s; quando
   `done`, recebe um JWT (15 min, `tool: "sped"`) e baixa por `GET /tools/sped/jobs/:id/download`.

### 3.2 Motor Python, etapa por etapa

Montagem em `cli.py`:

```
Processor(
  reader    = SpedFileReader(),
  parser    = DefaultSpedParser(),
  df_builder= DefaultDataFrameBuilder(merge_headers(HEADERS)),
  writer    = XlsxWriterExcelWriter(),
  formatter = None,
  reporter  = None,        ← a aba RELATORIO NÃO é gerada pelo CLI
  progress  = CliProgress(),
)
```

Se o `--output` não terminar em `.xlsx`, a extensão é trocada. `--sheets` aceita no máximo 128 itens.

#### Etapa 1 — Cabeçalhos (`config.py` + `cabecalhos_sped.py`)

- `config.HEADERS` define as colunas de 15 registros (as 13 abas core + `0450`, `K200`, que têm
  cabeçalho mas não são core). Para os filhos, a lista **já inclui** as colunas injetadas.
- `cabecalhos_sped.txt` é um guia com títulos e linhas `REG | CAMPO | ...` de dezenas de
  registros (blocos 0, 1, 9, B, C, D, E, G, H, K). Formato:
  - linha de `=====` seguida do nome da seção → define o bloco corrente;
  - `C100 – Descrição` (hífen, en-dash ou em-dash) → título do REG;
  - a linha seguinte, se tiver `REG` e `|`, é o cabeçalho.
- `merge_headers`: o guia **sobrescreve** o `config.py`, **exceto** para os REGs com coluna
  injetada (`C170, C190, C590, D101, D105, D190, D590`); nesses vale sempre o `config.py`, senão
  as colunas do pai sumiriam.
- `SHEET_ORDER` (as 13 abas core, nesta ordem): `0150, 0200, C100, C170, C190, C500, C590, D100,
  D101, D105, D190, D500, D590`. Precisa ser igual a `SPED_EXPORT_SHEET_KEYS` nos contracts
  (o `npm run check:sync` confere).

#### Etapa 2 — Resolver o que exportar e o que analisar (`processor.py`)

- `_resolve_export_regs`: vazio → `SHEET_ORDER`; senão normaliza para maiúsculas, descarta o que
  não casar com a regex e remove duplicatas mantendo a ordem.
- `minimal_context_regs`: se for exportar só o filho, o pai também precisa ser analisado para o
  contexto ficar certo (`C170/C190 → C100`, `C590 → C500`, `D101/D105/D190 → D100`, `D590 → D500`).
- `build_parse_targets` = `SHEET_ORDER` + (exportados ∪ pais necessários − core), ordenado.

#### Etapa 3 — Leitura (`reader.py`)

`path.read_text()` tentando `utf-8 → cp1252 → latin-1`. O arquivo inteiro vai para a memória.

#### Etapa 4 — Parser (`parser.py`)

Uma passada única sobre `text.splitlines()`, numerando as linhas a partir de 1:

```
para cada linha (line_no, raw):
    se não tem "|" → pula
    fields = raw.split("|"); se len < 3 → pula
    payload = fields[1:-1]; reg = payload[0].upper()

    C100 → guarda NUM_DOC=fields[8], CHV=fields[9]; registra payload
    C170/C190 → registra [REG, num_doc_c, chv_nfe] + payload[1:]
    C500 → guarda NUM_DOC=fields[10]; registra payload
    C590 → registra [REG, num_doc_c500] + payload[1:]
    D100 → guarda NUM_DOC=fields[9], CHV=fields[10]; registra payload
    D101/D105/D190 → registra [REG, num_doc_d, chv_cte] + payload[1:]
    D500 → guarda NUM_DOC=fields[9]; registra payload
    D590 → registra [REG, num_doc_d500] + payload[1:]
    qualquer outro REG pedido → registra payload
```

Resultado: `{ REG: [(line_no, [campos...]), ...] }`. Pontos importantes:

- O pai é **atualizado mesmo quando não vai ser exportado**, desde que esteja nos targets (por isso
  existe o `minimal_context_regs`).
- O contexto nunca é zerado. Um filho órfão herdaria o último pai visto.
- `payload = fields[1:-1]` descarta o último pedaço: uma linha **sem `|` final** perde o último campo.
- `extract_razao_cnpj`: acha a primeira linha que começa com `|0000|`; razão = `parts[6]`,
  CNPJ = `parts[7]` só com dígitos.

#### Etapa 5 — Montar os DataFrames (`dataframe_builder.py`)

Para cada REG exportado:

- **REG com cabeçalho conhecido**: colunas = `["_LINHA"] + HEADERS[REG]`. Linha mais curta que o
  cabeçalho é completada com `""`. Linha mais longa ganha colunas `EXTRA_01`, `EXTRA_02`… (o número
  de extras é o máximo encontrado no REG).
- **REG sem cabeçalho (genérico)**: colunas `COL_01`…`COL_NN`, onde NN é o maior número de campos
  encontrado, limitado a **512**. Acima disso vira `EXTRA_xx` (ou uma coluna `EXTRA_NOTA` avisando
  do corte).
- Aba vazia sai só com o cabeçalho.
- Também conta `MISMATCH_REG` (linhas cujo `REG` não bate com a aba). Como o parser já separa por
  `REG`, esse contador **é sempre 0**.

#### Etapa 6 — Validação de vínculos (dentro do `Processor.run`)

O processor relê o texto inteiro, recalcula para cada filho o `NUM_DOC`/`CHV` esperado e compara
posição por posição com o DataFrame. Monta `summary`, `mismatches` e `link_checks`, mas **só o
`reporter` usa isso, e o CLI passa `reporter=None`**, então hoje esse trabalho é descartado. (E a
comparação usa o mesmo algoritmo do parser, então não teria como divergir.)

#### Etapa 7 — Gravar o Excel (`writer_xlsxwriter.py`)

Uma aba por REG, na ordem de `export_regs`. Regras por **nome de coluna**:

| Coluna | Conversão | Como fica na célula |
|--------|-----------|---------------------|
| `_LINHA` | inteiro | número, formato `0` |
| `VL_*` | vira número (`_to_number`); **vazio vira 0** | **texto** `"1.234,56"` (sempre 2 casas, milhar com ponto, formato `@`) |
| `DT_*` | `DDMMAAAA` → `date` | data real, formato `dd/mm/yyyy`; inválida ou vazia → célula vazia |
| `ALIQ_*` | número | número, formato `#.##0,0000` |
| `QTD`, `QUANT_*` | número | número, `#.##0` se a coluna inteira for de inteiros, senão `#.##0,00` |
| demais | nenhuma | texto como veio do `.txt` |

Por que `VL_*` vai como texto: para o Excel não trocar vírgula por ponto conforme o idioma da
máquina. Por que `ALIQ_*`/`QTD` vão como número: para dar para somar e filtrar. O efeito colateral é
que `7,60` volta do Excel como `7.6` (resolvido no merge, ver §4.4).

Visual: cabeçalho azul `#4169E1` com fonte branca e negrito, tudo centralizado, largura da coluna pelo
maior conteúdo (limites diferentes por tipo), altura de linha 25 no cabeçalho e 28 nos dados,
cabeçalho congelado.

`_to_number` aceita `(123)` como negativo, remove tudo que não for dígito, `,`, `.` ou `-`; se houver
`,` e `.`, trata como BR (`1.234,56`); só `,` vira decimal.

#### Etapa 8 — Progresso (`cli_progress_stdout.py`)

- `start(total)` emite 2.
- `tick_global` emite `2 + min(90, 88 × passo/total)`.
- `animate_local` emite `70 + hash(label) % 20`. **Atenção:** `hash()` de string muda a cada
  execução do Python, então esse valor é aleatório e o progresso pode **voltar** na barra.
- `tick_local` / `reset_local` não fazem nada.

### 3.3 Protocolo de saída

```json
{"kind":"progress","value":42,"label":"Registro C100"}
{"kind":"error","message":"..."}
{"kind":"done","output":"C:\\...\\saida.xlsx"}
```

---

## 4. XLSX → SPED (merge)

### 4.1 Fluxo de ponta a ponta

1. **Usuário solta a planilha** (`.xlsx`) na `SpedMergeHomePage`. O frontend dispara na hora
   `POST /tools/sped-merge/inspect-xlsx`.
2. **API** grava num job temporário, enfileira na fila `sped-merge-inspect` e **espera a
   resposta de forma síncrona** (`waitUntilFinished`, timeout 30 s); apaga o temporário e devolve
   `{ complete, requiresOriginal, reasons, regSheets }`.
3. **Tela**: se `requiresOriginal`, pede o `.txt` original e mostra o primeiro motivo; senão diz
   "Planilha completa detectada. O SPED original não é necessário." Se a inspeção falhar, pede o
   original por segurança.
4. **Envio**: `POST /tools/sped-merge/jobs` com os campos `xlsx` e, opcionalmente, `sped`. A API
   **inspeciona de novo** (não confia no frontend); se `requiresOriginal` e não veio `.txt` → 400
   com os motivos. Saída sempre em `out/SPED_mesclado.txt`. Fila `sped-merge`.
5. **Worker** (`worker-sped-merge-bridge`): `python cli_merge.py --xlsx ... --output ... [--sped ...]`
   com `cwd = engines/sped-merge`. O mesmo processo também consome a fila de inspeção
   (concorrência 2).
6. Polling e download iguais aos da outra ferramenta; download com `Content-Type: text/plain`.

O merge **importa** o `sped_engine` (`config.HEADERS`, `SHEET_ORDER`, `merge_headers`)
colocando `../sped/sped_engine` no `sys.path`. As duas pastas precisam ser irmãs.

### 4.2 Inspeção de completude (`inspect_xlsx.py`)

Decide se a planilha, sozinha, reconstrói o arquivo inteiro. Para cada aba cujo nome é um REG:

1. Precisa ter a coluna `_LINHA`, senão entra um motivo.
2. Se o REG tem cabeçalho conhecido, todas as colunas esperadas precisam existir.
3. Junta todos os `_LINHA` válidos (inteiros ≥ 1) num conjunto.

Depois:

- As abas core (`SHEET_ORDER`), **menos** as opcionais `D101`/`D105`, precisam estar presentes.
  As duas são opcionais porque entraram depois e havia planilhas antigas circulando; se o `.txt`
  tinha essas linhas, a checagem seguinte acusa o buraco.
- Os `_LINHA` precisam cobrir **1..máximo sem buracos**. É isso que garante que nenhuma linha do
  arquivo se perdeu.
- `complete = nenhum motivo`; `requiresOriginal = !complete`.

Na prática, uma planilha só é "completa" se foi exportada com **todos** os REGs do arquivo, porque
`0000`, `C001`, `9999` e companhia também precisam estar em alguma aba.

### 4.3 Algoritmo do merge (`merger.py`)

```
se veio .txt:
    lê bytes, decodifica utf-8 → cp1252 → latin-1 (guarda qual funcionou)
    lines = text.splitlines(); arquivo vazio → erro
abas = nomes de aba que casam com ^[0-9A-Z]{4}$ ; nenhuma → erro

para cada aba:
    df = read_excel(aba, dtype=object)
    sem _LINHA → erro; vazia → pula
    headers = MERGE_HEADERS[aba] (config + guia)
    sem headers e sem COL_xx → erro

    para cada linha do df:
        _LINHA vazia → pula; não inteira → erro
        COM original:
            _LINHA fora de 1..len(lines) → erro
            o REG da linha original precisa ser igual ao nome da aba → senão erro
            orig_inner = linha original split("|")[1:-1]      ← "template"
        SEM original:
            estica lines com "" até ter _LINHA posições
            orig_inner = []

        inner = remonta os campos (ver abaixo), campo a campo com normalize_sped_field
        inner += EXTRA_01, EXTRA_02... (ordenados pelo número)
        se aba == C100: _limpar_campos_mod65
        COM original: corta ou completa com "" até ter EXATAMENTE len(orig_inner) campos
        SEM original: ajustes K010 e 1010 (ver abaixo)
        lines[_LINHA-1] = "|" + "|".join(inner) + "|"

grava "\n".join(lines) + "\n", encoding = o do original (ou utf-8), quebra de linha LF
```

Remontagem dos campos (`inner_payload_for_register_with_template`):

- `C170, C190, D101, D105, D190` → usa `[h[0]] + h[3:]` (pula as 2 colunas injetadas).
- `C590, D590` → usa `[h[0]] + h[2:]` (pula 1).
- demais → todos os cabeçalhos.
- REG genérico → colunas `COL_xx` em ordem numérica.
- O campo *i* usa `orig_inner[i]` como **template**.

Regras especiais:

- **C100 com `COD_MOD = 65` (NFC-e)**: os campos de índice 3, 22–28 do miolo (`COD_PART`,
  `VL_BC_ICMS_ST`, `VL_ICMS_ST`, `VL_IPI`, `VL_PIS`, `VL_COFINS`, `VL_PIS_ST`, `VL_COFINS_ST`) são
  forçados a vazio, porque o leiaute proíbe esses campos na NFC-e.
- **Sem original, `K010`**: garante exatamente 2 campos, com `IND_TIPO_EST = "0"` se vier vazio.
- **Sem original, `1010`**: remove a cauda vazia e ajusta para exatamente 14 campos.
- **Com original**: a quantidade de campos da linha é sempre a do original (evita a rejeição do PVA
  por "número de campos diferente do leiaute").

Linhas do `.txt` que nenhuma aba referencia ficam **idênticas**. No modo sem original, a posição que
nenhuma aba cobre vira linha vazia (a inspeção impede isso de acontecer).

### 4.4 Normalização de cada campo (`line_builders.normalize_sped_field`)

A ordem das regras importa:

1. **Célula vazia + existe template** → devolve o template (o valor original). *Apagar* uma célula
   na planilha, portanto, **não apaga** o campo no SPED.
2. **Nome começa com `DT_`** → converte para `DDMMAAAA`. Aceita `datetime`/`date`, `AAAA-MM-DD`,
   `DD/MM/AAAA`, `DD-MM-AAAA` e 8 dígitos (se começar com `19`/`20` trata como `AAAAMMDD`).
3. **Nome casa com `VL_*`, `ALIQ_*`, `QTD`, `QUANT_*`** → `_normalize_numeric`:
   - tira espaços; se tiver `,` e `.`, o que vier por último é o decimal;
   - só `,` no padrão de milhar (`1,234`) → remove; só `.` no padrão de milhar → remove; só `.`
     decimal → troca por `,`.
   - Com template: se o número é **o mesmo** do original (`Decimal` igual, ex. `7.6` × `7,60`) →
     devolve **o texto original**. Se o template usa `.` → usa `.`. Se o template é inteiro e as
     casas decimais do valor são zeros → devolve só o inteiro.
   - Resultado final com `,` decimal.
4. **Outros campos com template** → `_normalize_with_template`: se o template tem 8 dígitos, trata
   como **data**; se o template parece número, aplica a normalização numérica copiando o separador
   do template (ou truncando as decimais, se o template for inteiro); senão, texto. Depois,
   `_sanitize_text`.
5. **Outros campos sem template** → `_sanitize_text(texto)`.

`_sanitize_text` troca `ç/Ç` por `c/C`, remove `~` e o til/cedilha combinantes (`ã→a`, `õ→o`).
Os demais acentos (`á`, `é`, `í`...) ficam. É uma "regra operacional" registrada no código.

`cell_str`: `None`/NaN → `""`; float inteiro → sem `.0`; float com casas → até 12 decimais, sem
zeros à direita; texto → `strip()`.

---

## 5. Contratos que a refatoração precisa manter

| Item | Valor atual |
|------|-------------|
| Filas | `sped-convert`, `sped-merge`, `sped-merge-inspect` |
| Payload SPED | `{ jobId, inputPath, outputPath, sheets?, presentRegs? }` |
| Payload merge | `{ jobId, spedPath?, xlsxPath, outputPath }` |
| Resposta da inspeção do merge | `{ complete, requiresOriginal, reasons[], regSheets[] }` (JSON com `"kind":"ok"`) |
| CLI SPED | `cli.py --input --output [--sheets CSV]` |
| CLI merge | `cli_merge.py --xlsx --output [--sped]` |
| CLI inspeção | `inspect_xlsx.py --xlsx` |
| Limites | 128 abas/job · 500 `presentRegs` · 8192 bytes de CSV · 512 colunas genéricas · `MAX_UPLOAD_MB` |
| Abas core | igual em `config.SHEET_ORDER` e `SPED_EXPORT_SHEET_KEYS` |
| Guia | `cabecalhos_sped.txt` igual à cópia em `apps/api/src/data/cabecalhos-sped.txt` |
| Planilha | toda aba de REG tem `_LINHA` na coluna A; colunas injetadas logo após `REG`; extras como `EXTRA_NN`; genéricas como `COL_NN` |

A planilha é um **formato de troca**: planilhas já exportadas pelos usuários precisam continuar
sendo aceitas pelo merge refatorado.

---

## 6. Defeitos encontrados (verificados rodando os CLIs)

Estes pontos devem ser **decididos** na refatoração. Não dá para simplesmente "manter o
comportamento":

### 6.1 Campo com 8 dígitos é tratado como data — corrompe ou derruba o merge (grave)

Regra 4 do §4.4: qualquer campo cujo valor original tenha 8 dígitos passa pela conversão de data.
`COD_NCM` tem sempre 8 dígitos, e `NUM_DOC`/`COD_ITEM` podem ter.

- NCM `20011010`, sem nenhuma edição, volta como **`10102001`** (lido como 10/10/2001). Sem aviso.
- NCMs `20098900`, `19059090`, `20000001` → o merge inteiro falha com
  `month must be in 1..12, not 89`.

NCMs começando por `19` e `20` são alimentos (capítulos 19 e 20), bem comuns. Qualquer planilha
com a aba `0200` desses clientes quebra ou sai errada. **Correção:** tratar como data só as colunas
`DT_*`, nunca pelo formato do valor.

### 6.2 Ida e volta sem edição não devolve o mesmo arquivo

Testado com um C100/C170 real, exportado e mesclado **sem mexer em nada**:

- **`VL_*` vazio vira `0,00`.** O writer grava vazio como `0,00`, e o merge não consegue distinguir
  isso de uma edição (o template vazio não entra na comparação). O `_limpar_campos_mod65` é um
  remendo desse mesmo problema, só para o C100 da NFC-e. Nos outros registros (C170, D100...) os
  campos opcionais vazios ganham `0,00`, o que muda o arquivo e pode gerar alerta no PVA.
- **Cedilha e til são removidos de toda linha que está na planilha**, editada ou não
  (`SUCO DE AÇAÍ` → `SUCO DE ACAÍ`). Precisa confirmar com o fiscal se a regra é intencional para
  todos os campos ou só para os editados.

### 6.3 Outras fragilidades

- **Zero à esquerda**: se o usuário redigitar um código (`COD_PART` `001`), o Excel guarda `1` e o
  merge grava `1`. O mesmo vale para chave de 44 dígitos redigitada (vira notação científica).
- **Apagar uma célula não apaga o campo** (regra 1 do §4.4). Não há como zerar um campo opcional
  pela planilha.
- **Linha sem `|` final** perde o último campo no parser (`fields[1:-1]`).
- **Progresso aleatório**: `animate_local` usa `hash()`, que muda a cada processo; a barra pode voltar.
- **Código morto**: a validação de vínculos, `summary`, `mismatches` e todo o `report.py` rodam (ou
  existem) sem efeito, porque o CLI usa `reporter=None`. O `MISMATCH_REG` é sempre 0.
- **Arquivo inteiro na memória**, na leitura e no parser (`splitlines()` do texto completo, duas
  vezes: parser e processor).
- **Nome do arquivo**: a API lê a razão social como UTF-8; em arquivo `cp1252` a acentuação do nome
  do `.xlsx` pode sair errada.
- **Encoding de saída sem original** é sempre UTF-8, mas o PVA costuma esperar `cp1252`/`latin-1`.

---

## 7. Proposta de estrutura em Python

Uma biblioteca só, com as duas direções compartilhando a mesma definição de leiaute, em vez de o
merge importar o engine por `sys.path`:

```
sped_xlsx/
  layout.py        # HEADERS, SHEET_ORDER, INJECTED (filho → pai, colunas, índices), guia
  model.py         # dataclasses: SpedLine(line_no, reg, fields), Parent context
  reader.py        # leitura em streaming com detecção de encoding (retorna o encoding usado)
  parser.py        # gera SpedLine + colunas injetadas a partir de INJECTED (uma tabela, sem if por REG)
  fields.py        # tipos de campo por NOME: DATE, MONEY, RATE, QTY, TEXT, CODE (nunca por valor)
  export_xlsx.py   # DataFrame/xlsxwriter; VL vazio continua vazio
  inspect_xlsx.py  # completude (mesmas regras do §4.2)
  merge.py         # merge por _LINHA; "campo não mudou → texto original" vale para TODOS os tipos
  cli.py           # subcomandos: export | inspect | merge — mesmo protocolo JSON lines
  tests/
```

Princípios:

1. **Uma única tabela de vínculos** (`INJECTED`): quem é pai, quais colunas injeta, de quais índices.
   Parser, validação, inspeção e merge leem dela. Hoje a mesma informação está repetida em 6 lugares
   (é por isso que o README tem um checklist de 10 passos para acrescentar um REG).
2. **Tipo do campo pelo nome da coluna**, nunca pelo formato do valor (resolve o §6.1).
3. **Invariante de ida e volta**: `merge(original, export(original))` precisa devolver
   **byte a byte** o original, para qualquer arquivo real. Isso vira o teste principal.
4. **Comparar antes de normalizar**: se o valor da célula, interpretado conforme o tipo, é igual ao
   original, devolve o texto original. Só reformatar o que o usuário de fato editou.
5. **Manter o protocolo** (§3.3 e §5) para os workers Node não mudarem.

### Testes que a nova versão precisa passar

- Ida e volta byte a byte com `sped_minimo.txt`, `sped_bloco_d.txt` e pelo menos um SPED real
  anonimizado de cada perfil (ICMS/IPI e Contribuições).
- NCMs `20011010`, `20098900`, `19059090` na aba `0200`: sem erro e sem alteração.
- `VL_*` vazio continua vazio; cedilha preservada em linha não editada (ou removida, conforme a
  decisão do §6.2).
- Edição de `VL_*`, `ALIQ_*`, `QTD` e `DT_*` gravada no formato do original.
- Colunas injetadas descartadas em todos os 7 filhos.
- C100 modelo 65 com os campos proibidos vazios.
- Inspeção: planilha antiga sem D101/D105 continua completa; buraco em `_LINHA` exige o original.
- Os 23 testes atuais de `engines/sped-merge/tests` e os 10 de `engines/sped/tests`, adaptados.
