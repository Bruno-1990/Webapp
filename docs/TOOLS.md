# Ferramentas — índice de arquivos (atalho "abra exatamente aqui")

Para o mapa conceitual e o fluxo, ver [ARCHITECTURE.md](ARCHITECTURE.md). Aqui é
só "onde clicar" para cada ferramenta. Caminhos relativos à raiz `webapp/`.

## Fiscais

### NFe (XML → XLSX) — `id: nfe`
- Página: [`webapp-01/frontend/src/pages/HomePage.tsx`](../webapp-01/frontend/src/pages/HomePage.tsx)
- Worker: [`webapp-01/apps/worker`](../webapp-01/apps/worker) · core (lógica em [`packages/nfe-core`](../webapp-01/packages/nfe-core))
- API: rotas `/api/v1/jobs*` em [`server.ts`](../webapp-01/apps/api/src/server.ts)
- **Eventos** — XMLs de `procEventoNFe` (cancelamento, carta de correção,
  manifestação) não entram na aba `PRODUTOS`: vão para a aba `Cancelamentos`,
  cruzados com a NF-e recíproca pela chave de 44 dígitos
  ([`evento.ts`](../webapp-01/packages/nfe-core/src/evento.ts)). O link "Ir para a NF"
  é uma **fórmula `HYPERLINK`**, não o hyperlink nativo do ExcelJS — a v4.4.0 grava
  todo link como relação `External` e o Excel acusa arquivo corrompido.
- **Notas canceladas em vermelho** — as linhas da `PRODUTOS` cuja chave tem evento
  de cancelamento (`tpEvento` 110111/110112, com `cStat` 135/155 ou sem `retEvento`)
  saem com a fonte vermelha. Carta de correção e cancelamento rejeitado **não**
  pintam. Regra em `chavesCanceladas()`, pintura em `paintCanceladasRows()`.

### SPED (SPED → XLSX) — `id: sped`
- Página: [`SpedHomePage.tsx`](../webapp-01/frontend/src/pages/SpedHomePage.tsx)
- Worker: [`worker-sped-bridge`](../webapp-01/apps/worker-sped-bridge) → Engine: [`engines/sped/sped_engine`](../engines/sped/sped_engine)
- Dockerfile: [`Dockerfile.worker-sped`](../webapp-01/docker/Dockerfile.worker-sped) · env `SPED_ENGINE_DIR`
- Abas exportadas: `SHEET_ORDER` + `HEADERS` em [`config.py`](../engines/sped/sped_engine/config.py), espelhados em `SPED_EXPORT_SHEET_KEYS` nos [contracts](../webapp-01/packages/contracts/src/index.ts). Para acrescentar um REG, siga o checklist do [README do engine](../engines/sped/README.md#checklist--adicionar-um-reg-às-abas-core) — são 10 pontos, incluindo o rebuild da imagem.
- Testes: `npm run test:sped-py`, `npm run test:sped-merge-py`, `npm run test:sped-smoke`, `npm run check:sync` (de `webapp-01/`; o `lint` e o CI já chamam o `check:sync`)

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

### Comparador NFS-e (OCR) — `id: comparacao-nfse`
- Página: [`NfseComparadorHomePage.tsx`](../webapp-01/frontend/src/pages/NfseComparadorHomePage.tsx)
- Worker: [`worker-comparacao-nfse`](../webapp-01/apps/worker-comparacao-nfse) → Engine: [`engines/comparacao-nfse`](../engines/comparacao-nfse)
- Dockerfile: [`Dockerfile.worker-comparacao-nfse`](../webapp-01/docker/Dockerfile.worker-comparacao-nfse) · env `COMPARACAO_NFSE_PY_DIR`
- Extração em 3 passes, do mais barato ao mais caro:
  1. `pdf_text_extractor.py` — texto nativo via pdfplumber. Resolve ~90% dos lotes.
  2. `ocr_local.py` — rasteriza com PyMuPDF e lê com RapidOCR (ONNX/CPU). **Sem API, sem cota, offline.** Extrai por *bounding box* (rótulo→valor), não por texto linearizado.
  3. `pdf_extractor.py` — OCR Gemini. Fallback **opcional**; sem `GEMINI_API_KEY` o passe é pulado.
- Toda chave lida por OCR passa por `chave_nfse.py`, que a cruza com o CNPJ do prestador e o número da nota lidos em separado. Um dígito errado na chave elimina a nota silenciosamente (pela regra do comparador, PDF com chave não cai no fallback de `cnpj+numero`), então a chave suspeita é descartada para que a nota volte a poder casar.
- Arquivo que não é lido por nenhum passe sai em `pdfFalhos` com motivo, aparece na tela (10 primeiros) e na aba **"Nao lidos"** do XLSX (lista completa).

### Conciliador NFS-e (Portal Nacional × SCI) — `id: sci-portal-nacional`
- Página: [`SciPortalNacionalHomePage.tsx`](../webapp-01/frontend/src/pages/SciPortalNacionalHomePage.tsx)
- Worker: [`worker-sci-portal-nacional`](../webapp-01/apps/worker-sci-portal-nacional) → Engine: [`engines/sci-portal-nacional`](../engines/sci-portal-nacional) (Node, `cli.mjs`)
- Dockerfile: [`Dockerfile.worker-sci-portal-nacional`](../webapp-01/docker/Dockerfile.worker-sci-portal-nacional) · env `SCI_PORTAL_DIR`

### Concatenador de Planilhas — `id: concatenador-planilhas`
- Página: [`ConcatenadorPlanilhasHomePage.tsx`](../webapp-01/frontend/src/pages/ConcatenadorPlanilhasHomePage.tsx)
- Worker: [`worker-concatenador-planilhas`](../webapp-01/apps/worker-concatenador-planilhas) → Engine: [`engines/concatenador-planilhas`](../engines/concatenador-planilhas) (Node, `cli.mjs`)
- Dockerfile: [`Dockerfile.worker-concatenador-planilhas`](../webapp-01/docker/Dockerfile.worker-concatenador-planilhas) · env `CONCATENADOR_DIR`
- Emenda N planilhas de mesmo layout numa só. Ordem dos blocos = menor valor da coluna `#` (fallback: ordem natural do nome). O `#` é **preservado**, nunca reescrito; furos/repetições viram aviso no `result` do job. Cabeçalho divergente é erro. Regras completas no [README do engine](../engines/concatenador-planilhas/README.md).
- **Confronto antes de concatenar** (mesma regra na API e no frontend, em [`packages/contracts`](../webapp-01/packages/contracts/src/index.ts) → `checkConcatenadorCompatibilidade`): o **CNPJ no início do nome do arquivo** (titular do relatório) e o **tipo** (`Emitente`/`Destinatario`) têm de ser iguais em todas as partes. Divergiu → `400` com `reasons: ["cnpjs_diferentes" | "tipos_misturados"]` e modal na tela. As colunas de CNPJ/CPF *dentro* da planilha não entram na conta — são de clientes/fornecedores de cada nota. Nomes fora do padrão são ignorados na comparação (a ferramenta serve para planilhas genéricas).
- Nome do arquivo de saída: [`concatenador-filename.ts`](../webapp-01/apps/api/src/concatenador-filename.ts) — reaproveita o prefixo dos nomes de entrada (`<CNPJ>_NFEs_<Emitente|Destinatario>`) e recalcula o período com a **menor data inicial** e a **maior data final** das partes. Prefixos divergentes ou nomes fora do padrão → `Planilha Unificada.xlsx`.

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
