#!/usr/bin/env node
// Análise Fiscal de Produtos — engine standalone Node.js.
// Recebe a exportação de produtos por nota do SCI (CSV/Excel, ~170 colunas),
// mantém só as colunas que o analista fiscal consulta e cruza cada NCM com a
// base de monofásicos de PIS/COFINS (base-monofasicos.json), dizendo o que
// fazer em cada linha (coluna Situação) e qual CST era o esperado.
// Saída: XLSX no padrão docs/EXPORT-STANDARD.md (exceção documentada: cor na
// coluna Situação).
//
// Protocolo stdout (cada linha = 1 evento JSON):
//   {"kind":"progress","value":<0..100>}
//   {"kind":"done","output":"<path>","linhas":N,"monofasicos":N,"depende":N,"corrigir":N,"confirmar":N,"baseVersao":"..."}
//   {"kind":"error","message":"<texto>"}

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import ExcelJS from "exceljs";

XLSX.set_cptable(cptable);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function parseArgs(argv) {
  const out = { input: null, output: null, nome: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") out.input = argv[++i];
    else if (a === "--output") out.output = argv[++i];
    else if (a === "--nome") out.nome = argv[++i];
  }
  return out;
}

// ── Normalização ─────────────────────────────────────────────────────────

/** Compara cabeçalhos ignorando acento, caixa, pontuação e espaço repetido. */
function normalizeHeader(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/�/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBlank(v) {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** O SCI exporta códigos como ="50" para o Excel não comer zero à esquerda. */
function cleanText(v) {
  if (v == null) return "";
  let s = String(v).trim();
  const m = s.match(/^="(.*)"$/);
  if (m) s = m[1];
  return s.replace(/^"|"$/g, "").trim();
}

/** "1.234,56" → 1234.56. Número já numérico passa direto; vazio vira null. */
function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = cleanText(v);
  if (s === "") return null;
  const t = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "22/07/2026" → Date (UTC, para o Excel não deslocar o dia). */
function toDate(v) {
  if (v instanceof Date) return v;
  const s = cleanText(v);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return s === "" ? null : s;
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}

function digits(v) {
  return cleanText(v).replace(/\D/g, "");
}

// ── Colunas de origem ────────────────────────────────────────────────────

// Campos lidos do SCI. `de` = cabeçalhos aceitos (o primeiro com valor ganha).
// Campo ausente na entrada sai vazio: o layout não muda de arquivo para arquivo.
const CAMPOS = {
  nf: { titulo: "Nº NF.", de: ["Nº NF.", "Nº NF", "Numero NF", "NF"], tipo: "texto" },
  data: { titulo: "Data", de: ["Data", "Data de emissao", "Data de entrada"], tipo: "data" },
  tipo: { titulo: "Tipo", de: ["Tipo de lançamento"], tipo: "texto" },
  cfop: { titulo: "CFOP", de: ["CFOP"], tipo: "texto" },
  cnpj: { titulo: "CNPJ do participante", de: ["CNPJ do participante", "CNPJ"], tipo: "texto" },
  nome: { titulo: "Nome do participante", de: ["Nome do participante", "Participante"], tipo: "texto" },
  uf: { titulo: "UF", de: ["UF"], tipo: "texto" },
  cod: { titulo: "Cód. Prod.", de: ["Cód. Prod.", "Cód. Prod. Unificado"], tipo: "texto" },
  desc: { titulo: "Descrição", de: ["Descrição", "Descrição do produto"], tipo: "texto" },
  ncm: { titulo: "NCM", de: ["NCM"], tipo: "texto" },
  cest: { titulo: "CEST", de: ["CEST"], tipo: "texto" },
  qtd: { titulo: "Quantidade", de: ["Quantidade"], tipo: "quantidade" },
  un: { titulo: "Unidade", de: ["Unidade"], tipo: "texto" },
  valor: { titulo: "Valor do produto", de: ["Valor do produto"], tipo: "valor" },
  desconto: { titulo: "Desconto do produto", de: ["Desconto do produto"], tipo: "valor" },
  cstIcms: { titulo: "CST ICMS", de: ["CST ICMS"], tipo: "texto" },
  baseIcms: { titulo: "Base de ICMS", de: ["Base de ICMS"], tipo: "valor" },
  aliqIcms: { titulo: "Alíquota de ICMS", de: ["Alíquota de ICMS"], tipo: "aliquota" },
  icms: { titulo: "Valor do ICMS", de: ["Valor do ICMS"], tipo: "valor" },
  icmsSt: { titulo: "Valor do ICMS ST", de: ["Valor do ICMS ST"], tipo: "valor" },
  cstIpi: { titulo: "CST IPI", de: ["CST IPI"], tipo: "texto" },
  ipi: { titulo: "Valor do IPI", de: ["Valor do IPI"], tipo: "valor" },
  cstPis: { titulo: "CST PIS", de: ["CST PIS"], tipo: "texto" },
  aliqPis: { titulo: "Alíquota de PIS", de: ["Alíquota de PIS"], tipo: "aliquota" },
  pis: { titulo: "Valor do PIS", de: ["Valor do PIS"], tipo: "valor" },
  cstCofins: { titulo: "CST COFINS", de: ["CST COFINS"], tipo: "texto" },
  aliqCofins: { titulo: "Alíquota de COFINS", de: ["Alíquota de COFINS"], tipo: "aliquota" },
  cofins: { titulo: "Valor do COFINS", de: ["Valor do COFINS"], tipo: "valor" },
  natureza: { titulo: "Natureza crédito/receita", de: ["Descrição natureza crédito/receita"], tipo: "texto" },
};

// Campos calculados pela análise.
const ANALISE = {
  situacao: { titulo: "Situação", tipo: "texto" },
  monofasico: { titulo: "Monofásico", tipo: "texto" },
  cstEsperado: { titulo: "CST esperado", tipo: "texto" },
  categoria: { titulo: "Categoria", tipo: "texto" },
  conferir: { titulo: "O que conferir", tipo: "texto" },
  observacao: { titulo: "Observação", tipo: "texto" },
  base: { titulo: "Base legal", tipo: "texto" },
};

// Ordem da aba de itens: identificação + veredito primeiro (as 3 primeiras
// ficam congeladas na horizontal), depois o detalhe da nota e dos tributos.
const LAYOUT = [
  "nf", "desc", "ncm",
  "situacao", "monofasico", "cstPis", "cstEsperado", "valor",
  "cfop", "tipo", "data", "categoria", "conferir", "observacao", "base",
  "cnpj", "nome", "uf", "cod", "cest", "qtd", "un", "desconto",
  "cstIcms", "baseIcms", "aliqIcms", "icms", "icmsSt", "cstIpi", "ipi",
  "aliqPis", "pis", "cstCofins", "aliqCofins", "cofins", "natureza",
];
const COLUNAS_CONGELADAS = 3;
const def = (k) => CAMPOS[k] ?? ANALISE[k];

const NUM_FMT = { valor: "#,##0.00", quantidade: "#,##0.####", aliquota: "0.00", data: "dd/mm/yyyy", inteiro: "#,##0" };

// ── Situação: o que o analista faz com a linha ───────────────────────────

const SIT = {
  corrigir: "Corrigir CST",
  confirmar: "Confirmar condição",
  devolucao: "Conferir devolução",
  perfil: "Conferir perfil",
  ok: "OK",
  uso: "Uso e consumo",
  semNcm: "Sem NCM",
};

/** Ordem de prioridade (aba Monofásicos e Resumo). */
const PRIORIDADE = [SIT.corrigir, SIT.confirmar, SIT.devolucao, SIT.perfil, SIT.ok, SIT.uso];

const ACAO = {
  [SIT.corrigir]: "Produto monofásico com CST incoerente: corrigir o CST de PIS/COFINS para o da coluna CST esperado.",
  [SIT.confirmar]: "Só é monofásico se cumprir a coluna O que conferir. Se cumprir, o CST tem de ser o esperado; se não cumprir, nada a fazer.",
  [SIT.devolucao]: "Devolução: o CST tem de repetir o da nota original (compra ou venda).",
  [SIT.perfil]: "O CST certo depende do perfil da empresa (fabricante, atacadista ou varejista): confirmar o enquadramento.",
  [SIT.ok]: "CST coerente com o regime monofásico. Nada a fazer.",
  [SIT.uso]: "Entrada para uso e consumo ou ativo: a regra de revenda monofásica não se aplica. Nada a fazer.",
  [SIT.semNcm]: "Linha sem NCM (frete, energia, serviço ou item sem cadastro): fica fora da consulta.",
};

// Exceção ao EXPORT-STANDARD aprovada para esta ferramenta: cor só na Situação.
const SIT_COR = {
  [SIT.corrigir]: { fill: "FFF8D7DA", font: "FF842029" },
  [SIT.confirmar]: { fill: "FFFFF3CD", font: "FF664D03" },
  [SIT.devolucao]: { fill: "FFFFF3CD", font: "FF664D03" },
  [SIT.perfil]: { fill: "FFFFF3CD", font: "FF664D03" },
  [SIT.ok]: { fill: "FFD1E7DD", font: "FF0F5132" },
  [SIT.uso]: { fill: "FFE2E3E5", font: "FF41464B" },
  [SIT.semNcm]: { fill: "FFE2E3E5", font: "FF41464B" },
};

// ── Base de monofásicos ──────────────────────────────────────────────────

function carregarBase() {
  const raw = JSON.parse(readFileSync(path.join(__dirname, "base-monofasicos.json"), "utf-8"));
  const regras = raw.regras
    .map((r) => ({ ...r, prefixo: r.ncm.replace(/\D/g, "") }))
    // Prefixo mais longo primeiro: exceção (ex.: 3004.90.46) vence a posição (30.04).
    .sort((a, b) => b.prefixo.length - a.prefixo.length);
  return { versao: raw.versao, vigencia: raw.vigencia, regras };
}

function classificar(ncm, base) {
  if (!ncm) return null;
  for (const r of base.regras) {
    if (ncm.startsWith(r.prefixo)) return r.fora ? null : r;
  }
  return null;
}

// ── Coerência do CST de PIS com o regime ─────────────────────────────────

const CFOP_USO_CONSUMO = new Set(["556", "557", "551", "552", "406", "407"]);
const CFOP_DEVOLUCAO = /^(20[1-9]|210|41[0-3]|553|555|66[0-2])$/;

/** Direção pelo tipo de lançamento; sem ele, pelo 1º dígito do CFOP. */
function direcao(tipo, cfop) {
  const t = normalizeHeader(tipo);
  if (t.startsWith("entrada")) return "entrada";
  if (t.startsWith("saida")) return "saida";
  const d = cfop[0];
  if (d >= "1" && d <= "3") return "entrada";
  if (d >= "5" && d <= "7") return "saida";
  return "";
}

/**
 * Veredito de uma linha monofásica: { situacao, esperado, observacao }.
 * `veredito` é o que vale se o item for monofásico; a linha "Depende" vira
 * "Confirmar condição" sempre que houver algo a fazer.
 */
function avaliar(regra, cst, cfop, dir) {
  const operacao = cfop.slice(1, 4);
  const cstTxt = cst || "vazio";
  if (CFOP_DEVOLUCAO.test(operacao)) {
    return { veredito: SIT.devolucao, esperado: "o da nota original", observacao: `Devolução com CST ${cstTxt}: deve repetir o CST da operação original.` };
  }
  if (dir === "entrada") {
    if (CFOP_USO_CONSUMO.has(operacao)) {
      return { veredito: SIT.uso, esperado: null, observacao: "Entrada para uso e consumo ou ativo: não é revenda." };
    }
    if (cst === "70" || cst === "73") return { veredito: SIT.ok, esperado: "70 ou 73", observacao: `Entrada sem crédito (CST ${cst}), correto para revenda de monofásico.` };
    if (/^(5|6)\d$/.test(cst)) {
      return {
        veredito: SIT.corrigir,
        esperado: "70 ou 73",
        observacao: `CST ${cst} indica crédito, mas a compra para revenda de produto monofásico não gera crédito (Leis 10.637/2002 e 10.833/2003, art. 3º, I, b).`,
      };
    }
    return { veredito: SIT.corrigir, esperado: "70 ou 73", observacao: `CST ${cstTxt} na compra para revenda de produto monofásico.` };
  }
  if (dir === "saida") {
    if (regra.categoria === "Bebidas frias") {
      if (cst === "06") return { veredito: SIT.ok, esperado: "06", observacao: "Revenda de bebida fria pelo varejista: alíquota zero (Lei 13.097/2015, art. 28)." };
      if (cst === "01") return { veredito: SIT.perfil, esperado: "06 (varejista) ou 01 (atacadista)", observacao: "CST 01 só é correto se a empresa for atacadista: a alíquota zero é só do varejista." };
      if (cst === "02" || cst === "03") return { veredito: SIT.perfil, esperado: "06 (varejista)", observacao: `CST ${cst} só se a empresa for fabricante ou importadora.` };
      return { veredito: SIT.corrigir, esperado: "06 (varejista)", observacao: `CST ${cstTxt} na saída de bebida fria.` };
    }
    if (cst === "04") return { veredito: SIT.ok, esperado: "04", observacao: "Revenda monofásica a alíquota zero, correto." };
    if (cst === "02" || cst === "03") return { veredito: SIT.perfil, esperado: "04 (revenda)", observacao: `CST ${cst} só se a empresa for fabricante ou importadora.` };
    return { veredito: SIT.corrigir, esperado: "04", observacao: `CST ${cstTxt} na revenda de produto monofásico: o PIS/COFINS já foi pago na indústria e a revenda é alíquota zero.` };
  }
  return { veredito: SIT.perfil, esperado: null, observacao: "Não deu para saber se é entrada ou saída (sem Tipo de lançamento nem CFOP)." };
}

// ── Leitura ──────────────────────────────────────────────────────────────

function findHeaderRow(aoa) {
  // Cabeçalho = primeira linha (das 20 primeiras) que contém a coluna NCM.
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    if ((aoa[i] ?? []).some((c) => normalizeHeader(cleanText(c)) === "ncm")) return i;
  }
  return -1;
}

function readInput(filePath) {
  const buf = readFileSync(filePath);
  // raw:true no CSV mantém ="50" como texto (sem virar fórmula) e "0,00" sem
  // reinterpretação de locale — a conversão numérica é feita aqui, com regra BR.
  const wb = XLSX.read(buf, { type: "buffer", codepage: 1252, cellDates: true, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Arquivo sem abas.");
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true, blankrows: false });
  const h = findHeaderRow(aoa);
  if (h < 0) {
    throw new Error(
      "Não encontrei a coluna NCM. Envie a exportação de produtos por nota do SCI (a que traz NCM, CFOP e CST de PIS/COFINS por item).",
    );
  }
  const header = aoa[h].map((c) => normalizeHeader(cleanText(c)));
  const rows = aoa.slice(h + 1).filter((r) => r.some((c) => !isBlank(cleanText(c))));
  return { header, rows };
}

function converter(valor, tipo) {
  if (tipo === "data") return toDate(valor);
  if (tipo === "valor" || tipo === "quantidade" || tipo === "aliquota") return toNumber(valor);
  const s = cleanText(valor);
  return s === "" ? null : s;
}

/** Lê os campos de origem de cada linha para um objeto { chave: valor }. */
function extrair(header, rows) {
  const idx = Object.fromEntries(
    Object.entries(CAMPOS).map(([k, c]) => [k, c.de.map((n) => header.indexOf(normalizeHeader(n))).filter((i) => i >= 0)]),
  );
  return rows.map((bruta) => {
    const o = {};
    for (const [k, c] of Object.entries(CAMPOS)) {
      o[k] = null;
      for (const i of idx[k]) {
        const v = converter(bruta[i], c.tipo);
        if (v != null && v !== "") {
          o[k] = v;
          break;
        }
      }
    }
    return o;
  });
}

function analisar(item, base) {
  const ncm = digits(item.ncm);
  const cfop = digits(item.cfop);
  const cst = digits(item.cstPis) ? digits(item.cstPis).padStart(2, "0").slice(-2) : "";
  if (!ncm) {
    return { situacao: SIT.semNcm, monofasico: "Sem NCM", cstEsperado: null, categoria: null, conferir: null, observacao: ACAO[SIT.semNcm], base: null };
  }
  const regra = classificar(ncm, base);
  if (!regra) {
    return { situacao: null, monofasico: "Não", cstEsperado: null, categoria: null, conferir: null, observacao: null, base: null };
  }
  const v = avaliar(regra, cst, cfop, direcao(item.tipo, cfop));
  const depende = Boolean(regra.condicao);
  // Item condicional: só "Uso e consumo" e "OK" dispensam a confirmação.
  const situacao = depende && v.veredito !== SIT.uso && v.veredito !== SIT.ok ? SIT.confirmar : v.veredito;
  return {
    situacao,
    monofasico: depende ? "Depende" : "Sim",
    cstEsperado: v.esperado,
    categoria: regra.categoria,
    conferir: regra.condicao ?? null,
    observacao: v.observacao,
    base: regra.base,
  };
}

// ── Escrita (docs/EXPORT-STANDARD.md) ────────────────────────────────────

const FONT_NAME = "Calibri";
const FONT_SIZE = 11;
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4169E1" } };
const HEADER_FONT = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: "FFFFFFFF" } };
const DATA_FONT = { name: FONT_NAME, size: FONT_SIZE, color: { argb: "FF1A1A1F" } };
const ALIGN = { horizontal: "center", vertical: "middle" };
const THIN_BORDER = {
  top: { style: "thin", color: { argb: "FFCECECE" } },
  left: { style: "thin", color: { argb: "FFCECECE" } },
  bottom: { style: "thin", color: { argb: "FFCECECE" } },
  right: { style: "thin", color: { argb: "FFCECECE" } },
};
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 22;
// O padrão manda medir antes de abrir mão da formatação por célula (§5). No
// Node, 20 mil linhas com o padrão completo cabem com folga; acima disso fica
// só o estilo por coluna, para não estourar memória do worker.
const LARGE_SHEET_MIN_ROWS = 20_000;

function columnWidth(header, rows, i) {
  let max = String(header).length;
  for (const row of rows) {
    const v = row[i];
    if (v == null) continue;
    const len = v instanceof Date ? 10 : String(v).length;
    if (len > max) max = len;
  }
  return Math.min(60, Math.max(10, max + 2));
}

/**
 * Uma aba no padrão do sistema. `tipos[i]` define o numFmt da coluna i;
 * `colSituacao` (índice) recebe a cor da Situação; `congelar` = colunas fixas.
 */
function addSheet(wb, nome, header, rows, tipos, { colSituacao = -1, congelar = 0 } = {}) {
  const ws = wb.addWorksheet(nome);
  const headerRow = ws.addRow(header);
  for (const r of rows) ws.addRow(r);

  // Estilo por coluna antes do cabeçalho (o ExcelJS aplica em todas as células da coluna).
  for (let c = 0; c < header.length; c++) {
    const col = ws.getColumn(c + 1);
    col.font = DATA_FONT;
    col.alignment = ALIGN;
    col.width = columnWidth(header[c], rows, c);
    const fmt = NUM_FMT[tipos[c]];
    if (fmt) col.numFmt = fmt;
    else if (tipos[c] === "texto") col.numFmt = "@";
  }

  headerRow.height = HEADER_HEIGHT;
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = ALIGN;
    cell.border = THIN_BORDER;
    cell.numFmt = "General";
  });

  if (rows.length <= LARGE_SHEET_MIN_ROWS) {
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      row.height = ROW_HEIGHT;
      for (let c = 1; c <= header.length; c++) row.getCell(c).border = THIN_BORDER;
    }
  }

  if (colSituacao >= 0) {
    for (let r = 2; r <= ws.rowCount; r++) {
      const cell = ws.getRow(r).getCell(colSituacao + 1);
      const cor = SIT_COR[cell.value];
      if (!cor) continue;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cor.fill } };
      cell.font = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: cor.font } };
    }
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
  ws.views = [{ showGridLines: false, state: "frozen", ySplit: 1, xSplit: congelar }];
  return ws;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input || !args.output) throw new Error("Uso: node cli.mjs --input <arquivo> --output <saida.xlsx> [--nome <nome original>]");

  emit({ kind: "progress", value: 5 });
  const base = carregarBase();
  const { header, rows } = readInput(args.input);
  if (rows.length === 0) throw new Error("O arquivo não tem linhas de produto abaixo do cabeçalho.");
  emit({ kind: "progress", value: 25 });

  const itens = extrair(header, rows).map((item) => ({ ...item, ...analisar(item, base) }));
  emit({ kind: "progress", value: 55 });

  const valorDe = (i) => (typeof i.valor === "number" ? i.valor : 0);
  const soma = (lista) => Math.round(lista.reduce((s, i) => s + valorDe(i), 0) * 100) / 100;
  const prioridade = (s) => {
    const p = PRIORIDADE.indexOf(s);
    return p < 0 ? PRIORIDADE.length : p;
  };

  // ── Aba Produtos / Monofásicos
  const headerItens = LAYOUT.map((k) => def(k).titulo);
  const tiposItens = LAYOUT.map((k) => def(k).tipo);
  const linha = (i) => LAYOUT.map((k) => i[k]);
  const colSituacao = LAYOUT.indexOf("situacao");

  const monofasicos = itens
    .filter((i) => i.monofasico === "Sim" || i.monofasico === "Depende")
    .sort((a, b) => prioridade(a.situacao) - prioridade(b.situacao) || String(a.categoria).localeCompare(String(b.categoria)) || String(a.ncm).localeCompare(String(b.ncm)));

  // ── Aba Resumo por NCM — todas as NCMs, as que pedem ação primeiro.
  const porNcm = new Map();
  for (const i of itens) {
    const chave = i.ncm ?? "(sem NCM)";
    let g = porNcm.get(chave);
    if (!g) {
      g = { ncm: chave, desc: i.desc, mono: i.monofasico, cat: i.categoria, linhas: 0, corrigir: 0, confirmar: 0, valor: 0, csts: new Set() };
      porNcm.set(chave, g);
    }
    g.linhas += 1;
    if (i.situacao === SIT.corrigir) g.corrigir += 1;
    if (i.situacao === SIT.confirmar) g.confirmar += 1;
    g.valor += valorDe(i);
    if (i.cstPis) g.csts.add(i.cstPis);
  }
  const ordemMono = { Sim: 0, Depende: 1, "Não": 2, "Sem NCM": 3 };
  const linhasNcm = [...porNcm.values()]
    .sort((a, b) => b.corrigir - a.corrigir || b.confirmar - a.confirmar || ordemMono[a.mono] - ordemMono[b.mono] || b.valor - a.valor)
    .map((g) => [g.ncm, g.mono, g.cat ?? null, g.linhas, g.corrigir || null, g.confirmar || null, Math.round(g.valor * 100) / 100, [...g.csts].sort().join(", ") || null, g.desc]);

  // ── Aba Resumo — o que fazer, depois o contexto do arquivo.
  const por = (s) => itens.filter((i) => i.situacao === s);
  const resumo = [];
  for (const s of [...PRIORIDADE, SIT.semNcm]) {
    const l = por(s);
    resumo.push([s, l.length, soma(l), ACAO[s]]);
  }
  const fora = itens.filter((i) => i.monofasico === "Não");
  resumo.push(["Fora da base", fora.length, soma(fora), "NCM sem regra monofásica de PIS/COFINS: nada a conferir aqui."]);

  const entradas = itens.filter((i) => direcao(i.tipo, digits(i.cfop)) === "entrada").length;
  const saidas = itens.filter((i) => direcao(i.tipo, digits(i.cfop)) === "saida").length;
  const datas = itens.map((i) => i.data).filter((d) => d instanceof Date).sort((a, b) => a - b);
  const info = [
    ["Arquivo analisado", null, null, args.nome ?? path.basename(args.input)],
    ["Período (data das notas)", null, null, datas.length ? `${fmtData(datas[0])} a ${fmtData(datas[datas.length - 1])}` : "não informado"],
    ["Linhas analisadas", itens.length, soma(itens), `${entradas} de entrada e ${saidas} de saída.`],
  ];
  if (saidas === 0) {
    info.push(["Atenção", null, null, "O arquivo só tem entradas. Nelas o CST errado não muda o imposto pago; o impacto financeiro (PIS/COFINS pago na revenda com CST 01) aparece nas SAÍDAS — exporte as saídas do SCI e rode de novo."]);
  } else if (entradas === 0) {
    info.push(["Atenção", null, null, "O arquivo só tem saídas. Para conferir o crédito nas compras, exporte também as entradas."]);
  }
  info.push(
    ["Base de monofásicos", null, null, `Versão ${base.versao}. ${base.vigencia}`],
    ["Simples Nacional", null, null, "No Simples, o PIS/COFINS monofásico é segregado no PGDAS-D; as situações de CST valem para Lucro Real e Presumido."],
  );
  const linhasResumo = [...resumo, ...info];
  emit({ kind: "progress", value: 70 });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Análise Fiscal de Produtos";
  wb.created = new Date();
  const wsResumo = addSheet(wb, "Resumo", ["Item", "Linhas", "Valor dos produtos", "O que fazer"], linhasResumo, ["texto", "inteiro", "valor", "texto"], { colSituacao: 0 });
  // A coluna "O que fazer" tem frases longas: quebra a linha em vez de cortar.
  wsResumo.getColumn(4).width = 60;
  wsResumo.getColumn(4).alignment = { ...ALIGN, wrapText: true };
  for (let r = 2; r <= wsResumo.rowCount; r++) {
    const texto = String(wsResumo.getRow(r).getCell(4).value ?? "");
    wsResumo.getRow(r).height = Math.max(ROW_HEIGHT, Math.ceil(texto.length / 58) * 15 + 7);
  }
  wsResumo.autoFilter = null;

  addSheet(wb, "Produtos", headerItens, itens.map(linha), tiposItens, { colSituacao, congelar: COLUNAS_CONGELADAS });
  emit({ kind: "progress", value: 85 });
  addSheet(wb, "Monofásicos", headerItens, monofasicos.map(linha), tiposItens, { colSituacao, congelar: COLUNAS_CONGELADAS });
  addSheet(
    wb,
    "Resumo por NCM",
    ["NCM", "Monofásico", "Categoria", "Linhas", "Linhas a corrigir", "Linhas a confirmar", "Valor dos produtos", "CSTs de PIS", "Exemplo de descrição"],
    linhasNcm,
    ["texto", "texto", "texto", "inteiro", "inteiro", "inteiro", "valor", "texto", "texto"],
    { congelar: 1 },
  );

  await wb.xlsx.writeFile(args.output);
  emit({ kind: "progress", value: 100 });
  emit({
    kind: "done",
    output: args.output,
    linhas: itens.length,
    monofasicos: itens.filter((i) => i.monofasico === "Sim").length,
    depende: itens.filter((i) => i.monofasico === "Depende").length,
    corrigir: por(SIT.corrigir).length,
    confirmar: por(SIT.confirmar).length,
    baseVersao: base.versao,
  });
}

function fmtData(d) {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

main().catch((e) => {
  emit({ kind: "error", message: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
