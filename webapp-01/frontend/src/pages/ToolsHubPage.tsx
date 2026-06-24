import {
  ArrowRight,
  Calculator,
  CircleHelp,
  ClipboardCheck,
  Combine,
  FileSearch,
  FileSpreadsheet,
  FileText,
  GitCompareArrows,
  Landmark,
  Receipt,
  ScrollText,
  Table2,
  TableProperties,
  type LucideIcon,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchToolsManifest,
  type ToolCategory,
  type ToolManifestEntry,
  type ToolTagTone,
} from "../api.js";
import { Modal } from "../components/Modal.js";

const TOOL_ICONS: Record<string, LucideIcon> = {
  nfe: FileSpreadsheet,
  sped: ScrollText,
  "sped-merge": Combine,
  "sci-consolidado": Table2,
  "comparacao-planilhas": GitCompareArrows,
  "comparacao-nfse": FileSearch,
  "sci-portal-nacional": ClipboardCheck,
  "nfse-pdf": FileText,
  gnre: Receipt,
  "extrato-edit": TableProperties,
};

const TOOL_OWNER: Record<string, string> = {
  nfe: "Bruno",
  sped: "Bruno",
  "sped-merge": "Bruno",
  "sci-consolidado": "Bruno",
  "comparacao-planilhas": "João",
  "comparacao-nfse": "Bruno",
  "sci-portal-nacional": "Bruno",
  "nfse-pdf": "Bruno",
  gnre: "Bruno",
  "extrato-edit": "Bruno",
};

const TAG_TONE_CLASS: Record<ToolTagTone, string> = {
  blue: "border-sky-300/80 bg-sky-50 text-sky-800",
  violet: "border-violet-300/80 bg-violet-50 text-violet-800",
  amber: "border-amber-300/80 bg-amber-50 text-amber-800",
  emerald: "border-emerald-300/80 bg-emerald-50 text-emerald-800",
  slate: "border-slate-300/80 bg-slate-50 text-slate-800",
};

const TOOL_ACCENT: Record<string, string> = {
  nfe: "from-[#447f98] via-[#4f8aa3] to-[#629bb5]",
  sped: "from-[#629bb5] via-[#5599b0] to-[#447f98]",
  "sped-merge": "from-[#3d7390] to-[#629bb5]",
  "sci-consolidado": "from-[#4a7f95] via-[#5a8fab] to-[#447f98]",
  "comparacao-planilhas": "from-[#3a6d85] via-[#4d8da6] to-[#5a9cb5]",
  "comparacao-nfse": "from-[#2f6378] via-[#4583a0] to-[#6aa6be]",
  "sci-portal-nacional": "from-[#356d85] via-[#4d8aa3] to-[#6fa3bb]",
  "nfse-pdf": "from-[#2f6378] via-[#4583a0] to-[#6aa6be]",
  gnre: "from-[#3f6f86] via-[#508aa1] to-[#73a8bd]",
  "extrato-edit": "from-[#3a6d85] via-[#4f8aa3] to-[#6fa3bb]",
};

type CategoryDef = {
  id: ToolCategory;
  label: string;
  icon: LucideIcon;
  title: string;
  highlight: string;
  subtitle: string;
};

const CATEGORIES: Record<ToolCategory, CategoryDef> = {
  fiscal: {
    id: "fiscal",
    label: "Fiscais",
    icon: Landmark,
    title: "Ferramentas",
    highlight: "fiscais",
    subtitle:
      "Conversões fiscais em um só lugar: envie os arquivos, acompanhe na tela e baixe o resultado quando estiver pronto.",
  },
  contabil: {
    id: "contabil",
    label: "Contábeis",
    icon: Calculator,
    title: "Ferramentas",
    highlight: "contábeis",
    subtitle:
      "Apoio à rotina do contábil: extração de guias, conciliações e relatórios prontos para conferência.",
  },
};

function categoryOf(tool: ToolManifestEntry): ToolCategory {
  return tool.category ?? "fiscal";
}

function parseCategory(value: string | null): ToolCategory {
  return value === "contabil" ? "contabil" : "fiscal";
}

export default function ToolsHubPage() {
  const [tools, setTools] = useState<ToolManifestEntry[] | null>(null);
  const [infoTool, setInfoTool] = useState<ToolManifestEntry | null>(null);
  const [params] = useSearchParams();
  const activeCategory = parseCategory(params.get("cat"));

  useEffect(() => {
    let cancelled = false;
    fetchToolsManifest().then((t) => {
      if (!cancelled) setTools(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const list = tools ?? [];

  const filtered = useMemo(
    () => list.filter((t) => categoryOf(t) === activeCategory),
    [list, activeCategory],
  );

  const activeDef = CATEGORIES[activeCategory];

  /** Mesma lógica antiga: 4 ferramentas viram 3 + 1 centralizada. */
  const hubThreePlusOne = filtered.length === 4;
  const hubGridClass = [
    "mx-auto grid w-full items-stretch gap-4 px-0.5 max-[480px]:grid-cols-1 sm:grid-cols-2 sm:gap-5",
    hubThreePlusOne
      ? "max-w-3xl md:max-w-5xl md:grid-cols-6 md:gap-5 lg:max-w-6xl lg:gap-6"
      : "max-w-3xl md:max-w-4xl md:grid-cols-3 md:gap-6",
  ].join(" ");

  return (
    <div className="space-y-8 sm:space-y-10">
      <div className="text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight text-[#183844] sm:text-3xl md:text-4xl">
          {activeDef.title} <span className="text-[#347891]">{activeDef.highlight}</span>
        </h1>
        <p className="mx-auto mt-3 max-w-lg font-sans text-sm leading-relaxed text-[#1e3d4d] sm:mt-3.5 sm:max-w-xl sm:text-[15px]">
          {activeDef.subtitle}
        </p>
      </div>

      {filtered.length === 0 ? (
        <EmptyCategoryState category={activeDef} />
      ) : (
        <ul className={hubGridClass}>
          {filtered.map((tool, index) => (
            <li
              key={tool.id}
              className={
                hubThreePlusOne
                  ? index === 3
                    ? "flex h-full min-h-0 md:col-span-2 md:col-start-3"
                    : "flex h-full min-h-0 md:col-span-2"
                  : "flex h-full min-h-0"
              }
            >
              <ToolCard tool={tool} onInfo={() => setInfoTool(tool)} />
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!infoTool}
        onClose={() => setInfoTool(null)}
        tone="info"
        title={infoTool?.title}
        primaryLabel="Fechar"
      >
        {infoTool && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#3c7f97]">
              {infoTool.subtitle}
            </p>
            <p className="text-sm leading-relaxed text-[#1e3d4d]">
              {infoTool.description}
            </p>
            {TOOL_OWNER[infoTool.id] && (
              <p className="pt-1 text-xs text-[#7eaabb]">
                Mantida por <span className="font-semibold">{TOOL_OWNER[infoTool.id]}</span>
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function EmptyCategoryState({ category }: { category: CategoryDef }) {
  const Icon = category.icon;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-3xl border border-dashed border-[#cfe2ec] bg-[linear-gradient(180deg,#ffffff_0%,#f5fbfe_100%)] px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#447f98] via-[#4f8aa3] to-[#629bb5] text-white shadow-[0_12px_24px_-14px_rgb(34_78_97/0.9)] ring-2 ring-white/60">
        <Icon className="h-5 w-5" strokeWidth={2.1} />
      </span>
      <p className="font-display text-base font-bold text-[#183844]">
        Em breve por aqui
      </p>
      <p className="max-w-xs text-sm leading-relaxed text-[#1e3d4d]">
        Ferramentas {category.label.toLowerCase()} aparecem assim que forem
        publicadas — estamos preparando.
      </p>
    </div>
  );
}

function ToolCard({
  tool,
  onInfo,
}: {
  tool: ToolManifestEntry;
  onInfo: () => void;
}) {
  const Icon = TOOL_ICONS[tool.id] ?? FileSpreadsheet;
  const accent = TOOL_ACCENT[tool.id] ?? TOOL_ACCENT.nfe;

  const handleInfoClick = (e: ReactMouseEvent) => {
    /** Card inteiro eh um <Link>; o botao "?" precisa interceptar antes da
     * navegacao. preventDefault() impede o Link, stopPropagation() impede
     * bubble. */
    e.preventDefault();
    e.stopPropagation();
    onInfo();
  };

  const inner = (
    <div className="relative flex min-h-0 flex-1 flex-col gap-2.5">
      <div
        aria-hidden
        className={`pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-gradient-to-br ${accent} opacity-[0.13] blur-2xl transition-opacity duration-300 group-hover:opacity-[0.18]`}
      />
      <div className="flex shrink-0 items-start gap-2">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${accent} text-white shadow-[0_12px_24px_-14px_rgb(34_78_97/0.9)] ring-1 ring-white/60 transition-transform duration-200 group-hover:scale-[1.04] sm:h-11 sm:w-11 sm:ring-2`}
          aria-hidden
        >
          <Icon className="h-[18px] w-[18px] sm:h-5 sm:w-5" strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1 pt-px">
          {tool.tag && (
            <span
              className={`mb-1 inline-flex items-center rounded-full border px-2 py-[1px] text-[9px] font-bold uppercase tracking-wide sm:text-[10px] ${TAG_TONE_CLASS[tool.tag.tone]}`}
            >
              {tool.tag.label}
            </span>
          )}
          <div className="flex items-start justify-between gap-1.5">
            <h2 className="font-display text-base font-bold leading-tight tracking-tight text-brand-inkStrong sm:text-lg">
              {tool.title}
            </h2>
            <div className="flex shrink-0 items-start gap-1.5">
              <button
                type="button"
                onClick={handleInfoClick}
                aria-label={`Sobre ${tool.title}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#bddae5] bg-[#eef7fb] text-[#2d6a82] shadow-[inset_0_1px_0_rgb(255_255_255/0.55)] transition-all duration-200 hover:-translate-y-px hover:border-[#91c2d4] hover:bg-[#def0f8] hover:shadow-[0_5px_12px_-8px_rgb(37_87_109/0.55)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#447f98]/55"
              >
                <CircleHelp className="h-3.5 w-3.5" strokeWidth={2.15} />
              </button>
              {!tool.available && (
                <span className="shrink-0 rounded-lg bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                  Breve
                </span>
              )}
            </div>
          </div>
          <p className="mt-px text-[9px] font-bold uppercase tracking-[0.12em] text-[#3c7f97] sm:mt-0.5 sm:text-[10px] sm:tracking-[0.14em]">
            {tool.subtitle}
          </p>
        </div>
      </div>
      {tool.available && (
        <div className="relative mt-auto flex shrink-0 items-center justify-between gap-2">
          <span className="inline-flex w-fit items-center gap-1 rounded-full border border-[#c5dfe8] bg-[#f2fafd] px-2.5 py-1 text-[12px] font-semibold text-[#2d6a82] transition-all duration-200 group-hover:gap-1.5 group-hover:border-[#9ec8d8] group-hover:bg-[#e8f5fa] group-hover:text-[#2b6f88] sm:text-[13px]">
            Abrir ferramenta
            <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5 sm:h-3.5 sm:w-3.5" />
          </span>
          {TOOL_OWNER[tool.id] && (
            <span className="text-[10px] font-medium tracking-wide text-[#7eaabb] sm:text-[11px]">
              By: {TOOL_OWNER[tool.id]}
            </span>
          )}
        </div>
      )}
    </div>
  );

  const cardBase =
    "group relative flex h-full min-h-[176px] w-full min-w-0 flex-col overflow-visible rounded-2xl p-3.5 outline-none sm:min-h-[188px] sm:rounded-3xl sm:p-4";

  const cardAvailable = `${cardBase} border border-[#d4e4eb]/95 bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] shadow-[0_8px_24px_-16px_rgb(41_85_104/0.55)] transition-[transform,box-shadow,border-color,background] duration-250 [-webkit-tap-highlight-color:transparent] hover:-translate-y-0.5 hover:border-[#aacede] hover:bg-[linear-gradient(180deg,#ffffff_0%,#f5fbfe_100%)] hover:shadow-[0_18px_38px_-20px_rgb(41_85_104/0.8)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#447f98]/55`;

  const cardDisabled = `${cardBase} cursor-not-allowed border border-brand-line/60 bg-gradient-to-b from-brand-bg/55 to-brand-bg/30 opacity-85 shadow-[0_6px_18px_-12px_rgb(68_127_152/0.35)]`;

  if (tool.available) {
    return (
      <Link
        to={tool.route}
        aria-label={`Abrir ${tool.title}`}
        className={`${cardAvailable} flex h-full w-full min-w-0 flex-col`}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className={`${cardDisabled} flex h-full w-full min-w-0 flex-col`} aria-label={`${tool.title} indisponivel`}>
      {inner}
    </div>
  );
}
