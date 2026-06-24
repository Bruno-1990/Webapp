/** Geração do QR Code de verificação do DANFSe (lib `qrcode`, carregada sob demanda). */

/** URL de consulta pública da chave no portal nacional da NFS-e. */
export function qrContentForChave(chave: string): string {
  return `https://www.nfse.gov.br/consultapublica/?tpc=1&chave=${chave}`;
}

/** Devolve um data URL (PNG) do QR, pronto para embutir no pdfmake. */
export async function qrDataUrl(content: string): Promise<string> {
  const mod = await import("qrcode");
  const QRCode = (mod.default ?? mod) as {
    toDataURL: (text: string, opts?: Record<string, unknown>) => Promise<string>;
  };
  return QRCode.toDataURL(content, {
    margin: 0,
    width: 240,
    errorCorrectionLevel: "M",
  });
}
