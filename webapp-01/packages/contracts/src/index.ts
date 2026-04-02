import { z } from "zod";

export const API_PREFIX = "/api/v1" as const;

export const QUEUE_NAME = "nfe-convert" as const;

/** Fila BullMQ dedicada ao SPED (worker bridge + Python). */
export const SPED_QUEUE_NAME = "sped-convert" as const;

/** XLSX (com _LINHA) + SPED .txt → SPED .txt mesclado (webapp-03). */
export const SPED_MERGE_QUEUE_NAME = "sped-merge" as const;

/** Planilha SCI (CSV/Excel) → ProdutosSCI.xlsx (Python). */
export const SCI_CONSOLIDADO_QUEUE_NAME = "sci-consolidado" as const;

/** Comparação SEFAZ vs SCI → Notas Faltantes.xlsx (Python webapp-05). */
export const COMPARACAO_PLANILHAS_QUEUE_NAME = "comparacao-planilhas" as const;

export const SciConsolidadoJobPayloadSchema = z.object({
  jobId: z.string(),
  inputPath: z.string(),
  outputPath: z.string(),
  sheetName: z.string().optional(),
});

export type SciConsolidadoJobPayload = z.infer<typeof SciConsolidadoJobPayloadSchema>;

/**
 * Abas exportadas pelo motor SPED (webapp-02). Manter igual a `SHEET_ORDER` em
 * `webapp-02/sped_engine/config.py`.
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
