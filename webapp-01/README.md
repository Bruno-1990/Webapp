# webapp-01 — Plataforma de conversões (hub + ferramentas)

Monorepo **Node.js + TypeScript**: API **Fastify**, fila **BullMQ** + **Redis**, workers assíncronos, frontend **Vite + React** (porta **5176**, LAN).

### Repositório GitHub (uma repo, várias ferramentas)

Este repositório concentra a **plataforma** e as **ferramentas** atuais e futuras (NFe, SPED, etc.). Novas ferramentas entram como pastas/workers adicionais (ex.: [webapp-02](../webapp-02) para SPED) sem obrigar outro repositório.

- **Hub:** `/` lista ferramentas (`GET /api/v1/tools` alimenta os cards).
- **NFe XML → XLSX:** `/tools/nfe` (rotas legadas de API: `POST /api/v1/jobs` inalteradas).
- **SPED → XLSX:** `/tools/sped`; motor Python em **[webapp-02](../webapp-02)/sped_engine** (worker `worker-sped-bridge`). A planilha exportada inclui a coluna **`_LINHA`** (número da linha no `.txt` original).
- **XLSX → SPED (webapp-03):** `/tools/sped-merge`; mescla o XLSX editado de volta no `.txt` preservando linhas que não estão na planilha. Requer o XLSX gerado pela exportação atual (**com `_LINHA`**). Código Python em **[webapp-03](../webapp-03)**; worker Node `worker-sped-merge-bridge`.
- **Consolidado SCI (webapp-04):** `/tools/sci-consolidado`; exportação SCI → **ProdutosSCI.xlsx**. Código Python em **[webapp-04](../webapp-04)**; worker Node `worker-sci-consolidado`.

**Pastas irmãs no disco:** `webapp-01`, `webapp-02`, `webapp-03` e `webapp-04` no mesmo diretório pai (caminhos padrão dos workers).

---

## Ferramenta NFe (referência rápida)

Monorepo **Node.js + TypeScript** para XML NFe → XLSX: API **Fastify**, fila **BullMQ** + **Redis**, worker assíncrono.

### Início rápido (um comando)

1. **Redis** em `127.0.0.1:6379` (ex.: `npm run redis:up` com Docker ligado).
2. Na pasta `webapp-01`: `npm install`
3. **`npm run dev`** — compila API/workers e sobe **API + workers + Vite** (`dev:all`). Para SPED, XLSX→SPED e Consolidado SCI: **Python** com `pip install -r requirements.txt` em `webapp-02/sped_engine`, `webapp-03` e **`webapp-04`** (ou o mesmo venv).

**Só interface:** `npm run dev:fe` sobe apenas o Vite; aí é preciso **`npm run dev:backend`** (ou API na porta 8000) em outro terminal, senão o proxy dá `ECONNREFUSED`.

## Estrutura

- `packages/contracts` — constantes e schemas compartilhados
- `packages/nfe-core` — parse XML NFe + consolidação (port do `core_nfe.py`)
- `packages/excel-export` — geração XLSX com **exceljs** + formatação
- `apps/api` — upload, jobs, download com token JWT
- `apps/worker` — consome fila e grava planilha
- `frontend` — drag-and-drop pastel

## Desenvolvimento local (detalhe)

1. **Redis** em `127.0.0.1:6379` (`docker run -d -p 6379:6379 --name redis-nfe redis:7-alpine`).
2. `npm install` na pasta `webapp-01`.
3. **`npm run dev`** (recomendado) **ou** `npm run dev:stack` (sobe Redis via Compose e depois o app) **ou** dois terminais: `npm run dev:backend` e `npm run dev:fe`.

O **Vite** (`dev:fe`) faz proxy de `http://<ip>:5176/api/*` → `http://127.0.0.1:8000`. Sem processo na porta **8000**, aparece `ECONNREFUSED` no terminal do Vite.

### Se `ECONNREFUSED 127.0.0.1:8000` ou 500 em `/api/v1/jobs`

- O Vite está encaminhando para a API em **8000**, mas **nada está escutando** → suba `npm run dev:backend` (ou `node apps/api/dist/server.js` manualmente após `npm run build`).
- Confirme o **Redis** (`docker ps` ou teste `redis-cli ping`).
- Produção / variáveis próprias: copie `.env.example` para `.env` e use `JWT_SECRET` com **16+ caracteres**; para só API/worker sem o script `dev:backend`, use os comandos `set`/`export` descritos na versão antiga do README ou rode `npm run dev:api:only` e `npm run dev:worker:only` **depois** de `npm run build` nos pacotes.

Se a API estiver em outra máquina/porta, use `frontend/.env.local`:

- `VITE_API_PROXY_TARGET=http://192.168.0.47:8000` (proxy em dev), ou
- `VITE_API_URL=http://192.168.0.47:8000` (chamada direta, sem proxy).

Abra `http://192.168.0.47:5176` (ou `http://localhost:5176`).

## Docker Compose (API + worker + Redis)

Na raiz do projeto:

```bash
set JWT_SECRET=um-segredo-longo-e-aleatorio
docker compose up --build
```

API em `http://0.0.0.0:8000`. O frontend em dev continua apontando `VITE_API_URL` para essa API.

**SPED (Python):** a partir da pasta **pai** que contém `webapp-01` e `webapp-02` (e `webapp-03` para merge):

```bash
docker compose -f webapp-01/docker-compose.yml --profile sped up --build worker-sped worker-sped-merge
```

Ou inclua os serviços com profile `sped` junto da API conforme sua orquestração. O build do `worker-sped-merge` copia `webapp-02/sped_engine` e `webapp-03` para a imagem.

## GitHub

```bash
git init
git remote add origin https://github.com/CentralContabil/webapp.git
```

Use `scripts/commit-push.bat` para commit e push (mensagem como argumento).

## Testes

```bash
npm test
```

## CI/CD

- `.github/workflows/ci.yml` — build + test no push/PR
- `.github/workflows/cd.yml` — esqueleto para deploy na VPS (SSH + Compose)
