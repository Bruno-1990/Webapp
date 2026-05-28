import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { TitleNfeXmlXlsx } from "../components/TitleNfeXmlXlsx.js";
import { ToolPageTitle } from "../components/ToolPageTitle.js";
import { toolPageShellClass, toolPanelClass, toolProgressFillClass } from "../toolLayout.js";
import {
  comparacaoPlanilhasDownloadUrl,
  downloadUrl,
  getComparacaoPlanilhasJob,
  getJob,
  getSciConsolidadoJob,
  getSciPortalNacionalJob,
  getSpedJob,
  getSpedMergeJob,
  sciConsolidadoDownloadUrl,
  sciPortalNacionalDownloadUrl,
  spedDownloadUrl,
  spedMergeDownloadUrl,
  type JobResponse,
} from "../api.js";
import { fadeUp, transitionFast, transitionSmooth } from "../motion-variants.js";

type UiPhase =
  | "net_err"
  | "bad_id"
  | "loading"
  | "not_found"
  | "failed"
  | "done";

export default function DownloadPage() {
  const { pathname } = useLocation();
  const isSpedMerge = pathname.includes("/tools/sped-merge/download");
  const isSci = pathname.includes("/tools/sci-consolidado/download");
  const isComparacao = pathname.includes("/tools/comparacao-planilhas/download");
  const isSciPortal = pathname.includes("/tools/sci-portal-nacional/download");
  const isSped =
    pathname.includes("/tools/sped/download") && !isSpedMerge && !isSci && !isComparacao;
  const { jobId: rawId } = useParams<{ jobId: string }>();
  const jobId = rawId ? decodeURIComponent(rawId) : "";
  const [job, setJob] = useState<JobResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const j = isSpedMerge
          ? await getSpedMergeJob(jobId)
          : isSci
            ? await getSciConsolidadoJob(jobId)
            : isComparacao
              ? await getComparacaoPlanilhasJob(jobId)
              : isSciPortal
                ? await getSciPortalNacionalJob(jobId)
                : isSped
                  ? await getSpedJob(jobId)
                  : await getJob(jobId);
        if (cancelled) return;
        setLoadErr(null);
        setJob(j);
        if (
          j.status === "done" ||
          j.status === "failed" ||
          j.status === "not_found"
        ) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      } catch {
        if (!cancelled) setLoadErr("Não foi possível consultar o job.");
      }
    };

    tick();
    timerRef.current = setInterval(tick, 1000);

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [jobId, isSped, isSpedMerge, isSci, isComparacao, isSciPortal]);

  const showDeterminateBar =
    job?.status === "running" &&
    job.progress != null &&
    !Number.isNaN(job.progress);

  const progressLabel =
    job?.status === "running"
      ? isSpedMerge
        ? "Atualizando arquivo…"
        : isSci
          ? "Gerando planilha SCI…"
          : isComparacao
            ? "Comparando planilhas…"
            : isSciPortal
              ? "Conciliando notas…"
              : "Preparando planilha…"
      : job?.status === "queued"
        ? "Na fila…"
        : "Carregando…";

  const stillWaiting =
    job == null ||
    job.status === "queued" ||
    job.status === "running" ||
    (job.status !== "done" &&
      job.status !== "failed" &&
      job.status !== "not_found");

  const phase: UiPhase = useMemo(() => {
    if (loadErr) return "net_err";
    if (!jobId) return "bad_id";
    if (stillWaiting) return "loading";
    if (job?.status === "not_found") return "not_found";
    if (job?.status === "failed") return "failed";
    if (job?.status === "done" && job.downloadToken) return "done";
    return "loading";
  }, [loadErr, jobId, stillWaiting, job]);

  const progressPct = showDeterminateBar
    ? Math.min(100, Math.max(0, job!.progress as number))
    : 0;

  const panelVariants = {
    initial: { opacity: 0, y: 14, scale: 0.98, filter: "blur(6px)" },
    animate: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" },
    exit: { opacity: 0, y: -10, scale: 0.99, filter: "blur(4px)" },
  };

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
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitionSmooth, delay: 0.08 }}
        >
          {isSpedMerge ? (
            <ToolPageTitle left="XLSX" right="SPED" size="download" />
          ) : isSci ? (
            <ToolPageTitle left="SCI" right="Excel" size="download" />
          ) : isComparacao ? (
            <ToolPageTitle left="SEFAZ" right="SCI" size="download" />
          ) : isSciPortal ? (
            <ToolPageTitle left="SCI" right="Portal Nacional" size="download" />
          ) : isSped ? (
            <ToolPageTitle left="SPED" right="XLSX" size="download" />
          ) : (
            <TitleNfeXmlXlsx size="download" />
          )}
        </motion.div>
        <motion.p
          className="mt-3 text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitionSmooth, delay: 0.14 }}
        >
          {isSpedMerge
            ? "Baixe o arquivo atualizado"
            : isSci
              ? "Baixe o ProdutosSCI.xlsx"
              : isComparacao
                ? "Baixe as notas faltantes"
                : isSciPortal
                  ? "Baixe a conciliação SCI × Portal Nacional"
                  : "Baixe a planilha"}
        </motion.p>
      </motion.header>

      <motion.div
        className={`p-8 ${toolPanelClass}`}
        initial={{ opacity: 0, y: 22, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ ...transitionSmooth, delay: 0.1 }}
        layout
      >
        <AnimatePresence mode="wait">
          {phase === "net_err" && (
            <motion.p
              key="net_err"
              className="text-center text-sm font-medium text-rose-700"
              variants={panelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transitionFast}
            >
              {loadErr}
            </motion.p>
          )}

          {phase === "bad_id" && (
            <motion.p
              key="bad_id"
              className="text-center text-brand-hover/80"
              variants={panelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transitionFast}
            >
              ID do job inválido.
            </motion.p>
          )}

          {phase === "loading" && (
            <motion.div
              key="loading"
              className="space-y-4"
              aria-live="polite"
              variants={panelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transitionSmooth}
            >
              <motion.p
                className="text-center text-sm font-semibold text-accent"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.06, ...transitionFast }}
              >
                {job ? progressLabel : "Carregando…"}
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
                <AnimatePresence mode="wait">
                  {showDeterminateBar ? (
                    <motion.div
                      key="determinate"
                      className={toolProgressFillClass}
                      initial={{ width: 0, opacity: 0.85 }}
                      animate={{ width: `${progressPct}%`, opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                    />
                  ) : (
                    <motion.div
                      key="indeterminate"
                      className={`absolute top-0 h-full w-[38%] animate-loadingBar ${toolProgressFillClass}`}
                      aria-hidden
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={transitionFast}
                    />
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {phase === "not_found" && (
            <motion.p
              key="not_found"
              className="text-center font-medium text-brand-hover/80"
              variants={panelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transitionFast}
            >
              Job não encontrado ou expirado.
            </motion.p>
          )}

          {phase === "failed" && job && (
            <motion.div
              key="failed"
              className="text-center"
              variants={panelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transitionSmooth}
            >
              <motion.p
                className="font-bold text-rose-700"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={transitionFast}
              >
                {isSpedMerge
                  ? "Não foi possível atualizar o arquivo"
                  : isComparacao
                    ? "Não foi possível comparar as planilhas"
                    : isSciPortal
                      ? "Não foi possível conciliar as planilhas"
                      : "Não foi possível gerar a planilha"}
              </motion.p>
              {job.error && (
                <motion.p
                  className="mt-2 text-sm text-rose-600"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...transitionFast, delay: 0.06 }}
                >
                  {job.error}
                </motion.p>
              )}
            </motion.div>
          )}

          {phase === "done" && job?.downloadToken && (
            <motion.div
              key="done"
              className="flex flex-col items-center gap-6 text-center"
              variants={panelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transitionSmooth}
            >
              <motion.div
                className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accentHi text-3xl font-bold text-white shadow-btn ring-4 ring-accentHi/45"
                aria-hidden
                initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 22 }}
              >
                ✓
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...transitionSmooth, delay: 0.12 }}
              >
                <p className="font-display text-lg font-bold text-brand-ink">
                  {isSpedMerge ? "Arquivo pronto" : "Planilha pronta"}
                </p>
                <p className="mt-1 text-sm text-[#347891]">
                  {isSpedMerge
                    ? "Suas alterações na planilha já estão aplicadas no arquivo para download."
                    : isSci
                      ? "O arquivo inclui as abas Produtos, Base e Consolidado (SCI)."
                      : isComparacao
                        ? "A planilha contém as notas da SEFAZ que não foram encontradas no SCI."
                        : isSciPortal
                          ? "A planilha tem 6 abas: Resumo, Em ambas, Só no Portal Nacional, Só no SCI, ⚠ Canceladas no SCI e Duplicados."
                          : isSped
                            ? "Sua planilha está pronta para abrir no programa de planilhas."
                            : "Sua planilha com os dados das notas está pronta para download."}
                </p>
              </motion.div>
              <motion.a
                className="pill-grad-cyan flex w-full max-w-md flex-col items-center gap-2 rounded-full px-5 py-4 text-center text-white shadow-btn"
                href={
                  isSpedMerge
                    ? spedMergeDownloadUrl(job.id, job.downloadToken)
                    : isSci
                      ? sciConsolidadoDownloadUrl(job.id, job.downloadToken)
                      : isComparacao
                        ? comparacaoPlanilhasDownloadUrl(job.id, job.downloadToken)
                        : isSciPortal
                          ? sciPortalNacionalDownloadUrl(job.id, job.downloadToken)
                          : isSped
                            ? spedDownloadUrl(job.id, job.downloadToken)
                            : downloadUrl(job.id, job.downloadToken)
                }
                download={
                  job.fileName ??
                  (isSpedMerge
                    ? "SPED_mesclado.txt"
                    : isSci
                      ? "ProdutosSCI.xlsx"
                      : isComparacao
                        ? "Notas Faltantes.xlsx"
                        : isSciPortal
                          ? "Conciliacao SCI x Portal Nacional.xlsx"
                          : isSped
                            ? "SPED_Convertido.xlsx"
                            : "NFE_Itens.xlsx")
                }
                title={
                  job.fileName ??
                  (isSpedMerge
                    ? "SPED_mesclado.txt"
                    : isSci
                      ? "ProdutosSCI.xlsx"
                      : isComparacao
                        ? "Notas Faltantes.xlsx"
                        : isSciPortal
                          ? "Conciliacao SCI x Portal Nacional.xlsx"
                          : isSped
                            ? "SPED_Convertido.xlsx"
                            : "NFE_Itens.xlsx")
                }
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...transitionSmooth, delay: 0.2 }}
                whileHover={{ scale: 1.02, filter: "brightness(1.06)" }}
                whileTap={{ scale: 0.98 }}
              >
                <span className="font-display text-[15px] font-bold uppercase tracking-wide">
                  {isSpedMerge ? "Baixar arquivo" : "Baixar planilha"}
                </span>
                <span className="w-full break-all font-sans text-[12px] font-medium normal-case leading-snug tracking-normal text-white/95">
                  {job.fileName ??
                    (isSpedMerge
                      ? "SPED_mesclado.txt"
                      : isSci
                        ? "ProdutosSCI.xlsx"
                        : isComparacao
                          ? "Notas Faltantes.xlsx"
                          : isSciPortal
                            ? "Conciliacao SCI x Portal Nacional.xlsx"
                            : isSped
                              ? "SPED_Convertido.xlsx"
                              : "NFE_Itens.xlsx")}
                </span>
              </motion.a>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          className="mt-8 border-t border-brand-line/80 pt-6 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...transitionSmooth, delay: 0.28 }}
        >
          <motion.div whileHover={{ x: -2 }} transition={transitionFast}>
            <Link
              to={
                isSpedMerge
                  ? "/tools/sped-merge"
                  : isSci
                    ? "/tools/sci-consolidado"
                    : isComparacao
                      ? "/tools/comparacao-planilhas"
                      : isSciPortal
                        ? "/tools/sci-portal-nacional"
                        : isSped
                          ? "/tools/sped"
                          : "/tools/nfe"
              }
              className="font-display text-sm font-bold text-accent underline-offset-4 hover:text-accent2 hover:underline"
            >
              ← Nova conversão
            </Link>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
