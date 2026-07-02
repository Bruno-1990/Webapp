#!/usr/bin/env node
/**
 * Gerenciador de portas do monorepo.
 *
 * Uso:
 *   node manage-ports.mjs                  Lista portas configuradas e verifica conflitos
 *   node manage-ports.mjs set api 9000     Altera a porta da API para 9000
 *   node manage-ports.mjs set frontend 3000
 *   node manage-ports.mjs set redis 6381
 *   node manage-ports.mjs reset            Restaura portas padrao (8000, 5176, 6381)
 *
 * Nota redis: a porta aqui e a do HOST. O container sempre escuta 6379 internamente
 * (a rede Docker usa redis://redis:6379). O host saiu de 6379 -> 6381 porque a 6379
 * passou a ser do OneClick V2 (saas-redis). Ver port-registry.json do server-manager.
 */

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTS_FILE = path.join(__dirname, "ports.json");

const DEFAULTS = { api: 8000, frontend: 5176, redis: 6381 };
const LABELS = { api: "API (Fastify)", frontend: "Frontend (Vite)", redis: "Redis" };

// ── helpers ────────────────────────────────────────────────────────────

function readPorts() {
  if (!fs.existsSync(PORTS_FILE)) {
    fs.writeFileSync(PORTS_FILE, JSON.stringify(DEFAULTS, null, 2) + "\n");
  }
  return JSON.parse(fs.readFileSync(PORTS_FILE, "utf-8"));
}

function writePorts(ports) {
  fs.writeFileSync(PORTS_FILE, JSON.stringify(ports, null, 2) + "\n");
}

function checkPort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => {
      srv.close();
      resolve(true);
    });
    srv.listen(port, "0.0.0.0");
  });
}

// ── listar ─────────────────────────────────────────────────────────────

async function listPorts() {
  const ports = readPorts();
  const maxLabel = Math.max(...Object.values(LABELS).map((l) => l.length));

  console.log("\n  Portas configuradas (ports.json)\n");
  console.log(
    "  " +
      "Servico".padEnd(maxLabel + 2) +
      "Porta".padEnd(8) +
      "Status"
  );
  console.log("  " + "-".repeat(maxLabel + 2 + 8 + 12));

  for (const [key, port] of Object.entries(ports)) {
    const label = (LABELS[key] || key).padEnd(maxLabel + 2);
    const portStr = String(port).padEnd(8);
    const livre = await checkPort(port);
    const status = livre ? "\x1b[32mlivre\x1b[0m" : "\x1b[31mem uso\x1b[0m";
    console.log(`  ${label}${portStr}${status}`);
  }

  // verificar duplicatas
  const vals = Object.values(ports);
  const dupes = vals.filter((v, i) => vals.indexOf(v) !== i);
  if (dupes.length) {
    console.log(`\n  \x1b[31mConflito!\x1b[0m Portas duplicadas: ${[...new Set(dupes)].join(", ")}`);
  }

  console.log(
    "\n  Para alterar:  node manage-ports.mjs set <api|frontend|redis> <porta>"
  );
  console.log("  Para resetar:  node manage-ports.mjs reset\n");
}

// ── set ────────────────────────────────────────────────────────────────

async function setPort(service, newPort) {
  const ports = readPorts();

  if (!(service in ports)) {
    console.error(
      `\n  Servico "${service}" nao encontrado. Use: ${Object.keys(ports).join(", ")}\n`
    );
    process.exit(1);
  }

  const num = Number(newPort);
  if (!num || num < 1 || num > 65535) {
    console.error("\n  Porta invalida. Use um numero entre 1 e 65535.\n");
    process.exit(1);
  }

  // verificar conflito com outros servicos
  for (const [k, v] of Object.entries(ports)) {
    if (k !== service && v === num) {
      console.error(
        `\n  \x1b[31mConflito!\x1b[0m Porta ${num} ja esta atribuida a "${LABELS[k] || k}".\n`
      );
      process.exit(1);
    }
  }

  const oldPort = ports[service];
  ports[service] = num;
  writePorts(ports);

  // propagar para os arquivos do projeto
  propagate(ports, service, oldPort, num);

  const livre = await checkPort(num);
  const statusMsg = livre
    ? "\x1b[32mlivre\x1b[0m"
    : "\x1b[33mem uso (outra aplicacao pode estar usando)\x1b[0m";

  console.log(
    `\n  ${LABELS[service] || service}: ${oldPort} -> ${num}  [${statusMsg}]`
  );
  console.log("  Arquivos atualizados automaticamente.\n");
}

// ── propagacao automatica ──────────────────────────────────────────────

function propagate(ports, service, oldPort, newPort) {
  const w01 = path.join(__dirname, "webapp-01");

  if (service === "api") {
    // package.json dev scripts — PORT na api
    replaceInFile(
      path.join(w01, "package.json"),
      `JWT_SECRET=devJWTSecretMinimum16chars REDIS_URL=redis://127.0.0.1:${ports.redis}`,
      `JWT_SECRET=devJWTSecretMinimum16chars REDIS_URL=redis://127.0.0.1:${ports.redis}`
    );

    // env.ts default
    replaceInFile(
      path.join(w01, "apps/api/src/env.ts"),
      `.default(${oldPort})`,
      `.default(${newPort})`
    );

    // ALLOWED_ORIGINS no env.ts (localhost com porta do frontend)
    updateAllowedOrigins(ports);

    // vite proxy target
    replaceInFile(
      path.join(w01, "frontend/vite.config.ts"),
      `http://127.0.0.1:${oldPort}`,
      `http://127.0.0.1:${newPort}`
    );

    // docker-compose
    replaceInFile(
      path.join(__dirname, "docker-compose.yml"),
      `"${oldPort}:${oldPort}"`,
      `"${newPort}:${newPort}"`
    );
    replaceInFile(
      path.join(__dirname, "docker-compose.yml"),
      `PORT: "${oldPort}"`,
      `PORT: "${newPort}"`
    );

    // Dockerfile EXPOSE
    const dockerfile = path.join(w01, "docker/Dockerfile");
    if (fs.existsSync(dockerfile)) {
      replaceInFile(dockerfile, `EXPOSE ${oldPort}`, `EXPOSE ${newPort}`);
    }
  }

  if (service === "frontend") {
    // vite.config.ts
    replaceInFile(
      path.join(w01, "frontend/vite.config.ts"),
      `port: ${oldPort}`,
      `port: ${newPort}`
    );

    // ALLOWED_ORIGINS
    updateAllowedOrigins(ports);

    // docker-compose ALLOWED_ORIGINS
    const dc = path.join(__dirname, "docker-compose.yml");
    if (fs.existsSync(dc)) {
      let content = fs.readFileSync(dc, "utf-8");
      content = content.replace(
        new RegExp(`localhost:${oldPort}`, "g"),
        `localhost:${newPort}`
      );
      content = content.replace(
        new RegExp(`192\\.168\\.0\\.47:${oldPort}`, "g"),
        `192.168.0.47:${newPort}`
      );
      fs.writeFileSync(dc, content);
    }
  }

  if (service === "redis") {
    // Todos os REDIS_URL nos scripts do package.json
    const pkgPath = path.join(w01, "package.json");
    let pkg = fs.readFileSync(pkgPath, "utf-8");
    pkg = pkg.replace(
      new RegExp(`redis://127\\.0\\.0\\.1:${oldPort}`, "g"),
      `redis://127.0.0.1:${newPort}`
    );
    fs.writeFileSync(pkgPath, pkg);

    // env.ts da API
    replaceInFile(
      path.join(w01, "apps/api/src/env.ts"),
      `redis://127.0.0.1:${oldPort}`,
      `redis://127.0.0.1:${newPort}`
    );

    // env.ts de todos os workers
    const workers = [
      "worker",
      "worker-sped-bridge",
      "worker-sped-merge-bridge",
      "worker-sci-consolidado",
      "worker-comparacao-planilhas",
    ];
    for (const w of workers) {
      const envFile = path.join(w01, `apps/${w}/src/env.ts`);
      if (fs.existsSync(envFile)) {
        replaceInFile(envFile, `redis://127.0.0.1:${oldPort}`, `redis://127.0.0.1:${newPort}`);
      }
    }

    // docker-compose — so o lado HOST muda; o container fica fixo em 6379
    const dc = path.join(__dirname, "docker-compose.yml");
    replaceInFile(dc, `"${oldPort}:6379"`, `"${newPort}:6379"`);
  }
}

function updateAllowedOrigins(ports) {
  const envFile = path.join(__dirname, "webapp-01/apps/api/src/env.ts");
  if (!fs.existsSync(envFile)) return;
  let content = fs.readFileSync(envFile, "utf-8");
  // Atualiza o default de ALLOWED_ORIGINS para usar a porta correta do frontend
  content = content.replace(
    /ALLOWED_ORIGINS:\s*z\.string\(\)\.default\("([^"]+)"\)/,
    (_match) => {
      const origins = `http://localhost:${ports.frontend},http://192.168.0.47:${ports.frontend}`;
      return `ALLOWED_ORIGINS: z.string().default("${origins}")`;
    }
  );
  fs.writeFileSync(envFile, content);
}

function replaceInFile(filePath, search, replacement) {
  if (!fs.existsSync(filePath)) return;
  if (search === replacement) return;
  let content = fs.readFileSync(filePath, "utf-8");
  if (!content.includes(search)) return;
  content = content.replace(search, replacement);
  fs.writeFileSync(filePath, content);
}

// ── reset ──────────────────────────────────────────────────────────────

async function resetPorts() {
  const current = readPorts();

  for (const [service, defaultPort] of Object.entries(DEFAULTS)) {
    const oldPort = current[service];
    if (oldPort !== defaultPort) {
      propagate({ ...current, [service]: defaultPort }, service, oldPort, defaultPort);
      current[service] = defaultPort;
    }
  }

  writePorts(DEFAULTS);
  console.log("\n  Portas restauradas para os valores padrao:");
  console.log(`    API:      ${DEFAULTS.api}`);
  console.log(`    Frontend: ${DEFAULTS.frontend}`);
  console.log(`    Redis:    ${DEFAULTS.redis}\n`);
}

// ── main ───────────────────────────────────────────────────────────────

const [, , cmd, arg1, arg2] = process.argv;

if (!cmd || cmd === "list") {
  await listPorts();
} else if (cmd === "set") {
  if (!arg1 || !arg2) {
    console.error("\n  Uso: node manage-ports.mjs set <api|frontend|redis> <porta>\n");
    process.exit(1);
  }
  await setPort(arg1, arg2);
} else if (cmd === "reset") {
  await resetPorts();
} else {
  console.error(`\n  Comando desconhecido: "${cmd}". Use: list, set, reset\n`);
  process.exit(1);
}
