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

### NFS-e → PDF (DANFSe) — `id: nfse-pdf`
- **Sem backend** — roda 100% no navegador. Seleciona uma **pasta** de XMLs de NFS-e (padrão nacional), gera um PDF DANFSe por nota e baixa tudo num `.zip`. XMLs de evento (cancelamento) viram PDF de evento.
- Entrada por **pasta**: picker nativo (Chrome/Edge) com fallback `webkitdirectory`; reaproveita `pickDirectoryAndReadFiles("xml-only")`/`getXmlOnlyFilesFromEvent` de `dropFiles.ts`.
- Layout do DANFSe **fiel ao oficial** (NT-008) com logo embutida; discriminação de retenções conforme **NT-007** (`tpRetPisCofins`, `vRetCSLL` = soma PIS+COFINS+CSLL, `vPis`/`vCofins` = débito de apuração própria; ISSQN retido via `tpRetISSQN`).
- Após gerar, mostra um **painel de retenções** (uma linha por nota com retenção) com download de **relatório `.xlsx`**; se não houver, avisa "nenhuma retenção".
- Página: [`NfsePdfHomePage.tsx`](../webapp-01/frontend/src/pages/NfsePdfHomePage.tsx)
- Lógica: [`frontend/src/nfsePdf/`](../webapp-01/frontend/src/nfsePdf) — `parseNfse.ts` (DOMParser) · `nfseEnums.ts`/`format.ts` (domínios NT-007 + formatação) · `danfseDoc.ts`/`eventoDoc.ts` (pdfmake) · `logoData.ts` (logo NFS-e base64) · `generateZip.ts` (JSZip + coleta de retenções) · `retencaoReport.ts` (relatório ExcelJS) · `qr.ts` (qrcode) · `municipios.ts` (+ `municipios.json`, tabela IBGE lazy)
- Libs: `pdfmake`, `jszip`, `qrcode`, `exceljs` (todas carregadas sob demanda).

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
