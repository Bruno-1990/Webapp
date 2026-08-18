#!/usr/bin/env node
/**
 * Verifica os pontos onde a mesma informação vive em mais de um arquivo e nada
 * mais os compara. Roda junto do `lint` e no CI.
 *
 *   1. SHEET_ORDER (engines/sped/sped_engine/config.py)
 *      == SPED_EXPORT_SHEET_KEYS (packages/contracts) — a API valida contra a
 *      lista TS e o exportador Python produz a lista Python.
 *   2. Toda aba core tem rótulo em SPED_EXPORT_SHEET_LABELS (o frontend usa).
 *   3. cabecalhos_sped.txt == apps/api/src/data/cabecalhos-sped.txt — o guia é
 *      lido pelo Python e servido pela API em /tools/sped/reg-meta.
 *
 * Uso: node scripts/check-sync.mjs   (requer contracts buildado)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");

const CONFIG_PY = path.join(repoRoot, "engines", "sped", "sped_engine", "config.py");
const GUIA_ENGINE = path.join(repoRoot, "engines", "sped", "sped_engine", "cabecalhos_sped.txt");
const GUIA_API = path.join(appRoot, "apps", "api", "src", "data", "cabecalhos-sped.txt");
const CONTRACTS_DIST = path.join(appRoot, "packages", "contracts", "dist", "index.js");

const erros = [];

function lerSheetOrderDoPython(arquivo) {
  const src = fs.readFileSync(arquivo, "utf-8");
  const m = src.match(/^SHEET_ORDER\s*=\s*\[(.*?)\]/ms);
  if (!m) {
    erros.push(`Não achei SHEET_ORDER em ${arquivo} (o formato da lista mudou?)`);
    return null;
  }
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

function normalizar(texto) {
  return texto.replace(/\r\n/g, "\n").replace(/\s+$/, "");
}

// 1 + 2 — lista de abas Python × TypeScript
if (!fs.existsSync(CONTRACTS_DIST)) {
  erros.push(
    `contracts sem build: ${CONTRACTS_DIST}\n     Rode: npm run build -w @webapp/contracts`
  );
} else {
  const { SPED_EXPORT_SHEET_KEYS, SPED_EXPORT_SHEET_LABELS } = await import(
    pathToFileURL(CONTRACTS_DIST).href
  );
  const py = lerSheetOrderDoPython(CONFIG_PY);
  const ts = [...SPED_EXPORT_SHEET_KEYS];

  if (py && py.join(",") !== ts.join(",")) {
    const soPy = py.filter((x) => !ts.includes(x));
    const soTs = ts.filter((x) => !py.includes(x));
    erros.push(
      "Abas do SPED fora de sincronia:\n" +
        `     config.py SHEET_ORDER      : ${py.join(",")}\n` +
        `     contracts SHEET_KEYS       : ${ts.join(",")}\n` +
        (soPy.length ? `     só no Python: ${soPy.join(",")}\n` : "") +
        (soTs.length ? `     só no TypeScript: ${soTs.join(",")}\n` : "") +
        "     Ajuste os dois (checklist em engines/sped/README.md)."
    );
  }

  const semRotulo = ts.filter((k) => !SPED_EXPORT_SHEET_LABELS[k]);
  if (semRotulo.length) {
    erros.push(
      `Abas sem rótulo em SPED_EXPORT_SHEET_LABELS: ${semRotulo.join(",")}\n` +
        "     O frontend mostra o checkbox sem descrição."
    );
  }
}

// 3 — guia de registros duplicado
if (!fs.existsSync(GUIA_API)) {
  erros.push(`Cópia do guia não encontrada: ${GUIA_API}`);
} else if (normalizar(fs.readFileSync(GUIA_ENGINE, "utf-8")) !== normalizar(fs.readFileSync(GUIA_API, "utf-8"))) {
  erros.push(
    "Guia de registros dessincronizado (tooltips da UI vêm da cópia da API):\n" +
      `     engine: ${path.relative(repoRoot, GUIA_ENGINE)}\n` +
      `     api   : ${path.relative(repoRoot, GUIA_API)}\n` +
      `     Copie o do engine por cima do da API.`
  );
}

if (erros.length) {
  console.error("check:sync encontrou problemas:\n");
  for (const e of erros) console.error(`  ✗ ${e}\n`);
  process.exit(1);
}

console.log("check:sync OK — abas do SPED e guia de registros em sincronia.");
