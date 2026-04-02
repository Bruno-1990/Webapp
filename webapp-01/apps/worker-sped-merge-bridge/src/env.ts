import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function defaultWebapp03Dir(): string {
  return path.resolve(__dirname, "../../../../webapp-03");
}

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  TEMP_JOBS_ROOT: z
    .string()
    .default("./temp_jobs")
    .transform((s) => path.resolve(process.cwd(), s)),
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
