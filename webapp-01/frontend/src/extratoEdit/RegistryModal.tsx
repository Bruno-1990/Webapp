/**
 * Gestão do cadastro de clientes/fornecedores ("+Add. Cliente / Fornecedor").
 *
 * O usuário escolhe o tipo, sobe a planilha de cadastro (Cód./Nome/CNPJ), confere
 * a prévia e grava no banco. Também lista/busca/exclui o que já existe. Os dados
 * alimentam o vínculo de CNPJ feito ao processar um extrato.
 */
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDropzone } from "react-dropzone";
import { Trash2 } from "lucide-react";
import { getXlsxOnlyFilesFromEvent, fileLabel } from "../dropFiles.js";
import { springSoft, transitionFast } from "../motion-variants.js";
import { toolDropzoneClass } from "../toolLayout.js";
import { parseRegistryFile, type ParsedRegistry } from "./parseRegistry.js";
import {
  importEntidades,
  listEntidades,
  deleteEntidade,
  clearTipo,
  fetchCounts,
  type EntidadeTipo,
  type Entidade,
  type Counts,
} from "./registryApi.js";

const TIPOS: Array<{ key: EntidadeTipo; label: string }> = [
  { key: "cliente", label: "Clientes" },
  { key: "fornecedor", label: "Fornecedores" },
];

export function RegistryModal({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** Avisa a página para reconsultar contagens/CNPJs após gravar. */
  onChanged?: (counts: Counts) => void;
}) {
  const [tipo, setTipo] = useState<EntidadeTipo>("cliente");
  const [counts, setCounts] = useState<Counts>({ cliente: 0, fornecedor: 0 });
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedRegistry | null>(null);
  const [parsing, setParsing] = useState(false);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Entidade[]>([]);
  const [total, setTotal] = useState(0);

  const refreshList = useCallback(
    async (t: EntidadeTipo, q: string) => {
      try {
        const res = await listEntidades({ tipo: t, q, limit: 100 });
        setItems(res.items);
        setTotal(res.total);
        setCounts(res.counts);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    fetchCounts().then(setCounts).catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void refreshList(tipo, query);
  }, [open, tipo, query, refreshList]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onDrop = useCallback(async (accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    setFile(f);
    setParsed(null);
    setErr(null);
    setOkMsg(null);
    setParsing(true);
    try {
      const result = await parseRegistryFile(f);
      setParsed(result);
      // A planilha Totvs identifica o tipo (CODFORNEC/CODCLI) — sincroniza o toggle.
      if (result.detectedTipo) setTipo(result.detectedTipo);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setFile(null);
    } finally {
      setParsing(false);
    }
  }, []);

  const zone = useDropzone({
    onDrop,
    getFilesFromEvent: getXlsxOnlyFilesFromEvent,
    useFsAccessApi: false,
    multiple: false,
  });

  const doImport = async () => {
    if (!parsed) return;
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      // O tipo detectado na planilha prevalece sobre o toggle (evita gravar no lado errado).
      const importTipo = parsed.detectedTipo ?? tipo;
      const res = await importEntidades(importTipo, parsed.rows, replace);
      setCounts(res.counts);
      setOkMsg(
        `Gravado: ${res.inserted} novo(s), ${res.updated} atualizado(s)` +
          (res.ignored ? `, ${res.ignored} ignorado(s)` : "") +
          ".",
      );
      setFile(null);
      setParsed(null);
      setReplace(false);
      onChanged?.(res.counts);
      await refreshList(tipo, query);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (codigo: string) => {
    try {
      const c = await deleteEntidade(tipo, codigo);
      setCounts(c);
      onChanged?.(c);
      await refreshList(tipo, query);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const doClear = async () => {
    if (!window.confirm(`Apagar TODOS os ${tipo === "cliente" ? "clientes" : "fornecedores"} cadastrados?`)) {
      return;
    }
    setBusy(true);
    try {
      const c = await clearTipo(tipo);
      setCounts(c);
      onChanged?.(c);
      await refreshList(tipo, query);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="registry-root"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transitionFast}
          role="dialog"
          aria-modal="true"
          aria-labelledby="registry-title"
        >
          <motion.div
            className="absolute inset-0 bg-[#0b1f29]/55 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transitionFast}
          />
          <motion.div
            className="relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[#dadee1] bg-white shadow-[0_20px_50px_-12px_rgb(24_56_68/0.35)] ring-4 ring-[#629bb5]/25"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={springSoft}
          >
            <div className="h-1 w-full bg-gradient-to-r from-[#347891] via-[#447f98] to-[#629bb5]" />

            <div className="flex items-start justify-between gap-3 px-6 pt-5">
              <div>
                <h3
                  id="registry-title"
                  className="font-display text-lg font-bold uppercase tracking-wide text-[#183844]"
                >
                  Clientes &amp; Fornecedores
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-[#2a4f60]">
                  Suba a planilha de cadastro (Código, Nome e CNPJ). Esses dados ficam guardados e o
                  CNPJ é vinculado pelo código quando você processa um extrato.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar"
                className="shrink-0 rounded-full p-1 text-[#629bb5] transition-colors hover:bg-[#eef6fb] hover:text-[#347891]"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4l10 10M14 4L4 14" />
                </svg>
              </button>
            </div>

            {/* Toggle de tipo */}
            <div className="flex gap-2 px-6 pt-4">
              {TIPOS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTipo(t.key);
                    setFile(null);
                    setParsed(null);
                    setErr(null);
                    setOkMsg(null);
                  }}
                  className={[
                    "flex-1 rounded-xl border px-3 py-2 text-sm font-display font-bold uppercase tracking-wide transition-colors",
                    tipo === t.key
                      ? "border-[#447f98] bg-[#447f98] text-white"
                      : "border-[#bddae5] bg-white text-[#2d6a82] hover:bg-[#eef7fb]",
                  ].join(" ")}
                >
                  {t.label}
                  <span className="ml-1.5 text-xs font-normal opacity-80">({counts[t.key]})</span>
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
              {err && (
                <div className="rounded-xl border border-rose-200 bg-[#fdeff1] px-4 py-2.5 text-[13px] font-medium text-rose-900">
                  {err}
                </div>
              )}
              {okMsg && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] font-medium text-emerald-800">
                  {okMsg}
                </div>
              )}

              {/* Upload */}
              <section {...zone.getRootProps()} className={toolDropzoneClass(zone.isDragActive)}>
                <input {...zone.getInputProps()} />
                <div className="flex flex-col">
                  <p className="font-display text-[15px] font-bold text-[#183844]">
                    {parsing
                      ? "Lendo planilha…"
                      : zone.isDragActive
                        ? "Solte a planilha…"
                        : `Arraste ou clique para enviar a planilha de ${tipo === "cliente" ? "clientes" : "fornecedores"}`}
                  </p>
                  <p className="mt-1 text-xs text-[#2a4f60]">
                    Excel (.xlsx). Reconhece os exports do Totvs/PC (CODCLI/CODFORNEC, CGC/CGCENT) ou
                    colunas Código, Nome e CNPJ.
                  </p>
                  {file && parsed && (
                    <p className="mt-2 text-xs text-accent">
                      {fileLabel(file)} · {parsed.rows.length} registro(s)
                      {parsed.detectedTipo ? ` · detectado: ${parsed.detectedTipo === "cliente" ? "clientes" : "fornecedores"}` : ""}
                      {parsed.labels.codigo ? ` · colunas: ${parsed.labels.codigo}/${parsed.labels.nome || "—"}/${parsed.labels.cnpj}` : ""}
                    </p>
                  )}
                </div>
              </section>

              {parsed && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-[13px] text-[#1e3d4d]">
                    <input
                      type="checkbox"
                      checked={replace}
                      onChange={(e) => setReplace(e.target.checked)}
                      className="h-4 w-4 accent-[#447f98]"
                    />
                    Substituir todo o cadastro de {tipo === "cliente" ? "clientes" : "fornecedores"} (apaga o
                    atual antes de gravar)
                  </label>
                  <button
                    type="button"
                    onClick={doImport}
                    disabled={busy}
                    className="pill-grad-cyan w-full rounded-full py-3 text-sm font-display font-bold uppercase tracking-wide text-white shadow-btn disabled:opacity-50"
                  >
                    {busy ? "Gravando…" : `Gravar ${parsed.rows.length} no banco`}
                  </button>
                </div>
              )}

              {/* Lista / busca */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2">
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar por código, nome ou CNPJ…"
                    className="w-full rounded-xl border border-[#cdd9df] bg-white px-3 py-2 text-sm text-[#1e3d4d] outline-none focus:border-[#447f98]"
                  />
                  {counts[tipo] > 0 && (
                    <button
                      type="button"
                      onClick={doClear}
                      disabled={busy}
                      className="shrink-0 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-display font-bold uppercase tracking-wide text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                    >
                      Limpar
                    </button>
                  )}
                </div>

                {items.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[#cdd9df] bg-[#f7fbfd] px-4 py-6 text-center text-[13px] text-[#7eaabb]">
                    {counts[tipo] === 0
                      ? "Nenhum cadastro ainda. Envie a planilha acima."
                      : "Nada encontrado para essa busca."}
                  </p>
                ) : (
                  <div className="max-h-64 overflow-auto rounded-xl border border-[#d4e4eb]">
                    <table className="min-w-full border-collapse text-left text-[12px]">
                      <thead className="sticky top-0 bg-[#eef6fb]">
                        <tr>
                          <th className="border-b border-[#d4e4eb] px-2.5 py-1.5 font-semibold text-[#183844]">Código</th>
                          <th className="border-b border-[#d4e4eb] px-2.5 py-1.5 font-semibold text-[#183844]">Nome</th>
                          <th className="border-b border-[#d4e4eb] px-2.5 py-1.5 font-semibold text-[#183844]">CNPJ</th>
                          <th className="border-b border-[#d4e4eb] px-2.5 py-1.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => (
                          <tr key={it.codigo} className="odd:bg-white even:bg-[#f7fbfd]">
                            <td className="border-b border-[#eef2f4] px-2.5 py-1 font-medium text-[#1e3d4d]">{it.codigo}</td>
                            <td className="max-w-[220px] truncate border-b border-[#eef2f4] px-2.5 py-1 text-[#1e3d4d]" title={it.nome}>
                              {it.nome || "—"}
                            </td>
                            <td className="whitespace-nowrap border-b border-[#eef2f4] px-2.5 py-1 text-[#1e3d4d]">
                              {it.cnpj || "—"}
                            </td>
                            <td className="border-b border-[#eef2f4] px-2 py-1 text-right">
                              <button
                                type="button"
                                onClick={() => doDelete(it.codigo)}
                                aria-label="Excluir"
                                className="rounded-md p-1 text-[#9bb4c0] transition-colors hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {total > items.length && (
                  <p className="text-[11px] text-[#7eaabb]">
                    Mostrando {items.length} de {total}. Refine a busca para ver os demais.
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
