# Arquitetura — Central de Conversões (monorepo `webapp`)

Mapa autoritativo de onde está cada coisa. **Se a realidade do código divergir
deste documento, o documento está desatualizado — corrija-o aqui.**

> 📐 **Padrão de planilha de exportação:** todo `.xlsx` entregue ao usuário segue
> [`EXPORT-STANDARD.md`](EXPORT-STANDARD.md) (cores, fontes, bordas, alturas,
> receitas ExcelJS/openpyxl/xlsxwriter). Ao criar/editar um exportador, conforme-se a ele.

## Visão geral

```
webapp/
├─ webapp-01/                 # PLATAFORMA (Node/TS) — único lugar com frontend + API + workers
│  ├─ frontend/               #   Vite + React (o hub "Central de Conversões", porta 5176)
│  ├─ apps/
│  │  ├─ api/                 #   API Fastify (porta 8000) — recebe uploads, enfileira jobs
│  │  ├─ worker/              #   worker NFe (Node puro, sem engine)
│  │  └─ worker-*-bridge/     #   1 worker por ferramenta: consome a fila e chama a engine
│  ├─ packages/contracts/     #   nomes de fila + tipos de payload (fonte da verdade)
│  └─ docker/                 #   1 Dockerfile por worker
├─ engines/                   # ENGINES — 1 pasta por ferramenta, deps isoladas (Python ou Node)
│  ├─ sped/                   #   contém sped_engine/
│  ├─ sped-merge/             #   importa engines/sped/sped_engine
│  ├─ sci-consolidado/
│  ├─ comparacao-planilhas/
│  ├─ comparacao-nfse/
│  ├─ gnre/
│  └─ sci-portal-nacional/    #   engine Node (cli.mjs), não Python
├─ docs/                      # esta documentação
├─ knowledge/                 # referência de domínio (guia EFD, exemplos SPED)
├─ docker-compose.yml         # orquestra tudo (raiz)
├─ .env                       # único arquivo de env do monorepo (.env.example é o modelo)
└─ temp_jobs/                 # bind mount ./temp_jobs:/data/jobs (entrada/saída de jobs)
```

## Convenção de nomes (o que torna a árvore navegável)

Para cada ferramenta com backend, **o mesmo nome** aparece nos quatro níveis:

> `engines/<nome>` ↔ `apps/worker-<nome>(-bridge)` ↔ rota `/tools/<nome>` ↔ `id` no manifest

Ex.: `engines/gnre` ↔ `worker-gnre-bridge` ↔ `/tools/gnre` ↔ `id: "gnre"`.
Sabendo o nome de uma ferramenta, você acha todas as suas peças.

## Fluxo de um job (ferramentas com backend)

```
Frontend (página .tsx)
   │  POST /api/v1/tools/<nome>/jobs   (multipart)
API Fastify (apps/api/src/server.ts)   → grava em temp_jobs/<id>/in, enfileira na fila BullMQ
   │  Redis
worker-<nome>(-bridge) (apps/...)      → spawn da engine (Python cli.py / Node cli.mjs)
   │  protocolo JSON-lines no stdout (progress/file/error/done)
engine (engines/<nome>)                → processa, grava o XLSX em temp_jobs/<id>/out
   │
Download: GET /api/v1/tools/<nome>/jobs/:id/download?token=<JWT>
```

A engine é localizada em runtime por uma env var (default aponta para `engines/<nome>`,
ver tabela). No Docker, o Dockerfile copia a engine e fixa essa env var.

## Registro de ferramentas (tabela autoritativa)

| Ferramenta | id / rota (`/tools/…`) | Página frontend | Worker (`apps/…`) | Engine (`engines/…`) | Env dir | Fila (`packages/contracts`) | Dockerfile (`webapp-01/docker/…`) | Service (compose) | Profile |
|---|---|---|---|---|---|---|---|---|---|
| NFe XML→XLSX | `nfe` | `HomePage.tsx` | `worker` | — (Node, em `packages/nfe-core`) | — | `nfe-convert` | `Dockerfile` (target=worker) | `worker` | core |
| SPED→XLSX | `sped` | `SpedHomePage.tsx` | `worker-sped-bridge` | `sped/sped_engine` | `SPED_ENGINE_DIR` | `sped-convert` | `Dockerfile.worker-sped` | `worker-sped` | `sped` |
| XLSX→SPED (merge) | `sped-merge` | `SpedMergeHomePage.tsx` | `worker-sped-merge-bridge` | `sped-merge` (usa `sped/sped_engine`) | `SPED_MERGE_DIR` | `sped-merge` (+ `sped-merge-inspect`) | `Dockerfile.worker-sped-merge` | `worker-sped-merge` | `sped` |
| Consolidado SCI | `sci-consolidado` | `SciConsolidadoHomePage.tsx` | `worker-sci-consolidado` | `sci-consolidado` | `SCI_CONSOLIDADO_PY_DIR` | `sci-consolidado` | `Dockerfile.worker-sci-consolidado` | `worker-sci-consolidado` | core |
| Comparador SEFAZ×SCI | `comparacao-planilhas` | `ComparacaoPlanilhasHomePage.tsx` | `worker-comparacao-planilhas` | `comparacao-planilhas` | `COMPARACAO_PY_DIR` | `comparacao-planilhas` | `Dockerfile.worker-comparacao` | `worker-comparacao-planilhas` | `comparacao` |
| Comparador NFS-e (OCR) | `comparacao-nfse` | `NfseComparadorHomePage.tsx` | `worker-comparacao-nfse` | `comparacao-nfse` | `COMPARACAO_NFSE_PY_DIR` | `comparacao-nfse` | `Dockerfile.worker-comparacao-nfse` | `worker-comparacao-nfse` | `nfse` |
| Extrator GNRE | `gnre` | `GnreHomePage.tsx` | `worker-gnre-bridge` | `gnre` | `GNRE_PY_DIR` | `gnre-extract` | `Dockerfile.worker-gnre` | `worker-gnre` | `gnre` |
| Conciliador NFS-e | `sci-portal-nacional` | `SciPortalNacionalHomePage.tsx` | `worker-sci-portal-nacional` | `sci-portal-nacional` (Node) | `SCI_PORTAL_DIR` | `sci-portal-nacional-comparacao` | `Dockerfile.worker-sci-portal-nacional` | `worker-sci-portal-nacional` | `comparacao` |
| **Editor de Extrato** | `extrato-edit` | `ExtratoEditHomePage.tsx` | — (rotas na `api`) | — | — | — | — | `api` (DB SQLite) | core |
| **NFS-e → PDF (DANFSe)** | `nfse-pdf` | `NfsePdfHomePage.tsx` | — | — | — | — | — | — | — |

**NFS-e → PDF** roda **100% no navegador**, sem API, fila, worker, engine ou
Docker. O **Editor de Extrato** parseia e exporta o `.xlsx` no navegador, mas tem
um **cadastro de clientes/fornecedores server-side**: rotas REST simples
(sem fila/Redis) em `apps/api/src/server.ts` + `apps/api/src/extrato-db.ts`
(SQLite via `better-sqlite3`) sob `/api/v1/tools/extrato-edit/*`
(`entidades` CRUD/import, `lookup`). O usuário sobe a planilha de cadastro
(Cód./Nome/CNPJ, parseada no front por `extratoEdit/parseRegistry.ts`); ao
processar um extrato, o CNPJ é vinculado pelo código do cliente/fornecedor e vira
uma coluna na exportação. Lógica em
`webapp-01/frontend/src/extratoEdit/{parseExtrato.ts,exportExtrato.ts,parseRegistry.ts,registryApi.ts,RegistryModal.tsx}` e
`webapp-01/frontend/src/nfsePdf/` (parse com DOMParser, DANFSe via pdfmake fiel à
NT-008, retenções conforme NT-007, .zip via JSZip, QR via qrcode, relatório de
retenções `.xlsx` via ExcelJS, logo em `logoData.ts`; tabela IBGE `municipios.json`
carregada sob demanda).

Categorias do hub: **Fiscal** = nfe, sped, sped-merge, sci-consolidado,
comparacao-planilhas, comparacao-nfse, sci-portal-nacional, nfse-pdf. **Contábil**
= gnre, extrato-edit.

## Como o frontend descobre as ferramentas

`GET /api/v1/tools` (em `apps/api/src/server.ts`) devolve o manifest. O frontend
faz merge com um fallback local (`frontend/src/api.ts` → `defaultToolsManifest()`)
via `mergeToolsManifest`, deduplicando por `id`. `normalizeToolId` mapeia ids
legados numerados (`webapp-0X`) para os semânticos, caso uma API antiga ainda os
envie. Ícone/owner/cor de cada card ficam em mapas keyados por `id` no
`ToolsHubPage.tsx`.

## Subir o stack (a partir da raiz `webapp/`)

```bash
# Core (api, worker NFe, sci-consolidado, redis):
docker compose up -d --build
# Stack completo:
docker compose --profile sped --profile comparacao --profile nfse --profile gnre up -d --build
```

Frontend Vite roda **fora** do Docker (porta 5176). Build context dos workers
Python é a raiz `webapp/` (por isso os Dockerfiles fazem `COPY engines/<nome> …`).

> ⚠️ **Sempre use `--build`** ao subir. Imagens antigas anteriores ao refactor
> `engines/` (2026-06-22) ainda têm a árvore `/app/webapp-0X`; com o compose novo
> apontando `*_DIR=/app/engines/<nome>`, o worker falha ao achar a engine
> (sintoma: `spawn node ENOENT` no log e job sem saída). Rebuild resolve.

## Volumes / paths de job

Bind mount único `./temp_jobs:/data/jobs` em todos os services. A API grava em
`/data/jobs/<id>/in|out/...` (path do container) e enfileira esse path; os workers
leem o mesmo path. No host Windows aparece em `D:/aplicativos/webapp/temp_jobs/<id>/`.
`worker-gnre` tem volume extra `gnre-data:/data/gnre` para o SQLite de dedupe
(`GNRE_DB_PATH=/data/gnre/gnre.db`). A **`api`** tem volume extra
`extrato-data:/data/extrato` para o SQLite do cadastro de clientes/fornecedores
do Editor de Extrato (`EXTRATO_DB_PATH=/data/extrato/extrato.db`). Em dev local
(sem Docker) o default cai em `webapp-01/data/extrato/extrato.db`. O `Dockerfile`
(build stage) instala `python3 make g++` para compilar `better-sqlite3` quando o
binário pré-compilado não está disponível; o runtime só copia o `.node` pronto.

## Pastas reservadas

`contabil-01/`, `contabil-02/` na raiz são pastas vazias reservadas para futuras
ferramentas contábeis (não versionadas enquanto vazias, não plugadas em nada).
