import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import { createSciConsolidadoJob, getSciConsolidadoJob, type JobResponse } from "../api.js";
import { fileLabel } from "../dropFiles.js";
import { ToolPageTitle } from "../components/ToolPageTitle.js";
import {
  toolDropzoneClass,
  toolErrorBannerClass,
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

  return (
    <motion.div
      className={toolPageShellClass}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={transitionSmooth}
    >
      <motion.header
        className="text-center"
        initial={fadeUp.initial}
        animate={fadeUp.animate}
        transition={{ ...transitionSmooth, delay: 0.04 }}
      >
        <ToolPageTitle left="SCI" right="Excel" />
        <motion.p
          className="mt-3 text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitionSmooth, delay: 0.1 }}
        >
          CSV ou Excel da exportação SCI → <strong>ProdutosSCI.xlsx</strong>
        </motion.p>
      </motion.header>

      <motion.div
        className={`space-y-6 p-8 ${toolPanelClass}`}
        initial={{ opacity: 0, y: 22, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={springSoft}
      >
        <AnimatePresence mode="wait">
          {err && (
            <motion.div
              key="err"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={transitionFast}
              className={toolErrorBannerClass}
              role="alert"
            >
              {err}
            </motion.div>
          )}
        </AnimatePresence>

        <section {...getRootProps()} className={toolDropzoneClass(isDragActive)}>
          <input {...getInputProps()} />
          <p className="font-display text-lg font-bold text-[#183844]">
            {isDragActive ? "Solte o arquivo…" : "Arraste ou clique para escolher"}
          </p>
          <p className="mt-2 text-sm text-[#2a4f60]">.csv · .txt · .xlsx · .xls</p>
          {files[0] && (
            <p className="mt-3 truncate text-xs text-accent" title={fileLabel(files[0])}>
              {fileLabel(files[0])}
            </p>
          )}
        </section>

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
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-2"
            >
              <p className="text-center text-sm font-semibold text-accent">
                {job.status === "queued" ? "Na fila…" : "Processando…"}
              </p>
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-brand-soft ring-1 ring-brand-line/70">
                {showDeterminateBar ? (
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

        <motion.button
          type="button"
          className={toolPrimaryButtonClass}
          onClick={submit}
          disabled={!files[0] || isProcessing}
          whileTap={{ scale: 0.98 }}
          transition={springSnappy}
        >
          Gerar Excel
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
