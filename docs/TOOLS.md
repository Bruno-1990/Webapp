# Ferramentas — índice de arquivos (atalho "abra exatamente aqui")

Para o mapa conceitual e o fluxo, ver [ARCHITECTURE.md](ARCHITECTURE.md). Aqui é
só "onde clicar" para cada ferramenta. Caminhos relativos à raiz `webapp/`.

## Fiscais

### NFe (XML → XLSX) — `id: nfe`
- Página: [`webapp-01/frontend/src/pages/HomePage.tsx`](../webapp-01/frontend/src/pages/HomePage.tsx)
- Worker: [`webapp-01/apps/worker`](../webapp-01/apps/worker) · core (lógica em [`packages/nfe-core`](../webapp-01/packages/nfe-core))
- API: rotas `/api/v1/jobs*` em [`server.ts`](../webapp-01/apps/api/src/server.ts)

### SPED (SPED → XLSX) — `id: sped`
- Página: [`SpedHomePage.tsx`](../webapp-01/frontend/src/pages/SpedHomePage.tsx)
- Worker: [`worker-sped-bridge`](../webapp-01/apps/worker-sped-bridge) → Engine: [`engines/sped/sped_engine`](../engines/sped/sped_engine)
- Dockerfile: [`Dockerfile.worker-sped`](../webapp-01/docker/Dockerfile.worker-sped) · env `SPED_ENGINE_DIR`

### XLSX → SPED (merge) — `id: sped-merge`
- Página: [`SpedMergeHomePage.tsx`](../webapp-01/frontend/src/pages/SpedMergeHomePage.tsx)
- Worker: [`worker-sped-merge-bridge`](../webapp-01/apps/worker-sped-merge-bridge) → Engine: [`engines/sped-merge`](../engines/sped-merge) (importa `engines/sped/sped_engine`)
- Dockerfile: [`Dockerfile.worker-sped-merge`](../webapp-01/docker/Dockerfile.worker-sped-merge) · env `SPED_MERGE_DIR`

### Consolidado SCI — `id: sci-consolidado`
- Página: [`SciConsolidadoHomePage.tsx`](../webapp-01/frontend/src/pages/SciConsolidadoHomePage.tsx)
- Worker: [`worker-sci-consolidado`](../webapp-01/apps/worker-sci-consolidado) → Engine: [`engines/sci-consolidado`](../engines/sci-consolidado)
- Dockerfile: [`Dockerfile.worker-sci-consolidado`](../webapp-01/docker/Dockerfile.worker-sci-consolidado) · env `SCI_CONSOLIDADO_PY_DIR`

### Comparador SEFAZ × SCI — `id: comparacao-planilhas`
- Página: [`ComparacaoPlanilhasHomePage.tsx`](../webapp-01/frontend/src/pages/ComparacaoPlanilhasHomePage.tsx)
- Worker: [`worker-comparacao-planilhas`](../webapp-01/apps/worker-comparacao-planilhas) → Engine: [`engines/comparacao-planilhas`](../engines/comparacao-planilhas)
- Dockerfile: [`Dockerfile.worker-comparacao`](../webapp-01/docker/Dockerfile.worker-comparacao) · env `COMPARACAO_PY_DIR`

### Comparador NFS-e (OCR Gemini) — `id: comparacao-nfse`
- Página: [`NfseComparadorHomePage.tsx`](../webapp-01/frontend/src/pages/NfseComparadorHomePage.tsx)
- Worker: [`worker-comparacao-nfse`](../webapp-01/apps/worker-comparacao-nfse) → Engine: [`engines/comparacao-nfse`](../engines/comparacao-nfse)
- Dockerfile: [`Dockerfile.worker-comparacao-nfse`](../webapp-01/docker/Dockerfile.worker-comparacao-nfse) · env `COMPARACAO_NFSE_PY_DIR` · requer `GEMINI_API_KEY`

### Conciliador NFS-e (Portal Nacional × SCI) — `id: sci-portal-nacional`
- Página: [`SciPortalNacionalHomePage.tsx`](../webapp-01/frontend/src/pages/SciPortalNacionalHomePage.tsx)
- Worker: [`worker-sci-portal-nacional`](../webapp-01/apps/worker-sci-portal-nacional) → Engine: [`engines/sci-portal-nacional`](../engines/sci-portal-nacional) (Node, `cli.mjs`)
- Dockerfile: [`Dockerfile.worker-sci-portal-nacional`](../webapp-01/docker/Dockerfile.worker-sci-portal-nacional) · env `SCI_PORTAL_DIR`

## Contábeis

### Extrator GNRE (PDF → XLSX) — `id: gnre`
- Página: [`GnreHomePage.tsx`](../webapp-01/frontend/src/pages/GnreHomePage.tsx)
- Worker: [`worker-gnre-bridge`](../webapp-01/apps/worker-gnre-bridge) → Engine: [`engines/gnre`](../engines/gnre)
- Dockerfile: [`Dockerfile.worker-gnre`](../webapp-01/docker/Dockerfile.worker-gnre) · env `GNRE_PY_DIR` · SQLite dedupe `GNRE_DB_PATH`

### Editor de Extrato (XLSX → XLSX formatado) — `id: extrato-edit`
- **Sem backend** — roda no navegador (ExcelJS).
- Página: [`ExtratoEditHomePage.tsx`](../webapp-01/frontend/src/pages/ExtratoEditHomePage.tsx)
- Lógica: [`frontend/src/extratoEdit/parseExtrato.ts`](../webapp-01/frontend/src/extratoEdit/parseExtrato.ts) · [`exportExtrato.ts`](../webapp-01/frontend/src/extratoEdit/exportExtrato.ts)

## Pontos comuns
- Manifest da API: `GET /api/v1/tools` em [`server.ts`](../webapp-01/apps/api/src/server.ts) · fallback do front em [`api.ts`](../webapp-01/frontend/src/api.ts) (`defaultToolsManifest`)
- Cards do hub (ícone/owner/cor por `id`): [`ToolsHubPage.tsx`](../webapp-01/frontend/src/pages/ToolsHubPage.tsx)
- Rotas do front: [`App.tsx`](../webapp-01/frontend/src/App.tsx)
- Nomes de fila + tipos de payload: [`packages/contracts/src/index.ts`](../webapp-01/packages/contracts/src/index.ts)
