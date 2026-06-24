import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  SCI_PORTAL_NACIONAL_QUEUE_NAME,
  type SciPortalNacionalJobPayload,
} from "@webapp/contracts";
import { loadEnv } from "./env.js";

const env = loadEnv();

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  connectTimeout: 5_000,
});

const logger = {
  info: (...a: unknown[]) => console.log("[worker-sci-portal]", ...a),
  error: (...a: unknown[]) => console.error("[worker-sci-portal]", ...a),
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

/** Roda o engine standalone (engines/sci-portal-nacional/cli.mjs) consumindo eventos JSON do stdout. */
function runCli(
  job: { updateProgress: (n: number) => Promise<void> },
  data: SciPortalNacionalJobPayload,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const sciPath = absolutizeJobPath(data.sciPath);
    const portalPath = absolutizeJobPath(data.portalPath);
    const outputPath = absolutizeJobPath(data.outputPath);
    const cwd = env.SCI_PORTAL_DIR;
    const cliPath = path.join(cwd, "cli.mjs");

    // Erro claro se a engine não estiver no lugar (ex.: imagem Docker desatualizada
    // após o refactor engines/). Sem isso, spawn falha com "spawn node ENOENT".
    if (!fs.existsSync(cliPath)) {
      reject(
        new Error(
          `Engine não encontrada em ${cliPath} (SCI_PORTAL_DIR=${cwd}). ` +
            `Reconstrua a imagem: docker compose --profile comparacao build worker-sci-portal-nacional.`,
        ),
      );
      return;
    }

    const args = [
      cliPath,
      "--sci", sciPath,
      "--portal", portalPath,
      "--output", outputPath,
    ];

    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

    let jsonError: Error | null = null;

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        const o = JSON.parse(trimmed) as {
          kind?: string;
          value?: number;
          message?: string;
        };
        if (o.kind === "progress" && typeof o.value === "number") {
          void job.updateProgress(o.value);
        }
        if (o.kind === "error" && typeof o.message === "string") {
          jsonError = new Error(o.message);
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
        resolve();
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

new Worker<SciPortalNacionalJobPayload>(
  SCI_PORTAL_NACIONAL_QUEUE_NAME,
  async (job) => {
    const outputPath = absolutizeJobPath(job.data.outputPath);
    await job.updateProgress(1);
    await runCli(job, job.data);
    await job.updateProgress(100);
    return { fileName: path.basename(outputPath) };
  },
  {
    connection,
    concurrency: 1,
  },
).on("failed", (j, err) => {
  logger.error("job failed", j?.id, err?.message);
});

logger.info(
  `Worker Conciliador NFS-e SCI x SEFAZ ouvindo fila ${SCI_PORTAL_NACIONAL_QUEUE_NAME} (engine: ${env.SCI_PORTAL_DIR})`,
);
