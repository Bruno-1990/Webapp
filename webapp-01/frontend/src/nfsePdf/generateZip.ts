/**
 * Orquestra a ferramenta no navegador: lê cada XML, gera o PDF (DANFSe ou evento),
 * empacota tudo num .zip (JSZip, carregado sob demanda) e dispara o download.
 * Nenhum dado sai do navegador.
 */
import { parseNfseFile, valorLiquidoNfse, type NfseData, type EventoData } from "./parseNfse.js";
import { buildDanfseDoc } from "./danfseDoc.js";
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
  /** Situação da nota: "Ativa" ou "Cancelada" (para exibir/exportar nos relatórios). */
  status: string;
  /** True quando há evento de cancelamento/substituição para a nota. */
  cancelada: boolean;
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
  /** DANFSe geradas no total (ativas + canceladas). */
  geradosNfse: number;
  /** Notas vigentes (sem evento de cancelamento). */
  ativas: number;
  /** Notas marcadas com a marca d'água CANCELADA. */
  canceladas: number;
  /** Eventos de cancelamento/substituição lidos (controle interno; não viram PDF). */
  eventosCancel: number;
  ignorados: GenSkip[];
  /** NFS-e ativas processadas (canceladas são excluídas dos relatórios). */
  todas: RetencaoItem[];
  /** Subconjunto de `todas` que teve alguma retenção. */
  retencoes: RetencaoItem[];
  total: number;
};

/** Códigos de evento (padrão nacional) que invalidam a nota → marca d'água CANCELADA. */
const TP_EVENTO_CANCELA = new Set(["101101", "105102"]);

/** Só os dígitos da chave, para confrontar nota (Id "NFS<chave>") com evento (chNFSe). */
function normChave(chave: string): string {
  return chave.replace(/\D+/g, "");
}

/** Monta o item de relatório de uma NFS-e (retenções ficam zeradas quando não houver). */
export function buildNota(d: NfseData, cancelada = false): RetencaoItem {
  const issqn = issqnRetido(d.tpRetISSQN) ? toNumber(d.vISSQN) ?? 0 : 0;
  const irrf = toNumber(d.vRetIRRF) ?? 0;
  const prev = toNumber(d.vRetCP) ?? 0;
  const contrib = toNumber(d.vRetCSLL) ?? 0;
  return {
    numero: d.numeroNfse,
    status: cancelada ? "Cancelada" : "Ativa",
    cancelada,
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
    // Líquido calculado (subtrai descontos + retenções), consistente com o DANFSe.
    vLiq: valorLiquidoNfse(d),
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
    ativas: 0,
    canceladas: 0,
    eventosCancel: 0,
    ignorados: [],
    todas: [],
    retencoes: [],
    total: files.length,
  };

  // ── Passe 1: parse de todos os arquivos, separando notas de eventos ─────────
  const notas: { file: File; data: NfseData }[] = [];
  const eventos: EventoData[] = [];
  for (const file of files) {
    try {
      const parsed = await parseNfseFile(file);
      if (parsed.kind === "nfse") {
        notas.push({ file, data: parsed });
      } else if (parsed.kind === "evento") {
        eventos.push(parsed);
      } else {
        result.ignorados.push({ arquivo: file.name, motivo: parsed.reason });
      }
    } catch (e) {
      result.ignorados.push({ arquivo: file.name, motivo: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── Confronto: chaves canceladas a partir dos eventos de cancelamento ───────
  const canceladas = new Set<string>();
  for (const ev of eventos) {
    if (TP_EVENTO_CANCELA.has(ev.tpEvento)) {
      const ch = normChave(ev.chave);
      if (ch) canceladas.add(ch);
      result.eventosCancel += 1;
    }
  }

  // ── Passe 2: render das notas (com marca d'água quando cancelada) ───────────
  // O total do progresso considera só as notas — eventos são controle interno.
  for (let i = 0; i < notas.length; i++) {
    const { file, data } = notas[i];
    try {
      const cancelada = canceladas.has(normChave(data.chave));
      const qr = data.chave ? await qrDataUrl(qrContentForChave(data.chave)) : null;
      const blob = await renderPdf(buildDanfseDoc(data, qr, { cancelada }));
      const nome = data.numeroNfse || data.chave || baseName(file.name);
      // Canceladas levam "_CANCELADA" no nome do arquivo, junto ao número da NF.
      const desired = sanitize(`${nome}${cancelada ? "_CANCELADA" : ""}.pdf`);
      const pasta = cancelada ? "Canceladas/" : "Ativas/";
      zip.file(uniqueName(used, pasta + desired), await blob.arrayBuffer());
      result.geradosNfse += 1;
      if (cancelada) result.canceladas += 1;
      else result.ativas += 1;
      // Todas as notas entram nos relatórios (canceladas marcadas como "Cancelada",
      // para conferência); os totais somam só as ativas (ver retencaoReport / sumCol).
      const nota = buildNota(data, cancelada);
      result.todas.push(nota);
      if (hasRetencao(nota)) result.retencoes.push(nota);
    } catch (e) {
      result.ignorados.push({ arquivo: file.name, motivo: e instanceof Error ? e.message : String(e) });
    }
    onProgress?.(i + 1, notas.length);
  }

  // Canceladas primeiro nos relatórios (bloco no topo, com subtotal próprio); as
  // ativas vêm abaixo e são as únicas que entram no total. Array.sort é estável,
  // então a ordem de arquivo dentro de cada grupo é preservada.
  const canceladasPrimeiro = (a: RetencaoItem, b: RetencaoItem) => Number(b.cancelada) - Number(a.cancelada);
  result.todas.sort(canceladasPrimeiro);
  result.retencoes.sort(canceladasPrimeiro);

  if (result.geradosNfse === 0) {
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
