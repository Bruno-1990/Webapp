import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import * as readline from "node:readline";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  COMPARACAO_NFSE_QUEUE_NAME,
  type ComparacaoNfseJobPayload,
  type ComparacaoNfseResult,
  type NfseFailureKind,
} from "@webapp/contracts";
import { loadEnv } from "./env.js";
import { applyEvent, emptyRunState, parseStdoutLine } from "./parser.js";

const env = loadEnv();

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  connectTimeout: 5_000,
});

const logger = {
  info: (...a: unknown[]) => console.log("[worker-nfse]", ...a),
  error: (...a: unknown[]) => console.error("[worker-nfse]", ...a),
};

function absolutizeJobPath(filePath: string): string {
  const norm = path.normalize(filePath);
  if (path.isAbsolute(norm)) return norm;
  const rel = norm.replace(/^\.\//, "");
  const m = rel.match(/^temp_jobs[/\\](.+)$/i);
  if (m) {
    return path.join(env.TEMP_JOBS_ROOT, m[1]);
  }
  return path.resolve(process.cwd(), rel);
}

type RunOutcome = {
  result: ComparacaoNfseResult | null;
  failureKind: NfseFailureKind | null;
  retryAfterSec: number | null;
};

function runNfseCli(
  job: { updateProgress: (n: number) => Promise<void> },
  data: ComparacaoNfseJobPayload,
): Promise<RunOutcome> {
  return new Promise((resolve, reject) => {
    const pdfsDir = absolutizeJobPath(data.pdfsDir);
    const xmlsDir = absolutizeJobPath(data.xmlsDir);
    const outputXlsx = absolutizeJobPath(data.outputXlsx);
    const outputJson = absolutizeJobPath(data.outputJson);
    const cwd = env.COMPARACAO_NFSE_PY_DIR;
    const cliPath = path.join(cwd, "cli.py");
    const cmd = env.PYTHON_CMD.trim();
    const base = path.basename(cmd).replace(/\.exe$/i, "").toLowerCase();
    const args: string[] = base === "py" ? ["-3", cliPath] : [cliPath];

    args.push(
      "--pdfs-dir",
      pdfsDir,
      "--xmls-dir",
      xmlsDir,
      "--output-xlsx",
      outputXlsx,
      "--output-json",
      outputJson,
    );

    /** Repassamos REDIS_URL e knobs do governor para o Python. Sem REDIS_URL, o
     * CLI roda em modo single-process (sem coordenacao entre workers). */
    const childEnv = { ...process.env };
    if (env.GEMINI_API_KEY) childEnv.GEMINI_API_KEY = env.GEMINI_API_KEY;
    childEnv.REDIS_URL = env.REDIS_URL;
    childEnv.NFSE_GEMINI_RPM = String(env.NFSE_GEMINI_RPM);
    childEnv.NFSE_CIRCUIT_COOLDOWN_SEC = String(env.NFSE_CIRCUIT_COOLDOWN_SEC);

    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: childEnv,
    });

    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

    const state = emptyRunState();

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      const event = parseStdoutLine(line);
      if (event) {
        applyEvent(state, event, (v) => {
          void job.updateProgress(v);
        });
      }
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      rl.close();

      // failed_quota: codigo de saida 2 do CLI; tratamos como sucesso do worker
      // mas com failureKind para o frontend mostrar modal especifico.
      if (state.failureKind === "quota") {
        resolve({ result: null, failureKind: "quota", retryAfterSec: state.retryAfterSec });
        return;
      }

      if (state.jsonError) {
        reject(new Error(state.jsonError));
        return;
      }
      if (code === 0) {
        resolve({ result: state.doneResult, failureKind: null, retryAfterSec: null });
        return;
      }
      const errText = Buffer.concat(stderrChunks).toString("utf-8").trim().slice(0, 800);
      reject(
        new Error(
          errText
            ? `Python saiu com codigo ${code}: ${errText}`
            : `Python saiu com codigo ${code}`,
        ),
      );
    });
  });
}

new Worker<ComparacaoNfseJobPayload>(
  COMPARACAO_NFSE_QUEUE_NAME,
  async (job) => {
    const outputXlsx = absolutizeJobPath(job.data.outputXlsx);
    await job.updateProgress(1);
    const outcome = await runNfseCli(job, job.data);
    await job.updateProgress(100);

    // Quando o job foi abortado por quota (circuit aberto pre-job), nao temos
    // result completo — so o failureKind. Frontend usa isso pra mostrar modal.
    const finalResult: ComparacaoNfseResult | null =
      outcome.result ??
      (outcome.failureKind
        ? {
            soPdf: [],
            soXml: [],
            matchedCount: 0,
            failureKind: outcome.failureKind,
            retryAfterSec: outcome.retryAfterSec ?? undefined,
          }
        : null);

    // Nome amigavel para download (com razao social do tomador + data/hora).
    // O CLI Python coloca em result.outputName; se ausente, cai no path em disco.
    const friendlyName =
      (finalResult as ComparacaoNfseResult & { outputName?: string } | null)?.outputName ??
      path.basename(outputXlsx);

    return {
      fileName: friendlyName,
      result: finalResult,
      hasXlsx: outcome.failureKind ? false : fs.existsSync(outputXlsx),
    };
  },
  {
    connection,
    concurrency: env.NFSE_WORKER_CONCURRENCY,
  },
).on("failed", (j, err) => {
  logger.error("job failed", j?.id, err?.message);
});

if (!env.GEMINI_API_KEY) {
  logger.info(
    `Worker Comparacao NFS-e iniciado SEM GEMINI_API_KEY — apenas XMLs serao processados. Defina a variavel para habilitar OCR de PDFs.`,
  );
}
logger.info(
  `Worker Comparacao NFS-e ouvindo fila ${COMPARACAO_NFSE_QUEUE_NAME} ` +
    `(Python: ${env.COMPARACAO_NFSE_PY_DIR}, concurrency=${env.NFSE_WORKER_CONCURRENCY}, ` +
    `RPM=${env.NFSE_GEMINI_RPM}, cooldown=${env.NFSE_CIRCUIT_COOLDOWN_SEC}s)`,
);
