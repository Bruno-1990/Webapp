import { type ReactNode, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { springSoft, transitionFast } from "../motion-variants.js";

type Tone = "info" | "warn" | "error" | "success";

const TONE_THEME: Record<Tone, { ring: string; iconBg: string; icon: string; pill: string }> = {
  info: {
    ring: "ring-[#629bb5]/30",
    iconBg: "bg-[#eef6fb] text-[#347891] border-[#b9d8e1]",
    icon: "i",
    pill: "bg-gradient-to-r from-[#347891] via-[#447f98] to-[#629bb5]",
  },
  warn: {
    ring: "ring-amber-300/40",
    iconBg: "bg-amber-50 text-amber-700 border-amber-200",
    icon: "!",
    pill: "bg-gradient-to-r from-amber-500 via-amber-400 to-amber-300",
  },
  error: {
    ring: "ring-rose-300/40",
    iconBg: "bg-rose-50 text-rose-700 border-rose-200",
    icon: "×",
    pill: "bg-gradient-to-r from-rose-500 via-rose-400 to-rose-300",
  },
  success: {
    ring: "ring-emerald-300/40",
    iconBg: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: "✓",
    pill: "bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-300",
  },
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  message?: ReactNode;
  tone?: Tone;
  /** Texto do botao primario. Default: "Entendi". Use null para esconder. */
  primaryLabel?: string | null;
  onPrimary?: () => void;
  /** Botao secundario opcional (ex: "Cancelar"). */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Conteudo livre dentro do modal (substitui `message` se passado). */
  children?: ReactNode;
  /** Permite fechar com ESC e clique no backdrop. Default: true. */
  dismissible?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  message,
  tone = "info",
  primaryLabel = "Entendi",
  onPrimary,
  secondaryLabel,
  onSecondary,
  children,
  dismissible = true,
}: ModalProps) {
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissible, onClose]);

  const theme = TONE_THEME[tone];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal-root"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transitionFast}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? "modal-title" : undefined}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-[#0b1f29]/55 backdrop-blur-sm"
            onClick={dismissible ? onClose : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transitionFast}
          />

          {/* Card */}
          <motion.div
            className={`relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-[#dadee1] bg-white shadow-[0_20px_50px_-12px_rgb(24_56_68/0.35)] ring-4 ${theme.ring}`}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={springSoft}
          >
            {/* Faixa de cor superior */}
            <div className={`h-1 w-full ${theme.pill}`} />

            <div className="px-6 pt-5 pb-6 sm:px-7 sm:pt-6 sm:pb-7">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-base font-bold ${theme.iconBg}`}
                >
                  {theme.icon}
                </span>
                <div className="min-w-0 flex-1">
                  {title && (
                    <h3
                      id="modal-title"
                      className="font-display text-lg font-bold uppercase tracking-wide text-[#183844]"
                    >
                      {title}
                    </h3>
                  )}
                  {(message || children) && (
                    <div className="mt-1.5 text-sm leading-relaxed text-[#1e3d4d]">
                      {children ?? message}
                    </div>
                  )}
                </div>
                {dismissible && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fechar"
                    className="shrink-0 rounded-full p-1 text-[#629bb5] transition-colors hover:bg-[#eef6fb] hover:text-[#347891]"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 18 18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M4 4l10 10M14 4L4 14" />
                    </svg>
                  </button>
                )}
              </div>

              {(primaryLabel || secondaryLabel) && (
                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  {secondaryLabel && (
                    <button
                      type="button"
                      onClick={onSecondary ?? onClose}
                      className="rounded-full border border-[#b9d8e1] bg-white px-5 py-2.5 font-display text-xs font-bold uppercase tracking-wide text-accent transition-colors hover:bg-[#e8f4fa]"
                    >
                      {secondaryLabel}
                    </button>
                  )}
                  {primaryLabel && (
                    <button
                      type="button"
                      onClick={onPrimary ?? onClose}
                      className={`pill-grad-cyan rounded-full px-6 py-2.5 font-display text-xs font-bold uppercase tracking-wide text-white shadow-btn`}
                    >
                      {primaryLabel}
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
