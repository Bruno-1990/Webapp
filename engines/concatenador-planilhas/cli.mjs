#!/usr/bin/env node
// Concatenador de Planilhas — engine standalone Node.js.
// Recebe N planilhas com o MESMO layout, ordena pela coluna "#" e emenda tudo
// numa planilha só: o 1º arquivo entra inteiro (título + cabeçalho + dados) e
// dos seguintes só as linhas de dados. Sem linhas em branco entre os blocos.
//
// Protocolo stdout (cada linha = 1 evento JSON):
//   {"kind":"progress","value":<0..100>}
//   {"kind":"done","output":"<path>","arquivos":N,"linhas":N,"avisos":[...]}
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
  const out = { inputs: [], output: null };
  let mode = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input" || a === "--inputs") {
      mode = "input";
      continue;
    }
    if (a === "--output") {
      mode = "output";
      continue;
    }
    if (a.startsWith("--")) {
      mode = null;
      continue;
    }
    if (mode === "input") out.inputs.push(a);
    else if (mode === "output") {
      out.output = a;
      mode = null;
    }
  }
  return out;
}

// ── Normalização ─────────────────────────────────────────────────────────

/** Compara cabeçalhos ignorando acento, caixa e espaço repetido. */
function normalizeHeader(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/�/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isBlank(v) {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function isBlankRow(row) {
  return !Array.isArray(row) || row.every(isBlank);
}

/** Ordem natural do nome do arquivo ("f2" antes de "f10"); fallback de ordenação. */
function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
}

// ── Leitura ──────────────────────────────────────────────────────────────

/** Índice do cabeçalho = 1ª linha com 2+ células preenchidas.
 *  Cobre exports com linha de título isolada ("NFEs Emitidas" em A1). */
function findHeaderRow(aoa) {
  const limit = Math.min(aoa.length, 30);
  for (let i = 0; i < limit; i++) {
    const nonEmpty = (aoa[i] ?? []).filter((c) => !isBlank(c)).length;
    if (nonEmpty >= 2) return i;
  }
  return -1;
}

/** Lê a 1ª aba do arquivo e separa preâmbulo / cabeçalho / linhas de dados. */
function readSheet(filePath) {
  const nome = path.basename(filePath);
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer", codepage: 1252, cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error(`${nome}: arquivo sem abas.`);
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`${nome}: aba "${sheetName}" vazia.`);

  const aoa = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    raw: true,
    blankrows: true,
  });

  const headerIdx = findHeaderRow(aoa);
  if (headerIdx < 0) throw new Error(`${nome}: não encontrei a linha de cabeçalho.`);

  const header = (aoa[headerIdx] ?? []).map((c) => (isBlank(c) ? "" : c));
  // Descarta colunas-fantasma à direita (células vazias fora do intervalo útil).
  while (header.length > 0 && isBlank(header[header.length - 1])) header.pop();
  if (header.length === 0) throw new Error(`${nome}: cabeçalho sem colunas.`);

  const preamble = aoa.slice(0, headerIdx);
  const brutas = aoa.slice(headerIdx + 1);
  const rows = brutas.filter((r) => !isBlankRow(r));

  // Nada do que a leitura descarta pode sumir calado — cada item vira aviso.
  const abasIgnoradas = wb.SheetNames.slice(1);
  const linhasBrancas = brutas.length - rows.length;
  let celulasForaDoCabecalho = 0;
  let linhasForaDoCabecalho = 0;
  for (const r of rows) {
    let extras = 0;
    for (let c = header.length; c < r.length; c++) {
      if (!isBlank(r[c])) extras++;
    }
    if (extras > 0) {
      celulasForaDoCabecalho += extras;
      linhasForaDoCabecalho++;
    }
  }

  return {
    nome,
    sheetName,
    preamble,
    header,
    rows,
    abasIgnoradas,
    linhasBrancas,
    celulasForaDoCabecalho,
    linhasForaDoCabecalho,
  };
}

// ── Alinhamento de colunas ───────────────────────────────────────────────

/** Reordena as linhas de `sheet` para a ordem de colunas de `canonHeader`.
 *  Cabeçalho divergente é erro — emendar colunas trocadas corrompe a planilha. */
function alignToCanonical(sheet, canonHeader, canonNorm, canonNome) {
  const norm = sheet.header.map(normalizeHeader);

  const faltando = canonNorm.filter((h) => !norm.includes(h));
  const sobrando = norm.filter((h) => !canonNorm.includes(h));
  if (faltando.length > 0 || sobrando.length > 0) {
    // A API trunca `failedReason` em 500 chars — resumir mantém a mensagem útil
    // mesmo quando os dois relatórios não têm nenhuma coluna em comum.
    const resumir = (lista) => {
      const amostra = lista.slice(0, 4).join(", ");
      return lista.length > 4 ? `${amostra} (+${lista.length - 4})` : amostra;
    };
    const detalhe = [
      faltando.length ? `faltam ${faltando.length}: ${resumir(faltando)}` : "",
      sobrando.length ? `sobram ${sobrando.length}: ${resumir(sobrando)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    throw new Error(
      `Cabeçalho de "${sheet.nome}" não bate com o de "${canonNome}" (${detalhe}). ` +
        `Concatene apenas planilhas do mesmo relatório.`,
    );
  }

  // Mesma ordem de colunas: reaproveita as linhas sem remapear (caso comum).
  const mesmaOrdem =
    norm.length === canonNorm.length && norm.every((h, i) => h === canonNorm[i]);

  const normalizeRow = (row) => {
    const out = new Array(canonHeader.length);
    for (let c = 0; c < canonHeader.length; c++) {
      const v = row[c];
      out[c] = isBlank(v) ? "" : v;
    }
    return out;
  };

  if (mesmaOrdem) return sheet.rows.map(normalizeRow);

  const posDe = new Map();
  norm.forEach((h, i) => {
    if (!posDe.has(h)) posDe.set(h, i);
  });
  return sheet.rows.map((row) => {
    const out = new Array(canonHeader.length);
    for (let c = 0; c < canonHeader.length; c++) {
      const src = posDe.get(canonNorm[c]);
      const v = src === undefined ? "" : row[src];
      out[c] = isBlank(v) ? "" : v;
    }
    return out;
  });
}

// ── Ordenação pela coluna "#" ────────────────────────────────────────────

function asSeq(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Coluna de sequência: "#" (padrão dos exports SEFAZ) ou variações comuns. */
function findSeqColumn(canonNorm) {
  const alvos = ["#", "no", "n", "num", "numero", "seq", "sequencia", "item", "linha"];
  for (const alvo of alvos) {
    const i = canonNorm.indexOf(alvo);
    if (i >= 0) return i;
  }
  return -1;
}

/** Menor "#" do bloco — define a posição do arquivo na sequência final. */
function primeiroSeq(rows, seqCol) {
  if (seqCol < 0) return null;
  let min = null;
  for (const r of rows) {
    const n = asSeq(r[seqCol]);
    if (n === null) continue;
    if (min === null || n < min) min = n;
  }
  return min;
}

/** Ordena os blocos pela coluna "#"; se algum bloco não tiver "#" numérico,
 *  todos caem para a ordem natural do nome do arquivo. */
function ordenarBlocos(blocos, seqCol) {
  const comSeq = blocos.map((b) => ({ ...b, seq: primeiroSeq(b.rows, seqCol) }));
  const todosTemSeq = comSeq.every((b) => b.seq !== null);
  if (!todosTemSeq) {
    return {
      ordenados: [...comSeq].sort((a, b) => naturalCompare(a.nome, b.nome)),
      criterio: "nome do arquivo",
    };
  }
  return {
    ordenados: [...comSeq].sort((a, b) => a.seq - b.seq || naturalCompare(a.nome, b.nome)),
    criterio: "coluna #",
  };
}

/** Audita o "#" do resultado final. A planilha é entregue de qualquer forma —
 *  os avisos vão junto para quem for conferir.
 *  Cada aviso é {titulo, detalhe, dica, severidade} para a UI hierarquizar. */
function auditarSequencia(rows, seqCol) {
  const avisos = [];
  if (seqCol < 0) {
    avisos.push({
      titulo: 'Coluna "#" não encontrada',
      dica:
        "Os blocos foram emendados na ordem do nome do arquivo e não deu para conferir " +
        "se a sequência ficou contínua.",
      severidade: "alerta",
    });
    return avisos;
  }

  const vistos = new Set();
  const duplicados = new Set();
  let anterior = null;
  let saltos = 0;
  let regressoes = 0;
  const exemplos = [];
  let semNumero = 0;

  for (const r of rows) {
    const n = asSeq(r[seqCol]);
    if (n === null) {
      semNumero++;
      continue;
    }
    if (vistos.has(n)) duplicados.add(n);
    vistos.add(n);
    if (anterior !== null && n !== anterior + 1) {
      if (n < anterior) regressoes++;
      else saltos++;
      if (exemplos.length < 5) exemplos.push(`${anterior} → ${n}`);
    }
    anterior = n;
  }

  const quebras = saltos + regressoes;
  if (quebras > 0) {
    const reticencias = quebras > exemplos.length ? " · …" : "";
    avisos.push({
      titulo: `Quebra de sequência na coluna "#"`,
      detalhe: `${quebras} ${quebras === 1 ? "ocorrência" : "ocorrências"} · ${exemplos.join(" · ")}${reticencias}`,
      dica:
        saltos > 0 && regressoes === 0
          ? "Pode faltar alguma parte do relatório entre as planilhas enviadas."
          : "Confira se todas as partes foram enviadas e se nenhuma se sobrepõe.",
      severidade: "alerta",
    });
  }
  if (duplicados.size > 0) {
    const amostra = [...duplicados].slice(0, 5).join(" · ");
    const reticencias = duplicados.size > 5 ? " · …" : "";
    avisos.push({
      titulo: `Valores repetidos na coluna "#"`,
      detalhe: `${duplicados.size} ${duplicados.size === 1 ? "valor" : "valores"} · ${amostra}${reticencias}`,
      dica: "Provável sobreposição entre os arquivos enviados.",
      severidade: "alerta",
    });
  }
  if (semNumero > 0) {
    avisos.push({
      titulo: `Linhas sem número na coluna "#"`,
      detalhe: `${semNumero} ${semNumero === 1 ? "linha" : "linhas"}`,
      dica: "Ficaram fora da conferência de sequência.",
      severidade: "info",
    });
  }
  return avisos;
}

// ── Escrita XLSX ─────────────────────────────────────────────────────────

// Tokens do padrão único de exportação (docs/EXPORT-STANDARD.md).
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
/** Acima disso, nada de altura/borda por célula (docs/EXPORT-STANDARD.md §5). */
const LARGE_SHEET_MIN_ROWS = 2500;

/** Largura por coluna medida no array em memória — não toca nas células. */
function columnWidth(header, rows, i) {
  let max = String(header ?? "").length;
  for (const row of rows) {
    const v = row[i];
    if (isBlank(v)) continue;
    const len = String(v).length;
    if (len > max) max = len;
  }
  return Math.min(60, Math.max(10, max + 2));
}

/** Coluna majoritariamente textual (chave de acesso, CNPJ com zero à esquerda):
 *  formato "@" impede o Excel de exibir em notação científica. */
function isTextColumn(rows, i) {
  let texto = 0;
  let total = 0;
  for (const row of rows.slice(0, 500)) {
    const v = row[i];
    if (isBlank(v)) continue;
    total++;
    if (typeof v === "string") texto++;
  }
  return total > 0 && texto / total >= 0.5;
}

async function writeOutput(outputPath, sheetName, preamble, header, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Concatenador de Planilhas";
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName || "Consolidado");

  // Preâmbulo do 1º arquivo (ex.: "NFEs Emitidas" em A1), preservado como veio.
  for (const linha of preamble) {
    ws.addRow((linha ?? []).map((v) => (isBlank(v) ? "" : v)));
  }

  const headerRow = ws.addRow(header);
  for (const r of rows) ws.addRow(r);

  // Estilo por COLUNA primeiro: em ExcelJS isso escreve em cada célula existente,
  // então precisa vir antes do cabeçalho para não sobrescrevê-lo.
  for (let c = 0; c < header.length; c++) {
    const col = ws.getColumn(c + 1);
    col.font = DATA_FONT;
    col.alignment = ALIGN;
    col.width = columnWidth(header[c], rows, c);
    if (isTextColumn(rows, c)) col.numFmt = "@";
  }

  for (const linha of preamble.keys()) {
    ws.getRow(linha + 1).font = { ...DATA_FONT, bold: true, color: { argb: "FF183844" } };
  }

  headerRow.height = HEADER_HEIGHT;
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = ALIGN;
    cell.border = THIN_BORDER;
  });

  // Planilha pequena: altura e borda por linha. Grande, não — §5 do padrão.
  if (rows.length <= LARGE_SHEET_MIN_ROWS) {
    for (let r = headerRow.number + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      row.height = ROW_HEIGHT;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = THIN_BORDER;
      });
    }
  }

  ws.views = [{ showGridLines: false, state: "frozen", ySplit: headerRow.number }];

  await wb.xlsx.writeFile(outputPath);
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (args.inputs.length === 0 || !args.output) {
    emit({
      kind: "error",
      message: "Uso: node cli.mjs --input <p1> <p2> ... --output <path>",
    });
    process.exit(2);
  }

  try {
    emit({ kind: "progress", value: 3 });

    // 1. Lê todos os arquivos (0 → 60%).
    const lidos = [];
    for (let i = 0; i < args.inputs.length; i++) {
      lidos.push(readSheet(args.inputs[i]));
      emit({ kind: "progress", value: 3 + Math.round(((i + 1) / args.inputs.length) * 57) });
    }

    // 2. O 1º arquivo (em ordem natural de nome) define o layout canônico. A
    //    ordem final vem da coluna "#" — mas o cabeçalho tem de bater em todos.
    const base = [...lidos].sort((a, b) => naturalCompare(a.nome, b.nome))[0];
    const canonHeader = base.header;
    const canonNorm = canonHeader.map(normalizeHeader);

    const blocos = lidos.map((s) => ({
      nome: s.nome,
      preamble: s.preamble,
      sheetName: s.sheetName,
      rows: alignToCanonical(s, canonHeader, canonNorm, base.nome),
    }));
    emit({ kind: "progress", value: 70 });

    // Tudo o que a leitura descartou vira aviso — nenhum corte fica calado.
    const avisosLeitura = [];
    for (const s of lidos) {
      if (s.abasIgnoradas.length > 0) {
        avisosLeitura.push({
          titulo: "Abas ignoradas",
          detalhe: `${s.nome} · li só "${s.sheetName}" · fora: ${s.abasIgnoradas.join(", ")}`,
          dica: "O concatenador lê apenas a primeira aba de cada arquivo.",
          severidade: "alerta",
        });
      }
      if (s.celulasForaDoCabecalho > 0) {
        avisosLeitura.push({
          titulo: "Células fora do cabeçalho",
          detalhe: `${s.nome} · ${s.celulasForaDoCabecalho} ${s.celulasForaDoCabecalho === 1 ? "célula" : "células"} em ${s.linhasForaDoCabecalho} ${s.linhasForaDoCabecalho === 1 ? "linha" : "linhas"}`,
          dica: "Estavam à direita da última coluna do cabeçalho e não entraram no resultado.",
          severidade: "alerta",
        });
      }
    }
    const totalBrancas = lidos.reduce((s, x) => s + x.linhasBrancas, 0);
    if (totalBrancas > 0) {
      avisosLeitura.push({
        titulo: "Linhas em branco descartadas",
        detalhe: `${totalBrancas} ${totalBrancas === 1 ? "linha" : "linhas"}`,
        dica: "Removidas para a sequência não ficar com buracos.",
        severidade: "info",
      });
    }

    // 3. Ordena os blocos e emenda tudo, sem linha em branco entre eles.
    const seqCol = findSeqColumn(canonNorm);
    const { ordenados, criterio } = ordenarBlocos(blocos, seqCol);

    const rows = [];
    for (const b of ordenados) rows.push(...b.rows);
    emit({ kind: "progress", value: 80 });

    if (rows.length === 0) {
      throw new Error("Nenhuma linha de dados encontrada nas planilhas enviadas.");
    }

    const avisos = [...avisosLeitura];
    // Ordenar pelo nome do arquivo é um fallback, não o comportamento normal:
    // quem receber a planilha precisa saber que a ordem não veio do "#".
    if (criterio !== "coluna #" && seqCol >= 0) {
      avisos.push({
        titulo: "Ordem definida pelo nome do arquivo",
        detalhe: ordenados.map((b) => b.nome).join(" → "),
        dica: 'A coluna "#" não trouxe números utilizáveis. Confira a sequência.',
        severidade: "alerta",
      });
    }
    avisos.push(...auditarSequencia(rows, seqCol));

    // Cabeçalho e título saem do 1º bloco da ordem final.
    const primeiro = ordenados[0];
    await writeOutput(
      args.output,
      primeiro.sheetName,
      primeiro.preamble,
      canonHeader,
      rows,
    );
    emit({ kind: "progress", value: 100 });

    emit({
      kind: "done",
      output: path.resolve(args.output),
      arquivos: ordenados.length,
      linhas: rows.length,
      ordem: ordenados.map((b) => b.nome),
      criterio,
      avisos,
    });
  } catch (err) {
    emit({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

main();
