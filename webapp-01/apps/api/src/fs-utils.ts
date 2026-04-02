import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const unzipper = require("unzipper") as {
  Open: { buffer: (buf: Buffer) => Promise<{ files: ZipEntry[] }> };
};

interface ZipEntry {
  type: string;
  path: string;
  buffer: () => Promise<Buffer>;
}

function safeJoin(base: string, name: string): string | null {
  const target = path.resolve(base, name);
  const root = path.resolve(base);
  if (!target.startsWith(root + path.sep) && target !== root) return null;
  return target;
}

export async function extractZipSafe(
  zipBuffer: Buffer,
  destDir: string
): Promise<void> {
  const directory = await unzipper.Open.buffer(zipBuffer);
  for (const file of directory.files as ZipEntry[]) {
    if (file.type === "Directory") continue;
    const entryPath = file.path.replace(/\\/g, "/");
    if (entryPath.includes("..") || path.isAbsolute(entryPath)) continue;
    const baseName = path.basename(entryPath).toLowerCase();
    if (!baseName.endsWith(".xml")) continue;
    const full = safeJoin(destDir, entryPath);
    if (!full) continue;
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    const buf = await file.buffer();
    await fs.promises.writeFile(full, buf);
  }
}

export async function collectXmlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await fs.promises.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".xml")) out.push(p);
    }
  }
  await walk(dir);
  return out.sort();
}
