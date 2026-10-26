# Análise Fiscal de Produtos — engine

Recebe a exportação **de produtos por nota do SCI** (CSV ou Excel, ~170 colunas)
e devolve uma planilha enxuta para o analista fiscal: só as colunas que importam
para a conferência, e cada item cruzado com a **base de monofásicos de
PIS/COFINS** (`base-monofasicos.json`), com o CST de PIS conferido contra o regime.

Engine standalone em Node.js (`xlsx` para ler `.csv`/`.xls`/`.xlsx`, `exceljs`
para escrever). Consumida pelo `apps/worker-analise-produtos`.

## Uso

```bash
node cli.mjs --input Produtos_376.csv --output saida.xlsx --nome "Produtos_376.csv"
npm test   # fixtures em test/ (formato real do SCI: ';', cp1252, ="50")
```

## Saída (4 abas, padrão docs/EXPORT-STANDARD.md)

| Aba | Conteúdo |
|-----|----------|
| Resumo | uma linha por **Situação** (linhas, valor, o que fazer), depois arquivo, período, aviso de arquivo só de entradas/saídas e versão da base |
| Produtos | todas as linhas: identificação e veredito primeiro (Nº NF., Descrição, NCM congeladas; Situação, Monofásico, CST PIS, CST esperado, Valor), depois o detalhe da nota e dos tributos |
| Monofásicos | só as linhas Sim/Depende, em ordem de prioridade (Corrigir CST primeiro) |
| Resumo por NCM | uma linha por NCM, as com linhas a corrigir/confirmar primeiro |

Todas as abas (menos o Resumo) saem com filtro no cabeçalho.

Colunas de origem: Nº NF., Data, Tipo, CFOP, participante (CNPJ, nome, UF), Cód. Prod.,
Descrição, NCM, CEST, Quantidade, Unidade, Valor e desconto do produto,
CST/base/alíquota/valor de ICMS, ICMS ST, CST e valor de IPI, CST/alíquota/valor
de PIS e COFINS, natureza do crédito/receita. Coluna ausente na entrada sai vazia
(o layout não muda de arquivo para arquivo). `Cód. Prod.` usa o código do produto
e, quando vazio, o `Cód. Prod. Unificado`.

## Situação (o que o analista faz com a linha)

| Situação | Cor | Quando |
|----------|-----|--------|
| Corrigir CST | vermelho | monofásico certo (`Sim`) com CST incoerente |
| Confirmar condição | amarelo | monofásico `Depende` com algo a fazer — a coluna **O que conferir** diz o quê (Ex na NF, destinação da peça) |
| Conferir devolução | amarelo | CFOP de devolução: o CST repete o da nota original |
| Conferir perfil | amarelo | o CST certo depende de a empresa ser fabricante, atacadista ou varejista |
| OK | verde | CST coerente |
| Uso e consumo | cinza | entrada para uso/consumo ou ativo |
| Sem NCM | cinza | frete, energia, serviço |

A cor é **só** na célula da Situação — exceção ao EXPORT-STANDARD aprovada para
esta ferramenta (registrada lá). A coluna **CST esperado** mostra o código certo
ao lado do CST encontrado.

## Regras da consulta

| Campo | Regra |
|-------|-------|
| Monofásico | `Sim` = NCM na base sem condição; `Depende` = NCM na base com condição (Ex da TIPI ou destinação da peça, que o NCM sozinho não prova); `Não`; `Sem NCM` |
| Casamento de NCM | por prefixo, o mais longo vence (exceções como 3004.90.46 ganham da posição 30.04) |
| Entrada | CST 70/73 = OK; qualquer outro = Corrigir CST (5x/6x: compra para revenda de monofásico não gera crédito); uso e consumo (x.556, x.407…) = Uso e consumo |
| Saída | CST 04 = OK; CST 02/03 = Conferir perfil (só fabricante/importador); CST 01 ou outro = Corrigir CST. Bebidas frias: CST 06 = OK (varejista), CST 01 = Conferir perfil (atacadista) |
| Item `Depende` | vira Confirmar condição sempre que não for OK nem Uso e consumo |
| Devolução | Conferir: o CST espelha o da operação original |
| Entrada × saída | pelo `Tipo de lançamento`; sem ele, pelo 1º dígito do CFOP |

As observações de CST valem para Lucro Real e Presumido; no Simples Nacional o
monofásico é segregado no PGDAS-D (aviso no Resumo).

## Atualizar a base

`base-monofasicos.json` é cópia versionada da planilha
`produtos_monofasicos_pis_cofins` (Google Sheets). Ao mudar a planilha, atualize
as `regras`, troque `versao` (data da conferência) e rode `npm test`. A versão
aparece no Resumo de toda planilha gerada. Os regimes valem até 31/12/2026
(LC 214/2025, art. 542): para fatos geradores de 2027 a base precisa ser revista.

## Protocolo stdout

```json
{"kind":"progress","value":42}
{"kind":"done","output":"...","linhas":2805,"monofasicos":24,"depende":25,"corrigir":13,"confirmar":25,"baseVersao":"2026-10-23"}
{"kind":"error","message":"Não encontrei a coluna NCM. ..."}
```
