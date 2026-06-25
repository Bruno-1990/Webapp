#!/usr/bin/env node
// Conciliador NFS-e SCI x Portal Nacional — engine standalone Node.js.
// Lê 2 planilhas, faz match por chave de acesso (primário) ou CNPJ+número
// (fallback), gera XLSX com 5 abas (Resumo / Em ambas / Só no Portal /
// Só no SCI / Duplicados).
//
// Protocolo stdout (cada linha = 1 evento JSON):
//   {"kind":"progress","value":<0..100>}
//   {"kind":"done","output":"<path>","matched":N,"soSci":N,"soPortal":N}
//   {"kind":"error","message":"<texto>"}

import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import ExcelJS from "exceljs";

XLSX.set_cptable(cptable);

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function parseArgs(argv) {
  const out = { sci: null, portal: null, output: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--sci") { out.sci = v; i++; }
    else if (k === "--portal") { out.portal = v; i++; }
    else if (k === "--output") { out.output = v; i++; }
  }
  return out;
}

// ── Normalização ─────────────────────────────────────────────────────────

function normalizeHeader(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/�/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findCol(headers, ...tokens) {
  const want = tokens.map((t) => normalizeHeader(t));
  for (const h of headers) {
    const n = normalizeHeader(h);
    if (want.every((w) => n.includes(w))) return h;
  }
  return null;
}

function digits(s) {
  return String(s ?? "").replace(/\D+/g, "");
}

function normCnpjCpf(s) {
  const d = digits(s);
  if (d.length === 0) return "";
  return d.length <= 11 ? d.padStart(11, "0") : d.padStart(14, "0");
}

function normDoc(s) {
  return String(s ?? "").trim().replace(/^0+/, "").toLowerCase();
}

function normChave(s) {
  return digits(s);
}

function asNumber(s) {
  if (typeof s === "number" && Number.isFinite(s)) return s;
  const str = String(s ?? "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : 0;
}

function asText(s) {
  if (s == null) return "";
  return typeof s === "string" ? s : String(s);
}

// ── Leitura ──────────────────────────────────────────────────────────────

/** Lê só a primeira aba (usado para SCI, que é planilha de aba única). */
function readSheet(filePath) {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer", codepage: 1252, cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
}

/** Lê todas as abas e separa entre ativas (aba "NFSe") e canceladas (aba "Cancelada"/"Canceladas").
 *  - Detecção tolerante: usa `normalizeHeader` (sem acento, lowercase) e procura por "cancel" no nome da aba.
 *  - Se só houver uma aba, todo o conteúdo entra como "ativas" (compat com planilhas sem aba de cancelada). */
function readPortalSheets(filePath) {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer", codepage: 1252, cellDates: true });
  const ativasRows = [];
  const canceladasRows = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
    if (rows.length === 0) continue;
    const nameNorm = normalizeHeader(sheetName);
    if (nameNorm.includes("cancel")) {
      canceladasRows.push(...rows);
    } else {
      ativasRows.push(...rows);
    }
  }
  return { ativasRows, canceladasRows };
}

// ── Indexação ────────────────────────────────────────────────────────────

function indexSci(rows) {
  if (!rows.length) return { list: [], byChave: new Map(), byCnpjDoc: new Map() };
  const headers = Object.keys(rows[0]);
  const colDoc = findCol(headers, "documento");
  const colCnpj = findCol(headers, "cpf", "cnpj") ?? findCol(headers, "cnpj");
  const colChave = findCol(headers, "chave");
  const colValor = findCol(headers, "valor", "nota");
  const colNome = findCol(headers, "nome", "participante");
  const colData = findCol(headers, "data", "emiss");
  const colSit = findCol(headers, "situa");
  const colCidade = findCol(headers, "cidade");

  const list = [];
  const byChave = new Map();
  const byCnpjDoc = new Map();
  for (const raw of rows) {
    const documento = colDoc ? normDoc(raw[colDoc]) : "";
    const cnpjPrestador = colCnpj ? normCnpjCpf(raw[colCnpj]) : "";
    const chave = colChave ? normChave(raw[colChave]) : "";
    if (!documento && !chave) continue;
    const matchKeyChave = chave && chave.length >= 30 ? chave : "";
    const matchKeyCnpjDoc = cnpjPrestador && documento ? `${cnpjPrestador}|${documento}` : "";
    const item = {
      documento,
      cnpjPrestador,
      chave,
      matchKeyChave,
      matchKeyCnpjDoc,
      valor: colValor ? asNumber(raw[colValor]) : 0,
      nomePrestador: colNome ? asText(raw[colNome]) : "",
      dataEmissao: colData ? asText(raw[colData]) : "",
      situacao: colSit ? asText(raw[colSit]) : "",
      cidade: colCidade ? asText(raw[colCidade]) : "",
    };
    list.push(item);
    if (matchKeyChave) {
      const arr = byChave.get(matchKeyChave) ?? [];
      arr.push(item);
      byChave.set(matchKeyChave, arr);
    }
    if (matchKeyCnpjDoc) {
      const arr = byCnpjDoc.get(matchKeyCnpjDoc) ?? [];
      arr.push(item);
      byCnpjDoc.set(matchKeyCnpjDoc, arr);
    }
  }
  return { list, byChave, byCnpjDoc };
}

function indexPortal(rows) {
  if (!rows.length) return { list: [], byChave: new Map(), byCnpjDoc: new Map() };
  const headers = Object.keys(rows[0]);
  const colChave = findCol(headers, "chave", "acesso") ?? findCol(headers, "chave");
  const colNumero = findCol(headers, "nnfse") ?? findCol(headers, "numero");
  const colSerie = findCol(headers, "serie");
  const colCnpjPrest = findCol(headers, "prestador", "cnpj");
  const colCnpjTom = findCol(headers, "tomador", "cnpj");
  const colNomePrest = findCol(headers, "prestador", "xnome") ?? findCol(headers, "prestador", "nome");
  const colVliq = findCol(headers, "vliq") ?? findCol(headers, "liquido");
  const colVserv = findCol(headers, "vserv") ?? findCol(headers, "servico");
  const colDhEmi = findCol(headers, "dhemi") ?? findCol(headers, "emiss");
  const colCStat = findCol(headers, "cstat") ?? findCol(headers, "situa");
  const colDCompet = findCol(headers, "dcompet") ?? findCol(headers, "compet");

  const list = [];
  const byChave = new Map();
  const byCnpjDoc = new Map();
  for (const raw of rows) {
    const chave = colChave ? normChave(raw[colChave]) : "";
    const numero = colNumero ? normDoc(raw[colNumero]) : "";
    const cnpjPrestador = colCnpjPrest ? normCnpjCpf(raw[colCnpjPrest]) : "";
    if (!chave && !numero) continue;
    const matchKeyChave = chave && chave.length >= 30 ? chave : "";
    const matchKeyCnpjDoc = cnpjPrestador && numero ? `${cnpjPrestador}|${numero}` : "";
    const item = {
      numero,
      serie: colSerie ? asText(raw[colSerie]) : "",
      cnpjPrestador,
      cnpjTomador: colCnpjTom ? normCnpjCpf(raw[colCnpjTom]) : "",
      chave,
      matchKeyChave,
      matchKeyCnpjDoc,
      valorLiquido: colVliq ? asNumber(raw[colVliq]) : 0,
      valorServico: colVserv ? asNumber(raw[colVserv]) : 0,
      nomePrestador: colNomePrest ? asText(raw[colNomePrest]) : "",
      dataEmissao: colDhEmi ? asText(raw[colDhEmi]) : "",
      situacao: colCStat ? asText(raw[colCStat]) : "",
      competencia: colDCompet ? asText(raw[colDCompet]) : "",
    };
    list.push(item);
    if (matchKeyChave) {
      const arr = byChave.get(matchKeyChave) ?? [];
      arr.push(item);
      byChave.set(matchKeyChave, arr);
    }
    if (matchKeyCnpjDoc) {
      const arr = byCnpjDoc.get(matchKeyCnpjDoc) ?? [];
      arr.push(item);
      byCnpjDoc.set(matchKeyCnpjDoc, arr);
    }
  }
  return { list, byChave, byCnpjDoc };
}

// ── Match ────────────────────────────────────────────────────────────────

/** Casa cada portal item com um sci item (consumindo do set `usedSci`),
 *  usa chave primário e CNPJ+doc como fallback. Retorna lista de pares. */
function matchPortalAgainstSci(portalList, sciIdx, usedSci) {
  const pairs = [];
  for (const portal of portalList) {
    if (portal.matchKeyChave) {
      const cands = sciIdx.byChave.get(portal.matchKeyChave);
      if (cands) {
        const sci = cands.find((c) => !usedSci.has(c));
        if (sci) {
          usedSci.add(sci);
          pairs.push({ sci, portal, matchedBy: "chave" });
          continue;
        }
      }
    }
    if (portal.matchKeyCnpjDoc) {
      const cands = sciIdx.byCnpjDoc.get(portal.matchKeyCnpjDoc);
      if (cands) {
        const sci = cands.find((c) => !usedSci.has(c));
        if (sci) {
          usedSci.add(sci);
          pairs.push({ sci, portal, matchedBy: "cnpj+doc" });
        }
      }
    }
  }
  return pairs;
}

/** Compara SCI × Portal Nacional em 2 frentes:
 *  - Notas ATIVAS do Portal × SCI → "Em ambas" / "Só no Portal Nacional" / "Só no SCI".
 *  - Notas CANCELADAS do Portal × SCI → "Canceladas no SCI" (ainda lançadas, precisa retirar). */
function compare(sciIdx, portalAtivasIdx, portalCanceladasIdx) {
  const usedSci = new Set();

  // Passa 1: ativas. Consome SCIs do conjunto livre.
  const pairs = matchPortalAgainstSci(portalAtivasIdx.list, sciIdx, usedSci);

  // Passa 2: canceladas. Continua consumindo do mesmo SCI livre — uma nota SCI
  // ou casa com ativa OU com cancelada, nunca com ambas.
  const pairsCanceladas = matchPortalAgainstSci(portalCanceladasIdx.list, sciIdx, usedSci);

  const soSci = sciIdx.list.filter((x) => !usedSci.has(x));
  const matchedAtivas = new Set(pairs.map((p) => p.portal));
  const matchedCanceladas = new Set(pairsCanceladas.map((p) => p.portal));
  const soPortal = portalAtivasIdx.list.filter((x) => !matchedAtivas.has(x));
  const canceladasNoSci = pairsCanceladas; // canceladas no Portal que estão no SCI
  const canceladasForaSci = portalCanceladasIdx.list.filter((x) => !matchedCanceladas.has(x));

  const duplicadosSci = [];
  for (const arr of sciIdx.byChave.values()) {
    if (arr.length > 1) duplicadosSci.push(arr);
  }
  for (const arr of sciIdx.byCnpjDoc.values()) {
    if (arr.length > 1 && arr.every((it) => !it.matchKeyChave)) {
      duplicadosSci.push(arr);
    }
  }

  const duplicadosPortal = [];
  for (const arr of portalAtivasIdx.byChave.values()) {
    if (arr.length > 1) duplicadosPortal.push(arr);
  }
  for (const arr of portalAtivasIdx.byCnpjDoc.values()) {
    if (arr.length > 1 && arr.every((it) => !it.matchKeyChave)) {
      duplicadosPortal.push(arr);
    }
  }

  return {
    pairs,
    soSci,
    soPortal,
    canceladasNoSci,
    canceladasForaSci,
    duplicadosSci,
    duplicadosPortal,
  };
}

// ── Escrita XLSX ─────────────────────────────────────────────────────────

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4169E1" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" } };

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = HEADER_FONT;
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle", horizontal: "center" };
  row.height = 22;
}

/** Mede largura por conteúdo e centraliza todas as células.
 *  - Preserva alinhamentos especiais já definidos (ex.: wrapText + vertical:top no aviso da aba canceladas). */
function autoWidth(ws) {
  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > max) max = len;
      const current = cell.alignment || {};
      if (current.wrapText) return;
      cell.alignment = { ...current, horizontal: "center", vertical: "middle" };
    });
    col.width = Math.min(60, Math.max(10, max + 2));
  });
}

/** Cor de alerta (vermelho-âmbar) usada para destacar a aba "Canceladas no SCI". */
const ALERT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB91C1C" } };
const ALERT_TAB_COLOR = "FFB91C1C"; // mesma cor na orelha da aba
const ALERT_ROW_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };

function styleAlertHeader(ws) {
  const row = ws.getRow(1);
  row.font = HEADER_FONT;
  row.fill = ALERT_FILL;
  row.alignment = { vertical: "middle", horizontal: "center" };
  row.height = 22;
}

async function writeOutput(outputPath, sci, portalAtivas, portalCanceladas, cmp) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Conciliador NFS-e SCI x Portal Nacional";
  wb.created = new Date();

  // 1. Resumo
  const resumo = wb.addWorksheet("Resumo");
  resumo.columns = [
    { header: "Métrica", key: "k" },
    { header: "Valor", key: "v" },
  ];
  styleHeader(resumo);
  const totalPairsValor = cmp.pairs.reduce(
    (s, p) => s + (p.portal.valorLiquido || p.portal.valorServico || p.sci.valor),
    0,
  );
  const totalSoSciValor = cmp.soSci.reduce((s, x) => s + x.valor, 0);
  const totalSoPortalValor = cmp.soPortal.reduce(
    (s, x) => s + (x.valorLiquido || x.valorServico),
    0,
  );
  const totalCanceladasNoSciValor = cmp.canceladasNoSci.reduce(
    (s, p) => s + (p.portal.valorLiquido || p.portal.valorServico || p.sci.valor),
    0,
  );
  const linhas = [
    ["Linhas no SCI", sci.list.length],
    ["Linhas no Portal Nacional (ativas)", portalAtivas.list.length],
    ["Linhas no Portal Nacional (canceladas)", portalCanceladas.list.length],
    ["", ""],
    ["── Ativas ──", ""],
    ["Em ambas (com match)", cmp.pairs.length],
    ["  └ por chave de acesso", cmp.pairs.filter((p) => p.matchedBy === "chave").length],
    ["  └ por CNPJ + número", cmp.pairs.filter((p) => p.matchedBy === "cnpj+doc").length],
    ["Só no Portal Nacional (faltam lançar no SCI)", cmp.soPortal.length],
    ["Só no SCI (sem nota ativa no Portal Nacional)", cmp.soSci.length],
    ["", ""],
    ["── Canceladas ──", ""],
    ["⚠ Canceladas no Portal mas presentes no SCI (retirar do SCI)", cmp.canceladasNoSci.length],
    ["Canceladas no Portal que NÃO afetam o SCI (já não estavam)", cmp.canceladasForaSci.length],
    ["", ""],
    ["── Duplicados ──", ""],
    ["Grupos de duplicados no SCI", cmp.duplicadosSci.length],
    ["Grupos de duplicados no Portal Nacional (ativas)", cmp.duplicadosPortal.length],
    ["", ""],
    ["── Valores totais (R$) ──", ""],
    ["Valor total — Em ambas", Number(totalPairsValor.toFixed(2))],
    ["Valor total — Só no Portal Nacional", Number(totalSoPortalValor.toFixed(2))],
    ["Valor total — Só no SCI", Number(totalSoSciValor.toFixed(2))],
    ["Valor total — ⚠ Canceladas no SCI", Number(totalCanceladasNoSciValor.toFixed(2))],
  ];
  for (const [k, v] of linhas) resumo.addRow({ k, v });
  // Destacar a linha do alerta de canceladas no SCI.
  resumo.eachRow((row) => {
    const v0 = String(row.getCell(1).value ?? "");
    if (v0.startsWith("⚠")) {
      row.font = { bold: true, color: { argb: "FFB91C1C" } };
      row.fill = ALERT_ROW_FILL;
    } else if (v0.startsWith("──")) {
      row.font = { bold: true, color: { argb: "FF1E3D4D" } };
    }
  });
  autoWidth(resumo);

  // 2. Em ambas
  const ambas = wb.addWorksheet("Em ambas");
  ambas.columns = [
    { header: "Match por", key: "matchedBy" },
    { header: "Chave NFS-e", key: "chave" },
    { header: "Número", key: "numero" },
    { header: "Série", key: "serie" },
    { header: "CNPJ Prestador", key: "cnpj" },
    { header: "Nome Prestador", key: "nome" },
    { header: "Data Emissão (Portal)", key: "dataPortal" },
    { header: "Data Emissão (SCI)", key: "dataSci" },
    { header: "Valor Líquido Portal (R$)", key: "vPortal" },
    { header: "Valor SCI (R$)", key: "vSci" },
    { header: "Diferença (R$)", key: "diff" },
    { header: "Situação Portal", key: "situacaoPortal" },
  ];
  styleHeader(ambas);
  for (const p of cmp.pairs) {
    const vPortal = p.portal.valorLiquido || p.portal.valorServico;
    const vSci = p.sci.valor;
    ambas.addRow({
      matchedBy: p.matchedBy === "chave" ? "Chave" : "CNPJ + Nº",
      chave: p.portal.chave || p.sci.chave,
      numero: p.portal.numero || p.sci.documento,
      serie: p.portal.serie,
      cnpj: p.portal.cnpjPrestador || p.sci.cnpjPrestador,
      nome: p.portal.nomePrestador || p.sci.nomePrestador,
      dataPortal: p.portal.dataEmissao,
      dataSci: p.sci.dataEmissao,
      vPortal: Number(vPortal.toFixed(2)),
      vSci: Number(vSci.toFixed(2)),
      diff: Number((vPortal - vSci).toFixed(2)),
      situacaoPortal: p.portal.situacao,
    });
  }
  ambas.getColumn("chave").numFmt = "@";
  ambas.getColumn("cnpj").numFmt = "@";
  autoWidth(ambas);

  // 3. Só no Portal Nacional
  const soPortal = wb.addWorksheet("Só no Portal Nacional");
  soPortal.columns = [
    { header: "Chave NFS-e", key: "chave" },
    { header: "Número", key: "numero" },
    { header: "Série", key: "serie" },
    { header: "Data Emissão", key: "data" },
    { header: "Competência", key: "competencia" },
    { header: "CNPJ Prestador", key: "cnpjPrest" },
    { header: "Nome Prestador", key: "nomePrest" },
    { header: "CNPJ Tomador", key: "cnpjTom" },
    { header: "Valor Líquido (R$)", key: "vLiq" },
    { header: "Valor Serviço (R$)", key: "vServ" },
    { header: "Situação", key: "situacao" },
  ];
  styleHeader(soPortal);
  for (const p of cmp.soPortal) {
    soPortal.addRow({
      chave: p.chave,
      numero: p.numero,
      serie: p.serie,
      data: p.dataEmissao,
      competencia: p.competencia,
      cnpjPrest: p.cnpjPrestador,
      nomePrest: p.nomePrestador,
      cnpjTom: p.cnpjTomador,
      vLiq: Number(p.valorLiquido.toFixed(2)),
      vServ: Number(p.valorServico.toFixed(2)),
      situacao: p.situacao,
    });
  }
  soPortal.getColumn("chave").numFmt = "@";
  soPortal.getColumn("cnpjPrest").numFmt = "@";
  soPortal.getColumn("cnpjTom").numFmt = "@";
  autoWidth(soPortal);

  // 4. Só no SCI
  const soSciWs = wb.addWorksheet("Só no SCI");
  soSciWs.columns = [
    { header: "Documento", key: "documento" },
    { header: "CPF/CNPJ Prestador", key: "cnpj" },
    { header: "Nome Prestador", key: "nome" },
    { header: "Chave", key: "chave" },
    { header: "Data Emissão", key: "data" },
    { header: "Cidade", key: "cidade" },
    { header: "Valor da Nota (R$)", key: "valor" },
    { header: "Situação", key: "situacao" },
  ];
  styleHeader(soSciWs);
  for (const s of cmp.soSci) {
    soSciWs.addRow({
      documento: s.documento,
      cnpj: s.cnpjPrestador,
      nome: s.nomePrestador,
      chave: s.chave,
      data: s.dataEmissao,
      cidade: s.cidade,
      valor: Number(s.valor.toFixed(2)),
      situacao: s.situacao,
    });
  }
  soSciWs.getColumn("chave").numFmt = "@";
  soSciWs.getColumn("cnpj").numFmt = "@";
  soSciWs.getColumn("documento").numFmt = "@";
  autoWidth(soSciWs);

  // 5. ⚠ Canceladas no SCI — notas canceladas no Portal Nacional mas ainda
  //    lançadas no SCI. Auditoria precisa retirar do SCI.
  const canc = wb.addWorksheet("⚠ Canceladas no SCI", {
    properties: { tabColor: { argb: ALERT_TAB_COLOR } },
  });
  canc.columns = [
    { header: "Chave NFS-e", key: "chave" },
    { header: "Número (Portal)", key: "numPortal" },
    { header: "Documento (SCI)", key: "docSci" },
    { header: "CNPJ Prestador", key: "cnpj" },
    { header: "Nome Prestador", key: "nome" },
    { header: "Data Emissão (Portal)", key: "dataPortal" },
    { header: "Data Emissão (SCI)", key: "dataSci" },
    { header: "Valor Líquido Portal (R$)", key: "vPortal" },
    { header: "Valor SCI (R$)", key: "vSci" },
    { header: "Diferença (R$)", key: "diff" },
    { header: "Match por", key: "matchedBy" },
    { header: "Ação sugerida", key: "acao" },
  ];
  styleAlertHeader(canc);
  for (const p of cmp.canceladasNoSci) {
    const vPortal = p.portal.valorLiquido || p.portal.valorServico;
    const vSci = p.sci.valor;
    const row = canc.addRow({
      chave: p.portal.chave || p.sci.chave,
      numPortal: p.portal.numero,
      docSci: p.sci.documento,
      cnpj: p.portal.cnpjPrestador || p.sci.cnpjPrestador,
      nome: p.portal.nomePrestador || p.sci.nomePrestador,
      dataPortal: p.portal.dataEmissao,
      dataSci: p.sci.dataEmissao,
      vPortal: Number(vPortal.toFixed(2)),
      vSci: Number(vSci.toFixed(2)),
      diff: Number((vPortal - vSci).toFixed(2)),
      matchedBy: p.matchedBy === "chave" ? "Chave" : "CNPJ + Nº",
      acao: "Retirar lançamento do SCI",
    });
    row.fill = ALERT_ROW_FILL;
  }
  canc.getColumn("chave").numFmt = "@";
  canc.getColumn("cnpj").numFmt = "@";
  canc.getColumn("numPortal").numFmt = "@";
  canc.getColumn("docSci").numFmt = "@";
  // Aviso explicativo abaixo da tabela (se houver linhas).
  if (cmp.canceladasNoSci.length > 0) {
    const explainRow = canc.addRow([]);
    canc.mergeCells(explainRow.number, 1, explainRow.number, 12);
    const c = canc.getCell(explainRow.number, 1);
    c.value =
      "Notas que aparecem na aba 'Cancelada' do Portal Nacional, mas que ainda estão lançadas no SCI. " +
      "São o item de maior risco da conciliação — devem ser estornadas/excluídas do SCI.";
    c.font = { italic: true, color: { argb: "FF7F1D1D" } };
    c.alignment = { wrapText: true, vertical: "top" };
    explainRow.height = 36;
  }
  autoWidth(canc);

  // 6. Duplicados
  const dup = wb.addWorksheet("Duplicados");
  dup.columns = [
    { header: "Origem", key: "origem" },
    { header: "Grupo", key: "grupo" },
    { header: "Chave / Identificador", key: "ident" },
    { header: "Número", key: "numero" },
    { header: "CNPJ Prestador", key: "cnpj" },
    { header: "Nome Prestador", key: "nome" },
    { header: "Valor (R$)", key: "valor" },
    { header: "Data Emissão", key: "data" },
  ];
  styleHeader(dup);
  let g = 0;
  for (const grupo of cmp.duplicadosSci) {
    g += 1;
    const ident = grupo[0]?.matchKeyChave || grupo[0]?.matchKeyCnpjDoc || "";
    for (const it of grupo) {
      dup.addRow({
        origem: "SCI",
        grupo: g,
        ident,
        numero: it.documento,
        cnpj: it.cnpjPrestador,
        nome: it.nomePrestador,
        valor: Number(it.valor.toFixed(2)),
        data: it.dataEmissao,
      });
    }
  }
  for (const grupo of cmp.duplicadosPortal) {
    g += 1;
    const ident = grupo[0]?.matchKeyChave || grupo[0]?.matchKeyCnpjDoc || "";
    for (const it of grupo) {
      dup.addRow({
        origem: "Portal Nacional",
        grupo: g,
        ident,
        numero: it.numero,
        cnpj: it.cnpjPrestador,
        nome: it.nomePrestador,
        valor: Number((it.valorLiquido || it.valorServico).toFixed(2)),
        data: it.dataEmissao,
      });
    }
  }
  dup.getColumn("ident").numFmt = "@";
  dup.getColumn("cnpj").numFmt = "@";
  autoWidth(dup);

  await wb.xlsx.writeFile(outputPath);
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (!args.sci || !args.portal || !args.output) {
    emit({ kind: "error", message: "Uso: node cli.mjs --sci <path> --portal <path> --output <path>" });
    process.exit(2);
  }
  try {
    emit({ kind: "progress", value: 5 });
    const sciRows = readSheet(args.sci);
    emit({ kind: "progress", value: 25 });
    const { ativasRows, canceladasRows } = readPortalSheets(args.portal);
    emit({ kind: "progress", value: 50 });

    const sciIdx = indexSci(sciRows);
    const portalAtivasIdx = indexPortal(ativasRows);
    const portalCanceladasIdx = indexPortal(canceladasRows);
    emit({ kind: "progress", value: 70 });

    const cmp = compare(sciIdx, portalAtivasIdx, portalCanceladasIdx);
    emit({ kind: "progress", value: 85 });

    await writeOutput(args.output, sciIdx, portalAtivasIdx, portalCanceladasIdx, cmp);
    emit({ kind: "progress", value: 100 });

    emit({
      kind: "done",
      output: path.resolve(args.output),
      matched: cmp.pairs.length,
      soSci: cmp.soSci.length,
      soPortal: cmp.soPortal.length,
      canceladasNoSci: cmp.canceladasNoSci.length,
      canceladasForaSci: cmp.canceladasForaSci.length,
    });
  } catch (err) {
    emit({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

main();
