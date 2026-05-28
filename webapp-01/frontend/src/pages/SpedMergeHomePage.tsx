import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import {
  createSpedMergeJob,
  getSpedMergeJob,
  inspectSpedMergeXlsx,
  type JobResponse,
} from "../api.js";
import { fileLabel, getSpedFilesFromEvent } from "../dropFiles.js";
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

export default function SpedMergeHomePage() {
  const navigate = useNavigate();
  const [spedFile, setSpedFile] = useState<File | null>(null);
  const [xlsxFile, setXlsxFile] = useState<File | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsOriginalSped, setNeedsOriginalSped] = useState(false);
  const [inspectMsg, setInspectMsg] = useState<string | null>(null);
  const [inspectingXlsx, setInspectingXlsx] = useState(false);

  const onDropSped = useCallback((accepted: File[]) => {
    setSpedFile(accepted[0] ?? null);
    setErr(null);
  }, []);

  const onDropXlsx = useCallback((accepted: File[]) => {
    const f = accepted[0] ?? null;
    setXlsxFile(f);
    setSpedFile(null);
    setNeedsOriginalSped(false);
    setInspectMsg(null);
    setErr(null);
    if (!f) return;
    void (async () => {
      setInspectingXlsx(true);
      try {
        const inspected = await inspectSpedMergeXlsx(f);
        if (inspected.requiresOriginal) {
          setNeedsOriginalSped(true);
          const reason = inspected.reasons.length > 0 ? ` ${inspected.reasons[0]}` : "";
          setInspectMsg(`Planilha parcial detectada.${reason} Envie também o SPED original.`);
        } else {
          setNeedsOriginalSped(false);
          setInspectMsg("Planilha completa detectada. O SPED original não é necessário.");
        }
      } catch (e) {
        setNeedsOriginalSped(true);
        setInspectMsg("Não foi possível validar a planilha automaticamente. Envie também o SPED original.");
        setErr(e instanceof Error ? e.message : String(e));
      }
      finally {
        setInspectingXlsx(false);
      }
    })();
  }, []);

  const spedDrop = useDropzone({
    onDrop: onDropSped,
    maxFiles: 1,
    multiple: false,
    getFilesFromEvent: getSpedFilesFromEvent,
    validator: (file) => {
      const name = typeof file?.name === "string" ? file.name.toLowerCase() : "";
      if (name.endsWith(".txt")) return null;
      return { code: "file-invalid-type", message: "Use o arquivo de texto da declaração" };
    },
  });

  const xlsxDrop = useDropzone({
    onDrop: onDropXlsx,
    maxFiles: 1,
    multiple: false,
    validator: (file) => {
      const name = typeof file?.name === "string" ? file.name.toLowerCase() : "";
      if (name.endsWith(".xlsx")) return null;
      return { code: "file-invalid-type", message: "Use um arquivo de planilha" };
    },
  });

  const submit = async () => {
    if (!xlsxFile) return;
    if (needsOriginalSped && !spedFile) return;
    setBusy(true);
    setErr(null);
    setJob(null);
    try {
      const { id } = await createSpedMergeJob(spedFile, xlsxFile);
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
        const j = await getSpedMergeJob(job.id);
        setJob(j);
      } catch {
        /* ignore */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (job?.status === "done" && job.downloadToken && job.id) {
      navigate(`/tools/sped-merge/download/${encodeURIComponent(job.id)}`, { replace: true });
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
      ? "Atualizando arquivo…"
      : job?.status === "queued"
        ? "Na fila…"
        : "Aguarde…";

  const readyToSubmit = Boolean(!inspectingXlsx && xlsxFile && (!needsOriginalSped || spedFile));

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
          <ToolPageTitle left="XLSX" right="SPED" size="home" />
        </motion.div>
        <motion.p
          className="mt-3 text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          Envie primeiro a planilha editada. Se ela estiver parcial, pediremos o SPED original automaticamente.
        </motion.p>
      </motion.header>

      <div className={`grid min-w-0 gap-3 sm:gap-4 ${needsOriginalSped ? "grid-cols-2 max-[400px]:grid-cols-1" : "grid-cols-1"}`}>
        <section {...xlsxDrop.getRootProps()} className={toolDropzoneClass(xlsxDrop.isDragActive)}>
          <motion.div
            className="flex min-h-0 w-full flex-col"
            initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(6px)" }}
            animate={{
              opacity: 1,
              y: 0,
              scale: xlsxDrop.isDragActive ? 1.02 : 1,
              filter: "blur(0px)",
            }}
            transition={
              xlsxDrop.isDragActive
                ? springSnappy
                : { ...transitionSmooth, delay: 0.12 }
            }
            whileHover={{ scale: xlsxDrop.isDragActive ? 1.02 : 1.01 }}
            whileTap={{ scale: 0.995 }}
          >
            <input {...xlsxDrop.getInputProps({ accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })} />
            <p className="font-display text-sm font-semibold text-brand-ink">2. Planilha editada</p>
            <motion.p
              className="mt-1 text-xs text-[#347891]"
              key={xlsxDrop.isDragActive ? "drag" : "idle"}
              initial={{ opacity: 0.85, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={transitionFast}
            >
              {xlsxDrop.isDragActive ? "Solte o arquivo…" : "A que você baixou nesta conversão, já com suas alterações"}
            </motion.p>
            {xlsxFile && (
              <p className="mt-2 truncate text-xs text-accent" title={fileLabel(xlsxFile)}>
                {fileLabel(xlsxFile)}
              </p>
            )}
          </motion.div>
        </section>

        {needsOriginalSped && (
          <section {...spedDrop.getRootProps()} className={toolDropzoneClass(spedDrop.isDragActive)}>
            <motion.div
              className="flex min-h-0 w-full flex-col"
              initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(6px)" }}
              animate={{
                opacity: 1,
                y: 0,
                scale: spedDrop.isDragActive ? 1.02 : 1,
                filter: "blur(0px)",
              }}
              transition={
                spedDrop.isDragActive
                  ? springSnappy
                  : { ...transitionSmooth, delay: 0.18 }
              }
              whileHover={{ scale: spedDrop.isDragActive ? 1.02 : 1.01 }}
              whileTap={{ scale: 0.995 }}
            >
              <input {...spedDrop.getInputProps({ accept: ".txt,text/plain" })} />
              <p className="font-display text-sm font-semibold text-brand-ink">SPED original (obrigatório neste caso)</p>
              <motion.p
                className="mt-1 text-xs text-[#347891]"
                key={spedDrop.isDragActive ? "drag" : "idle"}
                initial={{ opacity: 0.85, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={transitionFast}
              >
                {spedDrop.isDragActive ? "Solte o arquivo…" : "Clique ou arraste o arquivo original .txt"}
              </motion.p>
              {spedFile && (
                <p className="mt-2 truncate text-xs text-accent" title={fileLabel(spedFile)}>
                  {fileLabel(spedFile)}
                </p>
              )}
            </motion.div>
          </section>
        )}
      </div>
      {(inspectMsg || inspectingXlsx) && (
        <p className="mt-2 text-xs text-[#2b6277]">
          {inspectingXlsx ? "Validando planilha..." : inspectMsg}
        </p>
      )}

      <AnimatePresence mode="popLayout">
        {readyToSubmit && (
          <motion.div
            key="submit-panel"
            className={`flex flex-col p-4 ${toolPanelClass}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={transitionSmooth}
          >
            <motion.button
              type="button"
              disabled={busy || isProcessing}
              onClick={submit}
              className={toolPrimaryButtonClass}
              whileHover={
                busy || isProcessing
                  ? undefined
                  : { scale: 1.015, boxShadow: "0 12px 40px -8px rgb(42 79 96 / 0.2)" }
              }
              whileTap={busy || isProcessing ? undefined : { scale: 0.985 }}
              transition={springSnappy}
            >
              {busy || isProcessing ? "Processando…" : "Gerar arquivo atualizado"}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isProcessing && (
          <motion.div
            key="progress"
            className={`space-y-2 p-4 ${toolPanelClass}`}
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
        title="Erro ao mesclar"
        message={job?.status === "failed" ? job.error : undefined}
        primaryLabel="Tentar de novo"
        onPrimary={() => setJob(null)}
      />
    </motion.div>
  );
}
