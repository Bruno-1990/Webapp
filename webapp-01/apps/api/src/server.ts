import { randomUUID } from "node:crypto";
import fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import {
  API_PREFIX,
  SPED_EXPORT_SHEET_KEYS,
  SPED_MAX_PRESENT_REGS,
  SPED_MAX_SHEETS_CSV_BYTES,
  SPED_MAX_SHEETS_PER_JOB,
  SPED_REG_CODE_RE,
  type SpedMergeInspectXlsxResponse,
} from "@webapp/contracts";
import { getOutName } from "@webapp/nfe-core";
import { loadEnv } from "./env.js";
import { collectXmlFiles, extractZipSafe } from "./fs-utils.js";
import {
  getQueue,
  getRedis,
  getSciConsolidadoQueue,
  getComparacaoPlanilhasQueue,
  getComparacaoNfseQueue,
  getGnreQueue,
  getSciPortalNacionalQueue,
  getSpedMergeQueue,
  getSpedMergeInspectQueue,
  getSpedMergeInspectEvents,
  getSpedQueue,
  type NfeJobPayload,
  type SciConsolidadoJobPayload,
  type SpedJobPayload,
  type SpedMergeJobPayload,
  type SpedMergeInspectJobPayload,
  type ComparacaoPlanilhasJobPayload,
  type ComparacaoNfseJobPayload,
  type GnreJobPayload,
  type SciPortalNacionalJobPayload,
} from "./queue.js";
import { signDownloadToken, verifyDownloadToken } from "./tokens.js";
import { buildSpedXlsxFileName, extractSpedRazaoFromBuffer } from "./sped-filename.js";
import { loadSpedCabecalhosMeta } from "./sped-cabecalhos.js";
import {
  getExtratoDb,
  importEntidades,
  lookupByCodigos,
  listEntidades,
  countEntidades,
  deleteEntidade,
  clearTipo,
  type EntidadeTipo,
  type EntidadeInput,
} from "./extrato-db.js";

const SPED_CORE = new Set<string>(SPED_EXPORT_SHEET_KEYS);

function normalizeSpedReg(s: string): string | null {
  const u = s.trim().toUpperCase();
  return SPED_REG_CODE_RE.test(u) ? u : null;
}

function extractRegFromSpedLine(line: string): string | null {
  if (!line.includes("|")) return null;
  const fields = line.trimEnd().split("|");
  if (fields.length < 3) return null;
  const inner = fields.slice(1, -1);
  const reg = (inner[0] || "").trim().toUpperCase();
  return SPED_REG_CODE_RE.test(reg) ? reg : null;
}

type SpedMergeXlsxInspect = SpedMergeInspectXlsxResponse;

const SPED_MERGE_INSPECT_TIMEOUT_MS = 30_000;

async function inspectSpedMergeXlsx(env: ReturnType<typeof loadEnv>, xlsxPath: string): Promise<SpedMergeXlsxInspect> {
  const inspectQueue = getSpedMergeInspectQueue(env);
  const inspectEvents = getSpedMergeInspectEvents(env);
  const jobId = randomUUID();
  const job = await inspectQueue.add(
    "inspect",
    { jobId, xlsxPath } satisfies SpedMergeInspectJobPayload,
    { jobId }
  );
  try {
    const result = (await job.waitUntilFinished(
      inspectEvents,
      SPED_MERGE_INSPECT_TIMEOUT_MS
    )) as SpedMergeXlsxInspect;
    return result;
  } finally {
    await job.remove().catch(() => undefined);
  }
}

function parseJsonRegArray(
  raw: string | undefined,
  fieldName: string
): { ok: true; arr: string[] } | { ok: false; error: string } {
  if (raw == null || raw.trim() === "") {
    return { ok: true, arr: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: `Campo ${fieldName} deve ser JSON válido (array de strings).` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: `Campo ${fieldName} deve ser um array.` };
  }
  const out: string[] = [];
  for (const x of parsed) {
    if (typeof x !== "string") {
      return { ok: false, error: `Campo ${fieldName}: cada item deve ser string.` };
    }
    const n = normalizeSpedReg(x);
    if (!n) {
      return { ok: false, error: `REG inválido em ${fieldName}: ${JSON.stringify(x)}` };
    }
    out.push(n);
  }
  return { ok: true, arr: out };
}

function dedupePreserveRegs(arr: string[]): string[] {
  const seen = new Set<string>();
  const o: string[] = [];
  for (const x of arr) {
    if (seen.has(x)) continue;
    seen.add(x);
    o.push(x);
  }
  return o;
}

function validateSpedJobSheetsAndPresent(
  sheetsRaw: string | undefined,
  presentRegsRaw: string | undefined
):
  | { ok: true; sheets: string[] | undefined; presentRegs?: string[] }
  | { ok: false; error: string } {
  const sheetsP = parseJsonRegArray(sheetsRaw, "sheets");
  if (!sheetsP.ok) return sheetsP;
  let sheetsArr = dedupePreserveRegs(sheetsP.arr);
  if (sheetsArr.length === 0) {
    return { ok: true, sheets: undefined };
  }
  if (sheetsArr.length > SPED_MAX_SHEETS_PER_JOB) {
    return { ok: false, error: `No máximo ${SPED_MAX_SHEETS_PER_JOB} abas em sheets.` };
  }

  const needsPresent = sheetsArr.some((s) => !SPED_CORE.has(s));
  const pr = parseJsonRegArray(presentRegsRaw, "presentRegs");
  if (!pr.ok) return pr;
  const presentRegs = dedupePreserveRegs(pr.arr);
  if (needsPresent && presentRegs.length === 0) {
    return {
      ok: false,
      error:
        "Envie presentRegs (JSON) com os REGs do arquivo quando sheets incluir blocos fora dos 11 principais (use POST /tools/sped/inspect no mesmo ficheiro).",
    };
  }
  if (presentRegs.length > SPED_MAX_PRESENT_REGS) {
    return { ok: false, error: `No máximo ${SPED_MAX_PRESENT_REGS} itens em presentRegs.` };
  }
  const prSet = new Set(presentRegs);
  for (const s of sheetsArr) {
    if (!SPED_CORE.has(s) && !prSet.has(s)) {
      return {
        ok: false,
        error: `Aba ${s} não está nos 11 principais e não consta em presentRegs.`,
      };
    }
  }

  const csv = sheetsArr.join(",");
  if (Buffer.byteLength(csv, "utf8") > SPED_MAX_SHEETS_CSV_BYTES) {
    return { ok: false, error: "Lista de abas excede o tamanho máximo permitido." };
  }

  const orderedCore = SPED_EXPORT_SHEET_KEYS.filter((k) => sheetsArr.includes(k));
  const seenExtra = new Set<string>();
  const orderedExtras: string[] = [];
  for (const s of sheetsArr) {
    if (SPED_CORE.has(s)) continue;
    if (seenExtra.has(s)) continue;
    seenExtra.add(s);
    orderedExtras.push(s);
  }
  const sheetsOrdered = [...orderedCore, ...orderedExtras];

  if (needsPresent) {
    return { ok: true, sheets: sheetsOrdered, presentRegs };
  }
  return { ok: true, sheets: sheetsOrdered };
}

const env = loadEnv();
/** Limite global do body precisa cobrir tanto upload NFe quanto chunks do Comparador NFS-e. */
const globalBodyLimitMb = Math.max(env.MAX_UPLOAD_MB, env.MAX_UPLOAD_NFSE_MB);
const app = fastify({
  logger: { level: env.NODE_ENV === "production" ? "info" : "debug" },
  bodyLimit: globalBodyLimitMb * 1024 * 1024,
});

const origins = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);

await app.register(helmet, { global: true });
await app.register(cors, { origin: origins, credentials: true });
/** Partes de arquivo no multipart (cada XML/ZIP = 1 parte). Precisa ≥ qtd enviada antes da validação de MAX_XML_FILES. */
const maxMultipartFileParts = Math.min(env.MAX_XML_FILES + 2_000, 20_000);

await app.register(multipart, {
  limits: {
    fileSize: globalBodyLimitMb * 1024 * 1024,
    files: maxMultipartFileParts,
  },
});
await app.register(rateLimit, {
  max: 600,
  timeWindow: "1 minute",
  /** Polling do frontend faz ~60 GETs/min por job; com varios jobs em paralelo 30/min estoura rapido. */
  allowList: (req) => req.method === "GET" && req.url.includes("/jobs/"),
});

app.setErrorHandler((err, req, reply) => {
  const code = (err as { code?: string }).code;
  if (code === "FST_FILES_LIMIT") {
    req.log.warn({ err }, "limite de partes multipart");
    return reply.code(413).send({
      error: `Envio com partes demais no formulário (máx. ${maxMultipartFileParts} arquivos por requisição). Envie em lotes menores ou use ZIP. Limite de XMLs após processar: ${env.MAX_XML_FILES}.`,
    });
  }
  if (code === "FST_REQ_FILE_TOO_LARGE" || code === "FST_FILES_TOO_LARGE") {
    req.log.warn({ err }, "arquivo individual excede fileSize");
    return reply.code(413).send({
      error: `Um dos arquivos excedeu o limite de ${globalBodyLimitMb} MB por arquivo. Reduza o tamanho ou divida em mais partes.`,
    });
  }
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE" || code === "FST_REQ_BODY_TOO_LARGE") {
    req.log.warn({ err }, "body total excede bodyLimit");
    return reply.code(413).send({
      error: `Request excedeu o limite de ${globalBodyLimitMb} MB. Envie em lotes menores.`,
    });
  }
  return reply.send(err);
});

const queue = getQueue(env);
const spedQueue = getSpedQueue(env);
const spedMergeQueue = getSpedMergeQueue(env);
getSpedMergeInspectQueue(env);
getSpedMergeInspectEvents(env);
const sciConsolidadoQueue = getSciConsolidadoQueue(env);
const comparacaoPlanilhasQueue = getComparacaoPlanilhasQueue(env);
const comparacaoNfseQueue = getComparacaoNfseQueue(env);
const gnreQueue = getGnreQueue(env);
const sciPortalNacionalQueue = getSciPortalNacionalQueue(env);

function jobDir(id: string): string {
  /** Absoluto para o payload BullMQ: o worker/Python usa outro cwd e paths relativos quebram (ex.: SPED). */
  return path.resolve(env.TEMP_JOBS_ROOT, id);
}

function mapBullState(s: string): "queued" | "running" | "done" | "failed" {
  if (s === "completed") return "done";
  if (s === "failed") return "failed";
  if (s === "active") return "running";
  return "queued";
}

app.get(`${API_PREFIX}/health`, async () => ({ ok: true }));

/** Manifest para o hub de ferramentas (cards no frontend). */
app.get(`${API_PREFIX}/tools`, async () => ({
  tools: [
    {
      id: "nfe",
      title: "XML → XLSX",
      subtitle: "Notas fiscais eletrônicas",
      description: "Junte os arquivos das notas e baixe tudo numa planilha só.",
      route: "/tools/nfe",
      available: true,
      category: "fiscal",
    },
    {
      id: "sped",
      title: "SPED → XLSX",
      subtitle: "EFD Contribuições · ICMS-IPI",
      description: "Envie o arquivo do contador e receba uma planilha fácil de conferir e ajustar.",
      route: "/tools/sped",
      available: true,
      category: "fiscal",
    },
    {
      id: "sped-merge",
      title: "XLSX → SPED",
      subtitle: "Mescla planilha no .txt",
      description: "Envie o arquivo original e a planilha que você editou; baixe o resultado pronto para reenviar.",
      route: "/tools/sped-merge",
      available: true,
      category: "fiscal",
    },
    {
      id: "sci-consolidado",
      title: "Consolidado SCI",
      subtitle: "Planilha SCI → Excel",
      description:
        "Envie a exportação SCI (CSV ou Excel). Receba ProdutosSCI.xlsx com abas Produtos, Base e Consolidado (SCI).",
      route: "/tools/sci-consolidado",
      available: true,
      category: "fiscal",
    },
    {
      id: "comparacao-planilhas",
      title: "Comparador",
      subtitle: "SEFAZ Estadual × SCI",
      description:
        "Compare notas fiscais de produto/transporte (NF-e, CT-e, NFC-e) baixadas do SEFAZ estadual com os lançamentos no SCI. Receba uma planilha com as notas que estão na SEFAZ mas não foram lançadas.",
      route: "/tools/comparacao-planilhas",
      available: true,
      category: "fiscal",
      tag: { label: "NF-e · Produtos", tone: "blue" },
    },
    {
      id: "comparacao-nfse",
      title: "Comparador NFS-e",
      subtitle: "PDF/Imagem × XML",
      description:
        "Envie a pasta com PDFs ou imagens (JPG/PNG) das notas de serviço tomadas e a pasta com XMLs; identificamos as que estão só em um lado.",
      route: "/tools/comparacao-nfse",
      available: true,
      category: "fiscal",
    },
    {
      id: "gnre",
      title: "Extrator GNRE",
      subtitle: "PDF → XLSX",
      description:
        "Envie os PDFs das guias GNRE e baixe uma planilha consolidada com Lançamentos e Falhas.",
      route: "/tools/gnre",
      available: true,
      category: "contabil",
    },
    {
      id: "sci-portal-nacional",
      title: "Conciliador NFS-e",
      subtitle: "Portal Nacional × SCI",
      description:
        "Concilia notas fiscais de serviço tomadas (NFS-e) baixadas do Portal Nacional com os lançamentos no SCI — inclusive notas canceladas. Receba um XLSX com Resumo, Em ambas, Só no Portal Nacional, Só no SCI, Canceladas no SCI e Duplicados.",
      route: "/tools/sci-portal-nacional",
      available: true,
      category: "fiscal",
      tag: { label: "NFS-e · Serviços", tone: "violet" },
    },
  ],
}));

app.get(`${API_PREFIX}/ready`, async (_req, reply) => {
  try {
    const redis = getRedis(env);
    const pong = await redis.ping();
    if (pong !== "PONG") throw new Error("redis");
    await fs.promises.mkdir(env.TEMP_JOBS_ROOT, { recursive: true });
    await fs.promises.access(env.TEMP_JOBS_ROOT, fs.constants.W_OK);
    return { ok: true };
  } catch {
    return reply.code(503).send({ ok: false });
  }
});

app.post(`${API_PREFIX}/jobs`, async (req, reply) => {
  const jobId = randomUUID();
  const inDir = path.join(jobDir(jobId), "in");
  const outDir = path.join(jobDir(jobId), "out");

  try {
    const pong = await getRedis(env).ping();
    if (pong !== "PONG") {
      throw new Error("Redis não respondeu");
    }
  } catch (e) {
    req.log.warn({ err: e }, "redis indisponível ao criar job");
    return reply.code(503).send({
      error:
        "Redis não está acessível (porta 6381). Inicie o Redis e reinicie API + worker — ex.: Docker Desktop + docker run -p 6381:6379 redis:7-alpine",
    });
  }

  await fs.promises.mkdir(inDir, { recursive: true });
  await fs.promises.mkdir(outDir, { recursive: true });

  let totalBytes = 0;
  const parts = req.parts();
  for await (const part of parts) {
    if (part.type !== "file") continue;
    const name = (part.filename ?? "file").replace(/[/\\]/g, "_");
    const lower = name.toLowerCase();
    const buf = await part.toBuffer();
    totalBytes += buf.length;
    if (totalBytes > env.MAX_UPLOAD_MB * 1024 * 1024) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      return reply.code(413).send({ error: "Payload muito grande" });
    }
    if (lower.endsWith(".zip")) {
      try {
        await extractZipSafe(buf, inDir);
      } catch {
        await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
        return reply.code(400).send({ error: "ZIP inválido ou inseguro" });
      }
    } else if (lower.endsWith(".xml")) {
      const dest = path.join(inDir, name);
      await fs.promises.writeFile(dest, buf);
    }
  }

  const xmlPaths = await collectXmlFiles(inDir);
  if (xmlPaths.length === 0) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    return reply.code(400).send({ error: "Nenhum XML encontrado" });
  }
  if (xmlPaths.length > env.MAX_XML_FILES) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    return reply.code(400).send({ error: "Excesso de arquivos XML" });
  }

  const outName = getOutName(xmlPaths[0]!);
  const outputPath = path.join(outDir, outName);

  try {
    await Promise.race([
      queue.add(
        "convert",
        {
          jobId,
          xmlPaths,
          outputPath,
        } satisfies NfeJobPayload,
        { jobId }
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Fila timeout")), 15_000)
      ),
    ]);
  } catch (e) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    req.log.error({ err: e }, "falha ao enfileirar job");
    return reply.code(503).send({
      error:
        "Não foi possível enfileirar o job (Redis/BullMQ). Verifique se o Redis está rodando e reinicie API e worker.",
    });
  }

  return reply.code(202).send({ id: jobId, status: "queued" as const });
});

app.get<{ Params: { id: string } }>(`${API_PREFIX}/jobs/:id`, async (req, reply) => {
  const { id } = req.params;
  const job = await queue.getJob(id);
  if (!job) {
    return reply.code(404).send({
      id,
      status: "not_found" as const,
    });
  }
  const state = await job.getState();
  const status = mapBullState(state);
  const progress =
    typeof job.progress === "number" ? Math.round(job.progress) : undefined;

  let downloadToken: string | undefined;
  let fileName: string | undefined;
  let error: string | undefined;

  if (status === "done") {
    const rv = job.returnvalue as { fileName?: string } | undefined;
    fileName = rv?.fileName ?? path.basename(String(job.data?.outputPath ?? "NFe_Itens.xlsx"));
    downloadToken = await signDownloadToken(env, id, fileName, "nfe");
  }
  if (status === "failed") {
    error = job.failedReason?.slice(0, 500) ?? "Falha no processamento";
  }

  return {
    id,
    status,
    progress,
    error,
    downloadToken,
    fileName,
  };
});

app.post(`${API_PREFIX}/tools/sped/inspect`, async (req, reply) => {
  const parts = req.parts();
  let gotFile = false;
  const regs = new Set<string>();
  let totalBytes = 0;
  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  for await (const part of parts) {
    if (part.type !== "file") continue;
    if (gotFile) {
      return reply.code(400).send({ error: "Envie apenas um arquivo .txt por vez." });
    }
    gotFile = true;
    const lower = (part.filename ?? "").toLowerCase();
    if (!lower.endsWith(".txt")) {
      return reply.code(400).send({ error: "Apenas arquivos .txt são aceitos." });
    }
    const rl = readline.createInterface({
      input: part.file,
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      totalBytes += Buffer.byteLength(line, "utf8") + 1;
      if (totalBytes > maxBytes) {
        return reply.code(413).send({ error: "Arquivo muito grande" });
      }
      const r = extractRegFromSpedLine(line);
      if (r) regs.add(r);
    }
  }
  if (!gotFile) {
    return reply.code(400).send({ error: "Nenhum arquivo enviado" });
  }
  const presentRegs = [...regs].sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true })
  );
  return { presentRegs };
});

app.get(`${API_PREFIX}/tools/sped/reg-meta`, async () => {
  const { descriptions, blockByReg } = loadSpedCabecalhosMeta();
  return { descriptions, blockByReg };
});

app.post(`${API_PREFIX}/tools/sped/jobs`, async (req, reply) => {
  const jobId = randomUUID();
  const inDir = path.join(jobDir(jobId), "in");
  const outDir = path.join(jobDir(jobId), "out");

  try {
    const pong = await getRedis(env).ping();
    if (pong !== "PONG") throw new Error("Redis não respondeu");
  } catch (e) {
    req.log.warn({ err: e }, "redis indisponível ao criar job SPED");
    return reply.code(503).send({
      error:
        "Redis não está acessível. Inicie o Redis e o worker SPED (worker-sped-bridge + Python).",
    });
  }

  await fs.promises.mkdir(inDir, { recursive: true });
  await fs.promises.mkdir(outDir, { recursive: true });

  let totalBytes = 0;
  let fileCount = 0;
  let spedUploadBuf: Buffer | null = null;
  let sheetsFieldRaw: string | undefined;
  let presentRegsFieldRaw: string | undefined;
  const parts = req.parts();
  for await (const part of parts) {
    if (part.type === "field") {
      if (part.fieldname === "sheets") {
        const v = part.value;
        sheetsFieldRaw =
          typeof v === "string"
            ? v
            : Buffer.isBuffer(v)
              ? v.toString("utf8")
              : String(v ?? "");
      }
      if (part.fieldname === "presentRegs") {
        const v = part.value;
        presentRegsFieldRaw =
          typeof v === "string"
            ? v
            : Buffer.isBuffer(v)
              ? v.toString("utf8")
              : String(v ?? "");
      }
      continue;
    }
    if (part.type !== "file") continue;
    fileCount += 1;
    if (fileCount > 1) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      return reply.code(400).send({ error: "Envie apenas um arquivo .txt SPED por vez." });
    }
    const name = (part.filename ?? "sped.txt").replace(/[/\\]/g, "_");
    const lower = name.toLowerCase();
    if (!lower.endsWith(".txt")) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      return reply.code(400).send({ error: "Apenas arquivos .txt são aceitos para SPED." });
    }
    const buf = await part.toBuffer();
    totalBytes += buf.length;
    if (totalBytes > env.MAX_UPLOAD_MB * 1024 * 1024) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      return reply.code(413).send({ error: "Arquivo SPED muito grande" });
    }
    const dest = path.join(inDir, "sped.txt");
    await fs.promises.writeFile(dest, buf);
    spedUploadBuf = buf;
  }

  if (fileCount === 0) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    return reply.code(400).send({ error: "Nenhum arquivo enviado" });
  }

  const sheetsParsed = validateSpedJobSheetsAndPresent(sheetsFieldRaw, presentRegsFieldRaw);
  if (!sheetsParsed.ok) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    return reply.code(400).send({ error: sheetsParsed.error });
  }

  const inputPath = path.join(inDir, "sped.txt");
  const razao =
    spedUploadBuf !== null ? extractSpedRazaoFromBuffer(spedUploadBuf) : null;
  const outputPath = path.join(outDir, buildSpedXlsxFileName(razao, new Date()));

  const payload: SpedJobPayload = {
    jobId,
    inputPath,
    outputPath,
    ...(sheetsParsed.sheets !== undefined ? { sheets: sheetsParsed.sheets } : {}),
    ...(sheetsParsed.presentRegs !== undefined && sheetsParsed.presentRegs.length > 0
      ? { presentRegs: sheetsParsed.presentRegs }
      : {}),
  };

  try {
    await Promise.race([
      spedQueue.add(
        "convert",
        payload,
        { jobId }
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Fila timeout")), 15_000)
      ),
    ]);
  } catch (e) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    req.log.error({ err: e }, "falha ao enfileirar job SPED");
    return reply.code(503).send({
      error:
        "Não foi possível enfileirar o job SPED. Verifique Redis e se o worker-sped-bridge está rodando.",
    });
  }

  return reply.code(202).send({ id: jobId, status: "queued" as const });
});

app.get<{ Params: { id: string } }>(`${API_PREFIX}/tools/sped/jobs/:id`, async (req, reply) => {
  const { id } = req.params;
  const job = await spedQueue.getJob(id);
  if (!job) {
    return reply.code(404).send({
      id,
      status: "not_found" as const,
    });
  }
  const state = await job.getState();
  const status = mapBullState(state);
  const progress =
    typeof job.progress === "number" ? Math.round(job.progress) : undefined;

  let downloadToken: string | undefined;
  let fileName: string | undefined;
  let error: string | undefined;

  if (status === "done") {
    const rv = job.returnvalue as { fileName?: string } | undefined;
    fileName =
      rv?.fileName ?? path.basename(String((job.data as SpedJobPayload).outputPath ?? "SPED_Convertido.xlsx"));
    downloadToken = await signDownloadToken(env, id, fileName, "sped");
  }
  if (status === "failed") {
    error = job.failedReason?.slice(0, 500) ?? "Falha no processamento";
  }

  return {
    id,
    status,
    progress,
    error,
    downloadToken,
    fileName,
  };
});

app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
  `${API_PREFIX}/jobs/:id/download`,
  async (req, reply) => {
    const { id } = req.params;
    const token = req.query.token;
    if (!token) return reply.code(401).send({ error: "Token ausente" });

    const claims = await verifyDownloadToken(env, token);
    if (!claims || claims.jobId !== id) {
      return reply.code(401).send({ error: "Token inválido" });
    }
    if (claims.tool === "sped" || claims.tool === "sped-merge" || claims.tool === "sci-consolidado" || claims.tool === "comparacao-planilhas") {
      return reply.code(401).send({ error: "Use o endpoint de download da ferramenta correspondente" });
    }

    const job = await queue.getJob(id);
    if (!job || (await job.getState()) !== "completed") {
      return reply.code(404).send({ error: "Job não concluído" });
    }

    const outPath = (job.data as NfeJobPayload).outputPath;
    if (!outPath || !fs.existsSync(outPath)) {
      return reply.code(404).send({ error: "Arquivo não encontrado" });
    }

    const stream = fs.createReadStream(outPath);
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const fn = claims.fileName.replace(/[\r\n"]/g, "_");
    const asciiFallback = fn.replace(/[^\x20-\x7e]/g, "_");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fn)}`
    );
    return reply.send(stream);
  }
);

app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
  `${API_PREFIX}/tools/sped/jobs/:id/download`,
  async (req, reply) => {
    const { id } = req.params;
    const token = req.query.token;
    if (!token) return reply.code(401).send({ error: "Token ausente" });

    const claims = await verifyDownloadToken(env, token);
    if (!claims || claims.jobId !== id || claims.tool !== "sped") {
      return reply.code(401).send({ error: "Token inválido" });
    }

    const job = await spedQueue.getJob(id);
    if (!job || (await job.getState()) !== "completed") {
      return reply.code(404).send({ error: "Job não concluído" });
    }

    const outPath = (job.data as SpedJobPayload).outputPath;
    if (!outPath || !fs.existsSync(outPath)) {
      return reply.code(404).send({ error: "Arquivo não encontrado" });
    }

    const stream = fs.createReadStream(outPath);
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const fn = claims.fileName.replace(/[\r\n"]/g, "_");
    const asciiFallback = fn.replace(/[^\x20-\x7e]/g, "_");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fn)}`
    );
    return reply.send(stream);
  }
);

app.post(`${API_PREFIX}/tools/sped-merge/inspect-xlsx`, async (req, reply) => {
  const jobId = randomUUID();
  const inDir = path.join(jobDir(jobId), "in");
  await fs.promises.mkdir(inDir, { recursive: true });
  let gotXlsx = false;
  let xlsxPath = "";
  let totalBytes = 0;
  const parts = req.parts();
  for await (const part of parts) {
    if (part.type !== "file") continue;
    const name = (part.filename ?? "file").replace(/[/\\]/g, "_");
    const lower = name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xlsm")) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      return reply.code(400).send({ error: "A planilha deve ser .xlsx" });
    }
    const buf = await part.toBuffer();
    totalBytes += buf.length;
    if (totalBytes > env.MAX_UPLOAD_MB * 1024 * 1024) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      return reply.code(413).send({ error: "Payload muito grande" });
    }
    xlsxPath = path.join(inDir, "planilha.xlsx");
    await fs.promises.writeFile(xlsxPath, buf);
    gotXlsx = true;
  }
  if (!gotXlsx) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    return reply.code(400).send({ error: "Envie a planilha .xlsx" });
  }
  try {
    const inspected = await inspectSpedMergeXlsx(env, xlsxPath);
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    return inspected;
  } catch (e) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    return reply
      .code(500)
      .send({ error: e instanceof Error ? e.message : "Falha ao inspecionar planilha" });
  }
});

app.post(`${API_PREFIX}/tools/sped-merge/jobs`, async (req, reply) => {
  const jobId = randomUUID();
  const inDir = path.join(jobDir(jobId), "in");
  const outDir = path.join(jobDir(jobId), "out");

  try {
    const pong = await getRedis(env).ping();
    if (pong !== "PONG") throw new Error("Redis não respondeu");
  } catch (e) {
    req.log.warn({ err: e }, "redis indisponível ao criar job SPED merge");
    return reply.code(503).send({
      error:
        "Redis não está acessível. Inicie o Redis e o worker SPED merge (worker-sped-merge-bridge + engines/sped-merge).",
    });
  }

  await fs.promises.mkdir(inDir, { recursive: true });
  await fs.promises.mkdir(outDir, { recursive: true });

  let totalBytes = 0;
  let gotSped = false;
  let gotXlsx = false;
  const parts = req.parts();
  for await (const part of parts) {
    if (part.type !== "file") continue;
    const field = (part as { fieldname?: string }).fieldname ?? "";
    const name = (part.filename ?? "file").replace(/[/\\]/g, "_");
    const lower = name.toLowerCase();
    const buf = await part.toBuffer();
    totalBytes += buf.length;
    if (totalBytes > env.MAX_UPLOAD_MB * 1024 * 1024) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      return reply.code(413).send({ error: "Payload muito grande" });
    }

    if (field === "sped" || (!gotSped && lower.endsWith(".txt"))) {
      if (!lower.endsWith(".txt")) {
        await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
        return reply.code(400).send({ error: "O arquivo SPED deve ser .txt" });
      }
      await fs.promises.writeFile(path.join(inDir, "sped.txt"), buf);
      gotSped = true;
      continue;
    }
    if (field === "xlsx" || (!gotXlsx && (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")))) {
      if (!lower.endsWith(".xlsx") && !lower.endsWith(".xlsm")) {
        await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
        return reply.code(400).send({ error: "A planilha deve ser .xlsx" });
      }
      await fs.promises.writeFile(path.join(inDir, "planilha.xlsx"), buf);
      gotXlsx = true;
      continue;
    }
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    return reply.code(400).send({ error: "Use o campo xlsx (.xlsx) e, opcionalmente, sped (.txt)." });
  }

  if (!gotXlsx) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    return reply.code(400).send({ error: "Envie a planilha .xlsx." });
  }

  const xlsxPath = path.join(inDir, "planilha.xlsx");
  let inspected: SpedMergeXlsxInspect;
  try {
    inspected = await inspectSpedMergeXlsx(env, xlsxPath);
  } catch (e) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    return reply
      .code(500)
      .send({ error: e instanceof Error ? e.message : "Falha ao validar a planilha." });
  }

  if (inspected.requiresOriginal && !gotSped) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    return reply.code(400).send({
      error:
        "Planilha parcial/dinâmica detectada. Envie também o SPED original (.txt). Motivo: " +
        inspected.reasons.join("; "),
    });
  }

  const spedPath = gotSped ? path.join(inDir, "sped.txt") : undefined;
  const outputPath = path.join(outDir, "SPED_mesclado.txt");

  try {
    await Promise.race([
      spedMergeQueue.add(
        "merge",
        {
          jobId,
          ...(spedPath ? { spedPath } : {}),
          xlsxPath,
          outputPath,
        } satisfies SpedMergeJobPayload,
        { jobId }
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Fila timeout")), 15_000)
      ),
    ]);
  } catch (e) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    req.log.error({ err: e }, "falha ao enfileirar job SPED merge");
    return reply.code(503).send({
      error:
        "Não foi possível enfileirar o job. Verifique Redis e se o worker-sped-merge-bridge está rodando.",
    });
  }

  return reply.code(202).send({ id: jobId, status: "queued" as const });
});

app.get<{ Params: { id: string } }>(`${API_PREFIX}/tools/sped-merge/jobs/:id`, async (req, reply) => {
  const { id } = req.params;
  const job = await spedMergeQueue.getJob(id);
  if (!job) {
    return reply.code(404).send({
      id,
      status: "not_found" as const,
    });
  }
  const state = await job.getState();
  const status = mapBullState(state);
  const progress =
    typeof job.progress === "number" ? Math.round(job.progress) : undefined;

  let downloadToken: string | undefined;
  let fileName: string | undefined;
  let error: string | undefined;

  if (status === "done") {
    const rv = job.returnvalue as { fileName?: string } | undefined;
    fileName =
      rv?.fileName ?? path.basename(String((job.data as SpedMergeJobPayload).outputPath ?? "SPED_mesclado.txt"));
    downloadToken = await signDownloadToken(env, id, fileName, "sped-merge");
  }
  if (status === "failed") {
    error = job.failedReason?.slice(0, 500) ?? "Falha no processamento";
  }

  return {
    id,
    status,
    progress,
    error,
    downloadToken,
    fileName,
  };
});

app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
  `${API_PREFIX}/tools/sped-merge/jobs/:id/download`,
  async (req, reply) => {
    const { id } = req.params;
    const token = req.query.token;
    if (!token) return reply.code(401).send({ error: "Token ausente" });

    const claims = await verifyDownloadToken(env, token);
    if (!claims || claims.jobId !== id || claims.tool !== "sped-merge") {
      return reply.code(401).send({ error: "Token inválido" });
    }

    const job = await spedMergeQueue.getJob(id);
    if (!job || (await job.getState()) !== "completed") {
      return reply.code(404).send({ error: "Job não concluído" });
    }

    const outPath = (job.data as SpedMergeJobPayload).outputPath;
    if (!outPath || !fs.existsSync(outPath)) {
      return reply.code(404).send({ error: "Arquivo não encontrado" });
    }

    const stream = fs.createReadStream(outPath);
    reply.header("Content-Type", "text/plain; charset=utf-8");
    const fn = claims.fileName.replace(/[\r\n"]/g, "_");
    const asciiFallback = fn.replace(/[^\x20-\x7e]/g, "_");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fn)}`
    );
    return reply.send(stream);
  }
);

const ALLOWED_SCI_EXT = new Set([".csv", ".txt", ".xlsx", ".xls"]);

app.post<{ Querystring: { sheet?: string } }>(
  `${API_PREFIX}/tools/sci-consolidado/jobs`,
  async (req, reply) => {
    const sheetName = req.query.sheet?.trim().slice(0, 120);
    const jobId = randomUUID();
    const inDir = path.join(jobDir(jobId), "in");
    const outDir = path.join(jobDir(jobId), "out");

    try {
      const pong = await getRedis(env).ping();
      if (pong !== "PONG") throw new Error("Redis não respondeu");
    } catch (e) {
      req.log.warn({ err: e }, "redis indisponível ao criar job SCI");
      return reply.code(503).send({
        error:
          "Redis não está acessível. Inicie o Redis e o worker Consolidado SCI (worker-sci-consolidado + Python).",
      });
    }

    await fs.promises.mkdir(inDir, { recursive: true });
    await fs.promises.mkdir(outDir, { recursive: true });

    let totalBytes = 0;
    let fileCount = 0;
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type !== "file") continue;
      fileCount += 1;
      if (fileCount > 1) {
        await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
        return reply.code(400).send({ error: "Envie apenas um arquivo por vez." });
      }
      const name = (part.filename ?? "entrada").replace(/[/\\]/g, "_");
      const ext = path.extname(name).toLowerCase();
      if (!ALLOWED_SCI_EXT.has(ext)) {
        await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
        return reply.code(400).send({
          error: "Formato não suportado. Use .csv, .txt, .xlsx ou .xls.",
        });
      }
      const buf = await part.toBuffer();
      totalBytes += buf.length;
      if (totalBytes > env.MAX_UPLOAD_MB * 1024 * 1024) {
        await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
        return reply.code(413).send({ error: "Arquivo muito grande" });
      }
      const dest = path.join(inDir, `entrada${ext}`);
      await fs.promises.writeFile(dest, buf);
    }

    if (fileCount === 0) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      return reply.code(400).send({ error: "Nenhum arquivo enviado" });
    }

    const entries = await fs.promises.readdir(inDir);
    const inputFile = entries.find((f) => f.startsWith("entrada."));
    if (!inputFile) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      return reply.code(400).send({ error: "Arquivo de entrada não encontrado" });
    }
    const inputPath = path.join(inDir, inputFile);
    const outputPath = path.join(outDir, "ProdutosSCI.xlsx");

    const payload: SciConsolidadoJobPayload = {
      jobId,
      inputPath,
      outputPath,
      ...(sheetName && sheetName.length > 0 ? { sheetName } : {}),
    };

    try {
      await Promise.race([
        sciConsolidadoQueue.add("consolidado", payload, { jobId }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Fila timeout")), 15_000)
        ),
      ]);
    } catch (e) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      req.log.error({ err: e }, "falha ao enfileirar job SCI");
      return reply.code(503).send({
        error:
          "Não foi possível enfileirar o job. Verifique Redis e se o worker-sci-consolidado está rodando.",
      });
    }

    return reply.code(202).send({ id: jobId, status: "queued" as const });
  }
);

app.get<{ Params: { id: string } }>(`${API_PREFIX}/tools/sci-consolidado/jobs/:id`, async (req, reply) => {
  const { id } = req.params;
  const job = await sciConsolidadoQueue.getJob(id);
  if (!job) {
    return reply.code(404).send({
      id,
      status: "not_found" as const,
    });
  }
  const state = await job.getState();
  const status = mapBullState(state);
  const progress =
    typeof job.progress === "number" ? Math.round(job.progress) : undefined;

  let downloadToken: string | undefined;
  let fileName: string | undefined;
  let error: string | undefined;

  if (status === "done") {
    const rv = job.returnvalue as { fileName?: string } | undefined;
    fileName =
      rv?.fileName ??
      path.basename(String((job.data as SciConsolidadoJobPayload).outputPath ?? "ProdutosSCI.xlsx"));
    downloadToken = await signDownloadToken(env, id, fileName, "sci-consolidado");
  }
  if (status === "failed") {
    error = job.failedReason?.slice(0, 500) ?? "Falha no processamento";
  }

  return {
    id,
    status,
    progress,
    error,
    downloadToken,
    fileName,
  };
});

app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
  `${API_PREFIX}/tools/sci-consolidado/jobs/:id/download`,
  async (req, reply) => {
    const { id } = req.params;
    const token = req.query.token;
    if (!token) return reply.code(401).send({ error: "Token ausente" });

    const claims = await verifyDownloadToken(env, token);
    if (!claims || claims.jobId !== id || claims.tool !== "sci-consolidado") {
      return reply.code(401).send({ error: "Token inválido" });
    }

    const job = await sciConsolidadoQueue.getJob(id);
    if (!job || (await job.getState()) !== "completed") {
      return reply.code(404).send({ error: "Job não concluído" });
    }

    const outPath = (job.data as SciConsolidadoJobPayload).outputPath;
    if (!outPath || !fs.existsSync(outPath)) {
      return reply.code(404).send({ error: "Arquivo não encontrado" });
    }

    const stream = fs.createReadStream(outPath);
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const fn = claims.fileName.replace(/[\r\n"]/g, "_");
    const asciiFallback = fn.replace(/[^\x20-\x7e]/g, "_");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fn)}`
    );
    return reply.send(stream);
  }
);

// ── Comparação de Planilhas (engines/comparacao-planilhas) ──────────────────

const ALLOWED_COMPARACAO_EXT = new Set([".csv", ".xlsx", ".xls"]);

app.post(
  `${API_PREFIX}/tools/comparacao-planilhas/jobs`,
  async (req, reply) => {
    const jobId = randomUUID();
    const inDir = path.join(jobDir(jobId), "in");
    const outDir = path.join(jobDir(jobId), "out");

    try {
      const pong = await getRedis(env).ping();
      if (pong !== "PONG") throw new Error("Redis não respondeu");
    } catch (e) {
      req.log.warn({ err: e }, "redis indisponível ao criar job comparação");
      return reply.code(503).send({
        error:
          "Redis não está acessível. Inicie o Redis e o worker Comparação Planilhas (worker-comparacao-planilhas + Python).",
      });
    }

    const sefazDir = path.join(inDir, "sefaz");
    const sciDir = path.join(inDir, "sci");
    await fs.promises.mkdir(sefazDir, { recursive: true });
    await fs.promises.mkdir(sciDir, { recursive: true });
    await fs.promises.mkdir(outDir, { recursive: true });

    let totalBytes = 0;
    const sefazPaths: string[] = [];
    const sciPaths: string[] = [];

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type !== "file") continue;
      const name = (part.filename ?? "arquivo").replace(/[/\\]/g, "_");
      const ext = path.extname(name).toLowerCase();
      if (!ALLOWED_COMPARACAO_EXT.has(ext)) {
        await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
        return reply.code(400).send({
          error: `Formato não suportado: ${name}. Use .csv, .xlsx ou .xls.`,
        });
      }
      const buf = await part.toBuffer();
      totalBytes += buf.length;
      if (totalBytes > env.MAX_UPLOAD_MB * 1024 * 1024) {
        await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
        return reply.code(413).send({ error: "Arquivos muito grandes" });
      }
      const fieldName = part.fieldname;
      if (fieldName === "sefaz") {
        const dest = path.join(sefazDir, `sefaz_${sefazPaths.length}${ext}`);
        await fs.promises.writeFile(dest, buf);
        sefazPaths.push(dest);
      } else if (fieldName === "sci") {
        const dest = path.join(sciDir, `sci_${sciPaths.length}${ext}`);
        await fs.promises.writeFile(dest, buf);
        sciPaths.push(dest);
      }
    }

    if (sefazPaths.length === 0 || sciPaths.length === 0) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      return reply.code(400).send({
        error: "Envie ao menos um arquivo SEFAZ e um arquivo SCI.",
      });
    }

    const outputPath = path.join(outDir, "Notas Faltantes.xlsx");

    const payload: ComparacaoPlanilhasJobPayload = {
      jobId,
      sefazPaths,
      sciPaths,
      outputPath,
    };

    try {
      await Promise.race([
        comparacaoPlanilhasQueue.add("comparacao", payload, { jobId }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Fila timeout")), 15_000)
        ),
      ]);
    } catch (e) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      req.log.error({ err: e }, "falha ao enfileirar job comparação");
      return reply.code(503).send({
        error:
          "Não foi possível enfileirar o job. Verifique Redis e se o worker-comparacao-planilhas está rodando.",
      });
    }

    return reply.code(202).send({ id: jobId, status: "queued" as const });
  }
);

app.get<{ Params: { id: string } }>(`${API_PREFIX}/tools/comparacao-planilhas/jobs/:id`, async (req, reply) => {
  const { id } = req.params;
  const job = await comparacaoPlanilhasQueue.getJob(id);
  if (!job) {
    return reply.code(404).send({
      id,
      status: "not_found" as const,
    });
  }
  const state = await job.getState();
  const status = mapBullState(state);
  const progress =
    typeof job.progress === "number" ? Math.round(job.progress) : undefined;

  let downloadToken: string | undefined;
  let fileName: string | undefined;
  let error: string | undefined;

  if (status === "done") {
    const rv = job.returnvalue as { fileName?: string } | undefined;
    fileName =
      rv?.fileName ??
      path.basename(String((job.data as ComparacaoPlanilhasJobPayload).outputPath ?? "Notas Faltantes.xlsx"));
    downloadToken = await signDownloadToken(env, id, fileName, "comparacao-planilhas");
  }
  if (status === "failed") {
    error = job.failedReason?.slice(0, 500) ?? "Falha no processamento";
  }

  return {
    id,
    status,
    progress,
    error,
    downloadToken,
    fileName,
  };
});

app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
  `${API_PREFIX}/tools/comparacao-planilhas/jobs/:id/download`,
  async (req, reply) => {
    const { id } = req.params;
    const token = req.query.token;
    if (!token) return reply.code(401).send({ error: "Token ausente" });

    const claims = await verifyDownloadToken(env, token);
    if (!claims || claims.jobId !== id || claims.tool !== "comparacao-planilhas") {
      return reply.code(401).send({ error: "Token inválido" });
    }

    const job = await comparacaoPlanilhasQueue.getJob(id);
    if (!job || (await job.getState()) !== "completed") {
      return reply.code(404).send({ error: "Job não concluído" });
    }

    const outPath = (job.data as ComparacaoPlanilhasJobPayload).outputPath;
    if (!outPath || !fs.existsSync(outPath)) {
      return reply.code(404).send({ error: "Arquivo não encontrado" });
    }

    const stream = fs.createReadStream(outPath);
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const fn = claims.fileName.replace(/[\r\n"]/g, "_");
    const asciiFallback = fn.replace(/[^\x20-\x7e]/g, "_");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fn)}`
    );
    return reply.send(stream);
  }
);

// ── Conciliador NFS-e SCI × Portal Nacional (engines/sci-portal-nacional) ─────────────────

const ALLOWED_SCI_PORTAL_EXT = new Set([".csv", ".xlsx", ".xls"]);

app.post(
  `${API_PREFIX}/tools/sci-portal-nacional/jobs`,
  async (req, reply) => {
    const jobId = randomUUID();
    const inDir = path.join(jobDir(jobId), "in");
    const outDir = path.join(jobDir(jobId), "out");

    try {
      const pong = await getRedis(env).ping();
      if (pong !== "PONG") throw new Error("Redis não respondeu");
    } catch (e) {
      req.log.warn({ err: e }, "redis indisponível ao criar job sci-portal");
      return reply.code(503).send({
        error:
          "Redis não está acessível. Inicie o Redis e o worker Conciliador NFS-e (worker-sci-portal-nacional).",
      });
    }

    await fs.promises.mkdir(inDir, { recursive: true });
    await fs.promises.mkdir(outDir, { recursive: true });

    let totalBytes = 0;
    let sciPath: string | null = null;
    let portalPath: string | null = null;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type !== "file") continue;
      const name = (part.filename ?? "arquivo").replace(/[/\\]/g, "_");
      const ext = path.extname(name).toLowerCase();
      if (!ALLOWED_SCI_PORTAL_EXT.has(ext)) {
        await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
        return reply.code(400).send({
          error: `Formato não suportado: ${name}. Use .csv, .xlsx ou .xls.`,
        });
      }
      const buf = await part.toBuffer();
      totalBytes += buf.length;
      if (totalBytes > env.MAX_UPLOAD_MB * 1024 * 1024) {
        await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
        return reply.code(413).send({ error: "Arquivos muito grandes" });
      }
      const fieldName = part.fieldname;
      if (fieldName === "sci" && !sciPath) {
        const dest = path.join(inDir, `sci${ext}`);
        await fs.promises.writeFile(dest, buf);
        sciPath = dest;
      } else if (fieldName === "portal" && !portalPath) {
        const dest = path.join(inDir, `portal${ext}`);
        await fs.promises.writeFile(dest, buf);
        portalPath = dest;
      }
    }

    if (!sciPath || !portalPath) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      return reply.code(400).send({
        error: "Envie 1 arquivo no campo 'sci' (planilha SCI) e 1 no campo 'portal' (planilha Portal Nacional).",
      });
    }

    const outputPath = path.join(outDir, "Conciliacao SCI x Portal Nacional.xlsx");

    const payload: SciPortalNacionalJobPayload = {
      jobId,
      sciPath,
      portalPath,
      outputPath,
    };

    try {
      await Promise.race([
        sciPortalNacionalQueue.add("conciliacao", payload, { jobId }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Fila timeout")), 15_000)
        ),
      ]);
    } catch (e) {
      await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
      req.log.error({ err: e }, "falha ao enfileirar job sci-portal");
      return reply.code(503).send({
        error:
          "Não foi possível enfileirar o job. Verifique Redis e se o worker-sci-portal-nacional está rodando.",
      });
    }

    return reply.code(202).send({ id: jobId, status: "queued" as const });
  }
);

app.get<{ Params: { id: string } }>(`${API_PREFIX}/tools/sci-portal-nacional/jobs/:id`, async (req, reply) => {
  const { id } = req.params;
  const job = await sciPortalNacionalQueue.getJob(id);
  if (!job) {
    return reply.code(404).send({
      id,
      status: "not_found" as const,
    });
  }
  const state = await job.getState();
  const status = mapBullState(state);
  const progress =
    typeof job.progress === "number" ? Math.round(job.progress) : undefined;

  let downloadToken: string | undefined;
  let fileName: string | undefined;
  let error: string | undefined;

  if (status === "done") {
    const rv = job.returnvalue as { fileName?: string } | undefined;
    fileName =
      rv?.fileName ??
      path.basename(String((job.data as SciPortalNacionalJobPayload).outputPath ?? "Conciliacao SCI x Portal Nacional.xlsx"));
    downloadToken = await signDownloadToken(env, id, fileName, "sci-portal-nacional");
  }
  if (status === "failed") {
    error = job.failedReason?.slice(0, 500) ?? "Falha no processamento";
  }

  return {
    id,
    status,
    progress,
    error,
    downloadToken,
    fileName,
  };
});

app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
  `${API_PREFIX}/tools/sci-portal-nacional/jobs/:id/download`,
  async (req, reply) => {
    const { id } = req.params;
    const token = req.query.token;
    if (!token) return reply.code(401).send({ error: "Token ausente" });

    const claims = await verifyDownloadToken(env, token);
    if (!claims || claims.jobId !== id || claims.tool !== "sci-portal-nacional") {
      return reply.code(401).send({ error: "Token inválido" });
    }

    const job = await sciPortalNacionalQueue.getJob(id);
    if (!job || (await job.getState()) !== "completed") {
      return reply.code(404).send({ error: "Job não concluído" });
    }

    const outPath = (job.data as SciPortalNacionalJobPayload).outputPath;
    if (!outPath || !fs.existsSync(outPath)) {
      return reply.code(404).send({ error: "Arquivo não encontrado" });
    }

    const stream = fs.createReadStream(outPath);
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const fn = claims.fileName.replace(/[\r\n"]/g, "_");
    const asciiFallback = fn.replace(/[^\x20-\x7e]/g, "_");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fn)}`
    );
    return reply.send(stream);
  }
);

// ── Comparação NFS-e (engines/comparacao-nfse) — PDF (OCR Gemini) × XML ────────────────

const ALLOWED_NFSE_PDF_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);
const ALLOWED_NFSE_XML_EXT = new Set([".xml"]);

/** Mesma chave Redis usada pelo gemini_governor (Python). NAO mudar isolado. */
const NFSE_CIRCUIT_KEY = "nfse:gemini:circuit";

function nfseJobPaths(jobId: string) {
  const base = jobDir(jobId);
  const pdfsDir = path.join(base, "in", "pdfs");
  const xmlsDir = path.join(base, "in", "xmls");
  const outDir = path.join(base, "out");
  return { base, pdfsDir, xmlsDir, outDir };
}

type NfseCircuitState = {
  state: "closed" | "open" | "half_open";
  openUntilSec: number; // epoch seconds; 0 se closed
};

async function readNfseCircuitState(): Promise<NfseCircuitState> {
  try {
    const redis = getRedis(env);
    const raw = await redis.hmget(NFSE_CIRCUIT_KEY, "state", "open_until");
    const state = (raw[0] as string | null) || "closed";
    const openUntil = parseFloat((raw[1] as string | null) || "0") || 0;
    if (state === "open" || state === "half_open") {
      return { state, openUntilSec: openUntil };
    }
    return { state: "closed", openUntilSec: 0 };
  } catch {
    return { state: "closed", openUntilSec: 0 };
  }
}

/** Heuristica simples: tempo medio de job * jobs aguardando + ativos. */
function estimateWaitSec(queueDepth: number): number {
  const AVG_JOB_SEC = 60; // estimativa conservadora (4000 PDFs / Tier 1)
  const concurrency = 4; // espelha NFSE_WORKER_CONCURRENCY default
  return Math.max(0, Math.ceil((queueDepth / concurrency) * AVG_JOB_SEC));
}

app.get(`${API_PREFIX}/tools/comparacao-nfse/health`, async () => {
  const circuit = await readNfseCircuitState();
  let queueDepth = 0;
  try {
    const counts = await comparacaoNfseQueue.getJobCounts(
      "waiting",
      "active",
      "delayed",
    );
    queueDepth =
      (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
  } catch {
    /* ignore */
  }
  const geminiAvailable =
    Boolean(env.GEMINI_API_KEY) && circuit.state !== "open";
  const circuitOpenUntil =
    circuit.state === "open" ? new Date(circuit.openUntilSec * 1000).toISOString() : null;
  return {
    geminiAvailable,
    circuitOpenUntil,
    queueDepth,
    estimatedWaitSec: estimateWaitSec(queueDepth),
  };
});

app.post(`${API_PREFIX}/tools/comparacao-nfse/jobs`, async (req, reply) => {
  const jobId = randomUUID();
  const { pdfsDir, xmlsDir, outDir } = nfseJobPaths(jobId);

  try {
    const pong = await getRedis(env).ping();
    if (pong !== "PONG") throw new Error("Redis não respondeu");
  } catch (e) {
    req.log.warn({ err: e }, "redis indisponível ao criar job nfse");
    return reply.code(503).send({
      error:
        "Redis não está acessível. Inicie o Redis e o worker Comparador NFS-e (worker-comparacao-nfse + engines/comparacao-nfse).",
    });
  }

  await fs.promises.mkdir(pdfsDir, { recursive: true });
  await fs.promises.mkdir(xmlsDir, { recursive: true });
  await fs.promises.mkdir(outDir, { recursive: true });
  return reply.code(201).send({ id: jobId });
});

app.post<{ Params: { id: string } }>(
  `${API_PREFIX}/tools/comparacao-nfse/jobs/:id/chunk`,
  async (req, reply) => {
    const { id } = req.params;
    if (!/^[0-9a-f-]{8,}$/i.test(id)) {
      return reply.code(400).send({ error: "Id inválido" });
    }
    const { base, pdfsDir, xmlsDir } = nfseJobPaths(id);
    if (!fs.existsSync(base)) {
      return reply.code(404).send({ error: "Job não encontrado (inicie com POST /jobs)." });
    }

    let totalBytes = 0;
    let savedPdfs = 0;
    let savedXmls = 0;
    const maxBytes = env.MAX_UPLOAD_NFSE_MB * 1024 * 1024;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type !== "file") continue;
      const originalName = (part.filename ?? "arquivo").replace(/[/\\]/g, "_");
      const ext = path.extname(originalName).toLowerCase();
      const field = part.fieldname;

      let targetDir: string | null = null;
      if (field === "pdfs" && ALLOWED_NFSE_PDF_EXT.has(ext)) {
        targetDir = pdfsDir;
      } else if (field === "xmls" && ALLOWED_NFSE_XML_EXT.has(ext)) {
        targetDir = xmlsDir;
      } else {
        return reply.code(400).send({
          error: `Arquivo ${originalName}: campo "${field}" não aceita extensão "${ext}". Use campo "pdfs" (.pdf, .jpg, .jpeg, .png) ou "xmls" (.xml).`,
        });
      }

      const buf = await part.toBuffer();
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        return reply.code(413).send({
          error: `Chunk excedeu ${env.MAX_UPLOAD_NFSE_MB} MB. Envie em lotes menores.`,
        });
      }
      const uniq = randomUUID().slice(0, 8);
      const dest = path.join(targetDir, `${uniq}_${originalName}`);
      await fs.promises.writeFile(dest, buf);
      if (targetDir === pdfsDir) savedPdfs += 1;
      else savedXmls += 1;
    }

    return reply.send({ ok: true, savedPdfs, savedXmls });
  }
);

app.post<{ Params: { id: string } }>(
  `${API_PREFIX}/tools/comparacao-nfse/jobs/:id/start`,
  async (req, reply) => {
    const { id } = req.params;
    const { base, pdfsDir, xmlsDir, outDir } = nfseJobPaths(id);
    if (!fs.existsSync(base)) {
      return reply.code(404).send({ error: "Job não encontrado." });
    }

    const xmlCount = (await fs.promises.readdir(xmlsDir).catch(() => [])).length;
    const pdfCount = (await fs.promises.readdir(pdfsDir).catch(() => [])).length;
    if (xmlCount === 0 && pdfCount === 0) {
      return reply.code(400).send({
        error: "Envie ao menos um XML ou um PDF antes de iniciar a comparação.",
      });
    }

    /** Fail-fast quando o circuit esta aberto E o job tem PDFs (que precisariam
     * de Gemini). Jobs so com XML nao tocam Gemini, entao podem prosseguir. */
    if (pdfCount > 0) {
      const circuit = await readNfseCircuitState();
      if (circuit.state === "open") {
        const retryAfterSec = Math.max(
          0,
          Math.ceil(circuit.openUntilSec - Date.now() / 1000),
        );
        return reply.code(503).send({
          error:
            "Cota do Gemini esgotada — aguarde antes de iniciar novos jobs com PDFs.",
          failureKind: "quota" as const,
          retryAfterSec,
        });
      }
    }

    const outputXlsx = path.join(outDir, "Comparador NFS-e.xlsx");
    const outputJson = path.join(outDir, "result.json");

    const payload: ComparacaoNfseJobPayload = {
      jobId: id,
      pdfsDir,
      xmlsDir,
      outputXlsx,
      outputJson,
    };

    try {
      await Promise.race([
        comparacaoNfseQueue.add("nfse", payload, { jobId: id }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Fila timeout")), 15_000)
        ),
      ]);
    } catch (e) {
      req.log.error({ err: e }, "falha ao enfileirar job nfse");
      return reply.code(503).send({
        error:
          "Não foi possível enfileirar o job. Verifique Redis e se o worker-comparacao-nfse está rodando.",
      });
    }

    return reply.code(202).send({ id, status: "queued" as const });
  }
);

app.get<{ Params: { id: string } }>(`${API_PREFIX}/tools/comparacao-nfse/jobs/:id`, async (req, reply) => {
  const { id } = req.params;
  const job = await comparacaoNfseQueue.getJob(id);
  if (!job) {
    const { base } = nfseJobPaths(id);
    if (fs.existsSync(base)) {
      return reply.send({ id, status: "queued" as const });
    }
    return reply.code(404).send({ id, status: "not_found" as const });
  }
  const state = await job.getState();
  const status = mapBullState(state);
  const progress =
    typeof job.progress === "number" ? Math.round(job.progress) : undefined;

  let downloadToken: string | undefined;
  let fileName: string | undefined;
  let error: string | undefined;
  let result: unknown;

  if (status === "done") {
    const rv = job.returnvalue as { fileName?: string; result?: unknown; hasXlsx?: boolean } | undefined;
    fileName =
      rv?.fileName ??
      path.basename(String((job.data as ComparacaoNfseJobPayload).outputXlsx ?? "Comparador NFS-e.xlsx"));
    if (rv?.hasXlsx !== false) {
      downloadToken = await signDownloadToken(env, id, fileName, "comparacao-nfse");
    }
    result = rv?.result;
    if (result == null) {
      const jsonPath = (job.data as ComparacaoNfseJobPayload).outputJson;
      if (jsonPath && fs.existsSync(jsonPath)) {
        try {
          const raw = await fs.promises.readFile(jsonPath, "utf-8");
          result = JSON.parse(raw);
        } catch {
          /* ignore */
        }
      }
    }
  }
  if (status === "failed") {
    error = job.failedReason?.slice(0, 500) ?? "Falha no processamento";
  }

  let estimatedWaitSec: number | undefined;
  if (status === "queued") {
    try {
      const counts = await comparacaoNfseQueue.getJobCounts(
        "waiting",
        "active",
        "delayed",
      );
      const depth =
        (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
      estimatedWaitSec = estimateWaitSec(depth);
    } catch {
      /* ignore — campo opcional */
    }
  }

  return {
    id,
    status,
    progress,
    error,
    downloadToken,
    fileName,
    result,
    estimatedWaitSec,
  };
});

app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
  `${API_PREFIX}/tools/comparacao-nfse/jobs/:id/download`,
  async (req, reply) => {
    const { id } = req.params;
    const token = req.query.token;
    if (!token) return reply.code(401).send({ error: "Token ausente" });

    const claims = await verifyDownloadToken(env, token);
    if (!claims || claims.jobId !== id || claims.tool !== "comparacao-nfse") {
      return reply.code(401).send({ error: "Token inválido" });
    }

    const job = await comparacaoNfseQueue.getJob(id);
    if (!job || (await job.getState()) !== "completed") {
      return reply.code(404).send({ error: "Job não concluído" });
    }

    const outPath = (job.data as ComparacaoNfseJobPayload).outputXlsx;
    if (!outPath || !fs.existsSync(outPath)) {
      return reply.code(404).send({ error: "Arquivo não encontrado" });
    }

    const stream = fs.createReadStream(outPath);
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const fn = claims.fileName.replace(/[\r\n"]/g, "_");
    const asciiFallback = fn.replace(/[^\x20-\x7e]/g, "_");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fn)}`
    );
    return reply.send(stream);
  }
);

/** ============= Extrator GNRE (engines/gnre) ============= */

const ALLOWED_GNRE_EXT = new Set([".pdf"]);

app.post(`${API_PREFIX}/tools/gnre/jobs`, async (req, reply) => {
  const jobId = randomUUID();
  const inDir = path.join(jobDir(jobId), "in");
  const outDir = path.join(jobDir(jobId), "out");

  try {
    const pong = await getRedis(env).ping();
    if (pong !== "PONG") throw new Error("Redis não respondeu");
  } catch (e) {
    req.log.warn({ err: e }, "redis indisponível ao criar job GNRE");
    return reply.code(503).send({
      error:
        "Redis não está acessível. Inicie o Redis e o worker GNRE (worker-gnre-bridge + Python).",
    });
  }

  await fs.promises.mkdir(inDir, { recursive: true });
  await fs.promises.mkdir(outDir, { recursive: true });

  let totalBytes = 0;
  let fileCount = 0;
  try {
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type !== "file") continue;
      const original = (part.filename ?? "guia.pdf").replace(/[/\\]/g, "_");
      const ext = path.extname(original).toLowerCase();
      if (!ALLOWED_GNRE_EXT.has(ext)) {
        await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
        return reply.code(400).send({
          error: `Formato não suportado: ${original}. Aceitamos apenas .pdf.`,
        });
      }
      const buf = await part.toBuffer();
      totalBytes += buf.length;
      if (totalBytes > env.MAX_UPLOAD_NFSE_MB * 1024 * 1024) {
        await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
        return reply.code(413).send({
          error: `Tamanho total excede ${env.MAX_UPLOAD_NFSE_MB} MB.`,
        });
      }
      fileCount += 1;
      const safe = original.replace(/[^\w.\-]+/g, "_").slice(0, 180) || `guia_${fileCount}.pdf`;
      const dest = path.join(inDir, `${String(fileCount).padStart(4, "0")}_${safe}`);
      await fs.promises.writeFile(dest, buf);
    }
  } catch (e) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    req.log.error({ err: e }, "falha ao ler upload GNRE");
    return reply.code(400).send({ error: "Falha ao ler upload" });
  }

  if (fileCount === 0) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    return reply.code(400).send({ error: "Nenhum PDF enviado" });
  }

  const outputXlsx = path.join(outDir, "GNRE_Extracao.xlsx");

  const payload: GnreJobPayload = {
    jobId,
    pdfsDir: inDir,
    outputXlsx,
  };

  try {
    await Promise.race([
      gnreQueue.add("extract", payload, { jobId }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Fila timeout")), 15_000),
      ),
    ]);
  } catch (e) {
    await fs.promises.rm(jobDir(jobId), { recursive: true, force: true });
    req.log.error({ err: e }, "falha ao enfileirar job GNRE");
    return reply.code(503).send({
      error:
        "Não foi possível enfileirar o job. Verifique Redis e o worker-gnre-bridge.",
    });
  }

  return reply.code(202).send({ id: jobId, status: "queued" as const });
});

app.get<{ Params: { id: string } }>(`${API_PREFIX}/tools/gnre/jobs/:id`, async (req, reply) => {
  const { id } = req.params;
  const job = await gnreQueue.getJob(id);
  if (!job) {
    return reply.code(404).send({ id, status: "not_found" as const });
  }
  const state = await job.getState();
  const status = mapBullState(state);
  const progress =
    typeof job.progress === "number" ? Math.round(job.progress) : undefined;

  let downloadToken: string | undefined;
  let fileName: string | undefined;
  let error: string | undefined;
  let result: unknown;

  if (status === "done") {
    const rv = job.returnvalue as { fileName?: string; result?: unknown } | undefined;
    fileName =
      rv?.fileName ??
      path.basename(String((job.data as GnreJobPayload).outputXlsx ?? "GNRE_Extracao.xlsx"));
    downloadToken = await signDownloadToken(env, id, fileName, "gnre");
    result = rv?.result;
  }
  if (status === "failed") {
    error = job.failedReason?.slice(0, 500) ?? "Falha no processamento";
  }

  return { id, status, progress, error, downloadToken, fileName, result };
});

app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
  `${API_PREFIX}/tools/gnre/jobs/:id/download`,
  async (req, reply) => {
    const { id } = req.params;
    const token = req.query.token;
    if (!token) return reply.code(401).send({ error: "Token ausente" });

    const claims = await verifyDownloadToken(env, token);
    if (!claims || claims.jobId !== id || claims.tool !== "gnre") {
      return reply.code(401).send({ error: "Token inválido" });
    }

    const job = await gnreQueue.getJob(id);
    if (!job || (await job.getState()) !== "completed") {
      return reply.code(404).send({ error: "Job não concluído" });
    }

    const outPath = (job.data as GnreJobPayload).outputXlsx;
    if (!outPath || !fs.existsSync(outPath)) {
      return reply.code(404).send({ error: "Arquivo não encontrado" });
    }

    const stream = fs.createReadStream(outPath);
    reply.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const fn = claims.fileName.replace(/[\r\n"]/g, "_");
    const asciiFallback = fn.replace(/[^\x20-\x7e]/g, "_");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fn)}`,
    );
    return reply.send(stream);
  },
);

// ── Editor de Extrato: cadastro de clientes/fornecedores (SQLite) ────────────
//
// Banco compartilhado na intranet (EXTRATO_DB_PATH, volume persistente). O
// usuário sobe a planilha de cadastro (Cód./Nome/CNPJ) parseada no navegador e
// envia as linhas em JSON aqui; ao processar um extrato, /lookup devolve o CNPJ
// pelo código do cliente/fornecedor. Sem fila/Redis — é só leitura/escrita local.

const EXTRATO_TIPOS = new Set<EntidadeTipo>(["cliente", "fornecedor"]);
const EXTRATO_MAX_IMPORT_ROWS = 100_000;
const EXTRATO_MAX_LOOKUP_CODES = 50_000;

function parseTipo(v: unknown): EntidadeTipo | null {
  return typeof v === "string" && EXTRATO_TIPOS.has(v as EntidadeTipo)
    ? (v as EntidadeTipo)
    : null;
}

app.get<{ Querystring: { tipo?: string; q?: string; limit?: string; offset?: string } }>(
  `${API_PREFIX}/tools/extrato-edit/entidades`,
  async (req, reply) => {
    const conn = getExtratoDb(env.EXTRATO_DB_PATH);
    const tipo = req.query.tipo ? parseTipo(req.query.tipo) : undefined;
    if (req.query.tipo && !tipo) {
      return reply.code(400).send({ error: "tipo deve ser 'cliente' ou 'fornecedor'." });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { items, total } = listEntidades(conn, {
      ...(tipo ? { tipo } : {}),
      ...(req.query.q ? { q: req.query.q } : {}),
      limit,
      offset,
    });
    return { items, total, counts: countEntidades(conn) };
  },
);

app.get(`${API_PREFIX}/tools/extrato-edit/entidades/counts`, async () => {
  const conn = getExtratoDb(env.EXTRATO_DB_PATH);
  return { counts: countEntidades(conn) };
});

app.post<{ Body: { tipo?: string; rows?: EntidadeInput[]; replace?: boolean } }>(
  `${API_PREFIX}/tools/extrato-edit/entidades/import`,
  async (req, reply) => {
    const body = req.body ?? {};
    const tipo = parseTipo(body.tipo);
    if (!tipo) {
      return reply.code(400).send({ error: "Informe tipo 'cliente' ou 'fornecedor'." });
    }
    if (!Array.isArray(body.rows)) {
      return reply.code(400).send({ error: "rows deve ser um array de { codigo, nome, cnpj }." });
    }
    if (body.rows.length > EXTRATO_MAX_IMPORT_ROWS) {
      return reply
        .code(413)
        .send({ error: `Máximo de ${EXTRATO_MAX_IMPORT_ROWS} linhas por importação.` });
    }
    const conn = getExtratoDb(env.EXTRATO_DB_PATH);
    if (body.replace === true) clearTipo(conn, tipo);
    const result = importEntidades(conn, tipo, body.rows, new Date().toISOString());
    return { ...result, counts: countEntidades(conn) };
  },
);

app.post<{ Body: { tipo?: string; codigos?: unknown } }>(
  `${API_PREFIX}/tools/extrato-edit/lookup`,
  async (req, reply) => {
    const body = req.body ?? {};
    const tipo = parseTipo(body.tipo);
    if (!tipo) {
      return reply.code(400).send({ error: "Informe tipo 'cliente' ou 'fornecedor'." });
    }
    if (!Array.isArray(body.codigos)) {
      return reply.code(400).send({ error: "codigos deve ser um array de strings." });
    }
    if (body.codigos.length > EXTRATO_MAX_LOOKUP_CODES) {
      return reply
        .code(413)
        .send({ error: `Máximo de ${EXTRATO_MAX_LOOKUP_CODES} códigos por consulta.` });
    }
    const codigos = body.codigos.map((c) => String(c ?? ""));
    const conn = getExtratoDb(env.EXTRATO_DB_PATH);
    return { matches: lookupByCodigos(conn, tipo, codigos) };
  },
);

app.delete<{ Querystring: { tipo?: string; codigo?: string } }>(
  `${API_PREFIX}/tools/extrato-edit/entidades/item`,
  async (req, reply) => {
    const tipo = parseTipo(req.query.tipo);
    if (!tipo) {
      return reply.code(400).send({ error: "Informe tipo 'cliente' ou 'fornecedor'." });
    }
    const codigo = String(req.query.codigo ?? "").trim();
    if (codigo === "") {
      return reply.code(400).send({ error: "Informe o código a excluir." });
    }
    const conn = getExtratoDb(env.EXTRATO_DB_PATH);
    const ok = deleteEntidade(conn, tipo, codigo);
    if (!ok) return reply.code(404).send({ error: "Registro não encontrado." });
    return { ok: true, counts: countEntidades(conn) };
  },
);

app.delete<{ Querystring: { tipo?: string } }>(
  `${API_PREFIX}/tools/extrato-edit/entidades`,
  async (req, reply) => {
    const tipo = parseTipo(req.query.tipo);
    if (!tipo) {
      return reply.code(400).send({ error: "Informe tipo 'cliente' ou 'fornecedor'." });
    }
    const conn = getExtratoDb(env.EXTRATO_DB_PATH);
    const removed = clearTipo(conn, tipo);
    return { removed, counts: countEntidades(conn) };
  },
);

async function cleanupOldJobs(): Promise<void> {
  const root = path.resolve(env.TEMP_JOBS_ROOT);
  try {
    const dirs = await fs.promises.readdir(root, { withFileTypes: true });
    const maxAgeMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const p = path.join(root, d.name);
      const st = await fs.promises.stat(p);
      if (now - st.mtimeMs > maxAgeMs) {
        await fs.promises.rm(p, { recursive: true, force: true });
      }
    }
  } catch {
    /* ignore */
  }
}

setInterval(() => {
  cleanupOldJobs().catch(() => undefined);
}, 60 * 60 * 1000);

await app.listen({ port: env.PORT, host: "0.0.0.0" });
app.log.info(`API ${API_PREFIX} na porta ${env.PORT}`);
