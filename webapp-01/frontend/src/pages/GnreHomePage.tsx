import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type InputHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDropzone } from "react-dropzone";
import {
  createGnreJob,
  getGnreJob,
  gnreDownloadUrl,
  type GnreJobResponse,
} from "../api.js";
import {
  fileLabel,
  getPdfOnlyFilesFromEvent,
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
  transitionSmooth,
} from "../motion-variants.js";

/** webkitdirectory faz o <input> abrir como picker de pasta (fallback p/ Firefox/Safari). */
const FOLDER_INPUT_ATTRS = {
  webkitdirectory: "",
  directory: "",
  mozdirectory: "",
} as unknown as InputHTMLAttributes<HTMLInputElement>;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function dedupe(prev: File[], incoming: File[]): File[] {
  const seen = new Set(prev.map((f) => `${fileLabel(f)}|${f.size}`));
  const merged = [...prev];
  for (const f of incoming) {
    const k = `${fileLabel(f)}|${f.size}`;
    if (!seen.has(k)) {
      merged.push(f);
      seen.add(k);
    }
  }
  return merged;
}

const CURRENCY_BR = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default function GnreHomePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<GnreJobResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  /** Garante que o modal abra UMA vez por job concluído (não reabra ao re-render). */
  const [summaryShownFor, setSummaryShownFor] = useState<string | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => dedupe(prev, accepted));
    setErr(null);
  }, []);

  const zone = useDropzone({
    onDrop,
    getFilesFromEvent: getPdfOnlyFilesFromEvent,
    useFsAccessApi: false,
  });

  /**
   * Em Chrome/Edge usamos showDirectoryPicker direto no clique da dropzone
   * (sem o alert "Carregar N arquivos…"). Em Firefox/Safari deixamos o
   * react-dropzone abrir o <input webkitdirectory> normalmente.
   */
  const usesNativeDirPicker = supportsDirectoryPicker();
  const handlePickDir = useCallback(async () => {
    try {
      const picked = await pickDirectoryAndReadFiles("pdf-only");
      if (!picked) return;
      setFiles((prev) => dedupe(prev, picked));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const onZoneClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!usesNativeDirPicker) return; // deixa react-dropzone abrir o input
      e.preventDefault();
      e.stopPropagation();
      void handlePickDir();
    },
    [usesNativeDirPicker, handlePickDir],
  );

  const removeAt = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  const clearAll = () => setFiles([]);

  const submit = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setErr(null);
    setJob(null);
    try {
      const { id } = await createGnreJob(files);
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
        const j = await getGnreJob(job.id);
        setJob(j);
      } catch {
        /* ignore */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (job?.status === "done" && job.id && summaryShownFor !== job.id) {
      setSummaryOpen(true);
      setSummaryShownFor(job.id);
    }
  }, [job?.status, job?.id, summaryShownFor]);

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

  const totalSize = useMemo(
    () => files.reduce((s, f) => s + f.size, 0),
    [files],
  );

  const done = job?.status === "done" && job.downloadToken && job.id;

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
        <ToolPageTitle left="GNRE" right="Excel" />
        <motion.p
          className="mt-3 text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitionSmooth, delay: 0.1 }}
        >
          Selecione uma pasta com os PDFs das guias GNRE → planilha consolidada
          com <strong>Lançamentos</strong> e <strong>Falhas</strong>.
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

        <GnreSummaryModal
          open={summaryOpen}
          onClose={() => setSummaryOpen(false)}
          result={job?.result}
          downloadHref={
            job?.downloadToken && job.id
              ? gnreDownloadUrl(job.id, job.downloadToken)
              : undefined
          }
        />

        <section
          {...zone.getRootProps({ onClick: onZoneClick })}
          className={toolDropzoneClass(zone.isDragActive)}
        >
          <input {...zone.getInputProps(FOLDER_INPUT_ATTRS)} />
          <p className="font-display text-lg font-bold text-[#183844]">
            {zone.isDragActive ? "Solte a pasta…" : "Arraste ou clique para escolher a pasta"}
          </p>
          <p className="mt-2 text-sm text-[#2a4f60]">
            Todos os PDFs dentro da pasta serão lidos automaticamente.
          </p>
          {files.length > 0 && (
            <p className="mt-3 text-xs text-accent">
              {files.length} PDF{files.length > 1 ? "s" : ""} ·{" "}
              {formatBytes(totalSize)}
            </p>
          )}
        </section>

        {files.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#347891]">
                PDFs selecionados
              </p>
              <button
                type="button"
                onClick={clearAll}
                disabled={isProcessing}
                className="text-xs font-medium text-[#7eaabb] hover:text-rose-600 disabled:opacity-50"
              >
                Limpar tudo
              </button>
            </div>
            <ul className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-[#d4e4eb] bg-white/60 p-2">
              {files.map((f, i) => {
                const label = fileLabel(f);
                return (
                  <li
                    key={`${label}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs text-[#1e3d4d] hover:bg-[#eef7fb]"
                  >
                    <span className="truncate" title={label}>
                      {label}
                    </span>
                    <span className="shrink-0 text-[10px] text-[#7eaabb]">
                      {formatBytes(f.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAt(i)}
                      disabled={isProcessing}
                      aria-label={`Remover ${label}`}
                      className="shrink-0 rounded px-1 text-[#7eaabb] hover:text-rose-600 disabled:opacity-50"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

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
                {job.status === "queued" ? "Na fila…" : "Extraindo guias…"}
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

        {done && job?.downloadToken && (
          <motion.a
            href={gnreDownloadUrl(job.id, job.downloadToken)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`${toolPrimaryButtonClass} flex items-center justify-center text-center`}
          >
            Baixar planilha
          </motion.a>
        )}

        {!done && (
          <motion.button
            type="button"
            className={toolPrimaryButtonClass}
            onClick={submit}
            disabled={files.length === 0 || isProcessing}
            whileTap={{ scale: 0.98 }}
            transition={springSnappy}
          >
            Gerar planilha
          </motion.button>
        )}
      </motion.div>
    </motion.div>
  );
}

function GnreSummaryModal({
  open,
  onClose,
  result,
  downloadHref,
}: {
  open: boolean;
  onClose: () => void;
  result: GnreJobResponse["result"];
  downloadHref?: string;
}) {
  const totais = result?.totais ?? {};
  const ok = totais.ok ?? 0;
  const dup = totais.dup ?? 0;
  const fail = totais.fail ?? 0;
  const total = totais.total ?? ok + dup + fail;
  const valor = typeof result?.valorTotal === "number" ? result.valorTotal : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      tone="success"
      title="Extração concluída"
      primaryLabel={null}
      secondaryLabel="Fechar"
      onSecondary={onClose}
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-[#1e3d4d]">
          Confira o resumo antes de baixar a planilha.
        </p>

        <div className="rounded-2xl border border-[#d4e4eb] bg-[linear-gradient(180deg,#ffffff_0%,#f5fbfe_100%)] p-4 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#3c7f97]">
            Valor total
          </p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight text-emerald-700">
            {CURRENCY_BR.format(valor)}
          </p>
          <p className="mt-1 text-[11px] text-[#7eaabb]">
            soma de processados + duplicados ({ok + dup} guias)
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <SummaryStat label="Processados" value={ok} tone="ok" />
          <SummaryStat label="Duplicados" value={dup} tone="dup" />
          <SummaryStat label="Falhas" value={fail} tone="fail" />
        </div>

        <p className="text-center text-[11px] text-[#7eaabb]">
          Total de PDFs lidos: <span className="font-semibold text-[#1e3d4d]">{total}</span>
        </p>

        {downloadHref && (
          <a
            href={downloadHref}
            onClick={onClose}
            className={`${toolPrimaryButtonClass} flex items-center justify-center text-center`}
          >
            Baixar planilha
          </a>
        )}
      </div>
    </Modal>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "dup" | "fail";
}) {
  const palette: Record<typeof tone, { ring: string; text: string; bg: string }> = {
    ok: {
      ring: "ring-emerald-200",
      text: "text-emerald-700",
      bg: "bg-emerald-50",
    },
    dup: {
      ring: "ring-amber-200",
      text: "text-amber-700",
      bg: "bg-amber-50",
    },
    fail: {
      ring: "ring-rose-200",
      text: "text-rose-700",
      bg: "bg-rose-50",
    },
  };
  const p = palette[tone];
  return (
    <div className={`rounded-xl px-2 py-3 ring-1 ${p.ring} ${p.bg}`}>
      <p className={`font-display text-xl font-bold leading-none ${p.text}`}>{value}</p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-[#1e3d4d]">
        {label}
      </p>
    </div>
  );
}
