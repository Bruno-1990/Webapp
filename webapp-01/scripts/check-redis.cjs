/**
 * Guard de pré-flight: ping em 127.0.0.1:6381 antes do `dev:all`.
 * Falha rápido (exit 1) com mensagem acionável em vez de deixar 8 workers
 * cuspirem ECONNREFUSED em loop.
 *
 * REDIS_URL é respeitado (formato redis://host:port[/db]); default 127.0.0.1:6381.
 * Timeout curto (1.5s) — Redis local responde em milissegundos.
 */
const net = require("node:net");

function parseRedisUrl(url) {
  if (!url) return { host: "127.0.0.1", port: 6381 };
  try {
    const u = new URL(url);
    return {
      host: u.hostname || "127.0.0.1",
      port: Number(u.port) || 6381,
    };
  } catch {
    return { host: "127.0.0.1", port: 6381 };
  }
}

const { host, port } = parseRedisUrl(process.env.REDIS_URL);
const TIMEOUT_MS = 1500;

const socket = new net.Socket();
let settled = false;

function done(ok, reason) {
  if (settled) return;
  settled = true;
  try {
    socket.destroy();
  } catch {}
  if (ok) {
    console.log(`[check-redis] OK — ${host}:${port}`);
    process.exit(0);
  }
  console.error(
    `\n\x1b[31m[check-redis] Redis indisponível em ${host}:${port} (${reason}).\x1b[0m\n` +
      `  → Suba o Redis antes do dev:\n` +
      `      cd D:\\aplicativos\\webapp   (ou a raiz do monorepo)\n` +
      `      npm run redis:up            (precisa do Docker ligado)\n` +
      `  ou rode \`npm run dev:stack\` na raiz, que sobe Redis + dev em sequência.\n`
  );
  process.exit(1);
}

socket.setTimeout(TIMEOUT_MS);
socket.once("connect", () => done(true));
socket.once("timeout", () => done(false, "timeout"));
socket.once("error", (e) => done(false, e.code || e.message));
socket.connect(port, host);
