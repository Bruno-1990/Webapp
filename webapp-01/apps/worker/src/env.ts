import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  TEMP_JOBS_ROOT: z.string().default("./temp_jobs"),
  /** XMLs lidos e parseados em lotes para reduzir pico de memória */
  WORKER_XML_CHUNK: z.coerce.number().min(1).default(100),
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
