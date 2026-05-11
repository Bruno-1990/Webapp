import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontDir = path.resolve(__dirname, "../Font");
/** Raiz do monorepo (webapp/), onde mora o .env unico. */
const monorepoRoot = path.resolve(__dirname, "../../");

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
        /** Incluir a raiz do frontend: se `allow` só listar ../Font, o Vite bloqueia index.html (403). */
        allow: [__dirname, fontDir],
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
