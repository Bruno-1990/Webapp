/**
 * Layout compartilhado das páginas de ferramenta (upload + download).
 * Cores alinhadas ao hub e ao fundo da página (#d6ebf3 · #eef6fb · bordas #dadee1 / #b9d8e1).
 */
export const toolPageShellClass =
  "mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:max-w-4xl sm:gap-9 sm:px-6 sm:py-12";

/** Painel interno (lista de arquivos, blocos de ação) — mesmo “ar” do fundo azul-claro, não branco puro. */
export const toolPanelClass =
  "rounded-2xl border border-[#dadee1]/90 bg-[#eef6fb] shadow-[0_2px_12px_-2px_rgb(68_127_152/0.12)]";

/** Área tracejada de upload (estados idle / drag). */
export function toolDropzoneClass(isDragActive: boolean): string {
  const base =
    "flex min-h-[132px] w-full min-w-0 cursor-pointer items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-5 py-8 text-center shadow-[0_2px_12px_-2px_rgb(68_127_152/0.12)] transition-colors duration-200 [-webkit-tap-highlight-color:transparent] sm:min-h-[152px] sm:px-8 sm:py-9";
  return isDragActive
    ? `${base} border-[#447f98] bg-[#d6ebf3] ring-4 ring-[#447f98]/18`
    : `${base} border-[#b9d8e1] bg-[#eef6fb] hover:border-[#629bb5]/55 hover:bg-[#e8f4fa] hover:shadow-[0_6px_20px_-4px_rgb(68_127_152/0.14)]`;
}

/** Botão principal — degradê da paleta (alinhado ao hub). */
export const toolPrimaryButtonClass =
  "pill-grad-cyan w-full shrink-0 rounded-full py-3.5 text-[15px] font-display font-bold uppercase tracking-wide text-white shadow-btn disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none";

/** Preenchimento da barra de progresso. */
export const toolProgressFillClass =
  "h-full rounded-full bg-gradient-to-r from-accent via-accentHi to-accent2 shadow-glow";

/** Caixa de erro — mantém alerta visível, mas fundo suave. */
export const toolErrorPanelClass =
  "rounded-2xl border border-rose-200/90 bg-[#fdf2f4] p-6 shadow-[0_2px_12px_-2px_rgb(225_100_100/0.1)]";

/** Faixa de erro compacta (mensagem curta). */
export const toolErrorBannerClass =
  "rounded-2xl border border-rose-200/90 bg-[#fdeff1] px-4 py-3 text-sm font-medium text-rose-900 shadow-[0_2px_10px_-2px_rgb(225_100_100/0.08)]";
