import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontDir = path.resolve(__dirname, "../Font");
/** Raiz do monorepo (webapp/), onde mora o .env unico. */
const monorepoRoot = path.resolve(__dirname, "../../");
/** Raiz do workspace npm (webapp-01/) — precisa estar em `fs.allow` para o Vite servir os pacotes linkados (`@webapp/contracts`, etc.). */
const workspaceRoot = path.resolve(__dirname, "..");

/** Sem VITE_API_URL, o frontend chama /api/... no mesmo host do Vite; o proxy encaminha para a API. */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, monorepoRoot, "");
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000";

  return {
    plugins: [react()],
    /** Le .env unico da raiz do monorepo (mesmo arquivo lido por API e workers). */
    envDir: monorepoRoot,
    server: {
      fs: {
        /**
         * Incluir a raiz do frontend (senao Vite bloqueia index.html com 403) e a raiz do workspace
         * `webapp-01/` para que `@webapp/contracts` e demais pacotes linkados em `packages/` possam
         * ser servidos via symlink em `node_modules/@webapp/*`.
         */
        allow: [__dirname, fontDir, workspaceRoot],
      },
      host: true,
      port: 5176,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          /** Upload de muitos XMLs: padrão curto do proxy pode cortar e gerar ERR_CONNECTION_ABORTED */
          timeout: 600_000,
          proxyTimeout: 600_000,
        },
      },
    },
  };
});
