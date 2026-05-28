import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import { createSciConsolidadoJob, getSciConsolidadoJob, type JobResponse } from "../api.js";
import { fileLabel } from "../dropFiles.js";
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

function allowedSciFile(file: File): boolean {
  if (!file?.name) return false;
  const n = file.name.toLowerCase();
  return n.endsWith(".csv") || n.endsWith(".txt") || n.endsWith(".xlsx") || n.endsWith(".xls");
}

export default function SciConsolidadoHomePage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [job, setJob] = useState<JobResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles(() => accepted.slice(0, 1));
    setErr(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    multiple: false,
    validator: (file) =>
      allowedSciFile(file)
        ? null
        : { code: "file-invalid-type", message: "Use CSV, TXT, XLS ou XLSX" },
  });

  const submit = async () => {
    const f = files[0];
    if (!f) return;
    setBusy(true);
    setErr(null);
    setJob(null);
    try {
      const { id } = await createSciConsolidadoJob(f, sheetName || undefined);
      setJob({ id, status: "queued" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!job?.id || job.status === "done" || job.status === "failed") return;
    const t = setInterval(async () => {
      try {
        const j = await getSciConsolidadoJob(job.id);
        setJob(j);
      } catch {
        /* ignore */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (job?.status === "done" && job.downloadToken && job.id) {
      navigate(`/tools/sci-consolidado/download/${encodeURIComponent(job.id)}`, { replace: true });
    }
  }, [job?.status, job?.downloadToken, job?.id, navigate]);

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

  const progressLabel = busy
    ? "Enviando arquivo…"
    : job?.status === "running"
      ? "Gerando planilha…"
      : job?.status === "queued"
        ? "Na fila…"
        : "Aguarde…";

  const readyToSubmit = !!files[0] && !isProcessing;

  const removeFile = () => {
    setFiles([]);
  };

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
          <ToolPageTitle left="SCI" right="Excel" />
        </motion.div>
        <motion.p
          className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          CSV ou Excel da exportação SCI → <strong>ProdutosSCI.xlsx</strong>
        </motion.p>
      </motion.header>

      <motion.div
        className={`space-y-6 p-8 ${toolPanelClass}`}
        initial={{ opacity: 0, y: 28, scale: 0.97, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
        layout
      >
        <Modal
          open={!!err}
          onClose={() => setErr(null)}
          tone="error"
          title="Algo deu errado"
          message={err}
        />

        <section {...getRootProps()} className={toolDropzoneClass(isDragActive)}>
          <motion.div
            className="flex min-h-0 w-full flex-col items-center"
            initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(6px)" }}
            animate={{
              opacity: 1,
              y: 0,
              scale: isDragActive ? 1.02 : 1,
              filter: "blur(0px)",
            }}
            transition={isDragActive ? springSnappy : { ...transitionSmooth, delay: 0.12 }}
            whileHover={{ scale: isDragActive ? 1.02 : 1.01 }}
            whileTap={{ scale: 0.995 }}
          >
            <input {...getInputProps()} />
            <motion.p
              className="font-display text-lg font-bold text-[#183844]"
              animate={{ opacity: 1, y: 0 }}
              key={isDragActive ? "drag" : "idle"}
              initial={{ opacity: 0.85, y: 4 }}
              transition={transitionFast}
            >
              {isDragActive ? "Solte o arquivo…" : "Arraste ou clique para escolher"}
            </motion.p>
            <p className="mt-2 text-sm text-[#2a4f60]">.csv · .txt · .xlsx · .xls</p>
          </motion.div>
        </section>

        <AnimatePresence mode="popLayout">
          {files[0] && (
            <motion.div
              key="file-row"
              layout
              initial={{ opacity: 0, x: -16, scale: 0.97, filter: "blur(4px)" }}
              animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: -12, scale: 0.97, filter: "blur(3px)" }}
              transition={transitionSmooth}
              className="flex items-center justify-between gap-2 rounded-xl bg-gradient-to-b from-brand-soft/90 to-brand-soft/70 px-3 py-2 text-sm text-brand-ink ring-1 ring-brand-line/60"
            >
              <span className="min-w-0 truncate" title={fileLabel(files[0])}>
                {fileLabel(files[0])}
              </span>
              <motion.button
                type="button"
                className="shrink-0 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm"
                onClick={removeFile}
                whileHover={{ scale: 1.06, filter: "brightness(1.08)" }}
                whileTap={{ scale: 0.92 }}
                transition={springSnappy}
                disabled={isProcessing}
              >
                remover
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-2">
          <label htmlFor="sheet-opt" className="block text-xs font-semibold uppercase tracking-wide text-[#347891]">
            Aba Excel (opcional)
          </label>
          <input
            id="sheet-opt"
            type="text"
            value={sheetName}
            onChange={(e) => setSheetName(e.target.value)}
            placeholder="Se várias abas, informe o nome exato"
            className="w-full rounded-xl border border-[#b9d8e1] bg-white px-3 py-2 text-sm text-[#183844] outline-none ring-brand-primary/20 focus:ring-2"
            disabled={isProcessing}
          />
        </div>

        <AnimatePresence mode="wait">
          {isProcessing && job && (
            <motion.div
              key="prog"
              className="space-y-2"
              aria-live="polite"
              initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -6, filter: "blur(3px)" }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            >
              <motion.p
                className="text-center text-sm font-semibold text-accent"
                key={progressLabel}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={transitionFast}
              >
                {progressLabel}
              </motion.p>
              <div
                className="relative h-3 w-full overflow-hidden rounded-full bg-brand-soft ring-1 ring-brand-line/70"
                role="progressbar"
                aria-valuetext={progressLabel}
                aria-busy={!showDeterminateBar}
                {...(showDeterminateBar
                  ? {
                      "aria-valuemin": 0,
                      "aria-valuemax": 100,
                      "aria-valuenow": Math.round(progressPct),
                    }
                  : {})}
              >
                {showDeterminateBar ? (
                  <motion.div
                    className={toolProgressFillClass}
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  />
                ) : (
                  <div
                    className={`absolute top-0 h-full w-[38%] animate-loadingBar ${toolProgressFillClass}`}
                    aria-hidden
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
          {busy ? "Enviando…" : "Gerar Excel"}
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
