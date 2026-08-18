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

function allowPdfOrImage(file: File): boolean {
  const n = file.name.toLowerCase();
  return (
    n.endsWith(".pdf") ||
    n.endsWith(".jpg") ||
    n.endsWith(".jpeg") ||
    n.endsWith(".png")
  );
}

function allowPdfOnly(file: File): boolean {
  return file.name.toLowerCase().endsWith(".pdf");
}

function allowXlsxOnly(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xlsx");
}

function allowExcel(file: File): boolean {
  const n = file.name.toLowerCase();
  return n.endsWith(".xlsx") || n.endsWith(".xls");
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
    // CRÍTICO: colher TODAS as entries de forma síncrona, antes de qualquer await.
    // O DataTransferItemList só é válido durante o despacho do evento — após o
    // primeiro await ele é neutralizado e `webkitGetAsEntry()` dos itens seguintes
    // retorna null. (Era por isso que, ao arrastar vários arquivos, só o 1º era lido.)
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    // Fallback síncrono: se nenhuma entry veio (navegador sem suporte), usa dt.files.
    if (entries.length === 0) {
      return Array.from(dt.files).filter(allowRoot);
    }
    const out: File[] = [];
    for (const entry of entries) {
      out.push(...(await entryToFiles(entry, 0, allowRoot, allowInside)));
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

/** NFS-e dropzone: aceita .pdf, .jpg, .jpeg e .png (raiz e pastas). */
export async function getPdfFilesFromEvent(event: unknown): Promise<File[]> {
  const dt = dataTransferFrom(event);
  if (dt) {
    return extractFromDataTransfer(dt, allowPdfOrImage, allowPdfOrImage);
  }
  const t = (event as { target?: EventTarget | null }).target as HTMLInputElement | null;
  if (t?.files?.length) {
    return Array.from(t.files).filter(allowPdfOrImage);
  }
  return [];
}

/** GNRE dropzone: aceita só `.pdf` (raiz e dentro de pastas). */
export async function getPdfOnlyFilesFromEvent(event: unknown): Promise<File[]> {
  const dt = dataTransferFrom(event);
  if (dt) {
    return extractFromDataTransfer(dt, allowPdfOnly, allowPdfOnly);
  }
  const t = (event as { target?: EventTarget | null }).target as HTMLInputElement | null;
  if (t?.files?.length) {
    return Array.from(t.files).filter(allowPdfOnly);
  }
  return [];
}

/** Cadastro de clientes/fornecedores: aceita só `.xlsx` (parser ExcelJS). */
export async function getXlsxOnlyFilesFromEvent(event: unknown): Promise<File[]> {
  const dt = dataTransferFrom(event);
  if (dt) {
    return extractFromDataTransfer(dt, allowXlsxOnly, allowXlsxOnly);
  }
  const t = (event as { target?: EventTarget | null }).target as HTMLInputElement | null;
  if (t?.files?.length) {
    return Array.from(t.files).filter(allowXlsxOnly);
  }
  return [];
}

/** Editor de Extrato: aceita `.xlsx` e `.xls` (raiz e dentro de pastas). */
export async function getExcelFilesFromEvent(event: unknown): Promise<File[]> {
  const dt = dataTransferFrom(event);
  if (dt) {
    return extractFromDataTransfer(dt, allowExcel, allowExcel);
  }
  const t = (event as { target?: EventTarget | null }).target as HTMLInputElement | null;
  if (t?.files?.length) {
    return Array.from(t.files).filter(allowExcel);
  }
  return [];
}

/** NFS-e XML dropzone: aceita só `.xml` (diferente do NFe, que aceita .zip). */
export async function getXmlOnlyFilesFromEvent(event: unknown): Promise<File[]> {
  const dt = dataTransferFrom(event);
  if (dt) {
    return extractFromDataTransfer(dt, isXml, isXml);
  }
  const t = (event as { target?: EventTarget | null }).target as HTMLInputElement | null;
  if (t?.files?.length) {
    return Array.from(t.files).filter(isXml);
  }
  return [];
}

/* ─── File System Access API: picker de pasta sem o alert "Carregar N arquivos" ─── */

/** True se o browser oferece o picker novo (Chrome/Edge >= 86 em https/localhost). */
export function supportsDirectoryPicker(): boolean {
  return typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

type FsHandle = {
  kind: "file" | "directory";
  name: string;
  values: () => AsyncIterable<FsHandle>;
  getFile: () => Promise<File>;
};

async function collectFromHandle(
  dir: FsHandle,
  accept: (f: File) => boolean,
  skipped: string[],
): Promise<File[]> {
  const out: File[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === "file") {
      // Leitura em pastas de rede (\\SERV02) falha de forma intermitente; tenta
      // algumas vezes antes de desistir. Se falhar de vez, registra em `skipped`
      // (NÃO descarta em silêncio — faltar nota caladо é inaceitável num tool fiscal).
      let f: File | null = null;
      for (let attempt = 0; attempt < 3 && !f; attempt++) {
        try {
          f = await entry.getFile();
        } catch {
          if (attempt === 2) skipped.push(entry.name);
        }
      }
      if (f && accept(f)) out.push(f);
    } else if (entry.kind === "directory") {
      out.push(...(await collectFromHandle(entry, accept, skipped)));
    }
  }
  return out;
}

/**
 * Abre o picker de pasta nativo (sem o alert "Upload N files…") e retorna os
 * arquivos filtrados. Lança se o browser não suportar; chame `supportsDirectoryPicker`
 * antes de invocar.
 */
export async function pickDirectoryAndReadFiles(
  accept: "pdf-or-image" | "xml-only" | "pdf-only",
): Promise<File[] | null> {
  const filter =
    accept === "pdf-or-image"
      ? allowPdfOrImage
      : accept === "pdf-only"
        ? allowPdfOnly
        : isXml;
  const showDirectoryPicker = (window as unknown as {
    showDirectoryPicker: (opts?: { mode?: "read" | "readwrite" }) => Promise<FsHandle>;
  }).showDirectoryPicker;
  try {
    const handle = await showDirectoryPicker({ mode: "read" });
    const skipped: string[] = [];
    const files = await collectFromHandle(handle, filter, skipped);
    if (skipped.length > 0) {
      // Falha ao ler parte da pasta (típico de pasta em rede). Avisa em vez de
      // entregar um conjunto incompleto sem o usuário perceber.
      const amostra = skipped.slice(0, 3).join(", ");
      throw new Error(
        `${skipped.length} arquivo(s) da pasta não puderam ser lidos pelo navegador — ` +
          `isso costuma acontecer com pastas em rede (ex.: \\\\SERV02). ` +
          `Copie a pasta para o computador local e tente de novo. ` +
          `Ex.: ${amostra}${skipped.length > 3 ? "…" : ""}`,
      );
    }
    return files;
  } catch (e) {
    /** AbortError = user cancelou (Esc / fechou). Devolve null para sinalizar. */
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}
