import { type InputHTMLAttributes, type MouseEvent as ReactMouseEvent, useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDropzone } from "react-dropzone";
import {
  fileLabel,
  getXmlOnlyFilesFromEvent,
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
import { fadeUp, springSnappy, springSoft, transitionFast, transitionSmooth } from "../motion-variants.js";
import { generateDanfseZip, type GenResult, type RetencaoItem } from "../nfsePdf/generateZip.js";
import { downloadRetencaoPdf, downloadRetencaoReport } from "../nfsePdf/retencaoReport.js";
import { fmtBRL } from "../nfsePdf/format.js";

type ReportKind = "retencao" | "todas";
type ReportFmt = "xlsx" | "pdf";
type ReportBusy = { kind: ReportKind; fmt: ReportFmt } | null;

/** webkitdirectory faz o <input> abrir como picker de pasta (fallback p/ Firefox/Safari). */
const FOLDER_INPUT_ATTRS = {
  webkitdirectory: "",
  directory: "",
  mozdirectory: "",
} as unknown as InputHTMLAttributes<HTMLInputElement>;

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

export default function NfsePdfHomePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<GenResult | null>(null);
  const [reportBusy, setReportBusy] = useState<ReportBusy>(null);
  const [err, setErr] = useState<string | null>(null);

  const baixarRelatorio = async (kind: ReportKind, fmt: ReportFmt) => {
    if (!result) return;
    const items = kind === "retencao" ? result.retencoes : result.todas;
    if (items.length === 0) return;
    setReportBusy({ kind, fmt });
    try {
      if (kind === "retencao") {
        if (fmt === "pdf") await downloadRetencaoPdf(items);
        else await downloadRetencaoReport(items);
      } else {
        if (fmt === "pdf") {
          await downloadRetencaoPdf(items, "NFS-e - Todas as notas.pdf", {
            title: "Relatório de NFS-e — Todas as notas",
            subtitle: `${items.length} nota(s)`,
          });
        } else {
          await downloadRetencaoReport(items, "NFS-e - Todas as notas.xlsx", "Todas as notas");
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReportBusy(null);
    }
  };

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => dedupe(prev, accepted));
    setErr(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    getFilesFromEvent: getXmlOnlyFilesFromEvent,
    useFsAccessApi: false,
  });

  /**
   * Em Chrome/Edge usamos o picker de pasta nativo (sem o alert "Carregar N
   * arquivos…"). Em Firefox/Safari deixamos o react-dropzone abrir o
   * <input webkitdirectory>.
   */
  const usesNativeDirPicker = supportsDirectoryPicker();
  const handlePickDir = useCallback(async () => {
    try {
      const picked = await pickDirectoryAndReadFiles("xml-only");
      if (!picked) return;
      setFiles((prev) => dedupe(prev, picked));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  const onZoneClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!usesNativeDirPicker) return; // deixa o react-dropzone abrir o input
      e.preventDefault();
      e.stopPropagation();
      void handlePickDir();
    },
    [usesNativeDirPicker, handlePickDir],
  );

  const removeAt = (i: number) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    setProgress({ done: 0, total: files.length });
    try {
      const r = await generateDanfseZip(files, (done, total) => setProgress({ done, total }));
      setResult(r);
      if (r.geradosNfse + r.geradosEvento === 0) {
        setErr("Nenhum XML de NFS-e válido foi encontrado nos arquivos enviados.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const reset = () => {
    setFiles([]);
    setResult(null);
    setErr(null);
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

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
          <ToolPageTitle left="NFS-e" right="PDF" />
        </motion.div>
        <motion.p
          className="mt-3 text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          Selecione a <strong>pasta com os XMLs de NFS-e</strong>: cada nota vira um PDF no layout do DANFSe e você
          baixa tudo num <strong>.zip</strong>. O processamento acontece no seu navegador — nada é enviado para servidores.
        </motion.p>
      </motion.header>

      {!result && (
        <section {...getRootProps({ onClick: onZoneClick })} className={toolDropzoneClass(isDragActive)}>
          <motion.div
            className="flex min-h-0 w-full flex-col"
            initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: isDragActive ? 1.02 : 1, filter: "blur(0px)" }}
            transition={isDragActive ? springSnappy : { ...transitionSmooth, delay: 0.12 }}
            whileHover={{ scale: isDragActive ? 1.02 : 1.01 }}
            whileTap={{ scale: 0.995 }}
          >
            <input {...getInputProps(FOLDER_INPUT_ATTRS)} />
            <motion.p
              className="font-display font-semibold text-brand-ink"
              animate={{ opacity: 1, y: 0 }}
              key={isDragActive ? "drag" : "idle"}
              initial={{ opacity: 0.85, y: 4 }}
              transition={transitionFast}
            >
              {isDragActive ? "Solte a pasta com os XMLs…" : "Clique para escolher a pasta, ou arraste-a aqui"}
            </motion.p>
            <p className="mt-2 text-sm text-[#347891]">Todos os .xml dentro da pasta são lidos automaticamente. Eventos de cancelamento também geram PDF.</p>
          </motion.div>
        </section>
      )}

      <AnimatePresence mode="popLayout">
        {files.length > 0 && !result && (
          <motion.div
            key="files-panel"
            className={`flex flex-col p-4 ${toolPanelClass}`}
            initial={{ opacity: 0, y: 28, scale: 0.97, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -16, scale: 0.98, filter: "blur(6px)" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            layout
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#347891]">
                {files.length} arquivo{files.length > 1 ? "s" : ""}
              </p>
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="text-[11px] font-semibold text-[#7eaabb] underline-offset-2 hover:underline disabled:opacity-50"
              >
                limpar tudo
              </button>
            </div>
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
                    transition={{ ...transitionSmooth, delay: Math.min(i * 0.02, 0.3) }}
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
                      disabled={busy}
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
              whileHover={busy ? undefined : { scale: 1.015 }}
              whileTap={busy ? undefined : { scale: 0.985 }}
              transition={springSnappy}
            >
              {busy ? "Gerando PDFs…" : "Gerar PDFs e baixar .zip"}
            </motion.button>

            <AnimatePresence>
              {busy && (
                <motion.div
                  key="progress"
                  className="mt-4 space-y-2"
                  aria-live="polite"
                  initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -6, filter: "blur(3px)" }}
                  transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                >
                  <p className="text-center text-xs font-semibold text-accent">
                    {progress ? `Gerando ${progress.done} de ${progress.total}…` : "Preparando…"}
                  </p>
                  <div
                    className="relative h-3 w-full overflow-hidden rounded-full bg-brand-soft ring-1 ring-brand-line/70"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                  >
                    <motion.div
                      className={toolProgressFillClass}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={!!err} onClose={() => setErr(null)} tone="error" title="Algo deu errado" message={err} />

      <AnimatePresence>
        {result && result.geradosNfse + result.geradosEvento > 0 && (
          <motion.div
            key="result-panel"
            className={`flex flex-col gap-4 p-5 ${toolPanelClass}`}
            initial={{ opacity: 0, y: 24, scale: 0.98, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -12, filter: "blur(4px)" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            layout
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/70 bg-emerald-50 px-3 py-1 text-[12px] font-medium text-emerald-800">
                <span className="font-display font-bold">{result.geradosNfse}</span> DANFSe
              </span>
              {result.geradosEvento > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#c5dfe8] bg-[#f2fafd] px-3 py-1 text-[12px] font-medium text-[#2d6a82]">
                  <span className="font-display font-bold">{result.geradosEvento}</span> evento(s)
                </span>
              )}
              {result.ignorados.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-50 px-3 py-1 text-[12px] font-medium text-amber-800">
                  <span className="font-display font-bold">{result.ignorados.length}</span> ignorado(s)
                </span>
              )}
              <button
                type="button"
                onClick={reset}
                className="ml-auto text-[11px] font-semibold text-[#7eaabb] hover:underline"
              >
                novos arquivos
              </button>
            </div>

            {result.retencoes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#cdd9df] bg-[#f7fbfd] px-4 py-6 text-center text-[13px] text-[#52636b]">
                Nenhuma retenção encontrada nos {result.geradosNfse} XML(s) de NFS-e analisados.
              </div>
            ) : (
              <ReportBlock
                title={`Notas com retenção (${result.retencoes.length})`}
                items={result.retencoes}
                reportBusy={reportBusy}
                onDownload={(fmt) => baixarRelatorio("retencao", fmt)}
                kind="retencao"
              />
            )}

            {result.todas.length > 0 && (
              <ReportBlock
                title={`Todas as notas (${result.todas.length})`}
                items={result.todas}
                reportBusy={reportBusy}
                onDownload={(fmt) => baixarRelatorio("todas", fmt)}
                kind="todas"
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Valor monetário ou travessão quando zero. */
function cell(v: number): string {
  return v > 0 ? fmtBRL(v) : "—";
}

/** Soma uma coluna numérica dos itens do relatório. */
function sumCol(items: RetencaoItem[], key: keyof RetencaoItem): number {
  return items.reduce((s, it) => {
    const v = it[key];
    return s + (typeof v === "number" ? v : 0);
  }, 0);
}

const TABLE_HEADERS = [
  "Nº NFS-e",
  "Prestador",
  "Mun. Incid. ISSQN",
  "Cód. Trib.",
  "Descrição do Serviço",
  "Valor Bruto",
  "Valor Líquido",
  "ISSQN",
  "IRRF",
  "Prev. (INSS)",
  "Contrib. Sociais",
  "Total Federais",
] as const;

/** Bloco de relatório: cabeçalho com downloads + tabela com linha de totais. */
function ReportBlock({
  title,
  items,
  reportBusy,
  onDownload,
  kind,
}: {
  title: string;
  items: RetencaoItem[];
  reportBusy: ReportBusy;
  onDownload: (fmt: ReportFmt) => void;
  kind: ReportKind;
}) {
  const busyHere = (fmt: ReportFmt) => reportBusy?.kind === kind && reportBusy.fmt === fmt;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#347891]">{title}</p>
        <div className="flex flex-wrap items-center gap-2">
          <motion.button
            type="button"
            onClick={() => onDownload("xlsx")}
            disabled={reportBusy !== null}
            className="rounded-full bg-gradient-to-br from-[#2f6378] to-[#4583a0] px-4 py-2 text-[12px] font-display font-bold uppercase tracking-wide text-white shadow-sm disabled:opacity-50"
            whileHover={reportBusy ? undefined : { scale: 1.03 }}
            whileTap={reportBusy ? undefined : { scale: 0.97 }}
          >
            {busyHere("xlsx") ? "Gerando…" : "Baixar relatório (.xlsx)"}
          </motion.button>
          <motion.button
            type="button"
            onClick={() => onDownload("pdf")}
            disabled={reportBusy !== null}
            className="rounded-full border border-[#4583a0]/40 bg-white px-4 py-2 text-[12px] font-display font-bold uppercase tracking-wide text-[#2f6378] shadow-sm disabled:opacity-50"
            whileHover={reportBusy ? undefined : { scale: 1.03 }}
            whileTap={reportBusy ? undefined : { scale: 0.97 }}
          >
            {busyHere("pdf") ? "Gerando…" : "Baixar relatório (.pdf)"}
          </motion.button>
        </div>
      </div>
      <div className="max-h-[min(48vh,26rem)] overflow-auto rounded-xl border border-[#d4e4eb] bg-white">
        <table className="min-w-full border-collapse text-left text-[11px]">
          <thead className="sticky top-0 bg-[#eef6fb]">
            <tr>
              {TABLE_HEADERS.map((h) => (
                <th key={h} className="whitespace-nowrap border-b border-[#d4e4eb] px-2.5 py-1.5 font-semibold text-[#183844]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={i} className="odd:bg-white even:bg-[#f7fbfd]">
                <td className="whitespace-nowrap border-b border-[#eef2f4] px-2.5 py-1 font-semibold text-[#1e3d4d]">{r.numero || "—"}</td>
                <td className="max-w-[220px] truncate border-b border-[#eef2f4] px-2.5 py-1 text-[#1e3d4d]" title={r.prestadorNome}>
                  {r.prestadorNome || "—"}
                </td>
                <td className="max-w-[160px] truncate border-b border-[#eef2f4] px-2.5 py-1 text-[#1e3d4d]" title={r.municipioIncidencia}>
                  {r.municipioIncidencia || "—"}
                </td>
                <td className="whitespace-nowrap border-b border-[#eef2f4] px-2.5 py-1 tabular-nums text-[#1e3d4d]">{r.codTribNac || "—"}</td>
                <td className="max-w-[280px] truncate border-b border-[#eef2f4] px-2.5 py-1 text-[#1e3d4d]" title={r.descServico}>
                  {r.descServico || "—"}
                </td>
                <td className="whitespace-nowrap border-b border-[#eef2f4] px-2.5 py-1 text-right font-semibold tabular-nums text-[#0b3a49]">{cell(r.vServ)}</td>
                <td className="whitespace-nowrap border-b border-[#eef2f4] px-2.5 py-1 text-right font-semibold tabular-nums text-[#0b3a49]">{cell(r.vLiq)}</td>
                <td className="whitespace-nowrap border-b border-[#eef2f4] px-2.5 py-1 text-right tabular-nums">{cell(r.issqnRetido)}</td>
                <td className="whitespace-nowrap border-b border-[#eef2f4] px-2.5 py-1 text-right tabular-nums">{cell(r.irrf)}</td>
                <td className="whitespace-nowrap border-b border-[#eef2f4] px-2.5 py-1 text-right tabular-nums">{cell(r.previdenciaria)}</td>
                <td className="whitespace-nowrap border-b border-[#eef2f4] px-2.5 py-1 text-right tabular-nums" title={r.descContribSociais}>{cell(r.contribSociais)}</td>
                <td className="whitespace-nowrap border-b border-[#eef2f4] px-2.5 py-1 text-right font-semibold tabular-nums text-[#0b3a49]">{cell(r.totalFederais)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0">
            <tr className="bg-[#eef6fb] font-semibold text-[#0b3a49]">
              <td className="whitespace-nowrap border-t border-[#d4e4eb] px-2.5 py-1.5" colSpan={5}>
                TOTAL ({items.length})
              </td>
              <td className="whitespace-nowrap border-t border-[#d4e4eb] px-2.5 py-1.5 text-right tabular-nums">{fmtBRL(sumCol(items, "vServ"))}</td>
              <td className="whitespace-nowrap border-t border-[#d4e4eb] px-2.5 py-1.5 text-right tabular-nums">{fmtBRL(sumCol(items, "vLiq"))}</td>
              <td className="whitespace-nowrap border-t border-[#d4e4eb] px-2.5 py-1.5 text-right tabular-nums">{fmtBRL(sumCol(items, "issqnRetido"))}</td>
              <td className="whitespace-nowrap border-t border-[#d4e4eb] px-2.5 py-1.5 text-right tabular-nums">{fmtBRL(sumCol(items, "irrf"))}</td>
              <td className="whitespace-nowrap border-t border-[#d4e4eb] px-2.5 py-1.5 text-right tabular-nums">{fmtBRL(sumCol(items, "previdenciaria"))}</td>
              <td className="whitespace-nowrap border-t border-[#d4e4eb] px-2.5 py-1.5 text-right tabular-nums">{fmtBRL(sumCol(items, "contribSociais"))}</td>
              <td className="whitespace-nowrap border-t border-[#d4e4eb] px-2.5 py-1.5 text-right tabular-nums">{fmtBRL(sumCol(items, "totalFederais"))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
