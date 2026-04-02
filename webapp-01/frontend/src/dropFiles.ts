/**
 * Expande arrastar pasta (webkit) e filtra extensões.
 * NFe: na raiz .xml e .zip; dentro de pastas só .xml.
 * SPED: .txt na raiz e dentro de pastas.
 */

function isXml(file: Pick<File, "name">): boolean {
  return file.name.toLowerCase().endsWith(".xml");
}

function isZip(file: Pick<File, "name">): boolean {
  return file.name.toLowerCase().endsWith(".zip");
}

function allowAtRoot(file: File): boolean {
  return isXml(file) || isZip(file);
}

function allowInsideFolder(file: File): boolean {
  return isXml(file);
}

function allowSpedTxt(file: File): boolean {
  return file.name.toLowerCase().endsWith(".txt");
}

function readEntriesAsync(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const acc: FileSystemEntry[] = [];
    const read = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) resolve(acc);
          else {
            acc.push(...batch);
            read();
          }
        },
        (err) => reject(err)
      );
    };
    read();
  });
}

async function entryToFiles(
  entry: FileSystemEntry,
  depth: number,
  allowRoot: (f: File) => boolean,
  allowInside: (f: File) => boolean
): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      (entry as FileSystemFileEntry).file(
        (file) => {
          const ok = depth === 0 ? allowRoot(file) : allowInside(file);
          resolve(ok ? [file] : []);
        },
        reject
      );
    });
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const entries = await readEntriesAsync(reader);
    const nested = await Promise.all(
      entries.map((e) => entryToFiles(e, depth + 1, allowRoot, allowInside))
    );
    return nested.flat();
  }
  return [];
}

async function extractFromDataTransfer(
  dt: DataTransfer,
  allowRoot: (f: File) => boolean,
  allowInside: (f: File) => boolean
): Promise<File[]> {
  const items = dt.items;
  if (items?.length && typeof items[0].webkitGetAsEntry === "function") {
    const out: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) out.push(...(await entryToFiles(entry, 0, allowRoot, allowInside)));
    }
    return out;
  }
  return Array.from(dt.files).filter(allowRoot);
}

export function fileLabel(file: File): string {
  const w = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return w && w.length > 0 ? w : file.name;
}

function dataTransferFrom(event: unknown): DataTransfer | null {
  const e = event as {
    dataTransfer?: DataTransfer | null;
    nativeEvent?: { dataTransfer?: DataTransfer | null };
    target?: EventTarget | null;
  };
  return e.dataTransfer ?? e.nativeEvent?.dataTransfer ?? null;
}

/** NFe: `useDropzone({ getFilesFromEvent })` — arrastar + input. */
export async function getFilesFromEvent(event: unknown): Promise<File[]> {
  const dt = dataTransferFrom(event);
  if (dt) {
    return extractFromDataTransfer(dt, allowAtRoot, allowInsideFolder);
  }
  const t = (event as { target?: EventTarget | null }).target as HTMLInputElement | null;
  if (t?.files?.length) {
    return Array.from(t.files).filter(allowAtRoot);
  }
  return [];
}

/** SPED: mesmo fluxo webkit, mas aceita só `.txt` (o handler NFe descartava .txt). */
export async function getSpedFilesFromEvent(event: unknown): Promise<File[]> {
  const dt = dataTransferFrom(event);
  if (dt) {
    return extractFromDataTransfer(dt, allowSpedTxt, allowSpedTxt);
  }
  const t = (event as { target?: EventTarget | null }).target as HTMLInputElement | null;
  if (t?.files?.length) {
    return Array.from(t.files).filter(allowSpedTxt);
  }
  return [];
}
