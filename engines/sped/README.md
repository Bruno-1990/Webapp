# engines/sped — SPED EFD → XLSX

Engine Python da ferramenta **SPED → XLSX** (contém `sped_engine/`). Mapa completo em `docs/ARCHITECTURE.md`.

## Mapa no ecossistema

| Pasta / projeto | Função |
|-----------------|--------|
| **[webapp-01](../../webapp-01)** | Plataforma: API Fastify, frontend (hub + NFe), worker Node **NFe**, Redis, Docker Compose |
| **engines/sped** (esta pasta) | Código **SPED**: CLI Python, worker/container, testes — **sem** duplicar a API HTTP |
| **[Sped to XLSx v2](../Sped to XLSx v2)** (Desktop) | Origem da lógica Python (reader, parser, processor, XlsxWriter); referência para portar/empacotar aqui |

## Integração prevista

- A API em `webapp-01` expõe rotas `/api/v1/tools/sped/*` (fila `sped-convert`) quando o backend SPED estiver pronto.
- O worker SPED (Docker) será construído a partir do conteúdo desta pasta (ou copiando/adaptando módulos do projeto desktop).
- O frontend em `webapp-01` já aponta o card **SPED → XLSX** para `/tools/sped` (placeholder até a API existir).

## Guia de registros (documentação)

O ficheiro **[sped_engine/cabecalhos_sped.txt](sped_engine/cabecalhos_sped.txt)** descreve os **REG** do layout EFD (blocos 0, 1, 9, B, C, D, E, G, H, K), com **título** e, quando aplicável, **linha de cabeçalho** (`REG | CAMPO | …`) alinhada a `config.py` para exportação.

- É lido pelo Python (`cabecalhos_sped.py`) e pela API (`GET /api/v1/tools/sped/reg-meta`), que alimenta tooltips na UI.
- Cópia em **`webapp-01/apps/api/src/data/cabecalhos-sped.txt`** — manter **igual** ao ficheiro em `sped_engine` ao alterar o guia.

## Próximos passos (implementação)

1. `requirements.txt` + estrutura `src/` ou `sped_worker/` com CLI headless.
2. Dockerfile `worker-sped` e serviço no `docker-compose` do webapp-01 (profile `sped`).
3. Contrato de job alinhado ao NFe (`jobId`, `inputPath`, `outputPath`, progresso BullMQ).
