import { spawn } from "node:child_process";
import path from "node:path";
import * as readline from "node:readline";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  SPED_MERGE_QUEUE_NAME,
  SPED_MERGE_INSPECT_QUEUE_NAME,
  type SpedMergeJobPayload,
  type SpedMergeInspectJobPayload,
  type SpedMergeInspectXlsxResponse,
} from "@webapp/contracts";
import { loadEnv } from "./env.js";

const env = loadEnv();

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  connectTimeout: 5_000,
});

const logger = {
  info: (...a: unknown[]) => console.log("[worker-sped-merge]", ...a),
  error: (...a: unknown[]) => console.error("[worker-sped-merge]", ...a),
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

function runMergeCli(job: { updateProgress: (n: number) => Promise<void> }, data: SpedMergeJobPayload): Promise<void> {
  return new Promise((resolve, reject) => {
    const spedPath = data.spedPath ? absolutizeJobPath(data.spedPath) : undefined;
    const xlsxPath = absolutizeJobPath(data.xlsxPath);
    const outputPath = absolutizeJobPath(data.outputPath);
    const cwd = env.SPED_MERGE_DIR;
    const cliPath = path.join(cwd, "cli_merge.py");
    const cmd = env.PYTHON_CMD.trim();
    const base = path.basename(cmd).replace(/\.exe$/i, "").toLowerCase();
    const args =
      base === "py"
        ? [
            "-3",
            cliPath,
            "--xlsx",
            xlsxPath,
            "--output",
            outputPath,
            ...(spedPath ? ["--sped", spedPath] : []),
          ]
        : [cliPath, "--xlsx", xlsxPath, "--output", outputPath, ...(spedPath ? ["--sped", spedPath] : [])];

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

new Worker<SpedMergeJobPayload>(
  SPED_MERGE_QUEUE_NAME,
  async (job) => {
    const outputPath = absolutizeJobPath(job.data.outputPath);
    await job.updateProgress(1);
    await runMergeCli(job, job.data);
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

function runInspectCli(xlsxPath: string): Promise<SpedMergeInspectXlsxResponse> {
  return new Promise((resolve, reject) => {
    const cwd = env.SPED_MERGE_DIR;
    const cliPath = path.join(cwd, "inspect_xlsx.py");
    const cmd = env.PYTHON_CMD.trim();
    const base = path.basename(cmd).replace(/\.exe$/i, "").toLowerCase();
    const args =
      base === "py"
        ? ["-3", cliPath, "--xlsx", xlsxPath]
        : [cliPath, "--xlsx", xlsxPath];

    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

    let out: SpedMergeInspectXlsxResponse | null = null;
    let jsonErr: string | null = null;
    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      const s = line.trim();
      if (!s.startsWith("{")) return;
      try {
        const obj = JSON.parse(s) as {
          kind?: string;
          message?: string;
          complete?: boolean;
          requiresOriginal?: boolean;
          reasons?: string[];
          regSheets?: string[];
        };
        if (obj.kind === "error") {
          jsonErr = obj.message ?? "Falha ao inspecionar XLSX";
          return;
        }
        if (obj.kind === "ok") {
          out = {
            complete: Boolean(obj.complete),
            requiresOriginal: Boolean(obj.requiresOriginal),
            reasons: Array.isArray(obj.reasons) ? obj.reasons.map(String) : [],
            regSheets: Array.isArray(obj.regSheets) ? obj.regSheets.map(String) : [],
          };
        }
      } catch {
        /* linha não JSON */
      }
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      rl.close();
      if (jsonErr) return reject(new Error(jsonErr));
      if (code !== 0) {
        const errText = Buffer.concat(stderrChunks).toString("utf-8").trim().slice(0, 800);
        return reject(new Error(errText || `inspect_xlsx falhou (${code})`));
      }
      if (!out) return reject(new Error("inspect_xlsx não retornou JSON válido"));
      resolve(out);
    });
  });
}

new Worker<SpedMergeInspectJobPayload, SpedMergeInspectXlsxResponse>(
  SPED_MERGE_INSPECT_QUEUE_NAME,
  async (job) => {
    const xlsxPath = absolutizeJobPath(job.data.xlsxPath);
    return await runInspectCli(xlsxPath);
  },
  {
    connection,
    concurrency: 2,
  }
).on("failed", (job, err) => {
  logger.error("inspect job failed", job?.id, err?.message);
});

logger.info(`Worker SPED merge ouvindo fila ${SPED_MERGE_QUEUE_NAME} (engines/sped-merge: ${env.SPED_MERGE_DIR})`);
logger.info(`Worker SPED inspect ouvindo fila ${SPED_MERGE_INSPECT_QUEUE_NAME}`);
