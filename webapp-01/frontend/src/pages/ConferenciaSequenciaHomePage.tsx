import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDropzone } from "react-dropzone";

import { fileLabel, getXlsxOnlyFilesFromEvent } from "../dropFiles.js";
import { ToolPageTitle } from "../components/ToolPageTitle.js";
import { Modal } from "../components/Modal.js";
import {
  toolDropzoneClass,
  toolPageShellClass,
  toolPanelClass,
  toolPrimaryButtonClass,
} from "../toolLayout.js";
import { fadeUp, springSnappy, springSoft, transitionFast, transitionSmooth } from "../motion-variants.js";
import {
  type Conferencia,
  type SerieInfo,
  conferirArquivo,
  rotuloPeriodo,
  rotuloSerie,
} from "../conferenciaSequencia/analise.js";
import { exportarConferencia } from "../conferenciaSequencia/exportConferencia.js";

/** Quantas faixas faltantes listar na tela; o resto sai na planilha. */
const MAX_BLOCOS_NA_TELA = 300;

const badgeBase =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium";
const badgeOk = `${badgeBase} border-emerald-300/70 bg-emerald-50 text-emerald-800`;
const badgeFalha = `${badgeBase} border-rose-300/70 bg-rose-50 text-rose-800`;
const badgeAlerta = `${badgeBase} border-amber-300/70 bg-amber-50 text-amber-800`;
const badgeNeutro = `${badgeBase} border-slate-300/70 bg-slate-50 text-slate-700`;

function nf(n: number): string {
  return n.toLocaleString("pt-BR");
}

function CartaoSerie({ s }: { s: SerieInfo }) {
  const blocos = s.blocos.slice(0, MAX_BLOCOS_NA_TELA);
  const ocultos = s.blocos.length - blocos.length;

  return (
    <div className="rounded-xl border border-[#dadee1]/90 bg-white/70 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-[#183844]">{rotuloSerie(s.serie)}</h3>
        {s.primeira != null && (
          <p className="text-sm text-[#347891]">
            {nf(s.primeira)} <span aria-hidden>→</span> {nf(s.ultima ?? s.primeira)}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className={badgeNeutro}>
          <span className="font-display font-bold">{nf(s.doPeriodo.length)}</span> notas
        </span>
        {s.faltantes.length === 0 ? (
          <span className={badgeOk}>sequência completa</span>
        ) : (
          <span className={badgeFalha}>
            <span className="font-display font-bold">{nf(s.faltantes.length)}</span> faltante
            {s.faltantes.length > 1 ? "s" : ""}
          </span>
        )}
        {s.duplicadas.length > 0 && (
          <span className={badgeAlerta}>
            <span className="font-display font-bold">{nf(s.duplicadas.length)}</span> duplicada
            {s.duplicadas.length > 1 ? "s" : ""}
          </span>
        )}
        {s.canceladas.length > 0 && (
          <span className={badgeNeutro}>
            <span className="font-display font-bold">{nf(s.canceladas.length)}</span> cancelada
            {s.canceladas.length > 1 ? "s" : ""}
          </span>
        )}
        {s.mesAnterior.length > 0 && (
          <span className={badgeNeutro}>
            <span className="font-display font-bold">{nf(s.mesAnterior.length)}</span> de mês anterior
          </span>
        )}
      </div>

      {s.mesAnterior.length > 0 && (
        <p className="mt-3 text-[13px] leading-relaxed text-[#4a6b78]">
          Essas notas foram emitidas em{" "}
          <strong>{rotuloPeriodo(s.mesAnterior[0].aamm)}</strong> e só transmitidas neste período.
          Elas pertencem à sequência do mês de origem, então ficaram <strong>fora</strong> da
          contagem de faltantes.
        </p>
      )}

      {blocos.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#347891]">
            Números sem nota
          </p>
          <ul className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
            {blocos.map((b) => (
              <li
                key={`${b.de}-${b.ate}`}
                className="rounded-md bg-rose-50 px-2 py-1 font-mono text-[12px] text-rose-900 ring-1 ring-rose-200/80"
              >
                {b.de === b.ate ? nf(b.de) : `${nf(b.de)} a ${nf(b.ate)}`}
                {b.ate > b.de && (
                  <span className="ml-1 text-rose-500">({nf(b.ate - b.de + 1)})</span>
                )}
              </li>
            ))}
          </ul>
          {ocultos > 0 && (
            <p className="mt-2 text-[12px] text-[#7eaabb]">
              +{nf(ocultos)} faixa(s) não listada(s) aqui — a planilha traz todas.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ConferenciaSequenciaHomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [conf, setConf] = useState<Conferencia | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onDrop = useCallback((aceitos: File[]) => {
    if (aceitos.length === 0) return;
    // Uma planilha por vez: a conferência é sempre de um período só.
    setFile(aceitos[0]);
    setConf(null);
    setErr(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    getFilesFromEvent: getXlsxOnlyFilesFromEvent,
    multiple: false,
    useFsAccessApi: false,
    disabled: busy,
  });

  const conferir = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    setConf(null);
    // Deixa o React pintar o estado "conferindo" antes de travar a thread.
    await new Promise((r) => setTimeout(r, 30));
    try {
      setConf(await conferirArquivo(file));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const baixar = async () => {
    if (!conf) return;
    setBaixando(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      await exportarConferencia(conf);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBaixando(false);
    }
  };

  const reset = () => {
    setFile(null);
    setConf(null);
    setErr(null);
  };

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
          <ToolPageTitle left="SEFAZ" right="Conferência" />
        </motion.div>
        <motion.p
          className="mt-3 text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          Envie a <strong>planilha de notas emitidas</strong> baixada da SEFAZ. Separamos as notas
          por <strong>série</strong> — lendo a série de dentro da chave de acesso, não pela faixa do
          número — e apontamos cada número que ficou sem nota. O processamento acontece no seu
          navegador: a planilha não é enviada para servidores.
        </motion.p>
      </motion.header>

      {!conf && (
        <section {...getRootProps()} className={toolDropzoneClass(isDragActive)}>
          <motion.div
            className="flex min-h-0 w-full flex-col"
            initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: isDragActive ? 1.02 : 1, filter: "blur(0px)" }}
            transition={isDragActive ? springSnappy : { ...transitionSmooth, delay: 0.12 }}
            whileHover={{ scale: isDragActive ? 1.02 : 1.01 }}
            whileTap={{ scale: 0.995 }}
          >
            <input {...getInputProps()} />
            <motion.p
              className="font-display font-semibold text-brand-ink"
              key={isDragActive ? "drag" : "idle"}
              initial={{ opacity: 0.85, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={transitionFast}
            >
              {isDragActive ? "Solte a planilha aqui…" : "Clique para escolher a planilha, ou arraste-a aqui"}
            </motion.p>
            <p className="mt-2 text-sm text-[#347891]">
              Uma planilha por vez (.xlsx ou .xls), no layout do relatório de NFes emitidas.
            </p>
          </motion.div>
        </section>
      )}

      <AnimatePresence mode="popLayout">
        {file && !conf && (
          <motion.div
            key="arquivo"
            className={`flex flex-col p-4 ${toolPanelClass}`}
            initial={{ opacity: 0, y: 28, scale: 0.97, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -16, scale: 0.98, filter: "blur(6px)" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            layout
          >
            <div className="flex items-center justify-between gap-2 rounded-lg bg-brand-soft/90 px-3 py-2 text-sm text-brand-ink ring-1 ring-brand-line/60">
              <span className="min-w-0 truncate" title={fileLabel(file)}>
                {fileLabel(file)}
              </span>
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="shrink-0 text-[11px] font-semibold text-[#7eaabb] underline-offset-2 hover:underline disabled:opacity-50"
              >
                trocar
              </button>
            </div>

            <motion.button
              type="button"
              disabled={busy}
              onClick={conferir}
              className={`mt-4 ${toolPrimaryButtonClass}`}
              whileHover={busy ? undefined : { scale: 1.015 }}
              whileTap={busy ? undefined : { scale: 0.985 }}
              transition={springSnappy}
            >
              {busy ? "Conferindo…" : "Conferir sequência"}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={!!err} onClose={() => setErr(null)} tone="error" title="Algo deu errado" message={err} />

      <AnimatePresence>
        {conf && (
          <motion.div
            key="resultado"
            className={`flex flex-col gap-4 p-5 ${toolPanelClass}`}
            initial={{ opacity: 0, y: 24, scale: 0.98, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -12, filter: "blur(4px)" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            layout
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-[#1e3d4d]">
                <strong>{nf(conf.notas.length)}</strong> notas · período{" "}
                <strong>{rotuloPeriodo(conf.periodo)}</strong> ·{" "}
                <strong>{conf.series.length}</strong> série
                {conf.series.length > 1 ? "s" : ""}
              </p>
              {conf.totalFaltantes === 0 ? (
                <span className={badgeOk}>nenhum número faltando</span>
              ) : (
                <span className={badgeFalha}>
                  <span className="font-display font-bold">{nf(conf.totalFaltantes)}</span> número(s)
                  sem nota
                </span>
              )}
            </div>

            {conf.ignoradas > 0 && (
              <p className="text-[13px] text-[#a06a2c]">
                {nf(conf.ignoradas)} linha(s) foram ignoradas por não ter chave de acesso nem número
                utilizável.
              </p>
            )}

            <div className="flex flex-col gap-3">
              {conf.series.map((s) => (
                <CartaoSerie key={s.serie} s={s} />
              ))}
            </div>

            <motion.button
              type="button"
              disabled={baixando}
              onClick={baixar}
              className={toolPrimaryButtonClass}
              whileHover={baixando ? undefined : { scale: 1.015 }}
              whileTap={baixando ? undefined : { scale: 0.985 }}
              transition={springSnappy}
            >
              {baixando ? "Gerando planilha…" : "Baixar planilha da conferência"}
            </motion.button>

            <button
              type="button"
              onClick={reset}
              className="text-center text-[12px] font-semibold text-[#7eaabb] underline-offset-2 hover:underline"
            >
              conferir outra planilha
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
