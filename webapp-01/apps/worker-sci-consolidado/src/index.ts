import { spawn } from "node:child_process";
import path from "node:path";
import * as readline from "node:readline";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { SCI_CONSOLIDADO_QUEUE_NAME, type SciConsolidadoJobPayload } from "@webapp/contracts";
import { loadEnv } from "./env.js";

const env = loadEnv();

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  connectTimeout: 5_000,
});

const logger = {
  info: (...a: unknown[]) => console.log("[worker-sci]", ...a),
  error: (...a: unknown[]) => console.error("[worker-sci]", ...a),
};

function absolutizeJobPath(filePath: string): string {
  const norm = path.normalize(filePath);
  const containerJobs = norm.match(/^[/\\]data[/\\]jobs[/\\](.+)$/i);
  if (containerJobs) {
    return path.join(env.TEMP_JOBS_ROOT, containerJobs[1]);
  }
  if (path.isAbsolute(norm)) return norm;
  const rel = norm.replace(/^\.\//, "");
  const m = rel.match(/^temp_jobs[/\\](.+)$/i);
  if (m) {
    return path.join(env.TEMP_JOBS_ROOT, m[1]);
  }
  return path.resolve(process.cwd(), rel);
}

function runSciCli(
  job: { updateProgress: (n: number) => Promise<void> },
  data: SciConsolidadoJobPayload
): Promise<void> {
  return new Promise((resolve, reject) => {
    const inputPath = absolutizeJobPath(data.inputPath);
    const outputPath = absolutizeJobPath(data.outputPath);
    const cwd = env.SCI_CONSOLIDADO_PY_DIR;
    const cliPath = path.join(cwd, "cli.py");
    const cmd = env.PYTHON_CMD.trim();
    const base = path.basename(cmd).replace(/\.exe$/i, "").toLowerCase();
    const args: string[] =
      base === "py"
        ? ["-3", cliPath, "--input", inputPath, "--output", outputPath]
        : [cliPath, "--input", inputPath, "--output", outputPath];
    if (data.sheetName) {
      args.push("--sheet", data.sheetName);
    }

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
        /* ignore */
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

new Worker<SciConsolidadoJobPayload>(
  SCI_CONSOLIDADO_QUEUE_NAME,
  async (job) => {
    const outputPath = absolutizeJobPath(job.data.outputPath);
    await job.updateProgress(1);
    await runSciCli(job, job.data);
    await job.updateProgress(100);
    return { fileName: path.basename(outputPath) };
  },
  {
    connection,
    concurrency: 1,
  }
).on("failed", (j, err) => {
  logger.error("job failed", j?.id, err?.message);
});

logger.info(
  `Worker Consolidado SCI ouvindo fila ${SCI_CONSOLIDADO_QUEUE_NAME} (Python: ${env.SCI_CONSOLIDADO_PY_DIR})`
);
