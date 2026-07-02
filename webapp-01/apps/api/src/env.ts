import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadDotenvFromUpwards } from "@webapp/contracts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const _loadedEnv = loadDotenvFromUpwards(__dirname);
if (_loadedEnv) {
  console.log(`[api] .env carregado de ${_loadedEnv}`);
}

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().default(8000),
  REDIS_URL: z.string().default("redis://127.0.0.1:6381"),
  /** Sempre absoluto (cwd na subida do processo) para coincidir com workers e Python. */
  TEMP_JOBS_ROOT: z
    .string()
    .default("./temp_jobs")
    .transform((s) => path.resolve(process.cwd(), s)),
  /**
   * SQLite do cadastro de clientes/fornecedores do Editor de Extrato. Em Docker
   * aponta para um volume persistente (`/data/extrato/extrato.db`); em dev local
   * cai em `./data/extrato/extrato.db` ao lado do processo. Sempre absoluto.
   */
  EXTRATO_DB_PATH: z
    .string()
    .default("./data/extrato/extrato.db")
    .transform((s) => path.resolve(process.cwd(), s)),
  JWT_SECRET: z.string().min(16, "JWT_SECRET deve ter pelo menos 16 caracteres"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5176,http://192.168.0.47:5176"),
  MAX_UPLOAD_MB: z.coerce.number().default(50),
  /** Quantidade máxima de XMLs consolidados por job (pastas grandes). */
  MAX_XML_FILES: z.coerce.number().default(5000),
  /** Limite por request do Comparador NFS-e (upload em chunks). */
  MAX_UPLOAD_NFSE_MB: z.coerce.number().default(300),
  /** Chave Google Generative AI — repassada ao worker de NFS-e (OCR). */
  GEMINI_API_KEY: z.string().optional().default(""),
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
