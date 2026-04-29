import fs from "node:fs";
import path from "node:path";

/**
 * Le o primeiro `.env` encontrado subindo a partir de `startDir` ate a raiz do
 * disco e popula em `process.env` apenas variaveis ainda nao definidas. Garante
 * que API e workers leiam o MESMO `.env` da raiz do monorepo, sem dependencia
 * do launcher (START.bat / dev:stack) ter exportado as variaveis previamente.
 *
 * Variaveis ja setadas no shell (cross-env, docker compose, secrets de CI) tem
 * prioridade — o arquivo apenas preenche o que estiver vazio.
 *
 * Retorna o caminho do `.env` carregado, ou `null` se nao achou nenhum.
 */
export function loadDotenvFromUpwards(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) {
      try {
        const text = fs.readFileSync(candidate, "utf-8");
        for (const raw of text.split(/\r?\n/)) {
          const line = raw.trim();
          if (!line || line.startsWith("#")) continue;
          const eq = line.indexOf("=");
          if (eq < 1) continue;
          const key = line.slice(0, eq).trim();
          let value = line.slice(eq + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          if (process.env[key] === undefined || process.env[key] === "") {
            process.env[key] = value;
          }
        }
      } catch {
        /* ignore read errors */
      }
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
