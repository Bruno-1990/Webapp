import { spawn } from "node:child_process";
import path from "node:path";
import * as readline from "node:readline";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  SPED_MAX_SHEETS_CSV_BYTES,
  SPED_QUEUE_NAME,
  type SpedJobPayload,
} from "@webapp/contracts";
import { loadEnv } from "./env.js";

const env = loadEnv();

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  connectTimeout: 5_000,
});

const logger = {
  info: (...a: unknown[]) => console.log("[worker-sped]", ...a),
  error: (...a: unknown[]) => console.error("[worker-sped]", ...a),
};

/** API pode enviar path absoluto ou relativo (cwd da API); Python usa cwd=sped_engine. */
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

function runSpedCli(job: { updateProgress: (n: number) => Promise<void> }, data: SpedJobPayload): Promise<void> {
  return new Promise((resolve, reject) => {
    const inputPath = absolutizeJobPath(data.inputPath);
    const outputPath = absolutizeJobPath(data.outputPath);
    const cwd = env.SPED_ENGINE_DIR;
    const cliPath = path.join(cwd, "cli.py");
    const cmd = env.PYTHON_CMD.trim();
    const base = path.basename(cmd).replace(/\.exe$/i, "").toLowerCase();
    const sheetsCsv =
      data.sheets !== undefined && data.sheets.length > 0 ? data.sheets.join(",") : "";
    if (Buffer.byteLength(sheetsCsv, "utf8") > SPED_MAX_SHEETS_CSV_BYTES) {
      reject(new Error("Lista de abas (--sheets) excede o tamanho máximo permitido."));
      return;
    }
    const sheetsArg = sheetsCsv.length > 0 ? ["--sheets", sheetsCsv] : [];
    const args =
      base === "py"
        ? ["-3", cliPath, "--input", inputPath, "--output", outputPath, ...sheetsArg]
        : [cliPath, "--input", inputPath, "--output", outputPath, ...sheetsArg];

    const child = spawn(cmd, args, {
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
        /* linha não JSON */
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
            ? `Python saiu com código ${code}: ${errText}`
            : `Python saiu com código ${code}`
        )
      );
    });
  });
}

new Worker<SpedJobPayload>(
  SPED_QUEUE_NAME,
  async (job) => {
    const outputPath = absolutizeJobPath(job.data.outputPath);
    await job.updateProgress(1);
    await runSpedCli(job, job.data);
    await job.updateProgress(100);
    return { fileName: path.basename(outputPath) };
  },
  {
    connection,
    concurrency: 1,
  }
).on("failed", (job, err) => {
  logger.error("job failed", job?.id, err?.message);
});

logger.info(`Worker SPED ouvindo fila ${SPED_QUEUE_NAME} (engine: ${env.SPED_ENGINE_DIR})`);
