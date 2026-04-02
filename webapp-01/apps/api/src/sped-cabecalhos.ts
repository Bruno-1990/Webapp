import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Mesma gramática que `cabecalhos_sped.py` (ficheiro guia interno). */
/** Traço ASCII, en-dash (U+2013) ou em-dash (U+2014) entre código e descrição */
const REG_LINE = /^([0-9A-Z]{4})\s*[\u2013\u2014-]\s*(.+)$/i;
const SEP_LINE = /^=+$/;

export type SpedCabecalhosMeta = {
  descriptions: Record<string, string>;
  blockByReg: Record<string, string>;
};

let cached: SpedCabecalhosMeta | null = null;

function resolveCabecalhosPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.join(here, "data", "cabecalhos-sped.txt");
  if (fs.existsSync(distPath)) return distPath;
  const srcFallback = path.join(here, "..", "src", "data", "cabecalhos-sped.txt");
  if (fs.existsSync(srcFallback)) return srcFallback;
  return distPath;
}

export function parseCabecalhosSpedText(raw: string): SpedCabecalhosMeta {
  const descriptions: Record<string, string> = {};
  const blockByReg: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  let currentBlock = "";
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const s = lines[i].trim();
    if (SEP_LINE.test(s)) {
      i += 1;
      if (i < n) {
        const nxt = lines[i].trim();
        if (nxt && !SEP_LINE.test(nxt)) {
          currentBlock = nxt;
          i += 1;
        }
      }
      while (i < n && SEP_LINE.test(lines[i].trim())) {
        i += 1;
      }
      continue;
    }
    const m = s.match(REG_LINE);
    if (m) {
      const reg = m[1].toUpperCase();
      descriptions[reg] = m[2].trim();
      if (currentBlock) blockByReg[reg] = currentBlock;
      i += 1;
      if (i < n) {
        const hdr = lines[i].trim();
        if (hdr.toUpperCase().includes("REG") && hdr.includes("|")) {
          i += 1;
        }
      }
      continue;
    }
    i += 1;
  }
  return { descriptions, blockByReg };
}

export function loadSpedCabecalhosMeta(): SpedCabecalhosMeta {
  if (cached) return cached;
  const p = resolveCabecalhosPath();
  if (!fs.existsSync(p)) {
    cached = { descriptions: {}, blockByReg: {} };
    return cached;
  }
  const raw = fs.readFileSync(p, "utf8");
  cached = parseCabecalhosSpedText(raw);
  return cached;
}
