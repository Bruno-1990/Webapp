# engines/sci-portal-nacional — Conciliador NFS-e SCI × Portal Nacional

Engine standalone Node.js que recebe duas planilhas e gera uma conciliação em
XLSX com 5 abas.

- **Planilha SCI** (`.xls` BIFF antigo / `.xlsx` / `.csv`): exportação do ERP SCI
  (NFS-e tomadas que foram lançadas).
- **Planilha Portal Nacional** (`.xlsx`): relatório do **Portal Nacional NFS-e**
  (notas emitidas contra o tomador).

A conciliação revela:

- Notas no Portal Nacional que **não foram lançadas no SCI** (provavelmente
  esquecidas).
- Notas no SCI que **não constam no Portal** (lançamento divergente / nota
  cancelada não baixada).
- Notas que **batem nos dois lados** (já conferidas).

## Uso

```
node cli.mjs \
  --sci    "/caminho/Relatório da consultaSCI.xls" \
  --portal "/caminho/Relatorio-NFSe ....xlsx" \
  --output "/caminho/Conciliacao SCI x Portal Nacional.xlsx"
```

A engine emite uma linha JSON no `stdout` a cada marco para o bridge
(`apps/worker-sci-portal-bridge`) atualizar o `BullMQ progress`:

```
{"kind":"progress","value":5}
{"kind":"progress","value":30}
...
{"kind":"done","output":"...","matched":384,"soSci":5,"soPortal":2}
```

Erros vão como JSON também (`{"kind":"error","message":"..."}`) e stderr.

## Lógica de match

1. **Primária**: chave de acesso NFS-e (44 dígitos) presente nos dois lados.
2. **Fallback**: `CNPJ Prestador (14 dígitos) + Número do documento`.

Normalização:

- CNPJ/CPF → só dígitos, padding à esquerda (CNPJ=14, CPF=11).
- Número → trim + remove zeros à esquerda.
- Chave → só dígitos (descarta o que não tem ≥30 dígitos).

A detecção das colunas é tolerante ao mojibake `latin1` que o Portal Nacional
emite: `findCol` normaliza headers (NFKD + minúsculo + sem acentos) e procura
por subtokens (`["prestador", "cnpj"]`, `["vliq"]`, etc).

## Saída — 6 abas

1. **Resumo** — contagens, valores totais por bucket. Linha do alerta de canceladas no SCI em destaque vermelho.
2. **Em ambas** — pareadas (ativas × SCI), com valor SCI × valor Portal Nacional + diferença.
3. **Só no Portal Nacional** — notas ativas emitidas que faltam no SCI.
4. **Só no SCI** — lançamentos sem nota ativa no Portal Nacional.
5. **⚠ Canceladas no SCI** — `[orelha vermelha]` notas presentes na aba `Cancelada` do Portal Nacional mas ainda lançadas no SCI. **Risco**: precisam ser estornadas do SCI.
6. **Duplicados** — agrupados por chave / CNPJ+número.

## Suporte às abas do Portal Nacional

O relatório do Portal Nacional pode ter 1 ou 2 abas:

- `NFSe` (ou nome equivalente) — notas **ativas**, processadas como a base principal da conciliação.
- `Cancelada` (ou `Canceladas` / `Cancelado`) — notas **canceladas pelo prestador**. Entram numa segunda passada de match contra o SCI: as que ainda aparecem no SCI são o item de maior risco e vão para a aba destacada em vermelho.

A detecção do nome é tolerante (lowercase, sem acentos, busca por substring `cancel`).

## Smoke local

Coloque os arquivos em `./exemplo/` (já vem com um par real) e rode:

```
npm install
npm run smoke
```

Abra o XLSX gerado em `./exemplo/Conciliacao SCI x Portal Nacional.xlsx`.
