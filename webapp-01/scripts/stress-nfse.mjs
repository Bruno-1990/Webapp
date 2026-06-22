#!/usr/bin/env node
// Stress test do Comparador NFS-e: dispara N jobs paralelos com K arquivos
// fixtures (XMLs e/ou PDFs do engines/comparacao-nfse/tests/fixtures, repetidos), mede tempo
// total, sucesso/falha por job, e checa estado do circuit breaker.
//
// Uso:
//   node scripts/stress-nfse.mjs [--jobs 10] [--xmls 100] [--pdfs 0] [--api http://127.0.0.1:8000]
//
// Pre-requisitos:
//   - Stack rodando (API + worker NFS-e + Redis)
//   - Fixtures em ../engines/comparacao-nfse/tests/fixtures/*.xml

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = {
    jobs: 10,
    xmls: 100,
    pdfs: 0,
    api: "http://127.0.0.1:8000",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--jobs") opts.jobs = parseInt(argv[++i], 10);
    else if (a === "--xmls") opts.xmls = parseInt(argv[++i], 10);
    else if (a === "--pdfs") opts.pdfs = parseInt(argv[++i], 10);
    else if (a === "--api") opts.api = argv[++i];
  }
  return opts;
}

const opts = parseArgs(process.argv);
const FIX_DIR = path.resolve(__dirname, "../../engines/comparacao-nfse/tests/fixtures");

function loadXmlFixtures() {
  if (!fs.existsSync(FIX_DIR)) {
    console.error(`Fixtures não encontradas em ${FIX_DIR}`);
    process.exit(1);
  }
  return fs
    .readdirSync(FIX_DIR)
    .filter((f) => f.endsWith(".xml") && !f.includes("malformado"))
    .map((f) => ({ name: f, bytes: fs.readFileSync(path.join(FIX_DIR, f)) }));
}

const xmlFixtures = loadXmlFixtures();
if (xmlFixtures.length === 0) {
  console.error("Sem fixtures XML disponiveis.");
  process.exit(1);
}

async function postFormData(url, formData) {
  const res = await fetch(url, { method: "POST", body: formData });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`POST ${url} -> ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function runJob(jobIdx) {
  const t0 = Date.now();
  const { id } = await postFormData(`${opts.api}/api/v1/tools/comparacao-nfse/jobs`, new FormData());

  // Envia XMLs (em chunks de 20)
  for (let i = 0; i < opts.xmls; i += 20) {
    const fd = new FormData();
    for (let k = i; k < Math.min(i + 20, opts.xmls); k++) {
      const fix = xmlFixtures[k % xmlFixtures.length];
      fd.append("xmls", new Blob([fix.bytes], { type: "application/xml" }), `j${jobIdx}_${k}_${fix.name}`);
    }
    await postFormData(`${opts.api}/api/v1/tools/comparacao-nfse/jobs/${id}/chunk`, fd);
  }
  // (pdfs ficaria similar; pulando aqui — sem fixtures PDF binarias)

  const startRes = await fetch(`${opts.api}/api/v1/tools/comparacao-nfse/jobs/${id}/start`, {
    method: "POST",
  });
  if (!startRes.ok) {
    const body = await startRes.json().catch(() => ({}));
    return {
      jobIdx,
      id,
      ok: false,
      reason: body.error ?? `start failed ${startRes.status}`,
      failureKind: body.failureKind,
      ms: Date.now() - t0,
    };
  }

  // Polling
  for (let attempt = 0; attempt < 600; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    const r = await fetch(`${opts.api}/api/v1/tools/comparacao-nfse/jobs/${id}`);
    if (!r.ok) continue;
    const data = await r.json();
    if (data.status === "done") {
      return {
        jobIdx,
        id,
        ok: true,
        matched: data.result?.matchedCount ?? 0,
        soXml: data.result?.soXml?.length ?? 0,
        failureKind: data.result?.failureKind,
        ms: Date.now() - t0,
      };
    }
    if (data.status === "failed") {
      return { jobIdx, id, ok: false, reason: data.error, ms: Date.now() - t0 };
    }
    if (data.status === "not_found") {
      return { jobIdx, id, ok: false, reason: "not_found", ms: Date.now() - t0 };
    }
  }
  return { jobIdx, id, ok: false, reason: "timeout 10min", ms: Date.now() - t0 };
}

async function main() {
  console.log(`> Health check: ${opts.api}/api/v1/tools/comparacao-nfse/health`);
  try {
    const h = await fetch(`${opts.api}/api/v1/tools/comparacao-nfse/health`);
    const hj = await h.json();
    console.log(`  geminiAvailable=${hj.geminiAvailable}, queueDepth=${hj.queueDepth}`);
  } catch (e) {
    console.warn(`  (health falhou: ${e.message})`);
  }

  console.log(`> Disparando ${opts.jobs} jobs paralelos com ${opts.xmls} XMLs cada...`);
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: opts.jobs }, (_, i) => runJob(i)),
  );
  const totalMs = Date.now() - t0;

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const quotaFailed = results.filter((r) => r.failureKind === "quota");
  const avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);
  const maxMs = Math.max(...results.map((r) => r.ms));

  console.log(`\n> Resultado em ${(totalMs / 1000).toFixed(1)}s:`);
  console.log(`  ok=${ok.length}/${opts.jobs}, failed=${failed.length}, quota=${quotaFailed.length}`);
  console.log(`  job avg=${avgMs}ms, max=${maxMs}ms`);
  if (failed.length > 0) {
    console.log(`\n> Falhas:`);
    for (const f of failed) console.log(`  job#${f.jobIdx} ${f.id?.slice(0, 8)}: ${f.reason}`);
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
