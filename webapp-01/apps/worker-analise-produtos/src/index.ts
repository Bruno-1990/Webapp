import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  ANALISE_PRODUTOS_QUEUE_NAME,
  type AnaliseProdutosJobPayload,
  type AnaliseProdutosResultado,
} from "@webapp/contracts";
import { loadEnv } from "./env.js";

const env = loadEnv();

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  connectTimeout: 5_000,
});

const logger = {
  info: (...a: unknown[]) => console.log("[worker-analise-produtos]", ...a),
  error: (...a: unknown[]) => console.error("[worker-analise-produtos]", ...a),
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

/** Roda o engine standalone (engines/analise-produtos/cli.mjs) consumindo eventos JSON do stdout. */
function runCli(
  job: { updateProgress: (n: number) => Promise<void> },
  data: AnaliseProdutosJobPayload,
): Promise<AnaliseProdutosResultado> {
  return new Promise((resolve, reject) => {
    const inputPath = absolutizeJobPath(data.inputPath);
    const outputPath = absolutizeJobPath(data.outputPath);
    const cwd = env.ANALISE_PRODUTOS_DIR;
    const cliPath = path.join(cwd, "cli.mjs");

    // Erro claro se a engine não estiver no lugar (ex.: imagem Docker sem o
    // engines/analise-produtos). Sem isso, spawn falha com ENOENT opaco.
    if (!fs.existsSync(cliPath)) {
      reject(
        new Error(
          `Engine não encontrada em ${cliPath} (ANALISE_PRODUTOS_DIR=${cwd}). ` +
            `Reconstrua a imagem: docker compose --profile comparacao build worker-analise-produtos.`,
        ),
      );
      return;
    }

    const args = [cliPath, "--input", inputPath, "--output", outputPath, "--nome", data.originalName];

    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

    let jsonError: Error | null = null;
    let doneEvent: AnaliseProdutosResultado = {};

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        const o = JSON.parse(trimmed) as {
          kind?: string;
          value?: number;
          message?: string;
        } & AnaliseProdutosResultado;
        if (o.kind === "progress" && typeof o.value === "number") {
          void job.updateProgress(o.value);
        }
        if (o.kind === "error" && typeof o.message === "string") {
          jsonError = new Error(o.message);
        }
        if (o.kind === "done") {
          doneEvent = {
            linhas: o.linhas,
            monofasicos: o.monofasicos,
            depende: o.depende,
            corrigir: o.corrigir,
            confirmar: o.confirmar,
            baseVersao: o.baseVersao,
          };
        }
      } catch {
        /* ignore linhas mal-formadas */
      }
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      rl.close();
      if (jsonError) {
        reject(jsonError);
        return;
      }
      if (code === 0) {
        resolve(doneEvent);
        return;
      }
      const errText = Buffer.concat(stderrChunks).toString("utf-8").trim().slice(0, 800);
      reject(
        new Error(
          errText
            ? `Engine saiu com código ${code}: ${errText}`
            : `Engine saiu com código ${code}`,
        ),
      );
    });
  });
}

new Worker<AnaliseProdutosJobPayload>(
  ANALISE_PRODUTOS_QUEUE_NAME,
  async (job) => {
    const outputPath = absolutizeJobPath(job.data.outputPath);
    await job.updateProgress(1);
    const done = await runCli(job, job.data);
    await job.updateProgress(100);

    logger.info(
      `job ${job.id}: ${done.linhas ?? "?"} linha(s), ${done.monofasicos ?? "?"} monofásica(s), ` +
        `${done.depende ?? "?"} dependendo de condição, ${done.corrigir ?? "?"} a corrigir e ${done.confirmar ?? "?"} a confirmar (base ${done.baseVersao ?? "?"})`,
    );

    return {
      fileName: path.basename(outputPath),
      ...done,
    };
  },
  {
    connection,
    concurrency: 1,
  },
).on("failed", (j, err) => {
  logger.error("job failed", j?.id, err?.message);
});

logger.info(
  `Worker Análise Fiscal de Produtos ouvindo fila ${ANALISE_PRODUTOS_QUEUE_NAME} (engine: ${env.ANALISE_PRODUTOS_DIR})`,
);
