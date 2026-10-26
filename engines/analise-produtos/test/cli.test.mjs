// Testes de ponta a ponta da engine: roda o cli.mjs de verdade sobre fixtures
// no formato do SCI (';', cp1252, códigos como ="50") e lê o XLSX gerado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "cli.mjs");

function run(input) {
  const dir = mkdtempSync(path.join(tmpdir(), "analise-produtos-"));
  const output = path.join(dir, "saida.xlsx");
  const r = spawnSync(process.execPath, [cli, "--input", input, "--output", output, "--nome", path.basename(input)], {
    encoding: "utf-8",
  });
  const eventos = r.stdout
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l));
  return { status: r.status, eventos, output, limpar: () => rmSync(dir, { recursive: true, force: true }) };
}

async function lerAba(output, nome) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(output);
  const ws = wb.getWorksheet(nome);
  const header = ws.getRow(1).values.slice(1);
  const linhas = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values.slice(1);
    linhas.push(Object.fromEntries(header.map((h, i) => [h, vals[i] ?? null])));
  }
  return { ws, header, linhas, wb };
}

test("classifica, limpa os códigos e aponta CST incoerente", async (t) => {
  const r = run(path.join(here, "fixture-sci.csv"));
  t.after(r.limpar);
  assert.equal(r.status, 0, JSON.stringify(r.eventos));
  const done = r.eventos.find((e) => e.kind === "done");
  assert.equal(done.linhas, 8);
  assert.equal(done.corrigir, 1);

  const { linhas, header } = await lerAba(r.output, "Produtos");
  assert.ok(!header.includes("Coluna inútil"), "coluna fora do layout não pode passar");
  assert.ok(!header.includes("Empresa"));
  const porNf = Object.fromEntries(linhas.map((l) => [l["Nº NF."], l]));

  // Pneu comprado para revenda com CST 50: monofásico, CST a revisar.
  assert.equal(porNf["10"]["Monofásico"], "Sim");
  assert.equal(porNf["10"]["Categoria"], "Pneus e camaras de ar");
  assert.equal(porNf["10"]["CST PIS"], "50", 'o ="50" do SCI tem de virar 50');
  assert.equal(porNf["10"]["Situação"], "Corrigir CST");
  assert.equal(porNf["10"]["CST esperado"], "70 ou 73");
  assert.match(porNf["10"]["Observação"], /^CST 50 indica crédito/);
  assert.equal(porNf["10"]["Valor do produto"], 1234.56);
  assert.equal(porNf["10"]["Quantidade"], 2);
  assert.ok(porNf["10"]["Data"] instanceof Date);

  // 3004.90.46 é exceção expressa da Lei 10.147: não entra.
  assert.equal(porNf["11"]["Monofásico"], "Não");

  // Saída de autopeça com CST 04: correta.
  assert.equal(porNf["12"]["Monofásico"], "Sim");
  assert.equal(porNf["12"]["Situação"], "OK");
  assert.equal(porNf["12"]["CST esperado"], "04");

  // Refrigerante saindo com CST 01: depende do perfil (atacadista).
  assert.equal(porNf["13"]["Categoria"], "Bebidas frias");
  assert.equal(porNf["13"]["Situação"], "Conferir perfil");
  assert.match(porNf["13"]["Observação"], /atacadista/);

  // Anexo II depende da destinação; entrada de uso e consumo não é revenda.
  assert.equal(porNf["14"]["Monofásico"], "Depende");
  assert.equal(porNf["14"]["Situação"], "Uso e consumo");
  assert.match(porNf["14"]["O que conferir"], /uso geral/);

  // Frete sem NCM fica fora da consulta, sem quebrar.
  assert.equal(porNf["15"]["Monofásico"], "Sem NCM");
  assert.equal(porNf["15"]["Situação"], "Sem NCM");

  // Item comum fora da base.
  assert.equal(porNf["16"]["Monofásico"], "Não");
  assert.equal(porNf["16"]["Observação"], null);
  assert.equal(porNf["16"]["Situação"], null);

  // Peça avulsa de máquina da 84.36: o art. 1º fala em máquinas e implementos.
  assert.equal(porNf["17"]["Monofásico"], "Depende");
  assert.equal(porNf["17"]["Situação"], "Confirmar condição");
  assert.match(porNf["17"]["O que conferir"], /peca avulsa/);

  // Monofásicos em ordem de prioridade: corrigir, conferir, OK, uso e consumo.
  const mono = await lerAba(r.output, "Monofásicos");
  assert.deepEqual(
    mono.linhas.map((l) => l["Nº NF."]),
    ["10", "17", "13", "12", "14"],
  );

  // Veredito primeiro: as 3 colunas de identificação ficam congeladas.
  assert.deepEqual(header.slice(0, 4), ["Nº NF.", "Descrição", "NCM", "Situação"]);

  // Resumo por ação, com o aviso de arquivo só de entradas ausente (há saídas).
  const resumo = await lerAba(r.output, "Resumo");
  const corrigir = resumo.linhas.find((l) => l["Item"] === "Corrigir CST");
  assert.equal(corrigir["Linhas"], 1);
  assert.equal(corrigir["Valor dos produtos"], 1234.56);
  assert.ok(!resumo.linhas.some((l) => l["Item"] === "Atenção"));
});

test("segue o padrão de exportação (docs/EXPORT-STANDARD.md)", async (t) => {
  const r = run(path.join(here, "fixture-sci.csv"));
  t.after(r.limpar);
  const { wb } = await lerAba(r.output, "Produtos");
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    ["Resumo", "Produtos", "Monofásicos", "Resumo por NCM"],
  );
  for (const ws of wb.worksheets) {
    const h = ws.getRow(1).getCell(1);
    assert.equal(h.fill.fgColor.argb, "FF4169E1", ws.name);
    assert.equal(h.font.bold, true);
    assert.equal(h.font.name, "Calibri");
    assert.equal(ws.getRow(1).height, 30);
    // Resumo cresce a altura para caber o texto de "O que fazer" (quebra de linha).
    if (ws.name === "Resumo") assert.ok(ws.getRow(2).height >= 22);
    else assert.equal(ws.getRow(2).height, 22);
    assert.equal(ws.getRow(2).getCell(1).border.top.color.argb, "FFCECECE");
    assert.equal(ws.views[0].state, "frozen");
    if (ws.name !== "Resumo") assert.ok(ws.autoFilter, `${ws.name} sem filtro`);
    assert.equal(ws.views[0].showGridLines, false);
  }
});

test("arquivo sem coluna NCM dá erro claro", () => {
  const r = run(path.join(here, "fixture-sem-ncm.csv"));
  r.limpar();
  assert.notEqual(r.status, 0);
  const err = r.eventos.find((e) => e.kind === "error");
  assert.match(err.message, /coluna NCM/);
});
