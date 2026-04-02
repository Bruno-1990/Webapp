import { readFileSync } from "node:fs";
import path from "node:path";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { buildXlsx } from "@webapp/excel-export";
import {
  buildNfeExportFileName,
  consolidateXmls,
  emptyRow,
  pickDominantEmit,
  type NfeRow,
} from "@webapp/nfe-core";
import { QUEUE_NAME } from "@webapp/contracts";
import { loadEnv } from "./env.js";

const env = loadEnv();

export type NfeJobPayload = {
  jobId: string;
  xmlPaths: string[];
  outputPath: string;
};

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  connectTimeout: 5_000,
});

const logger = {
  info: (...a: unknown[]) => console.log("[worker]", ...a),
  error: (...a: unknown[]) => console.error("[worker]", ...a),
};

new Worker<NfeJobPayload>(
  QUEUE_NAME,
  async (job) => {
    const { xmlPaths, outputPath } = job.data;
    const total = xmlPaths.length;
    const chunkSize = env.WORKER_XML_CHUNK;

    await job.updateProgress(2);

    const allRows: NfeRow[] = [];
    for (let offset = 0; offset < total; offset += chunkSize) {
      const slice = xmlPaths.slice(offset, offset + chunkSize);
      const inputs = slice.map((p) => ({
        fileName: path.basename(p),
        content: readFileSync(p, "utf-8"),
      }));
      const chunkRows = consolidateXmls(inputs);
      if (allRows.length > 0 && chunkRows.length > 0) {
        allRows.push(emptyRow(), emptyRow());
      }
      allRows.push(...chunkRows);
      const done = Math.min(offset + slice.length, total);
      await job.updateProgress(5 + Math.round((45 * done) / Math.max(1, total)));
    }

    await job.updateProgress(52);
    await buildXlsx(allRows, outputPath);
    await job.updateProgress(100);

    const { emitXNome, emitCnpj } = pickDominantEmit(allRows);
    const fileName = buildNfeExportFileName(emitXNome, emitCnpj, new Date());
    return { fileName };
  },
  {
    connection,
    concurrency: 1,
  }
).on("failed", (job, err) => {
  logger.error("job failed", job?.id, err?.message);
});

logger.info(`Worker ouvindo fila ${QUEUE_NAME}`);
