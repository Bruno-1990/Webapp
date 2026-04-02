import { ArrowRight, CircleHelp, Combine, FileSpreadsheet, GitCompareArrows, ScrollText, Table2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchToolsManifest, type ToolManifestEntry } from "../api.js";

const TOOL_ICONS: Record<string, typeof FileSpreadsheet> = {
  nfe: FileSpreadsheet,
  sped: ScrollText,
  "webapp-03": Combine,
  "webapp-04": Table2,
  "webapp-05": GitCompareArrows,
};

const TOOL_OWNER: Record<string, string> = {
  nfe: "Bruno",
  sped: "Bruno",
  "webapp-03": "Bruno",
  "webapp-04": "Bruno",
  "webapp-05": "João",
};

const TOOL_ACCENT: Record<string, string> = {
  nfe: "from-[#447f98] via-[#4f8aa3] to-[#629bb5]",
  sped: "from-[#629bb5] via-[#5599b0] to-[#447f98]",
  "webapp-03": "from-[#3d7390] to-[#629bb5]",
  "webapp-04": "from-[#4a7f95] via-[#5a8fab] to-[#447f98]",
  "webapp-05": "from-[#3a6d85] via-[#4d8da6] to-[#5a9cb5]",
};

export default function ToolsHubPage() {
  const [tools, setTools] = useState<ToolManifestEntry[] | null>(null);

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
  /** Quatro ferramentas: 3 na primeira linha + 1 centralizada abaixo (grid 6 colunas). Com mais itens, fluxo em 3 colunas no md+. */
  const hubThreePlusOne = list.length === 4;

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
          Ferramentas <span className="text-[#347891]">fiscais</span>
        </h1>
        <p className="mx-auto mt-3 max-w-lg font-sans text-sm leading-relaxed text-[#1e3d4d] sm:mt-3.5 sm:max-w-xl sm:text-[15px]">
          Conversões fiscais em um só lugar: envie os arquivos, acompanhe na tela e baixe o resultado quando estiver
          pronto.
        </p>
      </div>

      <ul className={hubGridClass}>
        {list.map((tool, index) => (
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
            <ToolCard tool={tool} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolManifestEntry }) {
  const Icon = TOOL_ICONS[tool.id] ?? FileSpreadsheet;
  const accent = TOOL_ACCENT[tool.id] ?? TOOL_ACCENT.nfe;

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
          <div className="flex items-start justify-between gap-1.5">
            <h2 className="font-display text-base font-bold leading-tight tracking-tight text-brand-inkStrong sm:text-lg">
              {tool.title}
            </h2>
            <div className="flex shrink-0 items-start gap-1.5">
              <span
                className="group/help relative inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#bddae5] bg-[#eef7fb] text-[#2d6a82] shadow-[inset_0_1px_0_rgb(255_255_255/0.55)] transition-all duration-200 hover:-translate-y-px hover:border-[#91c2d4] hover:bg-[#def0f8] hover:shadow-[0_5px_12px_-8px_rgb(37_87_109/0.55)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#447f98]/55"
                aria-label={`Descrição da ferramenta ${tool.title}`}
                title={tool.description}
                tabIndex={0}
              >
                <CircleHelp className="h-3.5 w-3.5" strokeWidth={2.15} />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-60 rounded-xl border border-[#a9ccda] bg-white/98 px-3 py-2.5 text-left font-sans text-[11px] font-medium leading-snug text-[#244958] opacity-0 shadow-[0_14px_34px_-14px_rgb(37_87_109/0.55)] ring-1 ring-white/70 backdrop-blur-[1px] transition-all duration-150 group-hover/help:-translate-y-0.5 group-hover/help:opacity-100 group-focus-visible/help:-translate-y-0.5 group-focus-visible/help:opacity-100"
                >
                  {tool.description}
                  <span
                    aria-hidden
                    className="absolute right-2 top-full h-2.5 w-2.5 -translate-y-[5px] rotate-45 border-b border-r border-[#a9ccda] bg-white"
                  />
                </span>
              </span>
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
