/**
 * Parser dos XMLs de NFS-e do padrão nacional (namespace
 * `http://www.sped.fazenda.gov.br/nfse`) usando `DOMParser` nativo do browser.
 *
 * Distingue dois tipos pela tag-raiz (ignorando namespace):
 *  - `<NFSe>`   → documento fiscal (gera DANFSe);
 *  - `<evento>` → evento (ex.: cancelamento por substituição) → PDF de evento.
 *
 * Busca de tags por *local name* via `getElementsByTagNameNS("*", ...)`, igual à
 * abordagem do `xml_parser.py` da engine `comparacao-nfse` (ignora prefixos/ns).
 */

export type Pessoa = {
  cnpjCpf: string;
  nome: string;
  im: string;
  fone: string;
  email: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cMun: string;
  uf: string;
  cep: string;
};

export type NfseData = {
  kind: "nfse";
  chave: string;
  numeroNfse: string;
  dhEmiNfse: string;
  competencia: string;
  numeroDps: string;
  serieDps: string;
  dhEmiDps: string;
  localEmissao: string;
  localPrestacao: string;
  localIncidencia: string;
  cLocIncid: string;
  emit: Pessoa;
  opSimpNac: string;
  regEspTrib: string;
  toma: Pessoa | null;
  interm: Pessoa | null;
  cTribNac: string;
  cTribMun: string;
  xDescServ: string;
  paisPrestacao: string;
  // Tributação municipal
  tribISSQN: string;
  tpRetISSQN: string;
  paisResultado: string;
  tpImunidade: string;
  tpSusp: string;
  nProcSusp: string;
  benefMun: string;
  calcBM: string;
  vBC: string;
  pAliq: string;
  vISSQN: string;
  vDeducao: string;
  // Tributação federal
  vRetIRRF: string;
  vRetCP: string;
  vRetCSLL: string; // soma das retenções de PIS+COFINS+CSLL (NT-007)
  tpRetPisCofins: string; // discrimina quais contrib. sociais foram retidas
  vPis: string; // débito de apuração própria (não é retenção)
  vCofins: string; // débito de apuração própria (não é retenção)
  // Valor total
  vServ: string;
  vDescCond: string;
  vDescIncond: string;
  vTotalRet: string;
  vLiq: string;
  // Totais aproximados dos tributos
  pTotTribFed: string;
  pTotTribEst: string;
  pTotTribMun: string;
  // Informações complementares
  xInfComp: string;
};

export type EventoData = {
  kind: "evento";
  chave: string;
  /** Código do tipo de evento (ex.: "101101" = cancelamento). Vem do nome `e<dígitos>`. */
  tpEvento: string;
  tipo: string;
  cMotivo: string;
  xMotivo: string;
  chSubstituta: string;
  cnpjAutor: string;
  dhEvento: string;
  dhProc: string;
  nSeqEvento: string;
};

export type ParsedXml =
  | NfseData
  | EventoData
  | { kind: "unknown"; reason: string };

function firstByLocal(scope: Element | Document, name: string): Element | null {
  const list = scope.getElementsByTagNameNS("*", name);
  return list.length ? list[0] : null;
}

/**
 * Primeiro filho DIRETO com esse local name. Necessário para o bloco `valores`:
 * o `infNFSe` tem o `valores` da apuração municipal (vBC, pAliqAplic, vISSQN, vLiq)
 * E, aninhado em `DPS/infDPS`, um segundo `valores` (declarado). Usar filho direto
 * garante que pegamos a apuração do `infNFSe`, não o `valores` do DPS.
 */
function directChild(parent: Element | null, name: string): Element | null {
  if (!parent) return null;
  for (const node of Array.from(parent.children)) {
    if (node.localName === name) return node;
  }
  return null;
}

function txt(scope: Element | Document | null, name: string): string {
  if (!scope) return "";
  return firstByLocal(scope, name)?.textContent?.trim() ?? "";
}

/** Primeiro nome de tag que existir (campos com nomes alternativos no leiaute). */
function txtAny(scope: Element | Document | null, names: string[]): string {
  if (!scope) return "";
  for (const n of names) {
    const v = txt(scope, n);
    if (v) return v;
  }
  return "";
}

/** CNPJ ou CPF (o que existir no escopo). */
function cnpjCpfOf(scope: Element | null): string {
  return txtAny(scope, ["CNPJ", "CPF", "NIF"]);
}

function pessoaEmit(emit: Element | null): Pessoa {
  return {
    cnpjCpf: cnpjCpfOf(emit),
    nome: txt(emit, "xNome"),
    im: txtAny(emit, ["IM", "im"]),
    fone: txt(emit, "fone"),
    email: txt(emit, "email"),
    logradouro: txt(emit, "xLgr"),
    numero: txt(emit, "nro"),
    complemento: txt(emit, "xCpl"),
    bairro: txt(emit, "xBairro"),
    cMun: txt(emit, "cMun"),
    uf: txt(emit, "UF"),
    cep: txt(emit, "CEP"),
  };
}

/** Tomador/Intermediário: endereço pode ter `xLgr/nro` soltos em `end` e cMun/CEP em `endNac`. */
function pessoaToma(scope: Element | null): Pessoa {
  return {
    cnpjCpf: cnpjCpfOf(scope),
    nome: txt(scope, "xNome"),
    im: txtAny(scope, ["IM", "im"]),
    fone: txt(scope, "fone"),
    email: txt(scope, "email"),
    logradouro: txt(scope, "xLgr"),
    numero: txt(scope, "nro"),
    complemento: txt(scope, "xCpl"),
    bairro: txt(scope, "xBairro"),
    cMun: txt(scope, "cMun"),
    uf: txt(scope, "UF"),
    cep: txt(scope, "CEP"),
  };
}

function chaveFromId(el: Element | null): string {
  const id = el?.getAttribute("Id") ?? "";
  // Id da NFS-e vem como "NFS<50 dígitos>"; tira o prefixo não numérico.
  const digits = id.replace(/\D+/g, "");
  if (digits.length >= 44) return digits;
  return id.replace(/^NFS/i, "");
}

function parseNfse(doc: Document): NfseData {
  const infNFSe = firstByLocal(doc, "infNFSe");
  const dps = firstByLocal(doc, "infDPS");
  const emit = firstByLocal(doc, "emit");
  const prest = firstByLocal(doc, "prest");
  const toma = firstByLocal(doc, "toma");
  const interm = firstByLocal(doc, "interm") ?? firstByLocal(doc, "TSInterm");
  /** Bloco da apuração municipal (filho direto de infNFSe): vBC, pAliqAplic, vISSQN, vLiq. */
  const valNFSe = directChild(infNFSe, "valores") ?? infNFSe;

  return {
    kind: "nfse",
    chave: chaveFromId(infNFSe),
    numeroNfse: txt(infNFSe, "nNFSe"),
    dhEmiNfse: txt(infNFSe, "dhProc"),
    competencia: txt(dps, "dCompet"),
    numeroDps: txt(dps, "nDPS"),
    serieDps: txt(dps, "serie"),
    dhEmiDps: txt(dps, "dhEmi"),
    localEmissao: txt(infNFSe, "xLocEmi"),
    localPrestacao: txt(infNFSe, "xLocPrestacao"),
    localIncidencia: txt(infNFSe, "xLocIncid"),
    cLocIncid: txt(infNFSe, "cLocIncid"),
    emit: pessoaEmit(emit),
    opSimpNac: txt(prest, "opSimpNac"),
    regEspTrib: txt(prest, "regEspTrib"),
    toma: toma ? pessoaToma(toma) : null,
    interm: interm ? pessoaToma(interm) : null,
    cTribNac: txt(dps, "cTribNac"),
    cTribMun: txt(dps, "cTribMun"),
    xDescServ: txt(dps, "xDescServ"),
    paisPrestacao: txtAny(dps, ["xPaisPrestacao", "cPaisPrestacao", "cPaisPres"]),
    tribISSQN: txtAny(dps, ["tribISSQN"]),
    tpRetISSQN: txt(dps, "tpRetISSQN"),
    paisResultado: txtAny(dps, ["xPaisResultado", "cPaisResultado", "cPaisRes"]),
    tpImunidade: txt(dps, "tpImunidade"),
    tpSusp: txt(dps, "tpSusp"),
    nProcSusp: txtAny(dps, ["nProcesso", "nProcessoSusp", "nProcSusp"]),
    benefMun: txtAny(infNFSe, ["xBenef", "cBenefMun", "tpBM"]),
    calcBM: txtAny(infNFSe, ["vCalcBM", "vRedBCB", "vDedRed"]),
    vBC: txtAny(valNFSe, ["vBC", "vBCISSQN"]),
    pAliq: txtAny(valNFSe, ["pAliqAplic", "pAliq"]),
    vISSQN: txt(valNFSe, "vISSQN"),
    vDeducao: txtAny(dps, ["vDeducaoReducao", "vDeducao"]),
    vRetIRRF: txt(dps, "vRetIRRF"),
    vRetCP: txtAny(dps, ["vRetCP", "vRetPrev"]),
    vRetCSLL: txt(dps, "vRetCSLL"),
    tpRetPisCofins: txt(dps, "tpRetPisCofins"),
    vPis: txt(dps, "vPis"),
    vCofins: txt(dps, "vCofins"),
    vServ: txt(dps, "vServ"),
    vDescCond: txt(dps, "vDescCondicionado"),
    vDescIncond: txt(dps, "vDescIncondicionado"),
    vTotalRet: txt(infNFSe, "vTotalRet"),
    vLiq: txtAny(valNFSe, ["vLiq"]) || txt(infNFSe, "vLiq"),
    pTotTribFed: txt(infNFSe, "pTotTribFed"),
    pTotTribEst: txt(infNFSe, "pTotTribEst"),
    pTotTribMun: txt(infNFSe, "pTotTribMun"),
    xInfComp: txt(dps, "xInfComp"),
  };
}

function parseEvento(doc: Document): EventoData {
  const infPedReg = firstByLocal(doc, "infPedReg");
  const infEvento = firstByLocal(doc, "infEvento");
  // Detalhe do evento: filho de infPedReg cujo nome é "e" + dígitos (ex.: e105102).
  let detalhe: Element | null = null;
  if (infPedReg) {
    for (const node of Array.from(infPedReg.childNodes)) {
      if (node.nodeType === 1) {
        const child = node as Element;
        if (/^e\d+$/i.test(child.localName)) {
          detalhe = child;
          break;
        }
      }
    }
  }
  // Código do evento: dígitos do nome `e<dígitos>` (ex.: e101101 → "101101").
  // Fallback: dígitos após "EVT" no Id de infEvento (ex.: EVT<chave><tpEvento><nSeq>) — como o
  // Id embute a chave (44/50 díg.) antes do tipo, extraímos o miolo após remover a chave.
  let tpEvento = detalhe ? detalhe.localName.replace(/\D+/g, "") : "";
  if (!tpEvento) {
    const chNfse = txt(infPedReg, "chNFSe").replace(/\D+/g, "");
    const evtDigits = (infEvento?.getAttribute("Id") ?? "").replace(/\D+/g, "");
    const afterChave = chNfse && evtDigits.includes(chNfse)
      ? evtDigits.slice(evtDigits.indexOf(chNfse) + chNfse.length)
      : evtDigits;
    tpEvento = afterChave.slice(0, 6); // tpEvento tem 6 dígitos no padrão nacional
  }
  return {
    kind: "evento",
    chave: txt(infPedReg, "chNFSe"),
    tpEvento,
    tipo: txt(detalhe, "xDesc"),
    cMotivo: txt(detalhe, "cMotivo"),
    xMotivo: txt(detalhe, "xMotivo"),
    chSubstituta: txt(detalhe, "chSubstituta"),
    cnpjAutor: txtAny(infPedReg, ["CNPJAutor", "CPFAutor"]),
    dhEvento: txt(infPedReg, "dhEvento"),
    dhProc: txt(infEvento, "dhProc"),
    nSeqEvento: txt(infEvento, "nSeqEvento"),
  };
}

/** Faz o parse de um texto XML já lido. */
export function parseNfseXml(xmlText: string): ParsedXml {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmlText, "application/xml");
  } catch {
    return { kind: "unknown", reason: "XML inválido" };
  }
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return { kind: "unknown", reason: "XML malformado" };
  }
  const root = doc.documentElement;
  const rootName = root?.localName ?? "";

  if (firstByLocal(doc, "infNFSe")) return parseNfse(doc);
  if (firstByLocal(doc, "infEvento") || rootName === "evento") return parseEvento(doc);
  return { kind: "unknown", reason: `Raiz não reconhecida: <${rootName || "?"}>` };
}

/** Lê o File e devolve o parse. */
export async function parseNfseFile(file: File): Promise<ParsedXml> {
  const text = await file.text();
  return parseNfseXml(text);
}

/**
 * Valor Líquido da NFS-e calculado a partir dos componentes exibidos no bloco
 * "VALOR TOTAL DA NFS-e" do DANFSe — robusto a descontos:
 *
 *   vLiq = vServ − Desc. Condicionado − Desc. Incondicionado
 *          − ISSQN Retido (se tpRetISSQN = 2/3) − Retenções Federais (IRRF + CP + CSLL)
 *
 * Validado contra o `vLiq` do XML em amostra real (bateu 82/82, inclusive com
 * retenção). Calcular garante que o desconto SEMPRE entra, mesmo quando o campo
 * `vLiq` do XML não o subtrai.
 */
export function valorLiquidoNfse(d: NfseData): number {
  const n = (s: string): number => {
    const v = parseFloat((s || "").replace(",", "."));
    return Number.isFinite(v) ? v : 0;
  };
  const issqnRet = d.tpRetISSQN === "2" || d.tpRetISSQN === "3" ? n(d.vISSQN) : 0;
  return (
    n(d.vServ) -
    n(d.vDescCond) -
    n(d.vDescIncond) -
    issqnRet -
    n(d.vRetIRRF) -
    n(d.vRetCP) -
    n(d.vRetCSLL)
  );
}
