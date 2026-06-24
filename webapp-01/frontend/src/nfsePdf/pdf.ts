/**
 * Wrapper do pdfmake (build do browser) carregado sob demanda. Resolve o vfs de
 * fontes (Roboto) tolerando as várias formas de export entre versões do pacote
 * e devolve um Blob de PDF a partir de uma definição de documento.
 */

type PdfDoc = { getBlob: (cb: (blob: Blob) => void) => void };
type PdfMake = { createPdf: (def: unknown) => PdfDoc; vfs?: unknown };

let pdfMakePromise: Promise<PdfMake> | null = null;

async function getPdfMake(): Promise<PdfMake> {
  if (!pdfMakePromise) {
    pdfMakePromise = (async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const pdfMod: any = await import("pdfmake/build/pdfmake");
      const vfsMod: any = await import("pdfmake/build/vfs_fonts");
      const pdfMake: PdfMake = pdfMod.default ?? pdfMod;
      const vfs =
        vfsMod?.default?.pdfMake?.vfs ??
        vfsMod?.pdfMake?.vfs ??
        vfsMod?.default?.vfs ??
        vfsMod?.vfs ??
        vfsMod?.default;
      pdfMake.vfs = vfs;
      /* eslint-enable @typescript-eslint/no-explicit-any */
      return pdfMake;
    })();
  }
  return pdfMakePromise;
}

/** Renderiza uma definição de documento pdfmake em um Blob (application/pdf). */
export async function renderPdf(docDefinition: unknown): Promise<Blob> {
  const pdfMake = await getPdfMake();
  return new Promise<Blob>((resolve) => {
    pdfMake.createPdf(docDefinition).getBlob((blob) => resolve(blob));
  });
}
