import { useCallback, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDropzone } from "react-dropzone";
import { GripVertical } from "lucide-react";
import { fileLabel, getXlsxOnlyFilesFromEvent } from "../dropFiles.js";
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
import { parseExtratoFile, type Cell, type ParsedExtrato } from "../extratoEdit/parseExtrato.js";
import { exportExtrato } from "../extratoEdit/exportExtrato.js";

const PREVIEW_ROWS = 20;

/**
 * Colunas marcadas por padrão (as demais começam desmarcadas). Comparação por
 * rótulo normalizado (sem acento/pontuação). Se nenhuma bater (planilha de outro
 * formato), todas começam marcadas para a ferramenta seguir útil.
 */
const DEFAULT_INCLUDE = new Set([
  "data",
  "conta",
  "fornecedor",
  "historico",
  "n nota",
  "vlr titulo",
  "bco",
]);

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type ColumnState = {
  /** Índice da coluna na planilha parseada (headers/rows originais). */
  source: number;
  label: string;
  include: boolean;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function displayCell(v: Cell): string {
  if (v == null) return "";
  if (v instanceof Date) {
    const dd = String(v.getUTCDate()).padStart(2, "0");
    const mm = String(v.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${v.getUTCFullYear()}`;
  }
  return String(v);
}

function outputFileName(inputName: string): string {
  const base = inputName.replace(/\.xlsx$/i, "");
  return `${base} - editado.xlsx`;
}

export default function ExtratoEditHomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedExtrato | null>(null);
  const [columns, setColumns] = useState<ColumnState[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) setFile(accepted[0]);
    setErr(null);
  }, []);

  const zone = useDropzone({
    onDrop,
    getFilesFromEvent: getXlsxOnlyFilesFromEvent,
    useFsAccessApi: false,
    multiple: false,
  });

  const readFile = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await parseExtratoFile(file);
      if (result.rows.length === 0) {
        throw new Error("Nenhum lançamento foi encontrado na planilha. Verifique se o arquivo está correto.");
      }
      setParsed(result);
      const anyDefault = result.headers.some((h) => DEFAULT_INCLUDE.has(normalizeLabel(h)));
      const cols: ColumnState[] = result.headers.map((label, i) => ({
        source: i,
        label,
        // Se a planilha tem as colunas conhecidas, marca só elas; senão marca todas.
        include: anyDefault ? DEFAULT_INCLUDE.has(normalizeLabel(label)) : true,
      }));
      // Marcadas primeiro (em sequência, na ordem da planilha), depois as desmarcadas.
      setColumns([...cols.filter((c) => c.include), ...cols.filter((c) => !c.include)]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleColumn = (index: number) =>
    setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, include: !c.include } : c)));

  const reorder = (from: number, to: number) =>
    setColumns((prev) => {
      if (from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

  const onDragStart = (i: number) => setDragIndex(i);
  const onDragOverItem = (i: number) => {
    if (dragIndex == null || i === overIndex) return;
    setOverIndex(i);
  };
  const onDropItem = (i: number) => {
    if (dragIndex != null) reorder(dragIndex, i);
    setDragIndex(null);
    setOverIndex(null);
  };
  const onDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const includedCount = columns.filter((c) => c.include).length;

  const previewRows = useMemo(() => parsed?.rows.slice(0, PREVIEW_ROWS) ?? [], [parsed]);

  const conclude = async () => {
    if (!parsed || !file) return;
    const ordered = columns.filter((c) => c.include);
    if (ordered.length === 0) {
      setErr("Selecione pelo menos uma coluna para exportar.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const headers = ordered.map((c) => c.label);
      const rows = parsed.rows.map((row) => ordered.map((c) => row[c.source]));
      await exportExtrato(headers, rows, outputFileName(file.name));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setParsed(null);
    setColumns([]);
    setFile(null);
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
          <ToolPageTitle left="Editor de Extrato" right="XLSX" />
        </motion.div>
        <motion.p
          className="mt-3 text-[15px] leading-relaxed text-[#1e3d4d]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          Envie a planilha do extrato, ajuste as colunas (arraste para reordenar, marque o que exportar) e
          baixe um <strong>.xlsx</strong> limpo e formatado.
        </motion.p>
      </motion.header>

      <motion.div
        className={`space-y-6 p-8 ${toolPanelClass}`}
        initial={{ opacity: 0, y: 22, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={springSoft}
      >
        <Modal open={!!err} onClose={() => setErr(null)} tone="error" title="Algo deu errado" message={err} />

        {!parsed ? (
          <>
            <section {...zone.getRootProps()} className={toolDropzoneClass(zone.isDragActive)}>
              <motion.div
                className="flex min-h-0 w-full flex-col"
                initial={{ opacity: 0, y: 20, scale: 0.98, filter: "blur(6px)" }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: zone.isDragActive ? 1.02 : 1,
                  filter: "blur(0px)",
                }}
                transition={zone.isDragActive ? springSnappy : { ...transitionSmooth, delay: 0.12 }}
                whileHover={{ scale: zone.isDragActive ? 1.02 : 1.01 }}
                whileTap={{ scale: 0.995 }}
              >
                <input {...zone.getInputProps()} />
                <motion.p
                  className="font-display text-lg font-bold text-[#183844]"
                  key={zone.isDragActive ? "drag" : "idle"}
                  initial={{ opacity: 0.85, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={transitionFast}
                >
                  {zone.isDragActive ? "Solte a planilha…" : "Arraste ou clique para escolher o .xlsx"}
                </motion.p>
                <p className="mt-2 text-sm text-[#2a4f60]">Um arquivo Excel (.xlsx) por vez.</p>
                {file && (
                  <p className="mt-3 text-xs text-accent">
                    {fileLabel(file)} · {formatBytes(file.size)}
                  </p>
                )}
              </motion.div>
            </section>

            {busy && (
              <div className="space-y-2" aria-live="polite">
                <p className="text-center text-sm font-semibold text-accent">Lendo a planilha…</p>
                <div className="relative h-3 w-full overflow-hidden rounded-full bg-brand-soft ring-1 ring-brand-line/70">
                  <div className={`absolute top-0 h-full w-[38%] animate-loadingBar ${toolProgressFillClass}`} />
                </div>
              </div>
            )}

            <motion.button
              type="button"
              className={toolPrimaryButtonClass}
              onClick={readFile}
              disabled={!file || busy}
              whileHover={!file || busy ? undefined : { scale: 1.015 }}
              whileTap={!file || busy ? undefined : { scale: 0.985 }}
              transition={springSnappy}
            >
              Ler planilha
            </motion.button>
          </>
        ) : (
          <div className="space-y-5">
            <ParseSummary parsed={parsed} />

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#347891]">
                Colunas ({includedCount} de {columns.length} marcadas)
              </p>
              <p className="text-[11px] text-[#7eaabb]">
                Arraste pela alça para reordenar. Desmarque as que não devem ser exportadas.
              </p>
              <ul className="flex flex-wrap gap-2">
                <AnimatePresence initial={false}>
                  {columns.map((col, i) => (
                    <motion.li
                      key={col.source}
                      layout
                      draggable
                      onDragStart={() => onDragStart(i)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        onDragOverItem(i);
                      }}
                      onDrop={() => onDropItem(i)}
                      onDragEnd={onDragEnd}
                      transition={transitionFast}
                      className={[
                        "flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs transition-colors",
                        col.include
                          ? "border-[#9ec8d8] bg-white text-[#1e3d4d]"
                          : "border-dashed border-[#cdd9df] bg-[#f3f7f9] text-[#9bb4c0] line-through",
                        overIndex === i && dragIndex !== i ? "ring-2 ring-[#447f98]/45" : "",
                        dragIndex === i ? "opacity-50" : "",
                      ].join(" ")}
                    >
                      <GripVertical className="h-3.5 w-3.5 cursor-grab text-[#7eaabb]" />
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={col.include}
                          onChange={() => toggleColumn(i)}
                          className="h-3.5 w-3.5 accent-[#447f98]"
                        />
                        <span className="max-w-[180px] truncate" title={col.label}>
                          {col.label}
                        </span>
                      </label>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>

            <PreviewTable columns={columns} rows={previewRows} totalRows={parsed.rows.length} />

            <div className="space-y-3">
              <motion.button
                type="button"
                className={toolPrimaryButtonClass}
                onClick={conclude}
                disabled={busy || includedCount === 0}
                whileHover={busy || includedCount === 0 ? undefined : { scale: 1.015 }}
                whileTap={busy || includedCount === 0 ? undefined : { scale: 0.985 }}
                transition={springSnappy}
              >
                {busy ? "Gerando…" : "Concluir e baixar"}
              </motion.button>
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="w-full rounded-full border border-[#bddae5] bg-white py-3 text-[13px] font-display font-bold uppercase tracking-wide text-[#2d6a82] transition-colors hover:bg-[#eef7fb] disabled:opacity-50"
              >
                Trocar arquivo
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function ParseSummary({ parsed }: { parsed: ParsedExtrato }) {
  const m = parsed.meta;
  const chips: Array<{ label: string; value: number | string }> = [
    { label: "Lançamentos", value: parsed.rows.length },
  ];
  if (m.hasDateColumn) chips.push({ label: "Datas aplicadas", value: m.datesExploded });
  if (m.blankRemoved) chips.push({ label: "Linhas em branco removidas", value: m.blankRemoved });
  if (m.totalsRemoved) chips.push({ label: "Linhas de resumo removidas", value: m.totalsRemoved });
  if (m.headerRepeatsRemoved) chips.push({ label: "Cabeçalhos repetidos removidos", value: m.headerRepeatsRemoved });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <span
            key={c.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#c5dfe8] bg-[#f2fafd] px-3 py-1 text-[12px] font-medium text-[#2d6a82]"
          >
            <span className="font-display font-bold text-[#183844]">{c.value}</span>
            {c.label}
          </span>
        ))}
      </div>
      {m.usedFallback && (
        <p className="text-[11px] text-amber-700">
          Formato não reconhecido como relatório de pagamentos — importado de forma genérica (1ª linha como
          cabeçalho).
        </p>
      )}
    </div>
  );
}

function PreviewTable({
  columns,
  rows,
  totalRows,
}: {
  columns: ColumnState[];
  rows: Cell[][];
  totalRows: number;
}) {
  /** Só colunas marcadas, na ordem atual (reflete o arrasto) — igual ao que será exportado. */
  const visible = columns.filter((c) => c.include);

  if (visible.length === 0) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#347891]">Pré-visualização</p>
        <div className="rounded-xl border border-dashed border-[#cdd9df] bg-[#f7fbfd] px-4 py-8 text-center text-[12px] text-[#7eaabb]">
          Nenhuma coluna marcada — selecione ao menos uma para ver a prévia.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#347891]">
        Pré-visualização <span className="font-normal text-[#7eaabb]">(só colunas marcadas)</span>
      </p>
      <div className="max-h-80 overflow-auto rounded-xl border border-[#d4e4eb] bg-white">
        <table className="min-w-full border-collapse text-left text-[11px]">
          <thead className="sticky top-0 bg-[#eef6fb]">
            <tr>
              {visible.map((c) => (
                <th
                  key={c.source}
                  className="whitespace-nowrap border-b border-[#d4e4eb] px-2.5 py-1.5 font-semibold text-[#183844]"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="odd:bg-white even:bg-[#f7fbfd]">
                {visible.map((c) => (
                  <td
                    key={c.source}
                    className="max-w-[220px] truncate whitespace-nowrap border-b border-[#eef2f4] px-2.5 py-1 text-[#1e3d4d]"
                    title={displayCell(row[c.source])}
                  >
                    {displayCell(row[c.source])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalRows > rows.length && (
        <p className="text-[11px] text-[#7eaabb]">
          Mostrando {rows.length} de {totalRows} lançamentos. Todos entram na exportação.
        </p>
      )}
    </div>
  );
}
