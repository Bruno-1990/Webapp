# Deploy na VPS — backend das Ferramentas Fiscais/Contábeis do OneClick V2

Este repo é o **backend de processamento** (API Fastify + workers + engines) das 10 ferramentas
do módulo "Ferramentas" do OneClick V2. O OneClick (frontend + gateway) já está em produção;
**sem esta stack no ar, as 8 ferramentas job-based não funcionam** (SPED, NFe, XLSX→SPED,
Consolidado SCI, Comparador Planilhas, Comparador NFS-e, Conciliador NFS-e, GNRE).
As 2 browser-only (`nfse-pdf`, `extrato-edit`) rodam no navegador — `extrato-edit` usa esta API
só para o cadastro de clientes/fornecedores (SQLite).

## Arquitetura em produção

```
Browser → OneClick web → OneClick API (gateway ferramentas, por tenant)
                              │ WEBAPP_API_URL=http://webapp-api:8000  (rede fiscal_net)
                              ▼
                    webapp-api (Fastify :8000, /api/v1)
                              │ redis://redis:6379 (rede interna do compose)
                              ▼
                    workers → engines (Python/Node) → download via token JWT (15 min)
```

- O browser **nunca** fala com o webapp; o OneClick faz proxy server-to-server e faz stream do download.
- A rede **`fiscal_net`** é criada automaticamente por este compose (`name: fiscal_net`);
  o `oneclick-api` entra nela pelo override do OneClick (declarada `external: true` lá).
- O webapp **não tem autenticação própria** — nunca exponha a porta 8000 na internet.

## Passo a passo (VPS)

```bash
# 0) espaço para o build (as imagens têm engines Python; o cache pode ser grande)
docker builder prune -f

# 1) código
cd /opt
git clone https://github.com/Bruno-1990/Webapp.git webapp
cd /opt/webapp

# 2) .env (baseado no .env.example)
#    JWT_SECRET: obrigatório (assina tokens de download) — openssl rand -base64 48
#    GEMINI_API_KEY: só se for subir o profile nfse (Comparador NFS-e, OCR)
cp .env.example .env && nano .env

# 3) build + subir (suba só os profiles das ferramentas que vai liberar)
docker compose --profile sped --profile comparacao --profile nfse --profile gnre up -d --build

# 4) health
curl -s http://127.0.0.1:8000/api/v1/health     # → {"ok":true}
curl -s http://127.0.0.1:8000/api/v1/tools      # manifest das ferramentas

# 5) ligar o OneClick (lado do OneClick, /opt/oneclick):
#    a) docker-compose.override.yml: adicionar a rede ao serviço api
#         services:
#           api:
#             networks: [default, n8n_default, fiscal_net]
#         networks:
#           fiscal_net:
#             external: true
#    b) /opt/oneclick/.env:  WEBAPP_API_URL=http://webapp-api:8000
#    c) recriar:  cd /opt/oneclick && docker compose up -d
#    d) gate de boot: curl -s http://127.0.0.1:4100/api/health  → 200

# 6) teste de alcance (de dentro do oneclick-api):
docker exec oneclick-api sh -lc 'wget -qO- http://webapp-api:8000/api/v1/health'

# 7) provisionar histórico de jobs nos tenants EXISTENTES (uma vez, repo do OneClick):
#    pnpm --filter @saas/db db:push          (mostra diff; NUNCA reset/--accept-data-loss)
#    pnpm --filter @saas/db exec tsx prisma/backfill-tool-jobs-tenants.ts
```

## Mapa profile → ferramenta

| Profile | Ferramentas | Observações |
|---|---|---|
| *(core, sempre)* | `nfe`, `sci-consolidado` | — |
| `sped` | `sped`, `sped-merge` | engines Python |
| `comparacao` | `comparacao-planilhas`, `sci-portal-nacional` | — |
| `nfse` | `comparacao-nfse` | exige `GEMINI_API_KEY`; uploads até 300 MB |
| `gnre` | `gnre` | dedupe SQLite em volume `gnre-data`; uploads até 300 MB |

## Portas

| Porta | O quê | Exposição |
|---|---|---|
| 8000 | API Fastify | host (dev/diagnóstico). **Bloquear externamente em produção** (firewall Hostinger). O OneClick usa `webapp-api:8000` pela `fiscal_net`, não a porta do host. |
| 6381→6379 | Redis do webapp | host 6381 (a 6379 é do OneClick). Interno segue `redis:6379`. |

## Teste E2E (piloto SPED)

Logar no OneClick com permissão `ferramentas-fiscal` (sub-perm `sped`) → **Fiscal → Ferramentas → SPED**
→ inspect → upload `.txt` → progresso → download `.xlsx` → job aparece no histórico **escopado à empresa**.

## Rollback

`cd /opt/webapp && docker compose down` — a stack é 100% aditiva (rede própria + `fiscal_net`);
remover `WEBAPP_API_URL` do `.env` do OneClick e recriar o `oneclick-api` desfaz a integração.
