import { DOMParser } from "@xmldom/xmldom";
import { COLS, emptyRow, type NfeRow } from "./cols.js";
import {
  digits,
  findAllLocal,
  findFirstLocal,
  firstGrandchildElement,
  text,
} from "./dom-utils.js";

const IND_PRES_LABEL: Record<string, string> = {
  "0": "Não se aplica",
  "1": "Operação presencial",
  "2": "Operação não presencial, pela Internet",
  "3": "Operação não presencial, Teleatendimento",
  "4": "NFC-e em operação com entrega a domicílio",
  "5": "Operação presencial, fora do estabelecimento",
  "9": "Operação não presencial, outros",
};

const FIN_NFE_LABEL: Record<string, string> = {
  "1": "NF-e normal",
  "2": "NF-e complementar",
  "3": "NF-e de ajuste",
  "4": "NF-e de devolução/retorno",
};

function codeWithLabel(code: string, labels: Record<string, string>): string {
  const c = code.trim();
  if (!c) return "";
  const label = labels[c];
  return label ? `${c} - ${label}` : `${c} - Código não mapeado`;
}

function formatDhEmiBr(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  // ISO comum da NF-e: 2025-09-22T12:42:01-03:00
  const mIso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2}))?/);
  if (mIso) {
    const yyyy = mIso[1]!;
    const mm = mIso[2]!;
    const dd = mIso[3]!;
    const hh = mIso[4];
    const mi = mIso[5];
    const ss = mIso[6];
    if (hh && mi && ss) return `${dd}/${mm}/${yyyy} - ${hh}:${mi}:${ss}`;
    return `${dd}/${mm}/${yyyy}`;
  }
  // Quando já vier sem timezone, só normaliza o separador de data/hora.
  const mBr = t.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T-]+(\d{2})[:/](\d{2})[:/](\d{2}))?$/);
  if (mBr) {
    const dd = mBr[1]!;
    const mm = mBr[2]!;
    const yyyy = mBr[3]!;
    const hh = mBr[4];
    const mi = mBr[5];
    const ss = mBr[6];
    if (hh && mi && ss) return `${dd}/${mm}/${yyyy} - ${hh}:${mi}:${ss}`;
    return `${dd}/${mm}/${yyyy}`;
  }
  return t;
}

function rowWithKeys(partial: Partial<NfeRow>): NfeRow {
  const r = emptyRow();
  for (const k of COLS) {
    if (partial[k] !== undefined) r[k] = partial[k]!;
  }
  return r;
}

export function parseNfeXml(xml: string, fileName: string): NfeRow[] {
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
  } catch (e) {
    const r = emptyRow();
    r.chNFe = `ERRO_PARSE: ${fileName}`;
    r.xProd = e instanceof Error ? e.message : String(e);
    return [r];
  }

  const docEl = root.documentElement;
  if (!docEl) {
    const r = emptyRow();
    r.chNFe = `ERRO_PARSE: ${fileName}`;
    r.xProd = "Documento sem elemento raiz";
    return [r];
  }

  const infNFe =
    findFirstLocal(docEl, "NFe/infNFe") ??
    findFirstLocal(docEl, "procNFe/NFe/infNFe") ??
    findFirstLocal(docEl, "infNFe");

  let descricao = "";
  if (infNFe) {
    const infAdic = findFirstLocal(infNFe, "infAdic");
    const infCpl = infAdic ? findFirstLocal(infAdic, "infCpl") : null;
    descricao = text(infCpl);
  }
  if (!descricao) {
    for (const el of findAllLocal(docEl, "infCpl")) {
      const t = text(el);
      if (t) {
        descricao = t;
        break;
      }
    }
  }

  let ch = "";
  for (const cand of ["protNFe/infProt/chNFe", "infProt/chNFe", "chNFe"] as const) {
    const el = findFirstLocal(docEl, cand);
    const v = text(el);
    if (v) {
      ch = digits(v);
      break;
    }
  }
  if (!ch && infNFe) {
    const idAttr = infNFe.getAttribute("Id") ?? "";
    const m = idAttr.match(/NFe(\d{44})/);
    if (m) ch = m[1]!;
  }

  const ide = infNFe ? findFirstLocal(infNFe, "ide") : null;
  const emit = infNFe ? findFirstLocal(infNFe, "emit") : null;
  const dest = infNFe ? findFirstLocal(infNFe, "dest") : null;

  const indPresRaw = ide ? text(findFirstLocal(ide, "indPres")) : "";
  const finNFeRaw = ide ? text(findFirstLocal(ide, "finNFe")) : "";
  const base: Partial<NfeRow> = {
    indPres: codeWithLabel(indPresRaw, IND_PRES_LABEL),
    indPres_raw: indPresRaw,
    finNFe: codeWithLabel(finNFeRaw, FIN_NFE_LABEL),
    finNFe_raw: finNFeRaw,
    chNFe: ch,
    nNF: ide ? text(findFirstLocal(ide, "nNF")) : "",
    dhEmi: ide
      ? formatDhEmiBr(text(findFirstLocal(ide, "dhEmi")) || text(findFirstLocal(ide, "dEmi")))
      : "",
    tpNF: ide ? text(findFirstLocal(ide, "tpNF")) : "",
    emit_CNPJ: emit ? digits(text(findFirstLocal(emit, "CNPJ"))) : "",
    emit_xNome: emit ? text(findFirstLocal(emit, "xNome")) : "",
    dest_CNPJ: dest ? digits(text(findFirstLocal(dest, "CNPJ"))) : "",
    dest_xNome: dest ? text(findFirstLocal(dest, "xNome")) : "",
  };
  const indIntermedRaw = ide ? text(findFirstLocal(ide, "indIntermed")) : "";
  const alertaFiscal =
    ["2", "9"].includes(indPresRaw) && indIntermedRaw === "1"
      ? "⚠ Atenção: operação não presencial com intermediação (marketplace). Revise os dados do intermediador e a escrituração fiscal."
      : "";

  const rows: NfeRow[] = [];
  const detList = infNFe ? findAllLocal(infNFe, "det") : [];

  for (const det of detList) {
    const prod = findFirstLocal(det, "prod");
    if (!prod) continue;

    const icmsParent =
      findFirstLocal(det, "imposto/ICMS") ?? findFirstLocal(det, "ICMS");
    const icmsAny = firstGrandchildElement(icmsParent);

    const pisParent =
      findFirstLocal(det, "imposto/PIS") ?? findFirstLocal(det, "PIS");
    const pisAny = firstGrandchildElement(pisParent);

    const cofParent =
      findFirstLocal(det, "imposto/COFINS") ?? findFirstLocal(det, "COFINS");
    const cofAny = firstGrandchildElement(cofParent);

    const ipiParent =
      findFirstLocal(det, "imposto/IPI") ?? findFirstLocal(det, "IPI");
    const ipiAny =
      (ipiParent && findFirstLocal(ipiParent, "IPITrib")) ||
      (ipiParent && findFirstLocal(ipiParent, "IPINT")) ||
      ipiParent;

    const row = rowWithKeys({
      ...base,
      cProd: text(findFirstLocal(prod, "cProd")),
      xProd: text(findFirstLocal(prod, "xProd")),
      NCM: text(findFirstLocal(prod, "NCM")),
      CFOP: text(findFirstLocal(prod, "CFOP")),
      uCom: text(findFirstLocal(prod, "uCom")),
      qCom: text(findFirstLocal(prod, "qCom")),
      vUnCom: text(findFirstLocal(prod, "vUnCom")),
      vProd: text(findFirstLocal(prod, "vProd")),
      "CSOSN/CST":
        (icmsAny ? text(findFirstLocal(icmsAny, "CSOSN")) : "") ||
        (icmsAny ? text(findFirstLocal(icmsAny, "CST")) : ""),
      orig: icmsAny ? text(findFirstLocal(icmsAny, "orig")) : "",
      pICMS: icmsAny ? text(findFirstLocal(icmsAny, "pICMS")) : "",
      vICMS: icmsAny ? text(findFirstLocal(icmsAny, "vICMS")) : "",
      pIPI: ipiAny ? text(findFirstLocal(ipiAny, "pIPI")) : "",
      vIPI: ipiAny ? text(findFirstLocal(ipiAny, "vIPI")) : "",
      pPIS: pisAny ? text(findFirstLocal(pisAny, "pPIS")) : "",
      vPIS: pisAny ? text(findFirstLocal(pisAny, "vPIS")) : "",
      pCOFINS: cofAny ? text(findFirstLocal(cofAny, "pCOFINS")) : "",
      vCOFINS: cofAny ? text(findFirstLocal(cofAny, "vCOFINS")) : "",
      "Alerta Fiscal": alertaFiscal,
      Descrição: descricao,
    });
    rows.push(row);
  }

  return rows;
}
