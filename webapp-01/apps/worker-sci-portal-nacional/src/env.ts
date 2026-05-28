import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadDotenvFromUpwards } from "@webapp/contracts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const _loadedEnv = loadDotenvFromUpwards(__dirname);
if (_loadedEnv) {
  console.log(`[worker-sci-portal] .env carregado de ${_loadedEnv}`);
}

function defaultWebapp08Dir(): string {
  return path.resolve(process.cwd(), "../webapp-08");
}

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  TEMP_JOBS_ROOT: z.string().default("./temp_jobs"),
  /** Diretório do engine standalone (webapp-08). */
  SCI_PORTAL_DIR: z.string().default(defaultWebapp08Dir()),
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
