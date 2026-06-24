import {
  SPED_EXPORT_SHEET_KEYS,
  SPED_REG_CODE_RE,
  type SpedRegMetaResponse,
} from "@webapp/contracts";

/** Limite ao ler o .txt no navegador quando a API não tem POST /tools/sped/inspect (404). */
const SPED_INSPECT_LOCAL_MAX_BYTES = 80 * 1024 * 1024;

function extractRegFromSpedLine(line: string): string | null {
  if (!line.includes("|")) return null;
  const fields = line.trimEnd().split("|");
  if (fields.length < 3) return null;
  const inner = fields.slice(1, -1);
  const reg = (inner[0] || "").trim().toUpperCase();
  return SPED_REG_CODE_RE.test(reg) ? reg : null;
}

/** Mesma lógica que a API; usada só como fallback se o servidor estiver desatualizado. */
export async function scanSpedPresentRegsLocal(file: File): Promise<string[]> {
  const n = Math.min(file.size, SPED_INSPECT_LOCAL_MAX_BYTES);
  const text = await file.slice(0, n).text();
  const regs = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const r = extractRegFromSpedLine(line);
    if (r) regs.add(r);
  }
  return [...regs].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

const API_PREFIX = "/api/v1";

/**
 * Se `VITE_API_URL` estiver vazio, usa URL relativa (`/api/...`) para o proxy do Vite
 * encaminhar para a API (padrão: 127.0.0.1:8000). Caso contrário, chama a API direto.
 */
function baseUrl(): string {
  const b = import.meta.env.VITE_API_URL as string | undefined;
  return (b ?? "").replace(/\/$/, "");
}

export type JobStatus = "queued" | "running" | "done" | "failed" | "not_found";

export type JobResponse = {
  id: string;
  status: JobStatus;
  progress?: number;
  error?: string;
  downloadToken?: string;
  fileName?: string;
};

export type ToolCategory = "fiscal" | "contabil";

export type ToolTagTone = "blue" | "violet" | "amber" | "emerald" | "slate";

export type ToolTag = {
  label: string;
  tone: ToolTagTone;
};

export type ToolManifestEntry = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  route: string;
  available: boolean;
  category?: ToolCategory;
  tag?: ToolTag;
};

/**
 * IDs antigos numerados (webapp-0X) → IDs semânticos. Uma API ainda não
 * atualizada pode enviar os ids velhos; mapeamos para os novos para não gerar
 * cards duplicados no merge com o fallback local.
 */
const LEGACY_TOOL_ID_MAP: Record<string, string> = {
  "webapp-03": "sped-merge",
  "webapp-04": "sci-consolidado",
  "webapp-05": "comparacao-planilhas",
  "webapp-06": "comparacao-nfse",
  "webapp-08": "sci-portal-nacional",
};
function normalizeToolId(t: ToolManifestEntry): ToolManifestEntry {
  const mapped = LEGACY_TOOL_ID_MAP[t.id];
  return mapped ? { ...t, id: mapped } : t;
}

function normalizeToolsFromApi(list: ToolManifestEntry[] | undefined): ToolManifestEntry[] {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeToolId);
}

function dedupeToolsById(tools: ToolManifestEntry[]): ToolManifestEntry[] {
  const seen = new Set<string>();
  const out: ToolManifestEntry[] = [];
  for (const t of tools) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

function mergeToolsManifest(
  apiList: ToolManifestEntry[] | undefined,
  fallback: ToolManifestEntry[]
): ToolManifestEntry[] {
  const api = normalizeToolsFromApi(apiList);
  const apiMap = new Map(api.map((t) => [t.id, t]));
  const merged: ToolManifestEntry[] = [];
  for (const t of fallback) {
    const o = apiMap.get(t.id);
    merged.push(o ? { ...t, ...o } : t);
  }
  const fallbackIds = new Set(fallback.map((t) => t.id));
  for (const t of api) {
    if (!fallbackIds.has(t.id)) merged.push(t);
  }
  return dedupeToolsById(merged);
}

export async function fetchToolsManifest(): Promise<ToolManifestEntry[]> {
  const fallback = defaultToolsManifest();
  try {
    const res = await fetch(`${baseUrl()}${API_PREFIX}/tools`);
    if (!res.ok) return fallback;
    const data = (await res.json()) as { tools?: ToolManifestEntry[] };
    return mergeToolsManifest(data.tools, fallback);
  } catch {
    return fallback;
  }
}

function defaultToolsManifest(): ToolManifestEntry[] {
  return [
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
        "Envie a exportação SCI (CSV ou Excel). Receba ProdutosSCI.xlsx com Produtos, Base e Consolidado (SCI).",
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
      id: "nfse-pdf",
      title: "NFS-e → PDF",
      subtitle: "XML → DANFSe (.zip)",
      description:
        "Envie os XMLs de NFS-e (padrão nacional). Cada nota vira um PDF no layout do DANFSe e você baixa tudo num .zip. Roda 100% no navegador — nada é enviado a servidores. Eventos de cancelamento também geram PDF.",
      route: "/tools/nfse-pdf",
      available: true,
      category: "fiscal",
      tag: { label: "NFS-e · Serviços", tone: "violet" },
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
      id: "extrato-edit",
      title: "Editor de Extrato",
      subtitle: "XLSX → XLSX formatado",
      description:
        "Envie a planilha do extrato, ajuste as colunas (reordene e marque o que exportar) e baixe um .xlsx limpo e formatado. A data das linhas separadoras vira uma coluna ao lado de cada lançamento.",
      route: "/tools/extrato-edit",
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
  ];
}

const UPLOAD_TIMEOUT_MS = 180_000;

function apiOfflineMessage(): string {
  return (
    "Não foi possível falar com a API em http://127.0.0.1:8000 (o Vite encaminha /api para lá). " +
    "Na raiz do projeto: npm run redis:up (Docker) e npm run dev (API + workers + Vite), ou npm run dev:stack. " +
    "Inclui workers das engines/. Só Vite: cd webapp-01 && npm run dev:fe + npm run dev:backend noutro terminal. " +
    "Se a API já estiver no ar e forem muitos XMLs, o envio pode demorar — confira o terminal da API."
  );
}

function isFetchNetworkError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return false;
  if (e instanceof TypeError) return true;
  if (e instanceof Error) {
    const m = e.message.toLowerCase();
    return (
      m === "failed to fetch" ||
      m.includes("networkerror") ||
      m.includes("load failed") ||
      m.includes("connection aborted") ||
      m.includes("network request failed")
    );
  }
  return false;
}

export async function createJob(files: File[]): Promise<{ id: string }> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/jobs`, {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
  } catch (e) {
    const aborted =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      throw new Error(
        `Envio excedeu ${Math.round(UPLOAD_TIMEOUT_MS / 60_000)} minutos (rede lenta ou API sem resposta). Verifique Redis, API em :8000 e tente de novo.`
      );
    }
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    let msg = (err as { error?: string }).error ?? res.statusText;
    const relative = !baseUrl();
    if (
      relative &&
      (res.status === 500 || res.status === 502 || res.status === 503) &&
      (msg === "Internal Server Error" || msg.length < 3)
    ) {
      msg =
        "A API em http://127.0.0.1:8000 não está rodando (o Vite faz proxy para lá). " +
        "Na raiz do projeto: npm run redis:up e npm run dev — " +
        "ou (em webapp-01) npm run dev:backend num terminal e npm run dev:fe noutro.";
    }
    throw new Error(msg);
  }
  return res.json() as Promise<{ id: string }>;
}

export async function getJob(id: string): Promise<JobResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/jobs/${id}`);
  } catch (e) {
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  }
  return res.json() as Promise<JobResponse>;
}

const SPED_CORE_SET = new Set<string>(SPED_EXPORT_SHEET_KEYS);

/** Envia todas as abas principais na ordem padrão; a API omite `sheets` (comportamento legado). */
function isFullCoreSpedSelection(sheets: string[]): boolean {
  if (sheets.length !== SPED_EXPORT_SHEET_KEYS.length) return false;
  const s = new Set(sheets);
  return SPED_EXPORT_SHEET_KEYS.every((k) => s.has(k));
}

export type SpedInspectResult = {
  presentRegs: string[];
  /** Servidor sem rota /tools/sped/inspect; lista veio do navegador. */
  localFallback?: boolean;
};

export async function inspectSpedFile(file: File): Promise<SpedInspectResult> {
  const fd = new FormData();
  fd.append("file", file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/sped/inspect`, {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
  } catch (e) {
    const aborted =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      throw new Error(
        `Leitura do SPED excedeu ${Math.round(UPLOAD_TIMEOUT_MS / 60_000)} minutos. Verifique a API em :8000.`
      );
    }
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (res.ok) {
    const data = (await res.json()) as { presentRegs?: string[] };
    const presentRegs = Array.isArray(data.presentRegs) ? data.presentRegs : [];
    return { presentRegs };
  }

  /** 404/405 = API antiga sem inspect — lista blocos no cliente (inclui K010, K100, K200, …). */
  if (res.status === 404 || res.status === 405) {
    const presentRegs = await scanSpedPresentRegsLocal(file);
    return { presentRegs, localFallback: true };
  }

  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error ?? res.statusText);
}

/** Títulos e blocos do guia interno (cabeçalhos SPED); usado na UI para descrever REGs extras. */
export async function fetchSpedRegMeta(): Promise<SpedRegMetaResponse | null> {
  try {
    const res = await fetch(`${baseUrl()}${API_PREFIX}/tools/sped/reg-meta`);
    if (!res.ok) return null;
    return (await res.json()) as SpedRegMetaResponse;
  } catch {
    return null;
  }
}

export async function createSpedJob(
  file: File,
  options?: { sheets?: string[]; presentRegs?: string[] }
): Promise<{ id: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const sheets = options?.sheets;
  const hasNonCore =
    sheets !== undefined &&
    sheets.length > 0 &&
    sheets.some((s) => !SPED_CORE_SET.has(s));
  if (hasNonCore) {
    const pr = options?.presentRegs;
    if (pr === undefined || pr.length === 0) {
      throw new Error(
        "Falta a lista de REGs do arquivo (presentRegs). Recarregue o ficheiro ou tente inspecionar de novo."
      );
    }
    fd.append("presentRegs", JSON.stringify(pr));
  }
  if (sheets && sheets.length > 0 && !isFullCoreSpedSelection(sheets)) {
    fd.append("sheets", JSON.stringify(sheets));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/sped/jobs`, {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
  } catch (e) {
    const aborted =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      throw new Error(
        `Envio excedeu ${Math.round(UPLOAD_TIMEOUT_MS / 60_000)} minutos (rede lenta ou API sem resposta). Verifique Redis, API em :8000 e worker SPED e tente de novo.`
      );
    }
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    let msg = (err as { error?: string }).error ?? res.statusText;
    const relative = !baseUrl();
    if (
      relative &&
      (res.status === 500 || res.status === 502 || res.status === 503) &&
      (msg === "Internal Server Error" || msg.length < 3)
    ) {
      msg =
        "A API em http://127.0.0.1:8000 não está rodando ou o worker SPED não está ativo. Na raiz do projeto: npm run redis:up e npm run dev (inclui worker-sped).";
    }
    throw new Error(msg);
  }
  return res.json() as Promise<{ id: string }>;
}

export async function getSpedJob(id: string): Promise<JobResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/sped/jobs/${id}`);
  } catch (e) {
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  }
  return res.json() as Promise<JobResponse>;
}

export async function createSpedMergeJob(spedTxt: File | null, xlsx: File): Promise<{ id: string }> {
  const fd = new FormData();
  if (spedTxt) fd.append("sped", spedTxt);
  fd.append("xlsx", xlsx);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/sped-merge/jobs`, {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
  } catch (e) {
    const aborted =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      throw new Error(
        `Envio excedeu ${Math.round(UPLOAD_TIMEOUT_MS / 60_000)} minutos. Verifique Redis, API e worker SPED merge (engines/sped-merge).`
      );
    }
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    let msg = (err as { error?: string }).error ?? res.statusText;
    const relative = !baseUrl();
    if (
      relative &&
      (res.status === 500 || res.status === 502 || res.status === 503) &&
      (msg === "Internal Server Error" || msg.length < 3)
    ) {
      msg =
        "API ou worker SPED merge inativo. Na raiz do projeto: npm run redis:up e npm run dev (inclui worker-sped-merge-bridge e engines/sped-merge).";
    }
    throw new Error(msg);
  }
  return res.json() as Promise<{ id: string }>;
}

export type SpedMergeInspectXlsxResult = {
  complete: boolean;
  requiresOriginal: boolean;
  reasons: string[];
  regSheets: string[];
};

export async function inspectSpedMergeXlsx(xlsx: File): Promise<SpedMergeInspectXlsxResult> {
  const fd = new FormData();
  fd.append("xlsx", xlsx);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/sped-merge/inspect-xlsx`, {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    if (res.status === 404 || res.status === 405) {
      return {
        complete: false,
        requiresOriginal: true,
        reasons: ["API sem rota /tools/sped-merge/inspect-xlsx (servidor desatualizado)"],
        regSheets: [],
      };
    }
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<SpedMergeInspectXlsxResult>;
}

export async function getSpedMergeJob(id: string): Promise<JobResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/sped-merge/jobs/${id}`);
  } catch (e) {
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  }
  return res.json() as Promise<JobResponse>;
}

export async function createSciConsolidadoJob(
  file: File,
  sheet?: string
): Promise<{ id: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const q =
    sheet && sheet.trim().length > 0
      ? `?sheet=${encodeURIComponent(sheet.trim())}`
      : "";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/sci-consolidado/jobs${q}`, {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
  } catch (e) {
    const aborted =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      throw new Error(
        `Envio excedeu ${Math.round(UPLOAD_TIMEOUT_MS / 60_000)} minutos. Verifique Redis, API e worker Consolidado SCI.`
      );
    }
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    let msg = (err as { error?: string }).error ?? res.statusText;
    const relative = !baseUrl();
    if (
      relative &&
      (res.status === 500 || res.status === 502 || res.status === 503) &&
      (msg === "Internal Server Error" || msg.length < 3)
    ) {
      msg =
        "API ou worker Consolidado SCI inativo. Na raiz do projeto: npm run redis:up e npm run dev (worker-sci + engines/sci-consolidado).";
    }
    throw new Error(msg);
  }
  return res.json() as Promise<{ id: string }>;
}

export async function getSciConsolidadoJob(id: string): Promise<JobResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/sci-consolidado/jobs/${id}`);
  } catch (e) {
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  }
  return res.json() as Promise<JobResponse>;
}

export function sciConsolidadoDownloadUrl(id: string, token: string): string {
  return `${baseUrl()}${API_PREFIX}/tools/sci-consolidado/jobs/${id}/download?token=${encodeURIComponent(token)}`;
}

export async function createGnreJob(files: File[]): Promise<{ id: string }> {
  const fd = new FormData();
  for (const f of files) fd.append("pdfs", f);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/gnre/jobs`, {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
  } catch (e) {
    const aborted =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      throw new Error(
        `Envio excedeu ${Math.round(UPLOAD_TIMEOUT_MS / 60_000)} minutos. Verifique Redis, API e worker GNRE.`,
      );
    }
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    let msg = (err as { error?: string }).error ?? res.statusText;
    const relative = !baseUrl();
    if (
      relative &&
      (res.status === 500 || res.status === 502 || res.status === 503) &&
      (msg === "Internal Server Error" || msg.length < 3)
    ) {
      msg =
        "API ou worker GNRE inativo. Na raiz do projeto: npm run redis:up e npm run dev (worker-gnre + engines/gnre).";
    }
    throw new Error(msg);
  }
  return res.json() as Promise<{ id: string }>;
}

export type GnreResult = {
  totais?: { ok?: number; dup?: number; fail?: number; total?: number };
  valorTotal?: number;
  lancamentos?: number;
  falhas?: number;
};

export type GnreJobResponse = JobResponse & { result?: GnreResult };

export async function getGnreJob(id: string): Promise<GnreJobResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/gnre/jobs/${id}`);
  } catch (e) {
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  }
  return res.json() as Promise<GnreJobResponse>;
}

export function gnreDownloadUrl(id: string, token: string): string {
  return `${baseUrl()}${API_PREFIX}/tools/gnre/jobs/${id}/download?token=${encodeURIComponent(token)}`;
}

export function downloadUrl(id: string, token: string): string {
  return `${baseUrl()}${API_PREFIX}/jobs/${id}/download?token=${encodeURIComponent(token)}`;
}

export function spedDownloadUrl(id: string, token: string): string {
  return `${baseUrl()}${API_PREFIX}/tools/sped/jobs/${id}/download?token=${encodeURIComponent(token)}`;
}

export function spedMergeDownloadUrl(id: string, token: string): string {
  return `${baseUrl()}${API_PREFIX}/tools/sped-merge/jobs/${id}/download?token=${encodeURIComponent(token)}`;
}

export async function createComparacaoPlanilhasJob(
  sefazFiles: File[],
  sciFiles: File[]
): Promise<{ id: string }> {
  const fd = new FormData();
  for (const f of sefazFiles) fd.append("sefaz", f);
  for (const f of sciFiles) fd.append("sci", f);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/comparacao-planilhas/jobs`, {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
  } catch (e) {
    const aborted =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      throw new Error(
        `Envio excedeu ${Math.round(UPLOAD_TIMEOUT_MS / 60_000)} minutos. Verifique Redis, API e worker Comparação Planilhas.`
      );
    }
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    let msg = (err as { error?: string }).error ?? res.statusText;
    const relative = !baseUrl();
    if (
      relative &&
      (res.status === 500 || res.status === 502 || res.status === 503) &&
      (msg === "Internal Server Error" || msg.length < 3)
    ) {
      msg =
        "API ou worker Comparação Planilhas inativo. Na raiz do projeto: npm run redis:up e npm run dev (worker-comparacao + engines/comparacao-planilhas).";
    }
    throw new Error(msg);
  }
  return res.json() as Promise<{ id: string }>;
}

export async function getComparacaoPlanilhasJob(id: string): Promise<JobResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/comparacao-planilhas/jobs/${id}`);
  } catch (e) {
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  }
  return res.json() as Promise<JobResponse>;
}

export function comparacaoPlanilhasDownloadUrl(id: string, token: string): string {
  return `${baseUrl()}${API_PREFIX}/tools/comparacao-planilhas/jobs/${id}/download?token=${encodeURIComponent(token)}`;
}

// ── Conciliador NFS-e SCI × SEFAZ Portal Nacional (engines/sci-portal-nacional) ────────────

export async function createSciPortalNacionalJob(
  sciFile: File,
  portalFile: File,
): Promise<{ id: string }> {
  const fd = new FormData();
  fd.append("sci", sciFile);
  fd.append("portal", portalFile);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/sci-portal-nacional/jobs`, {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
  } catch (e) {
    const aborted =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      throw new Error(
        `Envio excedeu ${Math.round(UPLOAD_TIMEOUT_MS / 60_000)} minutos. Verifique Redis, API e worker Conciliador NFS-e.`,
      );
    }
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    let msg = (err as { error?: string }).error ?? res.statusText;
    const relative = !baseUrl();
    if (
      relative &&
      (res.status === 500 || res.status === 502 || res.status === 503) &&
      (msg === "Internal Server Error" || msg.length < 3)
    ) {
      msg =
        "API ou worker Conciliador NFS-e inativo. Na raiz: docker compose --profile comparacao up -d (sobe Redis + worker-sci-portal-nacional).";
    }
    throw new Error(msg);
  }
  return res.json() as Promise<{ id: string }>;
}

export async function getSciPortalNacionalJob(id: string): Promise<JobResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/sci-portal-nacional/jobs/${id}`);
  } catch (e) {
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  }
  return res.json() as Promise<JobResponse>;
}

export function sciPortalNacionalDownloadUrl(id: string, token: string): string {
  return `${baseUrl()}${API_PREFIX}/tools/sci-portal-nacional/jobs/${id}/download?token=${encodeURIComponent(token)}`;
}

// ── Comparador NFS-e (PDF × XML) ─────────────────────────────────────────

export type NfseEntry = {
  cnpjTomador?: string | null;
  numeroNf?: string | null;
  chaveNf?: string | null;
  sourceFile: string;
  method?: "local" | "ocr" | null;
  cnpjPrestador?: string | null;
  razaoSocialPrestador?: string | null;
  razaoSocialTomador?: string | null;
};

export type NfseFailure = { file: string; reason: string };

export type NfseExtractStats = {
  local: number;
  ocr: number;
  imagens: number;
  ocr_disponivel: boolean;
};

export type NfseFailureKind = "quota" | "auth" | "timeout" | "internal";

export type NfseDuplicateGroup = {
  chaveNf?: string | null;
  cnpjTomador?: string | null;
  numeroNf?: string | null;
  entries: NfseEntry[];
};

export type NfseTotals = {
  pdfEnviados: number;
  pdfLidos: number;
  xmlEnviados: number;
  xmlLidos: number;
  matched: number;
  soPdf: number;
  soXml: number;
};

export type ComparacaoNfseResult = {
  soPdf: NfseEntry[];
  soXml: NfseEntry[];
  matchedCount: number;
  xmlIgnorados?: string[];
  pdfFalhos?: Array<string | NfseFailure>;
  extractStats?: NfseExtractStats;
  failureKind?: NfseFailureKind;
  retryAfterSec?: number;
  outputName?: string;
  totals?: NfseTotals;
  duplicadosPdf?: NfseDuplicateGroup[];
};

export type NfseJobResponse = JobResponse & {
  result?: ComparacaoNfseResult;
  estimatedWaitSec?: number;
};

export async function createComparacaoNfseJob(): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl()}${API_PREFIX}/tools/comparacao-nfse/jobs`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<{ id: string }>;
}

export async function uploadComparacaoNfseChunk(
  id: string,
  field: "pdfs" | "xmls",
  files: File[]
): Promise<{ savedPdfs: number; savedXmls: number }> {
  if (files.length === 0) return { savedPdfs: 0, savedXmls: 0 };
  const fd = new FormData();
  for (const f of files) fd.append(field, f);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/comparacao-nfse/jobs/${id}/chunk`, {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
  } catch (e) {
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<{ savedPdfs: number; savedXmls: number }>;
}

/** Erro lancado pelo `/start` quando a quota Gemini esta esgotada. */
export class NfseQuotaError extends Error {
  retryAfterSec: number;
  constructor(message: string, retryAfterSec: number) {
    super(message);
    this.name = "NfseQuotaError";
    this.retryAfterSec = retryAfterSec;
  }
}

export async function startComparacaoNfseJob(id: string): Promise<void> {
  const res = await fetch(`${baseUrl()}${API_PREFIX}/tools/comparacao-nfse/jobs/${id}/start`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      failureKind?: string;
      retryAfterSec?: number;
    };
    if (err.failureKind === "quota") {
      throw new NfseQuotaError(
        err.error ?? "Cota do Gemini esgotada.",
        err.retryAfterSec ?? 0,
      );
    }
    throw new Error(err.error ?? res.statusText);
  }
}

export type NfseHealth = {
  geminiAvailable: boolean;
  circuitOpenUntil: string | null;
  queueDepth: number;
  estimatedWaitSec: number;
};

export async function getNfseHealth(): Promise<NfseHealth> {
  const res = await fetch(`${baseUrl()}${API_PREFIX}/tools/comparacao-nfse/health`);
  if (!res.ok) {
    throw new Error(`Health check falhou: ${res.statusText}`);
  }
  return res.json() as Promise<NfseHealth>;
}

export async function getComparacaoNfseJob(id: string): Promise<NfseJobResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${API_PREFIX}/tools/comparacao-nfse/jobs/${id}`);
  } catch (e) {
    if (!baseUrl() && isFetchNetworkError(e)) {
      throw new Error(apiOfflineMessage());
    }
    throw e;
  }
  return res.json() as Promise<NfseJobResponse>;
}

export function comparacaoNfseDownloadUrl(id: string, token: string): string {
  return `${baseUrl()}${API_PREFIX}/tools/comparacao-nfse/jobs/${id}/download?token=${encodeURIComponent(token)}`;
}
