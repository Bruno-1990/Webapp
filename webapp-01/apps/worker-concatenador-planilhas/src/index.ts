import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  CONCATENADOR_PLANILHAS_QUEUE_NAME,
  type ConcatenadorAviso,
  type ConcatenadorPlanilhasJobPayload,
} from "@webapp/contracts";
import { loadEnv } from "./env.js";

const env = loadEnv();

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  connectTimeout: 5_000,
});

const logger = {
  info: (...a: unknown[]) => console.log("[worker-concatenador]", ...a),
  warn: (...a: unknown[]) => console.warn("[worker-concatenador]", ...a),
  error: (...a: unknown[]) => console.error("[worker-concatenador]", ...a),
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

type DoneEvent = {
  arquivos?: number;
  linhas?: number;
  ordem?: string[];
  criterio?: string;
  avisos?: ConcatenadorAviso[];
};

/** Roda o engine standalone (engines/concatenador-planilhas/cli.mjs) consumindo eventos JSON do stdout. */
function runCli(
  job: { id?: string; updateProgress: (n: number) => Promise<void> },
  data: ConcatenadorPlanilhasJobPayload,
): Promise<DoneEvent> {
  return new Promise((resolve, reject) => {
    const inputPaths = data.inputPaths.map(absolutizeJobPath);
    const outputPath = absolutizeJobPath(data.outputPath);
    const cwd = env.CONCATENADOR_DIR;
    const cliPath = path.join(cwd, "cli.mjs");

    // Erro claro se a engine não estiver no lugar (ex.: imagem Docker sem o
    // engines/concatenador-planilhas). Sem isso, spawn falha com ENOENT opaco.
    if (!fs.existsSync(cliPath)) {
      reject(
        new Error(
          `Engine não encontrada em ${cliPath} (CONCATENADOR_DIR=${cwd}). ` +
            `Reconstrua a imagem: docker compose --profile comparacao build worker-concatenador-planilhas.`,
        ),
      );
      return;
    }

    const args = [cliPath, "--input", ...inputPaths, "--output", outputPath];

    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

    let jsonError: Error | null = null;
    let doneEvent: DoneEvent = {};

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        const o = JSON.parse(trimmed) as {
          kind?: string;
          value?: number;
          message?: string;
        } & DoneEvent;
        if (o.kind === "progress" && typeof o.value === "number") {
          void job.updateProgress(o.value);
        }
        if (o.kind === "error" && typeof o.message === "string") {
          jsonError = new Error(o.message);
        }
        if (o.kind === "done") {
          doneEvent = {
            arquivos: o.arquivos,
            linhas: o.linhas,
            ordem: o.ordem,
            criterio: o.criterio,
            avisos: o.avisos,
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

new Worker<ConcatenadorPlanilhasJobPayload>(
  CONCATENADOR_PLANILHAS_QUEUE_NAME,
  async (job) => {
    const outputPath = absolutizeJobPath(job.data.outputPath);
    await job.updateProgress(1);
    const done = await runCli(job, job.data);
    await job.updateProgress(100);

    logger.info(
      `job ${job.id}: ${done.arquivos ?? job.data.inputPaths.length} arquivo(s) → ` +
        `${done.linhas ?? "?"} linha(s), ordenado por ${done.criterio ?? "?"}`,
    );
    // Avisos (furos/repetições no "#") não derrubam o job — ficam no log para
    // quem for conferir a planilha depois.
    for (const aviso of done.avisos ?? []) {
      logger.warn(
        `job ${job.id}: [${aviso.severidade}] ${aviso.titulo}` +
          (aviso.detalhe ? ` — ${aviso.detalhe}` : ""),
      );
    }

    return {
      fileName: path.basename(outputPath),
      arquivos: done.arquivos,
      linhas: done.linhas,
      avisos: done.avisos ?? [],
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
  `Worker Concatenador de Planilhas ouvindo fila ${CONCATENADOR_PLANILHAS_QUEUE_NAME} (engine: ${env.CONCATENADOR_DIR})`,
);
