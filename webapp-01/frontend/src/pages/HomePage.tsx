import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import { createJob, getJob, type JobResponse } from "../api.js";
import { fileLabel, getFilesFromEvent } from "../dropFiles.js";
import { TitleNfeXmlXlsx } from "../components/TitleNfeXmlXlsx.js";
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

export default function HomePage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => [...prev, ...accepted]);
    setErr(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    getFilesFromEvent,
    accept: {
      "application/xml": [".xml"],
      "text/xml": [".xml"],
      "application/zip": [".zip"],
    },
    validator: (file) => {
      const n = file.name.toLowerCase();
      if (n.endsWith(".xml") || n.endsWith(".zip")) return null;
      return {
        code: "file-invalid-type",
        message: "Escolha arquivos de nota fiscal ou um pacote",
      };
    },
  });

  const removeAt = (i: number) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  };

  const submit = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setErr(null);
    setJob(null);
    try {
      const { id } = await createJob(files);
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
        const j = await getJob(job.id);
        setJob(j);
      } catch {
        /* ignore */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (job?.status === "done" && job.downloadToken && job.id) {
      navigate(`/tools/nfe/download/${encodeURIComponent(job.id)}`, { replace: true });
    }
  }, [job?.status, job?.downloadToken, job?.id, navigate]);

  const isProcessing =
    busy ||
    (job != null &&
      job.status !== "not_found" &&
      job.status !== "done" &&
      job.status !== "failed");

  const showDeterminateBar =
    job?.status === "running" &&
    job.progress != null &&
    !Number.isNaN(job.progress);

  const progressLabel = busy
    ? "Enviando arquivos…"
    : job?.status === "running"
      ? "Gerando planilha…"
      : job?.status === "queued"
        ? "Na fila…"
        : "Aguarde…";

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
          <TitleNfeXmlXlsx size="home" />
        </motion.div>
        <motion.p
          className="mt-3 text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          Você pode arrastar vários arquivos de uma vez, um pacote ou uma pasta inteira. O que não for nota fiscal é
          ignorado.
        </motion.p>
      </motion.header>

      <section {...getRootProps()} className={toolDropzoneClass(isDragActive)}>
        <motion.div
          className="flex min-h-0 w-full flex-col"
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
            className="font-display font-semibold text-brand-ink"
            animate={{ opacity: 1, y: 0 }}
            key={isDragActive ? "drag" : "idle"}
            initial={{ opacity: 0.85, y: 4 }}
            transition={transitionFast}
          >
            {isDragActive
              ? "Solte os arquivos…"
              : "Clique ou arraste arquivos, pacote ou pasta"}
          </motion.p>
          <p className="mt-2 text-sm text-[#347891]">Dentro de pastas, só entram arquivos de nota fiscal.</p>
        </motion.div>
      </section>

      <AnimatePresence mode="popLayout">
        {files.length > 0 && (
          <motion.div
            key="files-panel"
            className={`flex flex-col p-4 ${toolPanelClass}`}
            initial={{ opacity: 0, y: 28, scale: 0.97, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -16, scale: 0.98, filter: "blur(6px)" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            layout
          >
            <ul
              className="max-h-[min(42vh,20rem)] space-y-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]"
              aria-label="Arquivos selecionados"
            >
              <AnimatePresence initial={false} mode="popLayout">
                {files.map((f, i) => (
                  <motion.li
                    key={`${fileLabel(f)}-${i}`}
                    layout
                    initial={{ opacity: 0, x: -16, scale: 0.97 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    transition={{
                      ...transitionSmooth,
                      delay: Math.min(i * 0.025, 0.35),
                    }}
                    exit={{ opacity: 0, x: 28, scale: 0.94, transition: transitionFast }}
                    className="flex items-center justify-between gap-2 rounded-lg bg-brand-soft/90 px-3 py-2 text-sm text-brand-ink ring-1 ring-brand-line/60"
                  >
                    <span className="min-w-0 truncate" title={fileLabel(f)}>
                      {fileLabel(f)}
                    </span>
                    <motion.button
                      type="button"
                      className="shrink-0 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm"
                      onClick={() => removeAt(i)}
                      whileHover={{ scale: 1.06, filter: "brightness(1.08)" }}
                      whileTap={{ scale: 0.92 }}
                      transition={springSnappy}
                    >
                      remover
                    </motion.button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            <motion.button
              type="button"
              disabled={busy}
              onClick={submit}
              className={`mt-4 ${toolPrimaryButtonClass}`}
              whileHover={busy ? undefined : { scale: 1.015, boxShadow: "0 12px 40px -8px rgb(42 79 96 / 0.2)" }}
              whileTap={busy ? undefined : { scale: 0.985 }}
              transition={springSnappy}
            >
              {busy ? "Enviando…" : "Gerar planilha"}
            </motion.button>
            <AnimatePresence>
              {isProcessing && (
                <motion.div
                  key="progress"
                  className="mt-4 space-y-2"
                  aria-live="polite"
                  initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -6, filter: "blur(3px)" }}
                  transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                >
                  <motion.p
                    className="text-center text-xs font-semibold text-accent"
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
                          "aria-valuenow": Math.round(
                            Math.min(100, Math.max(0, job!.progress as number))
                          ),
                        }
                      : {})}
                  >
                    {showDeterminateBar ? (
                      <motion.div
                        className={toolProgressFillClass}
                        initial={{ width: 0 }}
                        animate={{
                          width: `${Math.min(100, Math.max(0, job!.progress as number))}%`,
                        }}
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
          </motion.div>
        )}
      </AnimatePresence>

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
        title="Erro ao processar"
        message={job?.status === "failed" ? job.error : undefined}
        primaryLabel="Tentar de novo"
        onPrimary={() => setJob(null)}
      />
    </motion.div>
  );
}
