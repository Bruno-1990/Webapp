import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useDropzone, type FileRejection } from "react-dropzone";
import {
  NFE_RELATORIO_TIPO_LABEL,
  checkConcatenadorCompatibilidade,
  detectNfeRelatorioTipo,
  extractNfeCnpjFromFileName,
  formatCnpjCpf,
  type NfeRelatorioTipo,
} from "@webapp/contracts";
import {
  createConcatenadorPlanilhasJob,
  getConcatenadorPlanilhasJob,
  type ConcatenadorJobResponse,
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
  const n = typeof file?.name === "string" ? file.name.toLowerCase() : "";
  if (n.endsWith(".csv") || n.endsWith(".xlsx") || n.endsWith(".xls")) return null;
  return { code: "file-invalid-type", message: "Use CSV, XLS ou XLSX" };
}

const TIPO_BADGE_CLASS: Record<NfeRelatorioTipo, string> = {
  emitente: "border-sky-300/80 bg-sky-50 text-sky-800",
  destinatario: "border-violet-300/80 bg-violet-50 text-violet-800",
};

/** Etiqueta Emitente/Destinatário lida do nome do arquivo. */
function TipoBadge({ tipo }: { tipo: NfeRelatorioTipo }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TIPO_BADGE_CLASS[tipo]}`}
    >
      {NFE_RELATORIO_TIPO_LABEL[tipo]}
    </span>
  );
}

/** CNPJ/CPF do titular — os dígitos no início do nome do arquivo. */
function CnpjBadge({ cnpj, destaque }: { cnpj: string; destaque: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold ${
        destaque
          ? "border-amber-300/90 bg-amber-50 text-amber-800"
          : "border-[#b9d8e1] bg-[#eef6fb] text-[#2a4f60]"
      }`}
      title="CNPJ do titular do relatório (lido do nome do arquivo)"
    >
      {formatCnpjCpf(cnpj)}
    </span>
  );
}

/** Uma linha por arquivo dentro do modal, com as etiquetas que motivaram o bloqueio. */
function LinhaArquivo({ nome }: { nome: string }) {
  const tipo = detectNfeRelatorioTipo(nome);
  const cnpj = extractNfeCnpjFromFileName(nome);
  return (
    <li className="flex flex-wrap items-center gap-1.5 text-[13px]">
      {cnpj ? (
        <CnpjBadge cnpj={cnpj} destaque />
      ) : (
        <span className="shrink-0 rounded-full border border-slate-300/80 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
          sem CNPJ no nome
        </span>
      )}
      {tipo && <TipoBadge tipo={tipo} />}
      <span className="min-w-0 flex-1 truncate" title={nome}>
        {nome}
      </span>
    </li>
  );
}

export default function ConcatenadorPlanilhasHomePage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<ConcatenadorJobResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [avisoAberto, setAvisoAberto] = useState(false);

  /** Arquivos recusados pela dropzone — o react-dropzone os descarta em
   *  silêncio, então guardamos para mostrar o motivo. */
  const [recusados, setRecusados] = useState<{ nome: string; motivo: string }[]>([]);

  const onDrop = useCallback((accepted: File[], rejections: FileRejection[]) => {
    setFiles((prev) => [...prev, ...accepted]);
    setErr(null);
    setRecusados(
      rejections.map((r) => ({
        nome: r.file.name,
        motivo: r.errors[0]?.message ?? "Formato não suportado",
      })),
    );
  }, []);

  /** CNPJ do titular e tipo de cada arquivo, lidos do nome. */
  const tipos = useMemo(() => files.map((f) => detectNfeRelatorioTipo(f.name)), [files]);
  const cnpjs = useMemo(() => files.map((f) => extractNfeCnpjFromFileName(f.name)), [files]);

  /** Mesma regra que a API aplica — mensagem idêntica dos dois lados. */
  const compat = useMemo(
    () => checkConcatenadorCompatibilidade(files.map((f) => f.name)),
    [files],
  );

  const cnpjsDiferentes = compat.problemas.includes("cnpjs_diferentes");
  const tiposMisturados = compat.problemas.includes("tipos_misturados");

  /** Arquivos que ficaram de fora do confronto por não trazerem a informação no
   *  nome. Só vale avisar se OUTROS arquivos trouxeram — aí a conferência é parcial. */
  const foraDoConfronto = useMemo(() => {
    if (files.length === 0) return [];
    const algumTemCnpj = cnpjs.some(Boolean);
    const algumTemTipo = tipos.some(Boolean);
    if (!algumTemCnpj && !algumTemTipo) return [];
    return files
      .map((f, i) => ({ nome: f.name, semCnpj: !cnpjs[i], semTipo: !tipos[i] }))
      .filter((x) => (algumTemCnpj && x.semCnpj) || (algumTemTipo && x.semTipo));
  }, [files, cnpjs, tipos]);

  // Abre o lembrete assim que a incompatibilidade aparece (e não só ao enviar).
  useEffect(() => {
    if (!compat.ok) setAvisoAberto(true);
  }, [compat.ok]);

  const isProcessing =
    busy ||
    (job != null &&
      job.status !== "not_found" &&
      job.status !== "done" &&
      job.status !== "failed");

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    validator: allowedFile,
    disabled: isProcessing,
  });

  const submit = async () => {
    if (files.length < 2) return;
    if (!compat.ok) {
      setAvisoAberto(true);
      return;
    }
    setBusy(true);
    setErr(null);
    setJob(null);
    try {
      const { id } = await createConcatenadorPlanilhasJob(files);
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
        const j = await getConcatenadorPlanilhasJob(job.id);
        setJob(j);
      } catch {
        /* ignore */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (job?.status === "done" && job.downloadToken && job.id) {
      navigate(`/tools/concatenador-planilhas/download/${encodeURIComponent(job.id)}`, {
        replace: true,
      });
    }
  }, [job?.status, job?.downloadToken, job?.id, navigate]);

  const showDeterminateBar =
    job?.status === "running" && job.progress != null && !Number.isNaN(job.progress);

  const progressPct = showDeterminateBar
    ? Math.min(100, Math.max(0, job!.progress as number))
    : 0;

  const progressLabel = busy
    ? "Enviando planilhas…"
    : job?.status === "running"
      ? "Juntando as planilhas…"
      : job?.status === "queued"
        ? "Na fila…"
        : "Aguarde…";

  /** O botão NÃO desliga por incompatibilidade: desabilitado não explica nada.
   *  Clicar com tipos/CNPJs misturados tem de abrir o modal com o motivo. */
  const readyToSubmit = files.length >= 2 && !isProcessing;

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
          <ToolPageTitle left="Várias planilhas" right="Uma só" />
        </motion.div>
        <motion.p
          className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          Emenda planilhas do mesmo relatório na ordem da coluna{" "}
          <strong>#</strong> → <strong>Planilha Unificada.xlsx</strong>
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
          open={avisoAberto && !compat.ok}
          onClose={() => setAvisoAberto(false)}
          tone="warn"
          title={
            cnpjsDiferentes && tiposMisturados
              ? "Planilhas incompatíveis"
              : cnpjsDiferentes
                ? "CNPJs diferentes"
                : "Planilhas de tipos diferentes"
          }
          primaryLabel="Entendi"
        >
          <div className="space-y-3">
            {compat.mensagem && <p>{compat.mensagem}</p>}
            {cnpjsDiferentes && (
              <p className="text-[13px] text-[#2a4f60]">
                Encontrei {compat.cnpjs.length} CNPJs:{" "}
                <span className="font-mono font-semibold">
                  {compat.cnpjs.map(formatCnpjCpf).join(" · ")}
                </span>
                . Os CNPJs de dentro da planilha não entram nessa conta — são de
                clientes e fornecedores de cada nota.
              </p>
            )}
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-3 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                O que você enviou
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {files.map((f, i) => (
                  <LinhaArquivo key={`${f.name}-${i}`} nome={f.name} />
                ))}
              </ul>
            </div>
          </div>
        </Modal>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-[#347891]">
            Planilhas (2 ou mais)
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
              transition={isDragActive ? springSnappy : { ...transitionSmooth, delay: 0.12 }}
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
                {isDragActive ? "Solte as planilhas…" : "Arraste ou clique"}
              </motion.p>
              <p className="mt-1 text-xs text-[#2a4f60]">
                .csv · .xlsx · .xls — a ordem de envio não importa
              </p>
            </motion.div>
          </section>

          <AnimatePresence mode="popLayout">
            {files.map((f, i) => (
              <motion.div
                key={`${fileLabel(f)}-${i}`}
                layout
                initial={{ opacity: 0, x: -16, scale: 0.97, filter: "blur(4px)" }}
                animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, x: -12, scale: 0.97, filter: "blur(3px)" }}
                transition={transitionSmooth}
                className={`flex items-center justify-between gap-2 rounded-xl bg-gradient-to-b from-brand-soft/90 to-brand-soft/70 px-3 py-2 text-sm text-brand-ink ring-1 ${
                  (cnpjsDiferentes && cnpjs[i]) || (tiposMisturados && tipos[i])
                    ? "ring-amber-400/70"
                    : "ring-brand-line/60"
                }`}
              >
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {cnpjs[i] && <CnpjBadge cnpj={cnpjs[i]!} destaque={cnpjsDiferentes} />}
                  {tipos[i] && <TipoBadge tipo={tipos[i]!} />}
                  <span className="min-w-0 truncate" title={fileLabel(f)}>
                    {fileLabel(f)}
                  </span>
                </span>
                <motion.button
                  type="button"
                  className="shrink-0 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm"
                  onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  whileHover={{ scale: 1.06, filter: "brightness(1.08)" }}
                  whileTap={{ scale: 0.92 }}
                  transition={springSnappy}
                  disabled={isProcessing}
                >
                  remover
                </motion.button>
              </motion.div>
            ))}
          </AnimatePresence>

          {recusados.length > 0 && (
            <motion.div
              className="flex items-start gap-2.5 rounded-xl border border-rose-200/90 bg-rose-50/70 px-3 py-2.5"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={transitionFast}
              role="alert"
            >
              <span
                aria-hidden
                className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-rose-200 bg-rose-100 text-[12px] font-bold text-rose-700"
              >
                ×
              </span>
              <div className="min-w-0 flex-1 text-xs leading-relaxed text-rose-900">
                <p className="font-semibold">
                  {recusados.length} arquivo(s) não entraram na lista:
                </p>
                <ul className="mt-1 space-y-0.5">
                  {recusados.map((r, i) => (
                    <li key={`${r.nome}-${i}`} className="truncate" title={r.nome}>
                      {r.nome} — {r.motivo}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                onClick={() => setRecusados([])}
                className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
              >
                ok
              </button>
            </motion.div>
          )}

          {files.length === 1 && compat.ok && (
            <p className="text-xs font-medium text-[#347891]">
              Envie pelo menos duas planilhas para concatenar.
            </p>
          )}

          {foraDoConfronto.length > 0 && (
            <p className="rounded-xl border border-[#b9d8e1] bg-[#eef6fb] px-3 py-2 text-xs leading-relaxed text-[#2a4f60]">
              {foraDoConfronto.length} arquivo(s) sem CNPJ/tipo no nome ficaram de fora
              da conferência de titular ({foraDoConfronto.map((x) => x.nome).join(", ")}).
              Confira à mão se pertencem ao mesmo relatório.
            </p>
          )}

          {!compat.ok && (
            <motion.div
              className="flex items-start gap-2.5 rounded-xl border border-amber-200/90 bg-amber-50/70 px-3 py-2.5"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={transitionFast}
              role="alert"
            >
              <span
                aria-hidden
                className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-100 text-[12px] font-bold text-amber-700"
              >
                !
              </span>
              <div className="space-y-1 text-xs leading-relaxed text-amber-900">
                {cnpjsDiferentes && (
                  <p>
                    A lista tem <strong>{compat.cnpjs.length} CNPJs diferentes</strong>{" "}
                    ({compat.cnpjs.map(formatCnpjCpf).join(" · ")}). Deixe só as
                    planilhas de um titular.
                  </p>
                )}
                {tiposMisturados && (
                  <p>
                    Há planilhas de <strong>Emitente</strong> e de{" "}
                    <strong>Destinatário</strong>. A concatenação tem de ser Emitente
                    com Emitente, Destinatário com Destinatário.
                  </p>
                )}
              </div>
            </motion.div>
          )}
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
          {busy ? "Enviando…" : "Juntar planilhas"}
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
