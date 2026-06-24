import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import {
  createSciPortalNacionalJob,
  getSciPortalNacionalJob,
  type JobResponse,
} from "../api.js";
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

function allowedFile(file: File): null | { code: string; message: string } {
  const n = (file?.name ?? "").toLowerCase();
  if (n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls")) return null;
  return { code: "file-invalid-type", message: "Use CSV, XLS ou XLSX" };
}

type DropzoneSlotProps = {
  label: string;
  hint: string;
  file: File | null;
  onDrop: (files: File[]) => void;
  onClear: () => void;
  disabled: boolean;
  /** Para sequenciar a entrada animada dos 2 dropzones. */
  delay?: number;
};

function DropzoneSlot({
  label,
  hint,
  file,
  onDrop,
  onClear,
  disabled,
  delay = 0,
}: DropzoneSlotProps) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    maxFiles: 1,
    validator: allowedFile,
    disabled,
  });

  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold uppercase tracking-wide text-[#347891]">
        {label}
      </label>
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
          transition={
            isDragActive ? springSnappy : { ...transitionSmooth, delay: 0.12 + delay }
          }
          whileHover={{ scale: isDragActive ? 1.02 : 1.01 }}
          whileTap={{ scale: 0.995 }}
        >
          <input {...getInputProps()} />
          <motion.p
            className="font-display text-base font-bold text-[#183844]"
            animate={{ opacity: 1, y: 0 }}
            key={isDragActive ? "drag" : "idle"}
            initial={{ opacity: 0.85, y: 4 }}
            transition={transitionFast}
          >
            {isDragActive ? "Solte o arquivo…" : "Arraste ou clique"}
          </motion.p>
          <p className="mt-1 text-xs text-[#2a4f60]">{hint}</p>
        </motion.div>
      </section>

      <AnimatePresence mode="popLayout">
        {file && (
          <motion.div
            key="file-row"
            layout
            initial={{ opacity: 0, x: -16, scale: 0.97, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -12, scale: 0.97, filter: "blur(3px)" }}
            transition={transitionSmooth}
            className="flex items-center justify-between gap-2 rounded-xl bg-gradient-to-b from-brand-soft/90 to-brand-soft/70 px-3 py-2 text-sm text-brand-ink ring-1 ring-brand-line/60"
          >
            <span className="min-w-0 truncate" title={fileLabel(file)}>
              {fileLabel(file)}
            </span>
            <motion.button
              type="button"
              className="shrink-0 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm"
              onClick={onClear}
              whileHover={{ scale: 1.06, filter: "brightness(1.08)" }}
              whileTap={{ scale: 0.92 }}
              transition={springSnappy}
              disabled={disabled}
            >
              remover
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function SciPortalNacionalHomePage() {
  const navigate = useNavigate();
  const [sciFile, setSciFile] = useState<File | null>(null);
  const [portalFile, setPortalFile] = useState<File | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onDropSci = useCallback((accepted: File[]) => {
    if (accepted.length > 0) {
      setSciFile(accepted[0]!);
      setErr(null);
    }
  }, []);

  const onDropPortal = useCallback((accepted: File[]) => {
    if (accepted.length > 0) {
      setPortalFile(accepted[0]!);
      setErr(null);
    }
  }, []);

  const submit = async () => {
    if (!sciFile || !portalFile) return;
    setBusy(true);
    setErr(null);
    setJob(null);
    try {
      const { id } = await createSciPortalNacionalJob(sciFile, portalFile);
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
        const j = await getSciPortalNacionalJob(job.id);
        setJob(j);
      } catch {
        /* ignore */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (job?.status === "done" && job.downloadToken && job.id) {
      navigate(`/tools/sci-portal-nacional/download/${encodeURIComponent(job.id)}`, { replace: true });
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
    ? "Enviando arquivos…"
    : job?.status === "running"
      ? "Conciliando notas…"
      : job?.status === "queued"
        ? "Na fila…"
        : "Aguarde…";

  const readyToSubmit = !!sciFile && !!portalFile && !isProcessing;

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
          <ToolPageTitle left="SCI" right="Portal Nacional" />
        </motion.div>
        <motion.p
          className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          Compare a planilha do SCI com o relatório de NFS-e do Portal Nacional —{" "}
          <strong>inclusive a aba de canceladas</strong>. → <strong>Conciliacao SCI x Portal Nacional.xlsx</strong>
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

        <Modal
          open={job?.status === "failed"}
          onClose={() => setJob(null)}
          tone="error"
          title="Erro ao conciliar"
          message={job?.status === "failed" ? job.error : undefined}
          primaryLabel="Tentar de novo"
          onPrimary={() => setJob(null)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <DropzoneSlot
            label="Planilha SCI"
            hint=".csv · .xlsx · .xls"
            file={sciFile}
            onDrop={onDropSci}
            onClear={() => setSciFile(null)}
            disabled={isProcessing}
            delay={0}
          />
          <DropzoneSlot
            label="Planilha Portal Nacional"
            hint=".csv · .xlsx · .xls"
            file={portalFile}
            onDrop={onDropPortal}
            onClear={() => setPortalFile(null)}
            disabled={isProcessing}
            delay={0.08}
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
          {busy ? "Enviando…" : "Conciliar NFS-e"}
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
