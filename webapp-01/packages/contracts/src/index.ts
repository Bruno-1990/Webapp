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

/** N planilhas de mesmo layout → uma só, ordenadas pela coluna "#" (engines/concatenador-planilhas). */
export const CONCATENADOR_PLANILHAS_QUEUE_NAME = "concatenador-planilhas" as const;

/**
 * Tipo do relatório de NF-e da SEFAZ, lido do nome do arquivo
 * (`<CNPJ>_NFEs_<Emitente|Destinatario>_periodo_...`).
 *
 * Emitente (notas que a empresa emitiu) e Destinatário (notas que ela recebeu)
 * são universos distintos: concatenar os dois gera uma planilha sem sentido
 * fiscal. Usado pelo Concatenador na API e no frontend — por isso mora aqui.
 */
export type NfeRelatorioTipo = "emitente" | "destinatario";

/**
 * A SEFAZ às vezes entrega o acento corrompido no nome do arquivo:
 * `Destinatário` sai como `DestinatxE1rio` (o `\xE1` perdeu a barra), e também
 * aparecem `Destinat%E1rio`, `Destinat\xE1rio` e `DestinatÃ¡rio` (UTF-8 lido
 * como Latin-1). Por isso o miolo entre "destinat" e "rio" é curinga curto —
 * qualquer uma dessas formas conta como Destinatário.
 */
const NFE_TIPO_RE = /_(emitente|destinat[^_]{0,4}rios?)_/i;

/** Devolve o tipo do relatório, ou null se o nome não seguir o padrão. */
export function detectNfeRelatorioTipo(fileName: string): NfeRelatorioTipo | null {
  const norm = fileName.normalize("NFD").replace(/\p{M}/gu, "");
  const m = NFE_TIPO_RE.exec(norm);
  if (!m) return null;
  return m[1].toLowerCase().startsWith("emitente") ? "emitente" : "destinatario";
}

/**
 * Conserta o token do tipo quando o acento veio corrompido, para o nome do
 * arquivo de saída não carregar o defeito adiante. Formas já corretas
 * (`Destinatario`, `Destinatário`, `DESTINATARIOS`) ficam como estão.
 */
export function normalizeNfeTipoNoNome(nome: string): string {
  return nome.replace(/destinat([^_]{0,4})rios?/gi, (match, meio: string) => {
    if (/^[aá]?$/i.test(meio)) return match;
    return "Destinatario";
  });
}

/** True se a lista mistura relatórios de Emitente com os de Destinatário. */
export function hasMixedNfeRelatorioTipos(fileNames: string[]): boolean {
  const tipos = new Set<NfeRelatorioTipo>();
  for (const n of fileNames) {
    const t = detectNfeRelatorioTipo(n);
    if (t) tipos.add(t);
  }
  return tipos.size > 1;
}

/** Rótulo para mensagens ao usuário. */
export const NFE_RELATORIO_TIPO_LABEL: Record<NfeRelatorioTipo, string> = {
  emitente: "Emitente",
  destinatario: "Destinatário",
};

/**
 * CNPJ/CPF do DONO do relatório — os 11-14 dígitos no início do nome do arquivo
 * (`35060827000175_NFEs_Emitente_...`).
 *
 * É o único identificador confiável do titular: as colunas de CNPJ/CPF dentro da
 * planilha são dos clientes/fornecedores de cada nota, não da empresa.
 */
const NFE_CNPJ_PREFIX_RE = /^(\d{11,14})[_-]/;

/** Só os dígitos, como vieram. Null se o nome não começar com CNPJ/CPF. */
export function extractNfeCnpjFromFileName(fileName: string): string | null {
  const m = NFE_CNPJ_PREFIX_RE.exec(fileName.trim());
  return m ? m[1] : null;
}

/** `35060827000175` → `35.060.827/0001-75` (CPF: `123.456.789-01`). */
export function formatCnpjCpf(digits: string): string {
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return digits;
}

/** Motivos que impedem a concatenação. */
export type ConcatenadorIncompatibilidade = "tipos_misturados" | "cnpjs_diferentes";

export type ConcatenadorCheck = {
  ok: boolean;
  problemas: ConcatenadorIncompatibilidade[];
  /** Texto pronto para o usuário; null quando `ok`. */
  mensagem: string | null;
  /** Valores distintos encontrados (para a UI listar). */
  tipos: NfeRelatorioTipo[];
  cnpjs: string[];
};

export const CONCATENADOR_TIPOS_MISTURADOS_MSG =
  "A concatenação precisa ser feita com planilhas do mesmo tipo: Emitente com Emitente, " +
  "Destinatário com Destinatário. Separe os relatórios e gere um arquivo para cada tipo.";

export const CONCATENADOR_CNPJS_DIFERENTES_MSG =
  "As planilhas são de CNPJs diferentes — o CNPJ no início do nome do arquivo identifica " +
  "o titular do relatório e precisa ser o mesmo em todas as partes. Concatene um titular por vez.";

/**
 * Verifica se as planilhas podem ser emendadas. Arquivos cujo nome não traz a
 * informação (fora do padrão da SEFAZ) são ignorados na comparação — o
 * concatenador continua servindo para planilhas genéricas.
 */
export function checkConcatenadorCompatibilidade(fileNames: string[]): ConcatenadorCheck {
  const tiposSet = new Set<NfeRelatorioTipo>();
  const cnpjsSet = new Set<string>();
  for (const n of fileNames) {
    const t = detectNfeRelatorioTipo(n);
    if (t) tiposSet.add(t);
    const c = extractNfeCnpjFromFileName(n);
    if (c) cnpjsSet.add(c);
  }

  const problemas: ConcatenadorIncompatibilidade[] = [];
  if (cnpjsSet.size > 1) problemas.push("cnpjs_diferentes");
  if (tiposSet.size > 1) problemas.push("tipos_misturados");

  const partes: string[] = [];
  if (problemas.includes("cnpjs_diferentes")) partes.push(CONCATENADOR_CNPJS_DIFERENTES_MSG);
  if (problemas.includes("tipos_misturados")) partes.push(CONCATENADOR_TIPOS_MISTURADOS_MSG);

  return {
    ok: problemas.length === 0,
    problemas,
    mensagem: partes.length > 0 ? partes.join(" ") : null,
    tipos: [...tiposSet],
    cnpjs: [...cnpjsSet],
  };
}

/**
 * Aviso do Concatenador em 3 partes, para a tela hierarquizar em vez de exibir
 * um parágrafo corrido: o QUE aconteceu, os NÚMEROS e o QUE FAZER.
 * `alerta` = pode faltar/sobrar dado. `info` = decisão nossa, sem perda.
 */
export const ConcatenadorAvisoSchema = z.object({
  titulo: z.string(),
  detalhe: z.string().optional(),
  dica: z.string().optional(),
  severidade: z.enum(["alerta", "info"]).default("alerta"),
});

export type ConcatenadorAviso = z.infer<typeof ConcatenadorAvisoSchema>;

export const ConcatenadorPlanilhasJobPayloadSchema = z.object({
  jobId: z.string(),
  /** Ordem de envio; a ordenação final é feita pela engine (coluna "#"). */
  inputPaths: z.array(z.string()).min(1),
  outputPath: z.string(),
});

export type ConcatenadorPlanilhasJobPayload = z.infer<
  typeof ConcatenadorPlanilhasJobPayloadSchema
>;

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
  "D101",
  "D105",
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
  D101: "D101 — Complemento do CT-e — PIS/PASEP (EFD Contribuições)",
  D105: "D105 — Complemento do CT-e — COFINS (EFD Contribuições)",
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
  /** "local" = pdfplumber, "ocr-local" = OCR offline, "ocr" = Gemini, undefined = XML. */
  method: z.enum(["local", "ocr-local", "ocr"]).nullable().optional(),
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
  /** PDFs extraidos do texto nativo (pdfplumber, gratis e instantaneo). */
  local: z.number(),
  /** PDFs/imagens resolvidos por OCR local (rasteriza e le; sem API, sem cota). */
  ocr_local: z.number().optional(),
  /** PDFs que cairam no OCR Gemini (fallback opcional). */
  ocr: z.number(),
  /** Imagens (.jpg/.png) processadas via Gemini. */
  imagens: z.number(),
  /** True se a chave Gemini estava configurada (false desabilita o fallback). */
  ocr_disponivel: z.boolean(),
  /** True se as dependencias de OCR local estao instaladas no worker. */
  ocr_local_disponivel: z.boolean().optional(),
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
