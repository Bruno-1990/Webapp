import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { RegistryModal } from "../extratoEdit/RegistryModal.js";
import { lookupCnpj, fetchCounts, type Counts, type EntidadeTipo } from "../extratoEdit/registryApi.js";

const PREVIEW_ROWS = 20;

/** Rótulo da coluna de CNPJ anexada (vinda do cadastro). */
const CNPJ_COLUMN_LABEL = "CNPJ";

/**
 * Acha a coluna de código de cliente/fornecedor no extrato e o tipo associado.
 * Prioriza rótulos explícitos ("Cód. Fornecedor"/"Cód. Cliente"); senão usa
 * qualquer coluna de código e infere o tipo pelo formato detectado.
 */
function detectCodeColumn(
  headers: string[],
  profile: ParsedExtrato["meta"]["profile"],
): { colIndex: number; tipo: EntidadeTipo; label: string } | null {
  const norm = headers.map((h, i) => ({ i, n: normalizeLabel(h) }));
  for (const { i, n } of norm) {
    if (/\bcod/.test(n) && /fornecedor/.test(n)) return { colIndex: i, tipo: "fornecedor", label: headers[i] };
  }
  for (const { i, n } of norm) {
    if (/\bcod/.test(n) && /cliente/.test(n)) return { colIndex: i, tipo: "cliente", label: headers[i] };
  }
  const anyCod = norm.find(({ n }) => /\bcod/.test(n));
  if (anyCod) {
    const tipo: EntidadeTipo = profile === "titulos-recebidos" ? "cliente" : "fornecedor";
    return { colIndex: anyCod.i, tipo, label: headers[anyCod.i] };
  }
  return null;
}

function codeText(v: Cell): string {
  return v == null ? "" : String(v).trim();
}

/**
 * Comparação de rótulos por forma normalizada (sem acento/pontuação). As colunas
 * marcadas por padrão vêm do parser (`recommended`), conforme o formato detectado.
 * Se nenhuma bater (planilha de outro formato), todas começam marcadas para a
 * ferramenta seguir útil.
 */
function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type ColumnState = {
  /** Índice da coluna na planilha parseada (headers/rows originais). -1 se virtual. */
  source: number;
  label: string;
  include: boolean;
  /** Coluna calculada (não vem da planilha): CNPJ vindo do cadastro. */
  virtual?: "cnpj";
};

/** Valor de uma célula para preview/exportação, resolvendo a coluna virtual de CNPJ. */
function cellForColumn(col: ColumnState, row: Cell[], rowIndex: number, cnpjByRow: string[]): Cell {
  if (col.virtual === "cnpj") return cnpjByRow[rowIndex] ?? "";
  return row[col.source];
}

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
  /** Barra de "preparando" (3s) que roda ao soltar a planilha antes de ler. */
  const [preparing, setPreparing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Vínculo de CNPJ a partir do cadastro de clientes/fornecedores.
  const [cnpjByRow, setCnpjByRow] = useState<string[]>([]);
  const [codeInfo, setCodeInfo] = useState<{ colIndex: number; tipo: EntidadeTipo; label: string } | null>(null);
  const [cnpjMatched, setCnpjMatched] = useState(0);
  const [linking, setLinking] = useState(false);
  const [registryOpen, setRegistryOpen] = useState(false);
  const [counts, setCounts] = useState<Counts>({ cliente: 0, fornecedor: 0 });

  // Garante que a leitura automática dispare uma única vez por planilha solta.
  const autoReadRef = useRef(false);

  useEffect(() => {
    fetchCounts().then(setCounts).catch(() => undefined);
  }, []);

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    setFile(f);
    setParsed(null);
    setColumns([]);
    setErr(null);
    autoReadRef.current = false;
    // Inicia a barra de 3s; a leitura dispara sozinha quando ela completa.
    setPreparing(true);
  }, []);

  const zone = useDropzone({
    onDrop,
    getFilesFromEvent: getXlsxOnlyFilesFromEvent,
    useFsAccessApi: false,
    multiple: false,
  });

  const readFile = async (target?: File) => {
    const source = target ?? file;
    if (!source) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await parseExtratoFile(source);
      if (result.rows.length === 0) {
        throw new Error("Nenhum lançamento foi encontrado na planilha. Verifique se o arquivo está correto.");
      }
      setParsed(result);
      const recommended = new Set(result.recommended.map(normalizeLabel));
      const anyDefault = recommended.size > 0 && result.headers.some((h) => recommended.has(normalizeLabel(h)));
      const cols: ColumnState[] = result.headers.map((label, i) => ({
        source: i,
        label,
        // Se a planilha tem as colunas recomendadas, marca só elas; senão marca todas.
        include: anyDefault ? recommended.has(normalizeLabel(label)) : true,
      }));
      // Marcadas primeiro (em sequência, na ordem da planilha), depois as desmarcadas.
      const ordered = [...cols.filter((c) => c.include), ...cols.filter((c) => !c.include)];
      setColumns(ordered);
      // Detecta a coluna de código e tenta vincular o CNPJ do cadastro.
      await linkCnpj(result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Busca o CNPJ no cadastro pelo código de cliente/fornecedor e insere/atualiza a
   * coluna virtual "CNPJ" logo após a coluna de código. Tolerante a cadastro vazio
   * (mantém a coluna, só sem preenchimento) e a API offline (não bloqueia a edição).
   */
  const linkCnpj = useCallback(async (result: ParsedExtrato, surfaceError = false) => {
    const info = detectCodeColumn(result.headers, result.meta.profile);
    setCodeInfo(info);
    if (!info) {
      setCnpjByRow([]);
      setCnpjMatched(0);
      return;
    }
    setLinking(true);
    try {
      const codes = result.rows.map((row) => codeText(row[info.colIndex]));
      const distinct = [...new Set(codes.filter((c) => c !== ""))];
      const matches = distinct.length > 0 ? await lookupCnpj(info.tipo, distinct) : {};
      const byRow = codes.map((c) => (c && matches[c] ? matches[c].cnpj : ""));
      setCnpjByRow(byRow);
      setCnpjMatched(byRow.filter((v) => v !== "").length);
      // Insere a coluna CNPJ logo após a coluna de código (se ainda não existir).
      setColumns((prev) => {
        if (prev.some((c) => c.virtual === "cnpj")) return prev;
        const cnpjCol: ColumnState = { source: -1, label: CNPJ_COLUMN_LABEL, include: true, virtual: "cnpj" };
        const pos = prev.findIndex((c) => c.source === info.colIndex);
        const next = [...prev];
        next.splice(pos >= 0 ? pos + 1 : next.length, 0, cnpjCol);
        return next;
      });
    } catch (e) {
      // Cadastro indisponível não impede a edição. No vínculo automático apenas
      // avisa no console; na ação manual (Revincular) mostra o erro ao usuário.
      if (surfaceError) setErr(e instanceof Error ? e.message : String(e));
      else console.warn("Vínculo de CNPJ falhou (seguindo sem vincular):", e);
    } finally {
      setLinking(false);
    }
  }, []);

  /** Reconsulta o cadastro (após o usuário gravar novos clientes/fornecedores). */
  const revincular = useCallback(async () => {
    if (!parsed) return;
    // Atualiza os valores da coluna já existente sem duplicá-la.
    await linkCnpj(parsed, true);
  }, [parsed, linkCnpj]);

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
      const rows = parsed.rows.map((row, ri) => ordered.map((c) => cellForColumn(c, row, ri, cnpjByRow)));
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
    setPreparing(false);
    setCnpjByRow([]);
    setCodeInfo(null);
    setCnpjMatched(0);
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
        className="flex flex-col items-center gap-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.25 }}
      >
        <button
          type="button"
          onClick={() => setRegistryOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border border-[#447f98] bg-white px-5 py-2.5 font-display text-[13px] font-bold uppercase tracking-wide text-[#2d6a82] shadow-sm transition-colors hover:bg-[#eef7fb]"
        >
          <span className="text-base leading-none">+</span> Add. Cliente / Fornecedor
        </button>
        <span className="text-[12px] text-[#2a4f60]">
          Cadastrados: <strong className="text-[#183844]">{counts.cliente}</strong> clientes ·{" "}
          <strong className="text-[#183844]">{counts.fornecedor}</strong> fornecedores
        </span>
      </motion.div>

      <RegistryModal
        open={registryOpen}
        onClose={() => setRegistryOpen(false)}
        onChanged={(c) => {
          setCounts(c);
          void revincular();
        }}
      />

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

            <AnimatePresence mode="wait">
              {preparing ? (
                <motion.div
                  key="preparing"
                  className="space-y-2"
                  aria-live="polite"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={transitionFast}
                >
                  <p className="text-center text-sm font-semibold text-accent">Preparando a planilha…</p>
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-brand-soft ring-1 ring-brand-line/70">
                    <motion.div
                      className={`absolute left-0 top-0 h-full rounded-full ${toolProgressFillClass}`}
                      initial={{ width: "0%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: 3, ease: [0.22, 1, 0.36, 1] }}
                      onAnimationComplete={() => {
                        if (autoReadRef.current) return;
                        autoReadRef.current = true;
                        setPreparing(false);
                        void readFile(file ?? undefined);
                      }}
                    />
                  </div>
                </motion.div>
              ) : busy ? (
                <motion.div
                  key="busy"
                  className="space-y-2"
                  aria-live="polite"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={transitionFast}
                >
                  <p className="text-center text-sm font-semibold text-accent">Lendo a planilha…</p>
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-brand-soft ring-1 ring-brand-line/70">
                    <div className={`absolute top-0 h-full w-[38%] animate-loadingBar ${toolProgressFillClass}`} />
                  </div>
                </motion.div>
              ) : (
                file && (
                  // Fallback manual: só aparece se algo impedir o início automático.
                  <motion.button
                    key="manual"
                    type="button"
                    className={toolPrimaryButtonClass}
                    onClick={() => readFile(file)}
                    whileHover={{ scale: 1.015 }}
                    whileTap={{ scale: 0.985 }}
                    transition={springSnappy}
                  >
                    Ler planilha
                  </motion.button>
                )
              )}
            </AnimatePresence>
          </>
        ) : (
          <div className="space-y-5">
            <ParseSummary parsed={parsed} />

            <CnpjStatus
              codeInfo={codeInfo}
              linking={linking}
              matched={cnpjMatched}
              total={parsed.rows.length}
              counts={counts}
              onOpenRegistry={() => setRegistryOpen(true)}
              onRevincular={() => void revincular()}
            />

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
                      key={col.virtual ?? col.source}
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

            <PreviewTable
              columns={columns}
              rows={previewRows}
              totalRows={parsed.rows.length}
              cnpjByRow={cnpjByRow}
            />

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
  if (m.groupLabel) chips.push({ label: `${m.groupLabel} aplicado`, value: m.groupApplied });
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

function CnpjStatus({
  codeInfo,
  linking,
  matched,
  total,
  counts,
  onOpenRegistry,
  onRevincular,
}: {
  codeInfo: { colIndex: number; tipo: EntidadeTipo; label: string } | null;
  linking: boolean;
  matched: number;
  total: number;
  counts: Counts;
  onOpenRegistry: () => void;
  onRevincular: () => void;
}) {
  if (!codeInfo) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#dbe6ec] bg-[#f7fbfd] px-4 py-2.5 text-[12px] text-[#5b7c8a]">
        <span>
          Nenhuma coluna de <strong>código</strong> de cliente/fornecedor foi detectada — não há como
          vincular o CNPJ automaticamente nesta planilha.
        </span>
        <button
          type="button"
          onClick={onOpenRegistry}
          className="shrink-0 rounded-full border border-[#bddae5] bg-white px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide text-[#2d6a82] transition-colors hover:bg-[#eef7fb]"
        >
          Abrir cadastro
        </button>
      </div>
    );
  }

  const tipoLabel = codeInfo.tipo === "cliente" ? "clientes" : "fornecedores";
  const semCadastro = counts[codeInfo.tipo] === 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#c5dfe8] bg-[#f2fafd] px-4 py-2.5 text-[12px] text-[#2d6a82]">
      <span>
        {linking ? (
          <>Vinculando CNPJ por <strong>{codeInfo.label}</strong>…</>
        ) : semCadastro ? (
          <>
            Coluna <strong>CNPJ</strong> criada por <strong>{codeInfo.label}</strong>, mas não há{" "}
            {tipoLabel} cadastrados ainda. Envie a planilha de cadastro para preencher.
          </>
        ) : (
          <>
            <strong className="text-[#183844]">CNPJ vinculado:</strong> {matched} de {total} lançamentos
            (por <strong>{codeInfo.label}</strong>).
          </>
        )}
      </span>
      <span className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onRevincular}
          disabled={linking}
          className="rounded-full border border-[#bddae5] bg-white px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide text-[#2d6a82] transition-colors hover:bg-[#eef7fb] disabled:opacity-50"
        >
          Revincular
        </button>
        <button
          type="button"
          onClick={onOpenRegistry}
          className="rounded-full border border-[#447f98] bg-[#447f98] px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-[#3a6d83]"
        >
          {semCadastro ? "Cadastrar" : "Cadastro"}
        </button>
      </span>
    </div>
  );
}

function PreviewTable({
  columns,
  rows,
  totalRows,
  cnpjByRow,
}: {
  columns: ColumnState[];
  rows: Cell[][];
  totalRows: number;
  cnpjByRow: string[];
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
                  key={c.virtual ?? c.source}
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
                {visible.map((c) => {
                  const value = cellForColumn(c, row, ri, cnpjByRow);
                  return (
                    <td
                      key={c.virtual ?? c.source}
                      className="max-w-[220px] truncate whitespace-nowrap border-b border-[#eef2f4] px-2.5 py-1 text-[#1e3d4d]"
                      title={displayCell(value)}
                    >
                      {displayCell(value)}
                    </td>
                  );
                })}
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
