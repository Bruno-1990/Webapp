import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src", "data", "cabecalhos-sped.txt");
const destDir = path.join(root, "dist", "data");
const dest = path.join(destDir, "cabecalhos-sped.txt");

if (!fs.existsSync(src)) {
  console.warn("copy-data: ficheiro em falta:", src);
  process.exit(0);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
