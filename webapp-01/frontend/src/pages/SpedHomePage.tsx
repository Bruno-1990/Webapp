import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import {
  SPED_EXPORT_SHEET_KEYS,
  SPED_EXPORT_SHEET_LABELS,
} from "@webapp/contracts";
import {
  createSpedJob,
  fetchSpedRegMeta,
  getSpedJob,
  inspectSpedFile,
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

const SPED_CORE_LIST = SPED_EXPORT_SHEET_KEYS as readonly string[];

export default function SpedHomePage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(
    () => new Set(SPED_EXPORT_SHEET_KEYS)
  );
  const [job, setJob] = useState<JobResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** `null` = inspeção ainda não terminou para o ficheiro atual */
  const [presentRegs, setPresentRegs] = useState<string[] | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectErr, setInspectErr] = useState<string | null>(null);
  /** Aviso quando a API não tem /inspect e usámos leitura local (ex.: 404). */
  const [inspectNotice, setInspectNotice] = useState<string | null>(null);
  /** Descrições do guia `cabecalhos_sped.txt` (API GET /tools/sped/reg-meta). */
  const [spedRegMeta, setSpedRegMeta] = useState<{
    descriptions: Record<string, string>;
    blockByReg: Record<string, string>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const m = await fetchSpedRegMeta();
      if (!cancelled && m) setSpedRegMeta(m);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted.slice(0, 1)[0];
    if (!f) return;
    setFiles([f]);
    setSelectedSheets(new Set(SPED_EXPORT_SHEET_KEYS));
    setErr(null);
    setInspectErr(null);
    setInspectNotice(null);
    setPresentRegs(null);
    void (async () => {
      setInspecting(true);
      try {
        const { presentRegs: regs, localFallback } = await inspectSpedFile(f);
        setPresentRegs(regs);
        // Padrão: todas as opções marcadas (core + extras detectados no arquivo)
        setSelectedSheets(() => {
          const all = new Set<string>(SPED_EXPORT_SHEET_KEYS);
          for (const r of regs) all.add(r);
          return all;
        });
        if (localFallback) {
          setInspectNotice(
            "O servidor ainda não expõe a rota de inspeção (ou respondeu 404). " +
              "Os blocos foram listados no navegador. Reinicie a API após atualizar o código para usar inspeção no servidor. " +
              "Arquivos acima de ~80 MB: só os primeiros megabytes são varridos no modo local."
          );
        }
      } catch (e) {
        setInspectErr(e instanceof Error ? e.message : String(e));
        setPresentRegs([]);
      } finally {
        setInspecting(false);
      }
    })();
  }, []);

  const toggleSheet = (key: string) => {
    setSelectedSheets((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    multiple: false,
    getFilesFromEvent: getSpedFilesFromEvent,
    /** Sem `accept`: no Windows o MIME do .txt costuma ser vazio e o dropzone descartava o arquivo. Validação só pela extensão. */
    validator: (file) => {
      const n = file.name.toLowerCase();
      if (n.endsWith(".txt")) return null;
      return {
        code: "file-invalid-type",
        message: "Envie só o arquivo de texto da declaração",
      };
    },
  });

  const removeFile = () => {
    setFiles([]);
    setPresentRegs(null);
    setInspectErr(null);
    setInspectNotice(null);
    setInspecting(false);
  };

  const extraRegs = (presentRegs ?? []).filter((r) => !SPED_CORE_LIST.includes(r));
  const listedRegs = [...SPED_EXPORT_SHEET_KEYS, ...extraRegs];

  const submit = async () => {
    const f = files[0];
    if (!f) return;
    if (selectedSheets.size === 0) return;
    if (inspecting || presentRegs === null) return;
    const coreOrder = SPED_EXPORT_SHEET_KEYS.filter((k) => selectedSheets.has(k));
    const extrasOrdered = presentRegs.filter(
      (r) => selectedSheets.has(r) && !SPED_CORE_LIST.includes(r)
    );
    const sheetsOrdered = [...coreOrder, ...extrasOrdered];
    const needsPresentRegs = sheetsOrdered.some((s) => !SPED_CORE_LIST.includes(s));
    setBusy(true);
    setErr(null);
    setJob(null);
    try {
      const { id } = await createSpedJob(f, {
        sheets: sheetsOrdered,
        ...(needsPresentRegs ? { presentRegs } : {}),
      });
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
        const j = await getSpedJob(job.id);
        setJob(j);
      } catch {
        /* ignore */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (job?.status === "done" && job.downloadToken && job.id) {
      navigate(`/tools/sped/download/${encodeURIComponent(job.id)}`, { replace: true });
    }
  }, [job?.status, job?.downloadToken, job?.id, navigate]);

  const isProcessing =
    busy ||
    inspecting ||
    (job != null &&
      job.status !== "not_found" &&
      job.status !== "done" &&
      job.status !== "failed");

  const showDeterminateBar =
    job?.status === "running" &&
    job.progress != null &&
    !Number.isNaN(job.progress);

  const progressLabel = busy
    ? "Enviando arquivo…"
    : inspecting
      ? "A ler blocos do arquivo…"
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
          <ToolPageTitle left="SPED" right="XLSX" size="home" />
        </motion.div>
        <motion.p
          className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          Envie um arquivo por vez — o mesmo que você recebe do contador. Na planilha, cada tipo de informação aparece
          separado para ficar fácil de ler.
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
          <input {...getInputProps({ accept: ".txt,text/plain" })} />
          <motion.p
            className="font-display font-semibold text-brand-ink"
            animate={{ opacity: 1, y: 0 }}
            key={isDragActive ? "drag" : "idle"}
            initial={{ opacity: 0.85, y: 4 }}
            transition={transitionFast}
          >
            {isDragActive ? "Solte o arquivo…" : "Clique ou arraste o arquivo do escritório fiscal"}
          </motion.p>
          <p className="mt-2 text-sm text-[#347891]">Só um arquivo por vez</p>
        </motion.div>
      </section>

      <AnimatePresence mode="popLayout">
        {files.length > 0 && (
          <motion.div
            key="files-panel"
            className={`flex flex-col p-5 sm:p-6 ${toolPanelClass}`}
            initial={{ opacity: 0, y: 28, scale: 0.97, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -16, scale: 0.98, filter: "blur(6px)" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            layout
          >
            <ul className="space-y-2" aria-label="Arquivo selecionado">
              {files.map((f, i) => (
                <motion.li
                  key={`${fileLabel(f)}-${i}`}
                  layout
                  initial={{ opacity: 0, x: -16, scale: 0.97 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={transitionSmooth}
                  className="flex items-center justify-between gap-2 rounded-xl bg-gradient-to-b from-brand-soft/90 to-brand-soft/70 px-3 py-2.5 text-sm text-brand-ink ring-1 ring-brand-line/60"
                >
                  <span className="min-w-0 truncate" title={fileLabel(f)}>
                    {fileLabel(f)}
                  </span>
                  <motion.button
                    type="button"
                    className="shrink-0 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm"
                    onClick={removeFile}
                    whileHover={{ scale: 1.06, filter: "brightness(1.08)" }}
                    whileTap={{ scale: 0.92 }}
                    transition={springSnappy}
                  >
                    remover
                  </motion.button>
                </motion.li>
              ))}
            </ul>
            <div className="mt-5 rounded-xl border border-brand-line/50 bg-white/85 p-4 text-left shadow-[0_10px_28px_-20px_rgb(42_79_96/0.45)]">
              <p className="text-[12px] font-semibold text-brand-ink">
                Abas da planilha (cada opção vira uma aba no Excel)
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-brand-soft px-2.5 py-1.5 text-xs font-semibold text-brand-ink ring-1 ring-brand-line/60 transition-colors hover:bg-[#d8ebf3]"
                  onClick={() => {
                    setSelectedSheets(new Set(listedRegs));
                  }}
                >
                  Marcar todos
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-brand-soft px-2.5 py-1.5 text-xs font-semibold text-brand-ink ring-1 ring-brand-line/60 transition-colors hover:bg-[#d8ebf3]"
                  onClick={() => setSelectedSheets(new Set())}
                >
                  Desmarcar todos
                </button>
              </div>
              <ul className="mt-3.5 max-h-80 space-y-2 overflow-y-auto rounded-lg bg-[#fbfeff] p-2 pr-1 text-sm ring-1 ring-brand-line/40" role="list">
                {listedRegs.map((key) => {
                  const isCore = SPED_CORE_LIST.includes(key);
                  const title = spedRegMeta?.descriptions[key]?.trim();
                  const label = isCore
                    ? SPED_EXPORT_SHEET_LABELS[key as keyof typeof SPED_EXPORT_SHEET_LABELS]
                    : title && title.length > 0
                      ? `${key} — ${title}`
                      : spedRegMeta != null
                        ? `${key} — Sem descrição no guia`
                        : key;
                  return (
                    <li key={key} className="flex items-start gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-[#eef8fc]">
                      <input
                        id={`sped-sheet-${key}`}
                        type="checkbox"
                        checked={selectedSheets.has(key)}
                        onChange={() => toggleSheet(key)}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-brand-line text-accent focus:ring-accent"
                      />
                      <label
                        htmlFor={`sped-sheet-${key}`}
                        className="cursor-pointer leading-snug text-brand-ink"
                      >
                        {label}
                      </label>
                    </li>
                  );
                })}
              </ul>
              {inspectNotice && (
                <p className="mt-3 text-xs text-sky-900">{inspectNotice}</p>
              )}
              {inspectErr && (
                <p className="mt-3 text-xs text-amber-800">
                  Não foi possível listar blocos extra neste arquivo ({inspectErr}). Só as abas principais
                  estão disponíveis.
                </p>
              )}
              {selectedSheets.size === 0 && (
                <p className="mt-2 text-xs font-medium text-rose-600">
                  Marque ao menos uma aba para gerar a planilha.
                </p>
              )}
            </div>
            <motion.button
              type="button"
              disabled={busy || inspecting || presentRegs === null || selectedSheets.size === 0}
              onClick={submit}
              className={`mt-5 ${toolPrimaryButtonClass}`}
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
