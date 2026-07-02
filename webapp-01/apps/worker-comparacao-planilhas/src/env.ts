import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadDotenvFromUpwards } from "@webapp/contracts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Código Python do Comparador: engines/comparacao-planilhas. */
function defaultPythonDir(): string {
  return path.resolve(__dirname, "../../../../engines/comparacao-planilhas");
}

const _loadedEnv = loadDotenvFromUpwards(__dirname);
if (_loadedEnv) {
  console.log(`[worker-comparacao] .env carregado de ${_loadedEnv}`);
}

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  REDIS_URL: z.string().default("redis://127.0.0.1:6381"),
  TEMP_JOBS_ROOT: z
    .string()
    .default("./temp_jobs")
    .transform((s) => path.resolve(process.cwd(), s)),
  COMPARACAO_PY_DIR: z.string().default(defaultPythonDir()),
  PYTHON_CMD: z.string().default(process.platform === "win32" ? "py" : "python3"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Variáveis de ambiente inválidas");
  }
  return parsed.data;
}
