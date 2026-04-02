import path from "node:path";
import { z } from "zod";

function defaultWebapp03Dir(): string {
  return path.resolve(process.cwd(), "../webapp-03");
}

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().default(8000),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  /** Sempre absoluto (cwd na subida do processo) para coincidir com workers e Python. */
  TEMP_JOBS_ROOT: z
    .string()
    .default("./temp_jobs")
    .transform((s) => path.resolve(process.cwd(), s)),
  JWT_SECRET: z.string().min(16, "JWT_SECRET deve ter pelo menos 16 caracteres"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5176,http://192.168.0.47:5176"),
  MAX_UPLOAD_MB: z.coerce.number().default(50),
  /** Quantidade máxima de XMLs consolidados por job (pastas grandes). */
  MAX_XML_FILES: z.coerce.number().default(5000),
  /** Diretório do motor Python de merge SPED (webapp-03). */
  SPED_MERGE_DIR: z.string().default(defaultWebapp03Dir()),
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
