import { z } from "zod";

export { loadDotenvFromUpwards } from "./dotenv.js";

export const API_PREFIX = "/api/v1" as const;

export const QUEUE_NAME = "nfe-convert" as const;

/** Fila BullMQ dedicada ao SPED (worker bridge + Python). */
export const SPED_QUEUE_NAME = "sped-convert" as const;

/** XLSX (com _LINHA) + SPED .txt → SPED .txt mesclado (engines/sped-merge). */
export const SPED_MERGE_QUEUE_NAME = "sped-merge" as const;

/** Inspeção rápida da planilha XLSX (síncrona pela API via waitUntilFinished). */
export const SPED_MERGE_INSPECT_QUEUE_NAME = "sped-merge-inspect" as const;

/** Planilha SCI (CSV/Excel) → ProdutosSCI.xlsx (Python). */
export const SCI_CONSOLIDADO_QUEUE_NAME = "sci-consolidado" as const;

/** Comparação SEFAZ vs SCI → Notas Faltantes.xlsx (engines/comparacao-planilhas). */
export const COMPARACAO_PLANILHAS_QUEUE_NAME = "comparacao-planilhas" as const;

/** Conciliador NFS-e: SCI x SEFAZ (Portal Nacional) → Conciliação multi-aba (TS puro, engines/sci-portal-nacional). */
export const SCI_PORTAL_NACIONAL_QUEUE_NAME = "sci-portal-nacional-comparacao" as const;

export const SciConsolidadoJobPayloadSchema = z.object({
  jobId: z.string(),
  inputPath: z.string(),
  outputPath: z.string(),
  sheetName: z.string().optional(),
});

export type SciConsolidadoJobPayload = z.infer<typeof SciConsolidadoJobPayloadSchema>;

/**
 * Abas exportadas pelo motor SPED (engines/sped). Manter igual a `SHEET_ORDER` em
 * `engines/sped/sped_engine/config.py`.
 */
export const SPED_EXPORT_SHEET_KEYS = [
  "0150",
  "0200",
  "C100",
  "C170",
  "C190",
  "C500",
  "C590",
  "D100",
  "D190",
  "D500",
  "D590",
] as const;

export type SpedExportSheetKey = (typeof SPED_EXPORT_SHEET_KEYS)[number];

/** Código REG SPED (4 caracteres alfanuméricos). */
export const SPED_REG_CODE_RE = /^[0-9A-Z]{4}$/;

export const SPED_MAX_SHEETS_PER_JOB = 128;
export const SPED_MAX_PRESENT_REGS = 500;
/** Limite do CSV repassado ao Python em --sheets. */
export const SPED_MAX_SHEETS_CSV_BYTES = 8192;

export const SpedInspectResponseSchema = z.object({
  presentRegs: z.array(z.string()),
});

export type SpedInspectResponse = z.infer<typeof SpedInspectResponseSchema>;

/** Metadados do guia `cabecalhos_sped.txt` (título curto e bloco SPED por REG). */
export const SpedRegMetaResponseSchema = z.object({
  descriptions: z.record(z.string()),
  blockByReg: z.record(z.string()),
});

export type SpedRegMetaResponse = z.infer<typeof SpedRegMetaResponseSchema>;

/** Rótulos alinhados ao guia `cabecalhos_sped.txt` (EFD ICMS/IPI / referência interna). */
export const SPED_EXPORT_SHEET_LABELS: Record<SpedExportSheetKey, string> = {
  "0150": "0150 — Participantes",
  "0200": "0200 — Itens (produtos/serviços)",
  C100: "C100 — Documento fiscal (NF-e 55/65 e equivalentes)",
  C170: "C170 — Itens do documento fiscal",
  C190: "C190 — Registro analítico do documento",
  C500: "C500 — Nota de energia, gás, água e comunicação",
  C590: "C590 — Registro analítico (C500)",
  D100: "D100 — Documento de transporte (CT-e e equivalentes)",
  D190: "D190 — Registro analítico do CT-e",
  D500: "D500 — Nota de serviço de comunicação e telecomunicação",
  D590: "D590 — Registro analítico (D500)",
};

export const SpedJobPayloadSchema = z.object({
  jobId: z.string(),
  inputPath: z.string(),
  outputPath: z.string(),
  /** Subconjunto de abas; omitir ou vazio = todas (comportamento legado). */
  sheets: z.array(z.string()).optional(),
  /** Último resultado de /tools/sped/inspect para o mesmo arquivo; obrigatório se sheets tiver REG fora do core. */
  presentRegs: z.array(z.string()).optional(),
});

export type SpedJobPayload = z.infer<typeof SpedJobPayloadSchema>;

export const SpedMergeJobPayloadSchema = z.object({
  jobId: z.string(),
  spedPath: z.string().optional(),
  xlsxPath: z.string(),
  outputPath: z.string(),
});

export type SpedMergeJobPayload = z.infer<typeof SpedMergeJobPayloadSchema>;

export const SpedMergeInspectXlsxResponseSchema = z.object({
  complete: z.boolean(),
  requiresOriginal: z.boolean(),
  reasons: z.array(z.string()),
  regSheets: z.array(z.string()),
});

export type SpedMergeInspectXlsxResponse = z.infer<typeof SpedMergeInspectXlsxResponseSchema>;

export const SpedMergeInspectJobPayloadSchema = z.object({
  jobId: z.string(),
  xlsxPath: z.string(),
});

export type SpedMergeInspectJobPayload = z.infer<typeof SpedMergeInspectJobPayloadSchema>;

export const JobStatusSchema = z.enum([
  "queued",
  "running",
  "done",
  "failed",
  "not_found",
]);

export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobStatusResponseSchema = z.object({
  id: z.string(),
  status: JobStatusSchema,
  progress: z.number().min(0).max(100).optional(),
  error: z.string().optional(),
  downloadToken: z.string().optional(),
  fileName: z.string().optional(),
});

export type JobStatusResponse = z.infer<typeof JobStatusResponseSchema>;

export const CreateJobResponseSchema = z.object({
  id: z.string(),
  status: z.literal("queued"),
});

export type CreateJobResponse = z.infer<typeof CreateJobResponseSchema>;

export const ComparacaoPlanilhasJobPayloadSchema = z.object({
  jobId: z.string(),
  sefazPaths: z.array(z.string()),
  sciPaths: z.array(z.string()),
  outputPath: z.string(),
});

export type ComparacaoPlanilhasJobPayload = z.infer<typeof ComparacaoPlanilhasJobPayloadSchema>;

export const SciPortalNacionalJobPayloadSchema = z.object({
  jobId: z.string(),
  sciPath: z.string(),
  portalPath: z.string(),
  outputPath: z.string(),
});

export type SciPortalNacionalJobPayload = z.infer<typeof SciPortalNacionalJobPayloadSchema>;

/** Comparacao NFS-e: PDF (OCR via Gemini) × XML (parser) → divergencias (engines/comparacao-nfse). */
export const COMPARACAO_NFSE_QUEUE_NAME = "comparacao-nfse" as const;

/** Extrator GNRE: PDFs → XLSX (Lançamentos + Falhas), com dedupe SQLite (engines/gnre). */
export const GNRE_QUEUE_NAME = "gnre-extract" as const;

export const GnreJobPayloadSchema = z.object({
  jobId: z.string(),
  pdfsDir: z.string(),
  outputXlsx: z.string(),
});

export type GnreJobPayload = z.infer<typeof GnreJobPayloadSchema>;

export const ComparacaoNfseJobPayloadSchema = z.object({
  jobId: z.string(),
  pdfsDir: z.string(),
  xmlsDir: z.string(),
  outputXlsx: z.string(),
  outputJson: z.string(),
});

export type ComparacaoNfseJobPayload = z.infer<typeof ComparacaoNfseJobPayloadSchema>;

export const NfseEntrySchema = z.object({
  cnpjTomador: z.string().nullable().optional(),
  numeroNf: z.string().nullable().optional(),
  chaveNf: z.string().nullable().optional(),
  sourceFile: z.string(),
  /** "local" = pdfplumber, "ocr" = Gemini, undefined = entry de XML. */
  method: z.enum(["local", "ocr"]).nullable().optional(),
  /** CNPJ do prestador (quem emitiu a nota). */
  cnpjPrestador: z.string().nullable().optional(),
  /** Razao Social do prestador. */
  razaoSocialPrestador: z.string().nullable().optional(),
  /** Razao Social do tomador (usada no nome do arquivo). */
  razaoSocialTomador: z.string().nullable().optional(),
});

export type NfseEntry = z.infer<typeof NfseEntrySchema>;

export const NfseFailureSchema = z.object({
  file: z.string(),
  reason: z.string(),
});

export type NfseFailure = z.infer<typeof NfseFailureSchema>;

export const NfseExtractStatsSchema = z.object({
  /** PDFs extraidos localmente (pdfplumber, gratis e instantaneo). */
  local: z.number(),
  /** PDFs que cairam no OCR Gemini (so imagem ou layout incomum). */
  ocr: z.number(),
  /** Imagens (.jpg/.png) processadas via Gemini. */
  imagens: z.number(),
  /** True se a chave Gemini estava configurada (false desabilita OCR fallback). */
  ocr_disponivel: z.boolean(),
});

export type NfseExtractStats = z.infer<typeof NfseExtractStatsSchema>;

/** Tipo de falha global do job NFS-e (alem das falhas individuais em pdfFalhos). */
export const NfseFailureKindSchema = z.enum([
  "quota", // Cota Gemini esgotada (circuit breaker aberto)
  "auth", // Chave Gemini invalida / sem permissao
  "timeout", // Job excedeu o limite de duracao
  "internal", // Crash do Python ou erro inesperado
]);

export type NfseFailureKind = z.infer<typeof NfseFailureKindSchema>;

/** Grupo de PDFs duplicados (mesma chave OU mesmo cnpj+numero). */
export const NfseDuplicateGroupSchema = z.object({
  chaveNf: z.string().nullable().optional(),
  cnpjTomador: z.string().nullable().optional(),
  numeroNf: z.string().nullable().optional(),
  entries: z.array(NfseEntrySchema),
});

export type NfseDuplicateGroup = z.infer<typeof NfseDuplicateGroupSchema>;

/** Totalizadores que fecham com a entrega: enviados = lidos + falhos. */
export const NfseTotalsSchema = z.object({
  pdfEnviados: z.number(),
  pdfLidos: z.number(),
  xmlEnviados: z.number(),
  xmlLidos: z.number(),
  matched: z.number(),
  soPdf: z.number(),
  soXml: z.number(),
});

export type NfseTotals = z.infer<typeof NfseTotalsSchema>;

export const ComparacaoNfseResultSchema = z.object({
  soPdf: z.array(NfseEntrySchema),
  soXml: z.array(NfseEntrySchema),
  matchedCount: z.number(),
  xmlIgnorados: z.array(z.string()).optional(),
  pdfFalhos: z.array(z.union([z.string(), NfseFailureSchema])).optional(),
  extractStats: NfseExtractStatsSchema.optional(),
  /** Marcado quando o job parou por erro estrutural (nao falhas individuais). */
  failureKind: NfseFailureKindSchema.optional(),
  /** Tempo em segundos ate poder tentar de novo (so quando failureKind=quota). */
  retryAfterSec: z.number().optional(),
  /** Nome amigavel para download: "Comparacao NFSE - <tomador> - YYYY-MM-DD HHhMM.xlsx". */
  outputName: z.string().optional(),
  /** Totalizadores que fecham com o universo entregue. */
  totals: NfseTotalsSchema.optional(),
  /** Grupos de PDFs duplicados na entrada. */
  duplicadosPdf: z.array(NfseDuplicateGroupSchema).optional(),
});

export type ComparacaoNfseResult = z.infer<typeof ComparacaoNfseResultSchema>;

/** Estado do circuit breaker exposto pelo endpoint /tools/comparacao-nfse/health. */
export const NfseHealthSchema = z.object({
  /** True se a chave Gemini foi configurada e o circuit esta fechado. */
  geminiAvailable: z.boolean(),
  /** ISO timestamp de quando o circuit volta para HALF_OPEN, ou null se fechado. */
  circuitOpenUntil: z.string().nullable(),
  /** Quantos jobs estao em fila / processando agora. */
  queueDepth: z.number(),
  /** Estimativa em segundos ate um novo job ser atendido (heuristica). */
  estimatedWaitSec: z.number(),
});

export type NfseHealth = z.infer<typeof NfseHealthSchema>;
