/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      keyframes: {
        loadingBar: {
          "0%": { left: "-38%" },
          "100%": { left: "100%" },
        },
      },
      animation: {
        loadingBar: "loadingBar 1.35s ease-in-out infinite",
      },
      fontFamily: {
        sans: ["\"Plus Jakarta Sans\"", "system-ui", "sans-serif"],
        /** BabaPro-Bold.ttf em ../Font (peso 700) — títulos e CTAs */
        display: ["\"Baba Pro\"", "\"Plus Jakarta Sans\"", "system-ui", "sans-serif"],
      },
      colors: {
        /** Paleta: #447F98 · #629BB5 · #DADEE1 · #B9D8E1 · #D6EBF3 (+ ink derivado) */
        brand: {
          bg: "#d6ebf3",
          paper: "#ffffff",
          surface: "#ffffff",
          soft: "#b9d8e1",
          line: "#dadee1",
          mid: "#629bb5",
          primary: "#447f98",
          hover: "#629bb5",
          ink: "#2a4f60",
          inkStrong: "#183844",
        },
        lilac: "#b9d8e1",
        mist: "#2a4f60",
        mint: "#447f98",
        accent: "#447f98",
        accent2: "#2a4f60",
        accentHi: "#b9d8e1",
      },
      boxShadow: {
        card:
          "0 10px 28px -8px rgb(24 56 68 / 0.08), 0 2px 10px -4px rgb(42 79 96 / 0.06)",
        "card-hover":
          "0 14px 36px -10px rgb(24 56 68 / 0.11), 0 4px 14px -4px rgb(68 127 152 / 0.12)",
        btn: "0 6px 20px -6px rgb(24 56 68 / 0.15), 0 2px 8px -3px rgb(68 127 152 / 0.18)",
        glow: "0 0 24px -4px rgb(68 127 152 / 0.22)",
        pill: "0 3px 12px -4px rgb(24 56 68 / 0.1), 0 1px 4px -2px rgb(68 127 152 / 0.1)",
        "pill-hover": "0 5px 18px -6px rgb(24 56 68 / 0.12), 0 2px 6px -2px rgb(68 127 152 / 0.12)",
      },
    },
  },
  plugins: [],
};
