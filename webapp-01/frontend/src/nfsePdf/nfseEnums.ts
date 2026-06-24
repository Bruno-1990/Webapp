/**
 * Mapas código→texto do leiaute nacional da NFS-e (padrão sped.fazenda.gov.br/nfse).
 * Cobrimos os campos exibidos no DANFSe. Código desconhecido cai num rótulo
 * genérico ("Código N") em vez de quebrar — mantém o PDF sempre legível.
 */

function lookup(map: Record<string, string>, code: string | null | undefined): string {
  const c = (code ?? "").trim();
  if (!c) return "-";
  return map[c] ?? `Código ${c}`;
}

/** opSimpNac — Situação perante o Simples Nacional na competência. */
const OP_SIMP_NAC: Record<string, string> = {
  "1": "Não Optante",
  "2": "Optante - Microempreendedor Individual (MEI)",
  "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)",
};
export const optanteSimplesNacional = (code: string | null | undefined): boolean =>
  (code ?? "").trim() === "2" || (code ?? "").trim() === "3";
export const fmtSimplesNacional = (code: string | null | undefined): string =>
  lookup(OP_SIMP_NAC, code);

/** regEspTrib — Regime Especial de Tributação. */
const REG_ESP_TRIB: Record<string, string> = {
  "0": "Nenhum",
  "1": "Ato Cooperado (Cooperativa)",
  "2": "Estimativa",
  "3": "Microempresa Municipal",
  "4": "Notário ou Registrador",
  "5": "Profissional Autônomo",
  "6": "Sociedade de Profissionais",
};
export const fmtRegEspTrib = (code: string | null | undefined): string =>
  lookup(REG_ESP_TRIB, code);

/** tribISSQN — Tributação do ISSQN sobre a operação. */
const TRIB_ISSQN: Record<string, string> = {
  "1": "Operação Tributável",
  "2": "Imunidade",
  "3": "Exportação de Serviço",
  "4": "Não Incidência",
};
export const fmtTribIssqn = (code: string | null | undefined): string =>
  lookup(TRIB_ISSQN, code);

/** tpRetISSQN — Retenção do ISSQN. */
const TP_RET_ISSQN: Record<string, string> = {
  "1": "Não Retido",
  "2": "Retido pelo Tomador",
  "3": "Retido pelo Intermediário",
};
export const fmtRetIssqn = (code: string | null | undefined): string =>
  lookup(TP_RET_ISSQN, code);

/** True quando o ISSQN foi retido (pelo tomador ou intermediário). */
export const issqnRetido = (code: string | null | undefined): boolean => {
  const c = (code ?? "").trim();
  return c === "2" || c === "3";
};

/**
 * tpRetPisCofins — Tipo de Retenção PIS/COFINS e CSLL (NT-007 CGNFSe v1.0).
 * Discrimina quais contribuições sociais foram retidas. Os valores retidos de
 * PIS, COFINS e CSLL são SOMADOS no campo `vRetCSLL`; `vPis`/`vCofins` são
 * apenas débito de apuração própria, não retenção.
 */
const TP_RET_PIS_COFINS: Record<string, string> = {
  "0": "PIS/COFINS/CSLL Não Retidos",
  "1": "PIS/COFINS Retido", // legado (suprimido quando IBS/CBS for obrigatório)
  "2": "PIS/COFINS Não Retidos", // legado
  "3": "PIS/COFINS/CSLL Retidos",
  "4": "PIS/COFINS Retidos, CSLL Não Retido",
  "5": "PIS Retido, COFINS/CSLL Não Retido",
  "6": "COFINS Retido, PIS/CSLL Não Retido",
  "7": "PIS Não Retido, COFINS/CSLL Retidos",
  "8": "PIS/COFINS Não Retidos, CSLL Retido",
  "9": "COFINS Não Retido, PIS/CSLL Retidos",
};
/** Igual ao DANFSe oficial: "3 - PIS/COFINS/CSLL Retidos" (código + descrição). */
export const fmtRetPisCofins = (code: string | null | undefined): string => {
  const c = (code ?? "").trim();
  if (!c) return "-";
  const desc = TP_RET_PIS_COFINS[c];
  return desc ? `${c} - ${desc}` : `Código ${c}`;
};

/** tpSusp — Suspensão da Exigibilidade do ISSQN. Ausente/0 → "Não". */
const TP_SUSP: Record<string, string> = {
  "1": "Exigibilidade Suspensa por Decisão Judicial",
  "2": "Exigibilidade Suspensa por Processo Administrativo",
};
export const fmtSuspExig = (code: string | null | undefined): string => {
  const c = (code ?? "").trim();
  if (!c || c === "0") return "Não";
  return TP_SUSP[c] ?? "Sim";
};
