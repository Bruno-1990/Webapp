# Como adicionar uma nova ferramenta

Antes de tudo: **escolha um nome em kebab-case** (ex.: `darf-extrator`). Pela
convenção do monorepo, esse mesmo nome vira a pasta da engine, o nome do worker,
a rota e o `id` no manifest (ver [ARCHITECTURE.md](ARCHITECTURE.md)). Use-o em todos os lugares.

## Caso A — ferramenta com backend (engine + fila + worker)

Use uma ferramenta existente como molde (ex.: GNRE é a mais simples e isolada).

1. **Engine** — crie `engines/<nome>/` com a CLI (`cli.py` em Python ou `cli.mjs`
   em Node) + `requirements.txt`/`package.json` + `README.md`. A CLI deve emitir
   **JSON-lines** no stdout: `{"kind":"progress",...}`, `{"kind":"file",...}`,
   `{"kind":"error",...}`, `{"kind":"done",...}`.
2. **Fila + payload** — declare em
   [`webapp-01/packages/contracts/src/index.ts`](../webapp-01/packages/contracts/src/index.ts):
   `export const <NOME>_QUEUE_NAME = "<nome>" as const;` e o tipo do payload.
3. **Worker bridge** — crie `webapp-01/apps/worker-<nome>-bridge/` com
   `src/index.ts` + `src/env.ts` + `package.json` + `tsconfig.json`. No `env.ts`,
   o default da dir da engine é
   `path.resolve(__dirname, "../../../../engines/<nome>")` (4 níveis: `src` →
   `worker` → `apps` → `webapp-01` → raiz). Copie de um worker irmão.
4. **Dockerfile** — crie `webapp-01/docker/Dockerfile.worker-<nome>` no padrão dos
   outros (multi-stage: build-js Node + runtime). Para engine Python: instala o
   venv com `pip install -r /app/engines/<nome>/requirements.txt`. As linhas-chave:
   `COPY engines/<nome> /app/engines/<nome>` e `ENV <NOME>_PY_DIR=/app/engines/<nome>`.
5. **docker-compose.yml** — adicione o service `worker-<nome>` com
   `build.context: .`, `dockerfile: webapp-01/docker/Dockerfile.worker-<nome>`,
   `volumes: ./temp_jobs:/data/jobs`. Defina um `profile` se for opcional; omita
   se for core. Atualize o comentário-mapa no topo do arquivo.
6. **API** — em [`webapp-01/apps/api/src/server.ts`](../webapp-01/apps/api/src/server.ts):
   adicione a entrada no manifest (`GET /api/v1/tools`) com `id: "<nome>"` e
   `route: "/tools/<nome>"`, e as rotas `POST /api/v1/tools/<nome>/jobs` +
   `GET .../jobs/:id` + `GET .../jobs/:id/download`.
7. **Frontend** —
   - Página `webapp-01/frontend/src/pages/<Nome>HomePage.tsx`.
   - Rota em [`App.tsx`](../webapp-01/frontend/src/App.tsx): `/tools/<nome>`.
   - Card no fallback `defaultToolsManifest()` de
     [`api.ts`](../webapp-01/frontend/src/api.ts) (mesmo `id`/`route`).
   - Ícone/owner/cor nos mapas de
     [`ToolsHubPage.tsx`](../webapp-01/frontend/src/pages/ToolsHubPage.tsx) (chave = `id`).
8. **Build scripts** — inclua o novo worker em `dev:all`/`build`/`dev:backend` no
   [`webapp-01/package.json`](../webapp-01/package.json) (mesmo padrão dos outros).
9. **Docs** — adicione a linha na tabela de [ARCHITECTURE.md](ARCHITECTURE.md) e a
   seção em [TOOLS.md](TOOLS.md).

Verifique: `npm run build` na raiz, `docker compose --profile <p> build worker-<nome>`,
e um job de ponta a ponta pela UI.

## Caso B — ferramenta 100% no navegador (como o Editor de Extrato)

Sem engine, fila, worker, API ou Docker. Só frontend:

1. Lógica em `webapp-01/frontend/src/<nome>/` (ex.: parse + export com ExcelJS).
2. Página `<Nome>HomePage.tsx` + rota em `App.tsx`.
3. Card em `defaultToolsManifest()` (`api.ts`) com `available: true`. A API **não**
   precisa retornar essa ferramenta — o merge do front usa o fallback local.
4. Ícone/owner/cor em `ToolsHubPage.tsx`.
5. Docs.

## Engines reservadas

`contabil-01/`, `contabil-02/` na raiz são placeholders vazios. Prefira criar
`engines/<nome>` com o nome semântico em vez de reusar esses números.
