import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadDotenvFromUpwards } from "@webapp/contracts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Codigo Python do Comparador NFS-e: engines/comparacao-nfse. */
function defaultPythonDir(): string {
  return path.resolve(__dirname, "../../../../engines/comparacao-nfse");
}

const _loadedEnv = loadDotenvFromUpwards(__dirname);
if (_loadedEnv) {
  console.log(`[worker-nfse] .env carregado de ${_loadedEnv}`);
}

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  REDIS_URL: z.string().default("redis://127.0.0.1:6381"),
  TEMP_JOBS_ROOT: z
    .string()
    .default("./temp_jobs")
    .transform((s) => path.resolve(process.cwd(), s)),
  COMPARACAO_NFSE_PY_DIR: z.string().default(defaultPythonDir()),
  PYTHON_CMD: z.string().default(process.platform === "win32" ? "py" : "python3"),
  /** Chave do Google Generative AI — necessaria para OCR de PDFs. */
  GEMINI_API_KEY: z.string().optional().default(""),
  /** Quantos jobs em paralelo este worker processa. */
  NFSE_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  /** Limite de chamadas Gemini por minuto (token bucket compartilhado). */
  NFSE_GEMINI_RPM: z.coerce.number().int().min(1).default(1500),
  /** Tempo (segundos) que o circuit fica aberto apos detectar quota. */
  NFSE_CIRCUIT_COOLDOWN_SEC: z.coerce.number().int().min(1).default(300),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Variaveis de ambiente invalidas");
  }
  return parsed.data;
}
