import { DOMParser } from "@xmldom/xmldom";
import type { NfeRow } from "./cols.js";
import { formatDhEmiBr } from "./datetime.js";
import { digits, findAllLocal, findFirstLocal, text } from "./dom-utils.js";

/** Ordem das colunas da aba de eventos (chaves internas) — fonte única. */
export const EVENTO_COLS = [
  "chNFe",
  "descEvento",
  "tpEvento",
  "nSeqEvento",
  "dhEvento",
  "nProt",
  "cStat",
  "xMotivo",
  "xJust",
  "autor",
  "nNF",
  "dhEmi",
  "emit_CNPJ",
  "emit_xNome",
  "dest_CNPJ",
  "dest_xNome",
  "vProd",
  "vinculo",
  "link",
  "arquivo",
] as const;

export type EventoColKey = (typeof EVENTO_COLS)[number];

export type EventoRow = Record<EventoColKey, string>;

export const EVENTO_HEADER_MAP: Record<EventoColKey, string> = {
  chNFe: "Chave NFe",
  descEvento: "Evento",
  tpEvento: "Cód. Evento",
  nSeqEvento: "Seq.",
  dhEvento: "Data do Evento",
  nProt: "Protocolo",
  cStat: "Status",
  xMotivo: "Motivo",
  xJust: "Justificativa",
  autor: "CNPJ/CPF Autor",
  nNF: "Nº NF",
  dhEmi: "Emissão NF",
  emit_CNPJ: "CNPJ Emit.",
  emit_xNome: "Nome Emit.",
  dest_CNPJ: "CNPJ Dest.",
  dest_xNome: "Nome Dest.",
  vProd: "Vlr Produtos",
  vinculo: "Vínculo",
  link: "Ir para a NF",
  arquivo: "Arquivo",
};

export function emptyEventoRow(): EventoRow {
  const r = {} as EventoRow;
  for (const c of EVENTO_COLS) r[c] = "";
  return r;
}

const TP_EVENTO_LABEL: Record<string, string> = {
  "110110": "Carta de Correção",
  "110111": "Cancelamento",
  "110112": "Cancelamento por Substituição",
  "110113": "EPEC",
  "110130": "Comprovante de Entrega da NF-e",
  "110131": "Cancelamento do Comprovante de Entrega",
  "110140": "EPEC (emissão em contingência)",
  "111500": "Pedido de Prorrogação (1º)",
  "111501": "Pedido de Prorrogação (2º)",
  "111502": "Cancelamento do Pedido de Prorrogação (1º)",
  "111503": "Cancelamento do Pedido de Prorrogação (2º)",
  "210200": "Confirmação da Operação",
  "210210": "Ciência da Operação",
  "210220": "Desconhecimento da Operação",
  "210240": "Operação não Realizada",
};

export const VINCULO_ENCONTRADO = "NF-e localizada nesta planilha";
export const VINCULO_AUSENTE = "NF-e não incluída no lote";

/** Eventos que de fato tornam a NF-e sem efeito. Carta de correção não entra. */
const TP_EVENTO_CANCELA = new Set(["110111", "110112"]);

/**
 * cStat de evento aceito pela SEFAZ: 135 (registrado e vinculado) e 155
 * (cancelamento homologado fora de prazo). Qualquer outro código é rejeição —
 * a nota continua válida.
 */
const CSTAT_ACEITO = new Set(["135", "155"]);

/**
 * Chaves das NF-e efetivamente canceladas. Quando o XML não traz `retEvento`
 * (sem resposta da SEFAZ), considera cancelada pelo tipo do evento — é o que o
 * arquivo afirma, e esconder isso seria pior do que sinalizar.
 */
export function chavesCanceladas(eventos: EventoRow[]): Set<string> {
  const chaves = new Set<string>();
  for (const e of eventos) {
    if (!TP_EVENTO_CANCELA.has(e.tpEvento)) continue;
    if (e.cStat && !CSTAT_ACEITO.has(e.cStat)) continue;
    if (e.chNFe) chaves.add(e.chNFe);
  }
  return chaves;
}

/**
 * Detecta evento de NF-e sem pagar o custo de montar o DOM.
 * `infEvento` só existe em `procEventoNFe`/`evento`/`retEvento` — nunca em uma NF-e.
 */
export function isEventoXml(xml: string): boolean {
  return /<(?:[A-Za-z0-9_.-]+:)?infEvento[\s>]/.test(xml);
}

/**
 * Extrai o evento (pedido + retorno) de um XML de `procEventoNFe`.
 * Retorna `null` quando o XML não é um evento reconhecível — nesse caso o
 * chamador deve tratá-lo pelo caminho normal de NF-e.
 */
export function parseEventoXml(xml: string, fileName: string): EventoRow | null {
  let root: ReturnType<DOMParser["parseFromString"]>;
  try {
    const parser = new DOMParser({
      errorHandler: {
        warning: () => undefined,
        error: () => undefined,
        fatalError: (e) => {
          throw new Error(e);
        },
      },
    });
    root = parser.parseFromString(xml, "application/xml");
  } catch {
    return null;
  }

  const docEl = root.documentElement;
  if (!docEl) return null;

  const infEventos = findAllLocal(docEl, "infEvento");
  if (infEventos.length === 0) return null;

  // `evento/infEvento` traz o pedido (dhEvento, detEvento); `retEvento/infEvento`
  // traz a resposta da SEFAZ (cStat, xMotivo, dhRegEvento).
  const ped =
    infEventos.find((el) => findFirstLocal(el, "detEvento") != null) ??
    infEventos.find((el) => findFirstLocal(el, "dhEvento") != null) ??
    infEventos[0]!;
  const ret = infEventos.find((el) => findFirstLocal(el, "cStat") != null) ?? null;

  const detEvento = findFirstLocal(ped, "detEvento");

  const pick = (name: string): string => {
    const fromPed = text(findFirstLocal(ped, name));
    if (fromPed) return fromPed;
    return ret ? text(findFirstLocal(ret, name)) : "";
  };

  const ch = digits(pick("chNFe"));
  const tpEvento = pick("tpEvento");
  if (!ch && !tpEvento) return null;

  const descEvento =
    (detEvento ? text(findFirstLocal(detEvento, "descEvento")) : "") ||
    (ret ? text(findFirstLocal(ret, "xEvento")) : "") ||
    TP_EVENTO_LABEL[tpEvento] ||
    "Evento não mapeado";

  const nProt =
    (detEvento ? text(findFirstLocal(detEvento, "nProt")) : "") ||
    (ret ? text(findFirstLocal(ret, "nProt")) : "");

  const autor = digits(text(findFirstLocal(ped, "CNPJ")) || text(findFirstLocal(ped, "CPF")));

  const dhEvento =
    formatDhEmiBr(pick("dhEvento")) ||
    (ret ? formatDhEmiBr(text(findFirstLocal(ret, "dhRegEvento"))) : "");

  const row = emptyEventoRow();
  row.chNFe = ch;
  row.descEvento = descEvento;
  row.tpEvento = tpEvento;
  row.nSeqEvento = pick("nSeqEvento");
  row.dhEvento = dhEvento;
  row.nProt = nProt;
  row.cStat = ret ? text(findFirstLocal(ret, "cStat")) : "";
  row.xMotivo = ret ? text(findFirstLocal(ret, "xMotivo")) : "";
  row.xJust = detEvento ? text(findFirstLocal(detEvento, "xJust")) : "";
  row.autor = autor;
  row.vinculo = VINCULO_AUSENTE;
  row.arquivo = fileName;
  return row;
}

function parseDecimal(s: string): number | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  const normalized =
    t.includes(",") && (t.match(/,/g) ?? []).length === 1
      ? t.replace(/\./g, "").replace(",", ".")
      : t;
  const n = Number.parseFloat(normalized);
  return Number.isNaN(n) ? null : n;
}

export interface EventoVinculado {
  values: EventoRow;
  /** Índice 0-based da primeira linha da NF-e em `rows`, ou `null` se ausente do lote. */
  produtoRowIndex: number | null;
}

/**
 * Cruza cada evento com a NF-e recíproca pela chave de 44 dígitos, copiando os
 * dados de identificação da nota e o total dos produtos.
 */
export function vincularEventos(
  eventos: EventoRow[],
  rows: NfeRow[]
): EventoVinculado[] {
  const firstIndex = new Map<string, number>();
  const somaProd = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const ch = digits(r.chNFe ?? "");
    if (ch.length !== 44) continue;
    if (!firstIndex.has(ch)) firstIndex.set(ch, i);
    const v = parseDecimal(r.vProd ?? "");
    if (v !== null) somaProd.set(ch, (somaProd.get(ch) ?? 0) + v);
  }

  return eventos.map((evento) => {
    const values: EventoRow = { ...evento };
    const idx = values.chNFe ? firstIndex.get(values.chNFe) : undefined;

    if (idx === undefined) {
      values.vinculo = VINCULO_AUSENTE;
      values.link = "";
      return { values, produtoRowIndex: null };
    }

    const nfe = rows[idx]!;
    values.nNF = nfe.nNF ?? "";
    values.dhEmi = nfe.dhEmi ?? "";
    values.emit_CNPJ = nfe.emit_CNPJ ?? "";
    values.emit_xNome = nfe.emit_xNome ?? "";
    values.dest_CNPJ = nfe.dest_CNPJ ?? "";
    values.dest_xNome = nfe.dest_xNome ?? "";
    const total = somaProd.get(values.chNFe);
    values.vProd = total === undefined ? "" : total.toFixed(2);
    values.vinculo = VINCULO_ENCONTRADO;
    // +2: cabeçalho na linha 1 e índice 0-based -> linha do Excel.
    values.link = `PRODUTOS · linha ${idx + 2}`;
    return { values, produtoRowIndex: idx };
  });
}
