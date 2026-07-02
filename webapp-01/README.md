# webapp-01 — Plataforma de conversões (hub + ferramentas)

Monorepo **Node.js + TypeScript**: API **Fastify**, fila **BullMQ** + **Redis**, workers assíncronos, frontend **Vite + React** (porta **5176**, LAN).

### Repositório GitHub (uma repo, várias ferramentas)

Este repositório concentra a **plataforma** (webapp-01) e as **engines** das ferramentas (`../engines/<nome>`). Novas ferramentas entram como `engines/<nome>` + worker bridge, sem obrigar outro repositório. Mapa completo em [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

- **Hub:** `/` lista ferramentas (`GET /api/v1/tools` alimenta os cards). Categorias **Fiscais** e **Contábeis** no header (`?cat=contabil`).
- **NFe XML → XLSX:** `/tools/nfe` (rotas legadas de API: `POST /api/v1/jobs` inalteradas).
- **SPED → XLSX:** `/tools/sped`; motor Python em **[engines/sped](../engines/sped)/sped_engine** (worker `worker-sped-bridge`). A planilha exportada inclui a coluna **`_LINHA`** (número da linha no `.txt` original).
- **XLSX → SPED:** `/tools/sped-merge`; mescla o XLSX editado de volta no `.txt` preservando linhas que não estão na planilha. Requer o XLSX gerado pela exportação atual (**com `_LINHA`**). Código Python em **[engines/sped-merge](../engines/sped-merge)**; worker Node `worker-sped-merge-bridge`.
- **Consolidado SCI:** `/tools/sci-consolidado`; exportação SCI → **ProdutosSCI.xlsx**. Código Python em **[engines/sci-consolidado](../engines/sci-consolidado)**; worker Node `worker-sci-consolidado`.
- **Comparador SEFAZ × SCI:** `/tools/comparacao-planilhas`; identifica notas SEFAZ que faltam no SCI. Código Python em **[engines/comparacao-planilhas](../engines/comparacao-planilhas)**.
- **Comparador NFS-e PDF × XML:** `/tools/comparacao-nfse`; OCR via Gemini para PDFs vs parser XML. Código Python em **[engines/comparacao-nfse](../engines/comparacao-nfse)**.
- **Conciliador NFS-e:** `/tools/sci-portal-nacional`; concilia SCI × SEFAZ (Portal Nacional) gerando conciliação multi-aba. Engine **TypeScript puro** (sem Python) em **[engines/sci-portal-nacional](../engines/sci-portal-nacional)**; worker Node `worker-sci-portal-nacional` (profile `comparacao`).
- **NFS-e → PDF (DANFSe):** `/tools/nfse-pdf`; geração **no navegador** (sem worker/Python, sem porta nova). Seleciona a pasta com XMLs de NFS-e (padrão nacional), gera um PDF DANFSe por nota (layout NT-008, retenções NT-007) e baixa tudo num `.zip`; XMLs de evento viram PDF de evento. Mostra um painel de notas com retenção e baixa um relatório `.xlsx`. Categoria **Fiscal**. Página: `frontend/src/pages/NfsePdfHomePage.tsx` + lógica em `frontend/src/nfsePdf/`.
- **Extrator GNRE:** `/tools/gnre`; seleciona pasta com PDFs de guias GNRE → planilha (`Lançamentos` + `Falhas`) com dedupe SQLite persistente. Código Python em **[engines/gnre](../engines/gnre)**.
- **Editor de Extrato:** `/tools/extrato-edit`; parse/exportação **no navegador** (exceljs, sem worker/Python, sem porta nova), com **cadastro de clientes/fornecedores server-side** (SQLite). Recebe um `.xlsx` de relatório (ex.: "Contas Pagas" do SIST): colapsa células mescladas, **explode a data das linhas separadoras (`DT. PAGAMENTO:`) numa coluna à esquerda** de cada lançamento, descarta preâmbulo/cabeçalhos repetidos/totais/linhas em branco, deixa **reordenar colunas por arrasto** e marcar/desmarcar o que exportar, e baixa um `.xlsx` formatado conforme o [padrão de exportação do sistema](../docs/EXPORT-STANDARD.md) (cabeçalho Azul Royal/altura 30, linhas altura 22, tudo centralizado, bordas cinza). Tem **fallback genérico** para outros formatos. **Cadastro (botão "+Add. Cliente / Fornecedor"):** o usuário sobe a planilha de cadastro — reconhece os **exports do Totvs/Winthor PC** (`PCCLIENT`/`PC_FORNEC`: campos `CODCLI`/`CODFORNEC`, `CLIENTE`/`FORNECEDOR`, `CGCENT`/`CGC`, com cabeçalho multi-linha e dados a partir da 5ª linha) **ou** uma planilha simples com Código/Nome/CNPJ; o **tipo é auto-detectado** pelo cabeçalho. Guarda só **código, nome e CNPJ** no banco (PK = `(tipo, código)`) via rotas `/api/v1/tools/extrato-edit/*` (na API existente na 8000, **sem porta nova**; SQLite em `EXTRATO_DB_PATH`, volume `extrato-data`). Ao processar um extrato (que tem nome, mas não CNPJ), a ferramenta **vincula o CNPJ pelo `Cód. Cliente`/`Cód. Fornecedor`** e adiciona uma coluna **CNPJ** na saída. Categoria **Contábil**. Página: `frontend/src/pages/ExtratoEditHomePage.tsx` + lógica em `frontend/src/extratoEdit/`; backend em `apps/api/src/extrato-db.ts`.

**Layout no disco:** `webapp-01` (plataforma) e `engines/<nome>` (engines das ferramentas) sob a raiz do monorepo (caminhos padrão dos workers). **O `docker-compose.yml` e o serviço Redis ficam na raiz** (`../`).

---

## Ferramenta NFe (referência rápida)

Monorepo **Node.js + TypeScript** para XML NFe → XLSX: API **Fastify**, fila **BullMQ** + **Redis**, worker assíncrono.

### Início rápido (um comando)

1. **Redis** em `127.0.0.1:6381` — **na raiz do monorepo** (`../`): `npm run redis:up` (Docker).
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

1. **Redis** em `127.0.0.1:6381` — `npm run redis:up` **na raiz** (`docker compose up -d redis`). Avulso: `docker run -d -p 6381:6379 --name redis-nfe redis:7-alpine`.
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

A stack **core** (`redis`, `api`, `worker` NFe, `worker-sci-consolidado`) sobe sem profile — `docker compose up -d --build` na raiz já entrega: NFe XML→XLSX e Consolidado SCI prontos. Workers adicionais entram via profile:

```bash
# SPED export + merge (engines/sped + engines/sped-merge)
docker compose --profile sped up -d --build worker-sped worker-sped-merge

# Comparador SEFAZ × SCI + Conciliador NFS-e (engines/comparacao-planilhas, engines/sci-portal-nacional)
docker compose --profile comparacao up -d --build

# Comparador NFS-e PDF × XML (engines/comparacao-nfse, exige GEMINI_API_KEY)
docker compose --profile nfse up -d --build

# Extrator GNRE (engines/gnre, volume persistente para SQLite em gnre-data:/data/gnre)
docker compose --profile gnre up -d --build

# Tudo de uma vez:
docker compose --profile sped --profile comparacao --profile nfse --profile gnre up -d --build
```

Os Dockerfiles dos workers copiam o código da respectiva engine (`engines/<nome>`), então o build precisa rodar a partir da raiz do monorepo (já é o cwd). Ver [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

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
