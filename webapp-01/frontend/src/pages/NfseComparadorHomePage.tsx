import type { InputHTMLAttributes, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDropzone } from "react-dropzone";
import {
  createComparacaoNfseJob,
  getComparacaoNfseJob,
  getNfseHealth,
  NfseQuotaError,
  startComparacaoNfseJob,
  uploadComparacaoNfseChunk,
  comparacaoNfseDownloadUrl,
  type ComparacaoNfseResult,
  type NfseJobResponse,
} from "../api.js";
import {
  getPdfFilesFromEvent,
  getXmlOnlyFilesFromEvent,
  pickDirectoryAndReadFiles,
  supportsDirectoryPicker,
} from "../dropFiles.js";
import { ToolPageTitle } from "../components/ToolPageTitle.js";
import { Modal } from "../components/Modal.js";
import {
  toolDropzoneClass,
  toolPageShellClass,
  toolPanelClass,
  toolPrimaryButtonClass,
  toolProgressFillClass,
} from "../toolLayout.js";
import {
  fadeUp,
  springSnappy,
  springSoft,
  transitionFast,
  transitionSmooth,
} from "../motion-variants.js";

/** Chunking adaptativo: limite por bytes evita estourar o bodyLimit do Fastify com PDFs grandes (scans de 20–80 MB). */
const MAX_CHUNK_BYTES = 40 * 1024 * 1024;
const MAX_CHUNK_FILES = 10;

function partitionFilesForUpload(files: File[]): File[][] {
  const batches: File[][] = [];
  let current: File[] = [];
  let currentBytes = 0;
  for (const f of files) {
    const wouldOverflow =
      current.length > 0 &&
      (currentBytes + f.size > MAX_CHUNK_BYTES || current.length >= MAX_CHUNK_FILES);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(f);
    currentBytes += f.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Faz o <input type="file"> abrir o file picker no modo "selecionar pasta" ao clicar. */
const FOLDER_INPUT_ATTRS = { webkitdirectory: "", directory: "", mozdirectory: "" } as unknown as
  InputHTMLAttributes<HTMLInputElement>;

/** "30s" / "2 min" / "1h 5min" — humaniza segundos para mostrar no UX de espera. */
function formatRetryAfter(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m} min ${rem}s` : `${m} min`;
  const h = Math.floor(m / 60);
  const minRem = m % 60;
  return minRem ? `${h}h ${minRem}min` : `${h}h`;
}

async function uploadInChunks(
  jobId: string,
  field: "pdfs" | "xmls",
  files: File[],
  onChunk: () => void,
) {
  const batches = partitionFilesForUpload(files);
  for (const batch of batches) {
    await uploadComparacaoNfseChunk(jobId, field, batch);
    onChunk();
  }
}

export default function NfseComparadorHomePage() {
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [xmlFiles, setXmlFiles] = useState<File[]>([]);
  const [job, setJob] = useState<NfseJobResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [quotaModal, setQuotaModal] = useState<{ retryAfterSec: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onDropPdfs = useCallback((accepted: File[]) => {
    setPdfFiles((prev) => [...prev, ...accepted]);
    setErr(null);
  }, []);

  const onDropXmls = useCallback((accepted: File[]) => {
    setXmlFiles((prev) => [...prev, ...accepted]);
    setErr(null);
  }, []);

  const pdfZone = useDropzone({
    onDrop: onDropPdfs,
    getFilesFromEvent: getPdfFilesFromEvent,
    useFsAccessApi: false,
  });
  const xmlZone = useDropzone({
    onDrop: onDropXmls,
    getFilesFromEvent: getXmlOnlyFilesFromEvent,
    useFsAccessApi: false,
  });

  /**
   * Substitui o clique do dropzone pelo picker nativo de pasta (File System
   * Access API). Evita o alert "Carregar N arquivos para localhost..." que
   * o browser dispara no <input webkitdirectory>. Drag-and-drop continua
   * passando pelo react-dropzone normalmente.
   */
  const usesNativeDirPicker = supportsDirectoryPicker();
  const handlePickDir = useCallback(
    async (kind: "pdf-or-image" | "xml-only") => {
      try {
        const files = await pickDirectoryAndReadFiles(kind);
        if (!files) return; // user cancelou
        if (kind === "pdf-or-image") {
          setPdfFiles((prev) => [...prev, ...files]);
        } else {
          setXmlFiles((prev) => [...prev, ...files]);
        }
        setErr(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const onZoneClick = useCallback(
    (kind: "pdf-or-image" | "xml-only") => (e: ReactMouseEvent) => {
      if (!usesNativeDirPicker) return; // deixa react-dropzone abrir o input
      e.preventDefault();
      e.stopPropagation();
      void handlePickDir(kind);
    },
    [usesNativeDirPicker, handlePickDir],
  );

  const submit = async () => {
    if (pdfFiles.length === 0 || xmlFiles.length === 0) return;
    const oversized = [...pdfFiles, ...xmlFiles].find((f) => f.size > 250 * 1024 * 1024);
    if (oversized) {
      setErr(
        `O arquivo "${oversized.name}" tem ${(oversized.size / 1024 / 1024).toFixed(0)} MB, acima do limite de 250 MB por arquivo. Remova-o ou reduza o tamanho antes de enviar.`,
      );
      return;
    }

    // Pre-check de saude: se Gemini esta indisponivel e o user tem PDFs,
    // mostra modal antes de subir 1 byte.
    if (pdfFiles.length > 0) {
      try {
        const health = await getNfseHealth();
        if (!health.geminiAvailable) {
          const retry = health.circuitOpenUntil
            ? Math.max(
                0,
                Math.ceil((new Date(health.circuitOpenUntil).getTime() - Date.now()) / 1000),
              )
            : 0;
          setQuotaModal({ retryAfterSec: retry });
          return;
        }
      } catch {
        // Health endpoint indisponivel — segue tentando submit, /start ainda valida.
      }
    }

    setBusy(true);
    setErr(null);
    setJob(null);
    setUploadPct(0);
    try {
      const { id } = await createComparacaoNfseJob();
      const totalChunks =
        partitionFilesForUpload(pdfFiles).length +
        partitionFilesForUpload(xmlFiles).length;
      let sent = 0;
      const bump = () => {
        sent += 1;
        setUploadPct(Math.min(100, Math.round((sent / Math.max(1, totalChunks)) * 100)));
      };
      await uploadInChunks(id, "pdfs", pdfFiles, bump);
      await uploadInChunks(id, "xmls", xmlFiles, bump);
      await startComparacaoNfseJob(id);
      setUploadPct(null);
      setJob({ id, status: "queued" });
    } catch (e) {
      if (e instanceof NfseQuotaError) {
        setUploadPct(null);
        setQuotaModal({ retryAfterSec: e.retryAfterSec });
        setBusy(false);
        return;
      }
      setErr(e instanceof Error ? e.message : String(e));
      setUploadPct(null);
    } finally {
      setBusy(false);
    }
  };

  // Quando o job termina com failureKind=quota (worker detectou no meio),
  // abre o modal automaticamente para o usuario ver e tentar de novo.
  useEffect(() => {
    if (job?.status === "done" && job.result?.failureKind === "quota") {
      setQuotaModal({ retryAfterSec: job.result.retryAfterSec ?? 0 });
    }
  }, [job?.status, job?.result?.failureKind, job?.result?.retryAfterSec]);

  useEffect(() => {
    if (!job?.id) return;
    if (job.status === "done" || job.status === "failed" || job.status === "not_found") {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    let consecutiveFailures = 0;
    pollRef.current = setInterval(async () => {
      try {
        const j = await getComparacaoNfseJob(job.id);
        if (!j || typeof j.status !== "string") {
          consecutiveFailures += 1;
        } else {
          consecutiveFailures = 0;
          setJob(j);
        }
      } catch {
        consecutiveFailures += 1;
      }
      if (consecutiveFailures >= 10) {
        setErr(
          "Perdemos contato com a API durante o processamento. Verifique o terminal do dev:stack (painel 'api') e tente novamente."
        );
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    }, 1500);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [job?.id, job?.status]);

  const isProcessing =
    busy ||
    (job != null &&
      job.status !== "not_found" &&
      job.status !== "done" &&
      job.status !== "failed");

  const showDeterminateBar =
    job?.status === "running" && job.progress != null && !Number.isNaN(job.progress);

  const progressPct = showDeterminateBar
    ? Math.min(100, Math.max(0, job!.progress as number))
    : 0;

  const result = job?.status === "done" ? job.result : undefined;

  const readyToSubmit = pdfFiles.length > 0 && xmlFiles.length > 0 && !isProcessing;

  const barLabel = useMemo(() => {
    if (uploadPct != null) return `Enviando arquivos (${uploadPct}%)`;
    if (job?.status === "queued") return "Na fila…";
    if (job?.status === "running") {
      return pdfFiles.length > 0 ? "Lendo PDFs/imagens (OCR) e XMLs…" : "Lendo XMLs…";
    }
    return "Carregando…";
  }, [uploadPct, job?.status, pdfFiles.length]);

  return (
    <motion.div
      className={toolPageShellClass}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.header
        className="text-center"
        initial={fadeUp.initial}
        animate={fadeUp.animate}
        transition={{ ...transitionSmooth, delay: 0.05 }}
      >
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...springSoft, delay: 0.08 }}
        >
          <ToolPageTitle left="PDFs / Imagens" right="XMLs" />
        </motion.div>
        <motion.p
          className="mt-3 text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          Compare notas fiscais de serviço — PDFs ou imagens (OCR) × XMLs — e veja o que está só de um lado.
        </motion.p>
      </motion.header>

      <motion.div
        className={`space-y-6 p-8 ${toolPanelClass}`}
        initial={{ opacity: 0, y: 22, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={springSoft}
      >
        <Modal
          open={!!err}
          onClose={() => setErr(null)}
          tone="error"
          title="Algo deu errado"
          message={err}
        />

        <Modal
          open={!!quotaModal}
          onClose={() => setQuotaModal(null)}
          tone="warn"
          title="Cota do Gemini esgotada"
          message={
            quotaModal
              ? `O OCR de PDFs esta indisponivel temporariamente. Tente novamente em ~${formatRetryAfter(quotaModal.retryAfterSec)}. Voce pode prosseguir sem PDFs (apenas XMLs) se quiser.`
              : null
          }
          primaryLabel="Tentar novamente"
          onPrimary={() => {
            setQuotaModal(null);
            void submit();
          }}
          secondaryLabel="Fechar"
          onSecondary={() => setQuotaModal(null)}
        />

        {job?.status === "queued" && job.estimatedWaitSec != null && job.estimatedWaitSec > 0 && (
          <div className="rounded-xl border border-[#b9d8e1] bg-[#eef6fb] px-4 py-2.5 text-xs text-[#1e3d4d]">
            Sua vez em ~{formatRetryAfter(job.estimatedWaitSec)} (fila tem outros jobs na frente)
          </div>
        )}

        {job?.status !== "done" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-[#347891]">
                  Pasta com PDFs ou imagens
                </label>
                <section
                  {...pdfZone.getRootProps({ onClick: onZoneClick("pdf-or-image") })}
                  className={toolDropzoneClass(pdfZone.isDragActive)}
                >
                  <motion.div
                    className="flex flex-col items-center gap-2"
                    initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(6px)" }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      scale: pdfZone.isDragActive ? 1.02 : 1,
                      filter: "blur(0px)",
                    }}
                    transition={
                      pdfZone.isDragActive ? springSnappy : { ...transitionSmooth, delay: 0.12 }
                    }
                    whileHover={{ scale: pdfZone.isDragActive ? 1.02 : 1.01 }}
                    whileTap={{ scale: 0.995 }}
                  >
                    <input {...pdfZone.getInputProps(FOLDER_INPUT_ATTRS)} />
                    <motion.p
                      className="font-display text-base font-bold text-[#183844]"
                      key={pdfZone.isDragActive ? "drag" : "idle"}
                      initial={{ opacity: 0.85, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={transitionFast}
                    >
                      {pdfZone.isDragActive ? "Solte a pasta…" : "Arraste ou clique para escolher a pasta"}
                    </motion.p>
                    {pdfFiles.length > 0 && <FileSummary files={pdfFiles} />}
                  </motion.div>
                </section>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-[#347891]">
                  Pasta com XMLs
                </label>
                <section
                  {...xmlZone.getRootProps({ onClick: onZoneClick("xml-only") })}
                  className={toolDropzoneClass(xmlZone.isDragActive)}
                >
                  <motion.div
                    className="flex flex-col items-center gap-2"
                    initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(6px)" }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      scale: xmlZone.isDragActive ? 1.02 : 1,
                      filter: "blur(0px)",
                    }}
                    transition={
                      xmlZone.isDragActive ? springSnappy : { ...transitionSmooth, delay: 0.2 }
                    }
                    whileHover={{ scale: xmlZone.isDragActive ? 1.02 : 1.01 }}
                    whileTap={{ scale: 0.995 }}
                  >
                    <input {...xmlZone.getInputProps(FOLDER_INPUT_ATTRS)} />
                    <motion.p
                      className="font-display text-base font-bold text-[#183844]"
                      key={xmlZone.isDragActive ? "drag" : "idle"}
                      initial={{ opacity: 0.85, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={transitionFast}
                    >
                      {xmlZone.isDragActive ? "Solte a pasta…" : "Arraste ou clique para escolher a pasta"}
                    </motion.p>
                    {xmlFiles.length > 0 && <FileSummary files={xmlFiles} />}
                  </motion.div>
                </section>
              </div>
            </div>

            {(pdfFiles.length > 0 || xmlFiles.length > 0) && !isProcessing && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setPdfFiles([]);
                    setXmlFiles([]);
                  }}
                  className="text-xs font-medium text-rose-600 hover:underline"
                >
                  Limpar tudo
                </button>
              </div>
            )}
          </>
        )}

        <AnimatePresence mode="wait">
          {(isProcessing || uploadPct != null) && (
            <motion.div
              key="prog"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-2"
            >
              <motion.p
                className="text-center text-sm font-semibold text-accent"
                key={barLabel}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={transitionFast}
              >
                {barLabel}
              </motion.p>
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-brand-soft ring-1 ring-brand-line/70">
                {uploadPct != null ? (
                  <motion.div
                    className={toolProgressFillClass}
                    initial={{ width: 0 }}
                    animate={{ width: `${uploadPct}%` }}
                    transition={springSnappy}
                  />
                ) : showDeterminateBar ? (
                  <motion.div
                    className={toolProgressFillClass}
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPct}%` }}
                    transition={springSnappy}
                  />
                ) : (
                  <motion.div
                    className={`absolute top-0 h-full w-[38%] animate-loadingBar ${toolProgressFillClass}`}
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {job?.status !== "done" && (
          <motion.button
            type="button"
            className={toolPrimaryButtonClass}
            onClick={submit}
            disabled={!readyToSubmit}
            whileHover={
              !readyToSubmit
                ? undefined
                : { scale: 1.015, boxShadow: "0 12px 40px -8px rgb(42 79 96 / 0.2)" }
            }
            whileTap={!readyToSubmit ? undefined : { scale: 0.985 }}
            transition={springSnappy}
          >
            Comparar NFS-e
          </motion.button>
        )}

        <Modal
          open={job?.status === "failed" && !!job.error}
          onClose={() => setJob(null)}
          tone="error"
          title="Job falhou"
          message={job?.status === "failed" ? job.error : undefined}
          primaryLabel="Tentar de novo"
          onPrimary={() => setJob(null)}
        />

        {job?.status === "done" && result && (
          <NfseResultView
            jobId={job.id}
            fileName={job.fileName}
            downloadToken={job.downloadToken}
            result={result}
            onReset={() => {
              setJob(null);
              setPdfFiles([]);
              setXmlFiles([]);
            }}
          />
        )}
      </motion.div>
    </motion.div>
  );
}

function NfseResultView({
  jobId,
  fileName,
  downloadToken,
  result,
  onReset,
}: {
  jobId: string;
  fileName?: string;
  downloadToken?: string;
  result: ComparacaoNfseResult;
  onReset: () => void;
}) {
  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transitionFast}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-[#347891]">
          Resultado
        </h2>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
        >
          ← Nova comparação
        </button>
      </div>

      {result.extractStats &&
        !result.extractStats.ocr_disponivel &&
        result.pdfFalhos &&
        result.pdfFalhos.length > 0 && (
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="flex items-center gap-2 font-semibold">
              <span aria-hidden className="text-base">⚠️</span>
              OCR desativado — {result.pdfFalhos.length}{" "}
              {result.pdfFalhos.length === 1 ? "arquivo nao foi lido" : "arquivos nao foram lidos"}
            </p>
            <p className="mt-1 text-xs leading-relaxed">
              Estes PDFs/imagens precisam de OCR (Gemini), mas a chave nao esta configurada.
              Defina <span className="font-mono">GEMINI_API_KEY</span> em{" "}
              <span className="font-mono">.env</span> e reinicie o stack.
            </p>
          </div>
        )}

      <TotalsPanel result={result} />

      {result.duplicadosPdf && result.duplicadosPdf.length > 0 && (
        <DuplicatesSection groups={result.duplicadosPdf} />
      )}

      {result.extractStats && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#347891]">
            Como os PDFs foram lidos
          </p>
          <div className="flex flex-wrap gap-2">
            <ExtractChip
              label="Leitura direta"
              hint="Texto do PDF"
              value={result.extractStats.local}
              tone="ok"
            />
            <ExtractChip
              label="OCR Gemini (PDFs)"
              hint="PDFs escaneados"
              value={result.extractStats.ocr}
              tone="warn"
            />
            {result.extractStats.imagens > 0 && (
              <ExtractChip
                label="OCR Gemini (imagens)"
                hint=".jpg / .png"
                value={result.extractStats.imagens}
                tone="warn"
              />
            )}
          </div>
        </div>
      )}

      <NfseTable title={`Só em PDFs (${result.soPdf.length})`} rows={result.soPdf} showMethod />
      <NfseTable title={`Só em XMLs (${result.soXml.length})`} rows={result.soXml} />

      {result.pdfFalhos && result.pdfFalhos.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
          <p className="font-semibold">
            {result.pdfFalhos.length} PDF/imagem não puderam ser lidos pelo OCR:
          </p>
          <ul className="mt-1 space-y-0.5">
            {result.pdfFalhos.slice(0, 10).map((f, i) => {
              const file = typeof f === "string" ? f : f.file;
              const reason = typeof f === "string" ? null : f.reason;
              return (
                <li key={i} className="truncate">
                  <span className="font-mono">{file}</span>
                  {reason && <span className="ml-2 text-rose-700">— {reason}</span>}
                </li>
              );
            })}
            {result.pdfFalhos.length > 10 && (
              <li className="italic">…e mais {result.pdfFalhos.length - 10}</li>
            )}
          </ul>
        </div>
      )}
      {result.xmlIgnorados && result.xmlIgnorados.length > 0 && (
        <p className="text-xs text-rose-700">
          {result.xmlIgnorados.length} XML(s) inválidos foram ignorados.
        </p>
      )}

      {downloadToken && (
        <a
          className={`${toolPrimaryButtonClass} inline-flex items-center justify-center gap-2`}
          href={comparacaoNfseDownloadUrl(jobId, downloadToken)}
          download={fileName ?? "Comparador NFS-e.xlsx"}
        >
          Baixar XLSX
        </a>
      )}
    </motion.div>
  );
}

function FileSummary({ files }: { files: File[] }) {
  if (files.length === 0) return null;
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  const sizeMb = (totalBytes / (1024 * 1024)).toFixed(1);
  return (
    <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {files.length} {files.length === 1 ? "arquivo selecionado" : "arquivos selecionados"}
      <span className="font-normal text-emerald-700">· {sizeMb} MB</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "info";
  hint?: string;
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-sky-200 bg-sky-50 text-sky-900";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      {hint && <p className="mt-0.5 text-[10px] font-medium opacity-80">{hint}</p>}
    </div>
  );
}

function TotalsPanel({ result }: { result: ComparacaoNfseResult }) {
  // Fallback derivado quando o backend antigo nao envia totals.
  const pdfFalhosCount = result.pdfFalhos?.length ?? 0;
  const xmlIgnoradosCount = result.xmlIgnorados?.length ?? 0;
  const totals = result.totals ?? {
    pdfEnviados: result.matchedCount + result.soPdf.length + pdfFalhosCount,
    pdfLidos: result.matchedCount + result.soPdf.length,
    xmlEnviados: result.matchedCount + result.soXml.length + xmlIgnoradosCount,
    xmlLidos: result.matchedCount + result.soXml.length,
    matched: result.matchedCount,
    soPdf: result.soPdf.length,
    soXml: result.soXml.length,
  };

  const pdfHint =
    pdfFalhosCount > 0 ? `${totals.pdfLidos} lidos · ${pdfFalhosCount} falharam` : undefined;
  const xmlHint =
    xmlIgnoradosCount > 0
      ? `${totals.xmlLidos} lidos · ${xmlIgnoradosCount} ignorados`
      : undefined;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#347891]">
        Universo entregue
      </p>
      <div className="grid gap-3 text-center sm:grid-cols-2">
        <StatCard label="Total PDF" value={totals.pdfEnviados} tone="info" hint={pdfHint} />
        <StatCard label="Total XML" value={totals.xmlEnviados} tone="info" hint={xmlHint} />
      </div>
      <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-[#347891]">
        Resultado da comparação
      </p>
      <div className="grid gap-3 text-center sm:grid-cols-3">
        <StatCard label="Com match" value={totals.matched} tone="ok" />
        <StatCard label="Só em PDFs" value={totals.soPdf} tone="warn" />
        <StatCard label="Só em XMLs" value={totals.soXml} tone="warn" />
      </div>
    </div>
  );
}

function DuplicatesSection({
  groups,
}: {
  groups: NonNullable<ComparacaoNfseResult["duplicadosPdf"]>;
}) {
  const totalEntries = groups.reduce((s, g) => s + g.entries.length, 0);
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-semibold">
        <span aria-hidden className="text-base">⚠️</span>
        {groups.length} {groups.length === 1 ? "grupo de PDFs duplicados" : "grupos de PDFs duplicados"}
        <span className="font-normal opacity-80">
          ({totalEntries} arquivos no total)
        </span>
      </p>
      <p className="mt-1 text-xs leading-relaxed">
        Estes PDFs compartilham a mesma identidade. Apenas o primeiro de cada grupo entra
        no match — os demais aparecem em "Só em PDFs".
      </p>
      <ul className="mt-2 space-y-2">
        {groups.map((g, i) => (
          <li key={i} className="rounded-lg border border-amber-200 bg-white/70 p-2">
            <p className="text-xs font-semibold text-amber-900">
              {g.chaveNf ? (
                <>
                  Chave: <span className="font-mono text-[11px]">{g.chaveNf}</span>
                </>
              ) : (
                <>
                  CNPJ tomador {g.cnpjTomador} · NF nº {g.numeroNf}
                </>
              )}
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
              {g.entries.map((e, j) => (
                <li key={j} className="flex items-center gap-2 truncate">
                  <MethodBadge method={e.method} />
                  <span className="truncate font-mono">{e.sourceFile}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExtractChip({
  label,
  hint,
  value,
  tone,
}: {
  label: string;
  hint?: string;
  value: number;
  tone: "ok" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : "border-amber-300 bg-amber-50 text-amber-900";
  const dotClass = tone === "ok" ? "bg-emerald-500" : "bg-amber-500";
  return (
    <div className={`flex items-center gap-2.5 rounded-full border px-3 py-1.5 text-xs ${toneClass}`}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${dotClass}`} />
      <span className="font-mono text-sm font-bold">{value}</span>
      <span className="font-semibold">{label}</span>
      {hint && <span className="opacity-70">— {hint}</span>}
    </div>
  );
}

function MethodBadge({ method }: { method?: "local" | "ocr" | null }) {
  if (method === "local") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Local
      </span>
    );
  }
  if (method === "ocr") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        OCR
      </span>
    );
  }
  return <span className="text-[#a0b3bb]">—</span>;
}

function NfseTable({
  title,
  rows,
  showMethod = false,
}: {
  title: string;
  rows: ComparacaoNfseResult["soPdf"];
  showMethod?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#347891]">{title}</h3>
        <p className="text-xs text-[#2a4f60]">Nenhum.</p>
      </div>
    );
  }
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#347891]">{title}</h3>
      <div className="max-h-60 overflow-auto rounded-xl border border-[#b9d8e1] bg-white">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-[#eef6fb] text-[#183844]">
            <tr>
              {showMethod && <th className="px-2 py-1.5 font-semibold">Método</th>}
              <th className="px-2 py-1.5 font-semibold">Razão Social</th>
              <th className="px-2 py-1.5 font-semibold">CNPJ Prestador</th>
              <th className="px-2 py-1.5 font-semibold">CNPJ Tomador</th>
              <th className="px-2 py-1.5 font-semibold">Número NF</th>
              <th className="px-2 py-1.5 font-semibold">Chave NF</th>
              <th className="px-2 py-1.5 font-semibold">Arquivo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-[#e4eef3]">
                {showMethod && (
                  <td className="px-2 py-1">
                    <MethodBadge method={r.method} />
                  </td>
                )}
                <td className="truncate px-2 py-1">{r.razaoSocialPrestador ?? "—"}</td>
                <td className="px-2 py-1">{r.cnpjPrestador ?? "—"}</td>
                <td className="px-2 py-1">{r.cnpjTomador ?? "—"}</td>
                <td className="px-2 py-1">{r.numeroNf ?? "—"}</td>
                <td className="truncate px-2 py-1 font-mono">{r.chaveNf ?? "—"}</td>
                <td className="truncate px-2 py-1">{r.sourceFile}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
