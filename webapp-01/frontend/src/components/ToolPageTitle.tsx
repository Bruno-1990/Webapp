const sizeClasses = {
  home: "text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl",
  download: "text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-5xl",
} as const;

export type ToolPageTitleSize = keyof typeof sizeClasses;

type Props = {
  left: string;
  right?: string;
  size?: ToolPageTitleSize;
};

/** Título “A → B” no mesmo estilo do hub (tons sólidos, sem degradê em texto transparente). */
export function ToolPageTitle({ left, right = "XLSX", size = "home" }: Props) {
  const sz = sizeClasses[size];

  return (
    <h1
      className={`font-display flex flex-wrap items-center justify-center gap-x-1.5 drop-shadow-sm ${sz}`}
    >
      <span className="text-[#183844]">{left}</span>
      <span className="text-[#447f98]" aria-hidden>
        →
      </span>
      <span className="text-[#347891]">{right}</span>
    </h1>
  );
}
