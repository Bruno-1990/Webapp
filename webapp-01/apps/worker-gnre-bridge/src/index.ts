import { spawn } from "node:child_process";
import path from "node:path";
import * as readline from "node:readline";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { GNRE_QUEUE_NAME, type GnreJobPayload } from "@webapp/contracts";
import { loadEnv } from "./env.js";

const env = loadEnv();

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  connectTimeout: 5_000,
});

const logger = {
  info: (...a: unknown[]) => console.log("[worker-gnre]", ...a),
  error: (...a: unknown[]) => console.error("[worker-gnre]", ...a),
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

type GnreCliResult = {
  totais?: { ok?: number; dup?: number; fail?: number; total?: number };
  valorTotal?: number;
  lancamentos?: number;
  falhas?: number;
};

function runGnreCli(
  job: { updateProgress: (n: number) => Promise<void> },
  data: GnreJobPayload,
): Promise<GnreCliResult | undefined> {
  return new Promise((resolve, reject) => {
    const pdfsDir = absolutizeJobPath(data.pdfsDir);
    const outputXlsx = absolutizeJobPath(data.outputXlsx);
    const cwd = env.GNRE_PY_DIR;
    const cliPath = path.join(cwd, "cli.py");
    const cmd = env.PYTHON_CMD.trim();
    const base = path.basename(cmd).replace(/\.exe$/i, "").toLowerCase();
    const args: string[] =
      base === "py"
        ? ["-3", cliPath, "--pdfs-dir", pdfsDir, "--output", outputXlsx]
        : [cliPath, "--pdfs-dir", pdfsDir, "--output", outputXlsx];

    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    if (env.GNRE_DB_PATH && env.GNRE_DB_PATH.trim()) {
      childEnv.GNRE_DB_PATH = env.GNRE_DB_PATH.trim();
    }

    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: childEnv,
    });

    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

    let jsonError: Error | null = null;
    let cliResult: GnreCliResult | undefined;

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        const o = JSON.parse(trimmed) as {
          kind?: string;
          value?: number;
          message?: string;
          result?: GnreCliResult;
        };
        if (o.kind === "progress" && typeof o.value === "number") {
          void job.updateProgress(o.value);
        }
        if (o.kind === "error" && typeof o.message === "string") {
          jsonError = new Error(o.message);
        }
        if (o.kind === "done" && o.result && typeof o.result === "object") {
          cliResult = o.result;
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
        resolve(cliResult);
        return;
      }
      const errText = Buffer.concat(stderrChunks).toString("utf-8").trim().slice(0, 800);
      reject(
        new Error(
          errText
            ? `Python saiu com código ${code}: ${errText}`
            : `Python saiu com código ${code}`,
        ),
      );
    });
  });
}

new Worker<GnreJobPayload>(
  GNRE_QUEUE_NAME,
  async (job) => {
    const outputXlsx = absolutizeJobPath(job.data.outputXlsx);
    await job.updateProgress(1);
    const result = await runGnreCli(job, job.data);
    await job.updateProgress(100);
    return { fileName: path.basename(outputXlsx), result };
  },
  {
    connection,
    concurrency: 1,
  },
).on("failed", (j, err) => {
  logger.error("job failed", j?.id, err?.message);
});

logger.info(
  `Worker GNRE ouvindo fila ${GNRE_QUEUE_NAME} (Python: ${env.GNRE_PY_DIR})`,
);
