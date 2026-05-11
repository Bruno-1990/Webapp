import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import { createComparacaoPlanilhasJob, getComparacaoPlanilhasJob, type JobResponse } from "../api.js";
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
  const n = file.name.toLowerCase();
  if (n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls")) return null;
  return { code: "file-invalid-type", message: "Use CSV, XLS ou XLSX" };
}

export default function ComparacaoPlanilhasHomePage() {
  const navigate = useNavigate();
  const [sefazFiles, setSefazFiles] = useState<File[]>([]);
  const [sciFiles, setSciFiles] = useState<File[]>([]);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onDropSefaz = useCallback((accepted: File[]) => {
    setSefazFiles((prev) => [...prev, ...accepted]);
    setErr(null);
  }, []);

  const onDropSci = useCallback((accepted: File[]) => {
    setSciFiles((prev) => [...prev, ...accepted]);
    setErr(null);
  }, []);

  const sefazZone = useDropzone({ onDrop: onDropSefaz, validator: allowedFile });
  const sciZone = useDropzone({ onDrop: onDropSci, validator: allowedFile });

  const submit = async () => {
    if (sefazFiles.length === 0 || sciFiles.length === 0) return;
    setBusy(true);
    setErr(null);
    setJob(null);
    try {
      const { id } = await createComparacaoPlanilhasJob(sefazFiles, sciFiles);
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
        const j = await getComparacaoPlanilhasJob(job.id);
        setJob(j);
      } catch {
        /* ignore */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (job?.status === "done" && job.downloadToken && job.id) {
      navigate(`/tools/comparacao-planilhas/download/${encodeURIComponent(job.id)}`, { replace: true });
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

  const readyToSubmit = sefazFiles.length > 0 && sciFiles.length > 0 && !isProcessing;

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
        <ToolPageTitle left="SEFAZ" right="SCI" />
        <motion.p
          className="mt-3 text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitionSmooth, delay: 0.1 }}
        >
          Compare planilhas da SEFAZ com o SCI → <strong>Notas Faltantes.xlsx</strong>
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

        <div className="grid gap-4 sm:grid-cols-2">
          {/* SEFAZ dropzone */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#347891]">
              Arquivos SEFAZ
            </label>
            <section {...sefazZone.getRootProps()} className={toolDropzoneClass(sefazZone.isDragActive)}>
              <input {...sefazZone.getInputProps()} />
              <p className="font-display text-base font-bold text-[#183844]">
                {sefazZone.isDragActive ? "Solte os arquivos…" : "Arraste ou clique"}
              </p>
              <p className="mt-1 text-xs text-[#2a4f60]">.csv · .xlsx · .xls</p>
              {sefazFiles.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {sefazFiles.map((f, i) => (
                    <p key={i} className="truncate text-xs text-accent" title={fileLabel(f)}>
                      {fileLabel(f)}
                    </p>
                  ))}
                </div>
              )}
            </section>
            {sefazFiles.length > 0 && !isProcessing && (
              <button
                type="button"
                onClick={() => setSefazFiles([])}
                className="text-xs font-medium text-rose-600 hover:underline"
              >
                Limpar SEFAZ
              </button>
            )}
          </div>

          {/* SCI dropzone */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#347891]">
              Arquivos SCI
            </label>
            <section {...sciZone.getRootProps()} className={toolDropzoneClass(sciZone.isDragActive)}>
              <input {...sciZone.getInputProps()} />
              <p className="font-display text-base font-bold text-[#183844]">
                {sciZone.isDragActive ? "Solte os arquivos…" : "Arraste ou clique"}
              </p>
              <p className="mt-1 text-xs text-[#2a4f60]">.csv · .xlsx · .xls</p>
              {sciFiles.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {sciFiles.map((f, i) => (
                    <p key={i} className="truncate text-xs text-accent" title={fileLabel(f)}>
                      {fileLabel(f)}
                    </p>
                  ))}
                </div>
              )}
            </section>
            {sciFiles.length > 0 && !isProcessing && (
              <button
                type="button"
                onClick={() => setSciFiles([])}
                className="text-xs font-medium text-rose-600 hover:underline"
              >
                Limpar SCI
              </button>
            )}
          </div>
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
                {job.status === "queued" ? "Na fila…" : "Comparando planilhas…"}
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
          disabled={!readyToSubmit}
          whileTap={{ scale: 0.98 }}
          transition={springSnappy}
        >
          Comparar planilhas
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
