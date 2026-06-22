# webapp-01 — Plataforma de conversões (hub + ferramentas)

Monorepo **Node.js + TypeScript**: API **Fastify**, fila **BullMQ** + **Redis**, workers assíncronos, frontend **Vite + React** (porta **5176**, LAN).

### Repositório GitHub (uma repo, várias ferramentas)

Este repositório concentra a **plataforma** e as **ferramentas** atuais e futuras (NFe, SPED, etc.). Novas ferramentas entram como pastas/workers adicionais (ex.: [webapp-02](../webapp-02) para SPED) sem obrigar outro repositório.

- **Hub:** `/` lista ferramentas (`GET /api/v1/tools` alimenta os cards). Categorias **Fiscais** e **Contábeis** no header (`?cat=contabil`).
- **NFe XML → XLSX:** `/tools/nfe` (rotas legadas de API: `POST /api/v1/jobs` inalteradas).
- **SPED → XLSX:** `/tools/sped`; motor Python em **[webapp-02](../webapp-02)/sped_engine** (worker `worker-sped-bridge`). A planilha exportada inclui a coluna **`_LINHA`** (número da linha no `.txt` original).
- **XLSX → SPED (webapp-03):** `/tools/sped-merge`; mescla o XLSX editado de volta no `.txt` preservando linhas que não estão na planilha. Requer o XLSX gerado pela exportação atual (**com `_LINHA`**). Código Python em **[webapp-03](../webapp-03)**; worker Node `worker-sped-merge-bridge`.
- **Consolidado SCI (webapp-04):** `/tools/sci-consolidado`; exportação SCI → **ProdutosSCI.xlsx**. Código Python em **[webapp-04](../webapp-04)**; worker Node `worker-sci-consolidado`.
- **Comparador SEFAZ × SCI (webapp-05):** `/tools/comparacao-planilhas`; identifica notas SEFAZ que faltam no SCI. Código Python em **[webapp-05](../webapp-05)**.
- **Comparador NFS-e PDF × XML (webapp-06):** `/tools/comparacao-nfse`; OCR via Gemini para PDFs vs parser XML. Código Python em **[webapp-06](../webapp-06)**.
- **Extrator GNRE (webapp-07):** `/tools/gnre`; seleciona pasta com PDFs de guias GNRE → planilha (`Lançamentos` + `Falhas`) com dedupe SQLite persistente. Código Python em **[webapp-07](../webapp-07)**.
- **Editor de Extrato:** `/tools/extrato-edit`; **100% no navegador** (sem worker/Python, sem porta nova). Recebe um `.xlsx` de relatório (ex.: "Contas Pagas" do SIST): colapsa células mescladas, **explode a data das linhas separadoras (`DT. PAGAMENTO:`) numa coluna à esquerda** de cada lançamento, descarta preâmbulo/cabeçalhos repetidos/totais/linhas em branco, deixa **reordenar colunas por arrasto** e marcar/desmarcar o que exportar, e baixa um `.xlsx` formatado (cabeçalho Azul Royal/altura 30, linhas altura 22, dados à esquerda). Leitura/escrita com **exceljs** no front (chunk lazy). Tem **fallback genérico** para outros formatos de planilha. Categoria **Contábil**. Página: `frontend/src/pages/ExtratoEditHomePage.tsx` + lógica em `frontend/src/extratoEdit/`.

**Pastas irmãs no disco:** `webapp-01` até `webapp-07` no mesmo diretório pai (caminhos padrão dos workers). **O `docker-compose.yml` e o serviço Redis ficam na raiz** (`../`).

---

## Ferramenta NFe (referência rápida)

Monorepo **Node.js + TypeScript** para XML NFe → XLSX: API **Fastify**, fila **BullMQ** + **Redis**, worker assíncrono.

### Início rápido (um comando)

1. **Redis** em `127.0.0.1:6379` — **na raiz do monorepo** (`../`): `npm run redis:up` (Docker).
2. **`npm install`** na pasta `webapp-01` (ou `npm run install:app` na raiz).
3. **`npm run dev`** (na raiz **ou** em `webapp-01`) — compila API/workers e sobe **API + workers + Vite** (`dev:all`).
   - Para SPED, XLSX→SPED, Consolidado SCI, Comparadores e GNRE: **Python** com `pip install -r requirements.txt` em cada `webapp-0X` (ou um venv único). Alternativa one-shot: `npm run dev:stack` na raiz (sobe Redis e em seguida o dev).

**Só interface:** `npm run dev:fe` (em `webapp-01`) sobe apenas o Vite; aí é preciso **`npm run dev:backend`** (ou API na porta 8000) em outro terminal, senão o proxy dá `ECONNREFUSED`.

## Estrutura

- `packages/contracts` — constantes e schemas compartilhados
- `packages/nfe-core` — parse XML NFe + consolidação (port do `core_nfe.py`)
- `packages/excel-export` — geração XLSX com **exceljs** + formatação
- `apps/api` — upload, jobs, download com token JWT
- `apps/worker` — consome fila e grava planilha
- `frontend` — drag-and-drop pastel

## Desenvolvimento local (detalhe)

1. **Redis** em `127.0.0.1:6379` — `npm run redis:up` **na raiz** (`docker compose up -d redis`). Avulso: `docker run -d -p 6379:6379 --name redis-nfe redis:7-alpine`.
2. `npm install` na pasta `webapp-01`.
3. **`npm run dev`** (recomendado, raiz ou `webapp-01`) **ou** `npm run dev:stack` na raiz (sobe Redis e depois o app) **ou** dois terminais: `npm run dev:backend` e `npm run dev:fe`.

O **Vite** (`dev:fe`) faz proxy de `http://<ip>:5176/api/*` → `http://127.0.0.1:8000`. Sem processo na porta **8000**, aparece `ECONNREFUSED` no terminal do Vite.

### Se `ECONNREFUSED 127.0.0.1:8000` ou 500 em `/api/v1/jobs`

- O Vite está encaminhando para a API em **8000**, mas **nada está escutando** → suba `npm run dev:backend` (ou `node apps/api/dist/server.js` manualmente após `npm run build`).
- Confirme o **Redis** (`docker ps` ou teste `redis-cli ping`).
- Produção / variáveis próprias: copie `../.env.example` (raiz do monorepo) para `../.env` e use `JWT_SECRET` com **16+ caracteres**; para só API/worker sem o script `dev:backend`, use os comandos `set`/`export` descritos na versão antiga do README ou rode `npm run dev:api:only` e `npm run dev:worker:only` **depois** de `npm run build` nos pacotes.

Se a API estiver em outra máquina/porta, use o `.env` da raiz do monorepo (mesmo arquivo lido por API e workers):

- `VITE_API_PROXY_TARGET=http://192.168.0.47:8000` (proxy em dev), ou
- `VITE_API_URL=http://192.168.0.47:8000` (chamada direta, sem proxy).

Abra `http://192.168.0.47:5176` (ou `http://localhost:5176`).

## Docker Compose (API + workers + Redis)

O `docker-compose.yml` vive **só na raiz do monorepo** (`../docker-compose.yml`). Rode os comandos `docker compose ...` sempre a partir de lá.

Na **raiz do projeto**:

```bash
set JWT_SECRET=um-segredo-longo-e-aleatorio
docker compose up --build
```

API em `http://0.0.0.0:8000`. O frontend em dev continua apontando `VITE_API_URL` para essa API.

### Profiles opcionais (workers Python)

A stack **core** (`redis`, `api`, `worker` NFe, `worker-sci-consolidado`) sobe sem profile — `docker compose up -d --build` na raiz já entrega: NFe XML→XLSX e Consolidado SCI (webapp-04) prontos. Workers Python adicionais entram via profile:

```bash
# SPED export + merge (webapp-02 + webapp-03)
docker compose --profile sped up -d --build worker-sped worker-sped-merge

# Comparador SEFAZ × SCI (webapp-05)
docker compose --profile comparacao up -d --build

# Comparador NFS-e PDF × XML (webapp-06, exige GEMINI_API_KEY)
docker compose --profile nfse up -d --build

# Extrator GNRE (webapp-07, volume persistente para SQLite em gnre-data:/data/gnre)
docker compose --profile gnre up -d --build

# Tudo de uma vez:
docker compose --profile sped --profile comparacao --profile nfse --profile gnre up -d --build
```

Os Dockerfiles dos workers copiam o código Python da respectiva pasta irmã (`webapp-02..07`), então o build precisa rodar a partir da pasta-pai (que já é o cwd da raiz do monorepo).

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
