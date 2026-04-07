/** Curvas e durações — sensação “futurista” suave (sem snap). */
export const easeOutExpo: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const springSnappy = { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.85 };

export const springSoft = { type: "spring" as const, stiffness: 280, damping: 28, mass: 1 };

export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export const transitionSmooth = { duration: 0.5, ease: easeOutExpo };

export const transitionFast = { duration: 0.28, ease: easeOutExpo };
