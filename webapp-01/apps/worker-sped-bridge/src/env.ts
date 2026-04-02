import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function defaultSpedEngineDir(): string {
  return path.resolve(__dirname, "../../../../webapp-02/sped_engine");
}

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  /** Mesmo diretório da API (absoluto); usado se o job vier com path relativo tipo temp_jobs/... */
  TEMP_JOBS_ROOT: z
    .string()
    .default("./temp_jobs")
    .transform((s) => path.resolve(process.cwd(), s)),
  SPED_ENGINE_DIR: z.string().default(defaultSpedEngineDir()),
  /** Executável Python (ex.: python3, py -3, /opt/sped/bin/python) */
  PYTHON_CMD: z.string().default(
    process.platform === "win32" ? "py" : "python3"
  ),
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
