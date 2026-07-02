/**
 * Orquestra a ferramenta no navegador: lê cada XML, gera o PDF (DANFSe ou evento),
 * empacota tudo num .zip (JSZip, carregado sob demanda) e dispara o download.
 * Nenhum dado sai do navegador.
 */
import { parseNfseFile, type NfseData } from "./parseNfse.js";
import { buildDanfseDoc } from "./danfseDoc.js";
import { buildEventoDoc } from "./eventoDoc.js";
import { renderPdf } from "./pdf.js";
import { loadMunicipios } from "./municipios.js";
import { qrContentForChave, qrDataUrl } from "./qr.js";
import { toNumber, fmtCodTrib } from "./format.js";
import { fmtRetPisCofins, issqnRetido } from "./nfseEnums.js";
import { municipioLabel } from "./municipios.js";

export type GenSkip = { arquivo: string; motivo: string };

/** Retenções de uma NFS-e (só as que efetivamente foram retidas). */
export type RetencaoItem = {
  numero: string;
  chave: string;
  prestadorNome: string;
  prestadorCnpj: string;
  tomadorNome: string;
  tomadorCnpj: string;
  municipioIncidencia: string;
  codTribNac: string;
  descServico: string;
  vServ: number;
  issqnRetido: number;
  irrf: number;
  previdenciaria: number;
  contribSociais: number;
  descContribSociais: string;
  totalFederais: number;
  vLiq: number;
};

export type GenResult = {
  geradosNfse: number;
  geradosEvento: number;
  ignorados: GenSkip[];
  /** Todas as NFS-e processadas (com ou sem retenção). */
  todas: RetencaoItem[];
  /** Subconjunto de `todas` que teve alguma retenção. */
  retencoes: RetencaoItem[];
  total: number;
};

/** Monta o item de relatório de uma NFS-e (retenções ficam zeradas quando não houver). */
export function buildNota(d: NfseData): RetencaoItem {
  const issqn = issqnRetido(d.tpRetISSQN) ? toNumber(d.vISSQN) ?? 0 : 0;
  const irrf = toNumber(d.vRetIRRF) ?? 0;
  const prev = toNumber(d.vRetCP) ?? 0;
  const contrib = toNumber(d.vRetCSLL) ?? 0;
  return {
    numero: d.numeroNfse,
    chave: d.chave,
    prestadorNome: d.emit.nome,
    prestadorCnpj: d.emit.cnpjCpf,
    tomadorNome: d.toma?.nome ?? "",
    tomadorCnpj: d.toma?.cnpjCpf ?? "",
    municipioIncidencia: d.cLocIncid ? municipioLabel(d.cLocIncid) : d.localIncidencia,
    codTribNac: d.cTribNac ? fmtCodTrib(d.cTribNac) : "",
    descServico: cleanDesc(d.xDescServ ?? ""),
    vServ: toNumber(d.vServ) ?? 0,
    issqnRetido: issqn,
    irrf,
    previdenciaria: prev,
    contribSociais: contrib,
    descContribSociais: contrib > 0 ? fmtRetPisCofins(d.tpRetPisCofins) : "",
    // Total de retenções FEDERAIS apenas (IRRF + Previdenciária + Contrib. Sociais).
    // ISSQN é municipal e NÃO entra aqui — fica na coluna própria de ISSQN Retido.
    totalFederais: irrf + prev + contrib,
    vLiq: toNumber(d.vLiq) ?? 0,
  };
}

/** True se a nota teve alguma retenção (ISSQN municipal ou federais). */
export function hasRetencao(it: RetencaoItem): boolean {
  return it.issqnRetido > 0 || it.irrf > 0 || it.previdenciaria > 0 || it.contribSociais > 0;
}

/** Extrai as retenções de uma NFS-e; devolve null se nenhuma foi retida. */
export function extractRetencao(d: NfseData): RetencaoItem | null {
  const nota = buildNota(d);
  return hasRetencao(nota) ? nota : null;
}

/** A descrição do serviço vem do XML com quebras (`\r\n` literais ou reais); vira uma linha só. */
function cleanDesc(s: string): string {
  return s
    .replace(/\\r\\n|\\r|\\n/g, " ") // sequências de escape literais
    .replace(/[\r\n\t]+/g, " ") // quebras reais
    .replace(/\s+/g, " ")
    .trim();
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function sanitize(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

/** Garante nome único dentro do zip (evita sobrescrever PDFs homônimos). */
function uniqueName(used: Set<string>, desired: string): string {
  let name = desired;
  let i = 2;
  while (used.has(name.toLowerCase())) {
    name = desired.replace(/\.pdf$/i, "") + `_${i}.pdf`;
    i += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function zipFileName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `DANFSe_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.zip`;
}

export async function generateDanfseZip(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<GenResult> {
  await loadMunicipios();
  const JSZipMod = await import("jszip");
  const JSZip = (JSZipMod.default ?? JSZipMod) as unknown as { new (): JSZipInstance };
  const zip = new JSZip();

  const used = new Set<string>();
  const result: GenResult = {
    geradosNfse: 0,
    geradosEvento: 0,
    ignorados: [],
    todas: [],
    retencoes: [],
    total: files.length,
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const parsed = await parseNfseFile(file);
      if (parsed.kind === "nfse") {
        const qr = parsed.chave ? await qrDataUrl(qrContentForChave(parsed.chave)) : null;
        const blob = await renderPdf(buildDanfseDoc(parsed, qr));
        const desired = sanitize(`${parsed.numeroNfse || parsed.chave || baseName(file.name)}.pdf`);
        zip.file(uniqueName(used, desired), await blob.arrayBuffer());
        result.geradosNfse += 1;
        const nota = buildNota(parsed);
        result.todas.push(nota);
        if (hasRetencao(nota)) result.retencoes.push(nota);
      } else if (parsed.kind === "evento") {
        const blob = await renderPdf(buildEventoDoc(parsed));
        const desired = sanitize(`evento_${parsed.chave || baseName(file.name)}.pdf`);
        zip.file(uniqueName(used, desired), await blob.arrayBuffer());
        result.geradosEvento += 1;
      } else {
        result.ignorados.push({ arquivo: file.name, motivo: parsed.reason });
      }
    } catch (e) {
      result.ignorados.push({ arquivo: file.name, motivo: e instanceof Error ? e.message : String(e) });
    }
    onProgress?.(i + 1, files.length);
  }

  if (result.geradosNfse + result.geradosEvento === 0) {
    return result;
  }

  const out = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  triggerDownload(out, zipFileName());
  return result;
}

/* Tipo mínimo do JSZip usado aqui (evita depender de @types/jszip). */
type JSZipInstance = {
  file(name: string, data: ArrayBuffer): void;
  generateAsync(opts: { type: "blob"; compression?: string }): Promise<Blob>;
};
