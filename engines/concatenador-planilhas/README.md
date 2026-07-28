# Concatenador de Planilhas — engine

Emenda N planilhas de **mesmo layout** numa só. O primeiro bloco entra inteiro
(linha de título + cabeçalho + dados); dos seguintes entram apenas as linhas de
dados, sem linha em branco entre os blocos.

Engine standalone em Node.js (`xlsx` para ler `.xls`/`.xlsx`/`.csv`, `exceljs`
para escrever). Consumida pelo `apps/worker-concatenador-planilhas`.

## Uso

```bash
node cli.mjs --input "parte 2.xlsx" "parte 1.xlsx" --output "Planilha Unificada.xlsx"
npm run smoke   # roda com os arquivos de exemplo/01
```

## Regras

| Etapa | Comportamento |
|-------|---------------|
| Aba lida | apenas a **primeira** de cada arquivo |
| Cabeçalho | primeira linha com 2+ células preenchidas (pula títulos isolados como `NFEs Emitidas` em A1) |
| Ordem dos blocos | menor valor da coluna `#` de cada arquivo; se algum arquivo não tiver `#` numérico, todos caem para ordem natural do nome |
| Coluna `#` | **preservada** como veio — furos e repetições viram aviso, nunca reescrita |
| Colunas | alinhadas por nome (ordem diferente é remapeada); cabeçalho divergente é **erro**, não aviso |
| Linhas em branco | descartadas, dentro e entre blocos |
| Texto | colunas majoritariamente textuais (chave de acesso, CNPJ com zero à esquerda) recebem formato `@` |

A coluna de sequência é detectada por nome: `#`, `nº`, `num`, `numero`, `seq`,
`sequencia`, `item` ou `linha` (sem acento, minúsculas).

## Protocolo stdout

Uma linha = um evento JSON.

```json
{"kind":"progress","value":42}
{"kind":"done","output":"...","arquivos":2,"linhas":3683,"ordem":["parte 1.xlsx","parte 2.xlsx"],"criterio":"coluna #","avisos":[]}
{"kind":"error","message":"Cabeçalho de \"x.xlsx\" não bate com o de \"y.xlsx\" (...)"}
```

`avisos` é informativo (o worker registra em log); só `error` derruba o job.

## Exemplo

`exemplo/01` traz duas exportações reais da SEFAZ do mesmo período — a parte 1
cobre `#1..2000` e a parte 2 cobre `#2001..3683`. O `smoke` passa a parte 2
primeiro de propósito: a saída correta tem 3683 linhas em sequência contínua.
