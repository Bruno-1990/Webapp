/**
 * Monta a definição de documento pdfmake do DANFSe (Documento Auxiliar da
 * NFS-e) reproduzindo o layout oficial v1.0: cabeçalho com QR, faixa da chave,
 * e as seções Emitente, Tomador, Intermediário, Serviço, Tributação Municipal,
 * Tributação Federal, Valor Total, Totais Aproximados e Inf. Complementares.
 *
 * As células ficam numa grade de 4 colunas; faixas de seção ocupam as 4 (colSpan).
 */
import type { NfseData } from "./parseNfse.js";
import {
  DASH,
  fmtBRL,
  fmtCep,
  fmtCnpjCpf,
  fmtCodTrib,
  fmtData,
  fmtDataHora,
  fmtFone,
  fmtPct,
  joinEndereco,
  orDash,
  toNumber,
} from "./format.js";
import {
  fmtRegEspTrib,
  fmtRetIssqn,
  fmtRetPisCofins,
  fmtSimplesNacional,
  fmtSuspExig,
  fmtTribIssqn,
  issqnRetido,
  optanteSimplesNacional,
} from "./nfseEnums.js";
import { municipioLabel } from "./municipios.js";
import { NFSE_LOGO_DATAURL } from "./logoData.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Cell = any;
type Row = Cell[];

const COLS = 4;

const SN_APURACAO_TXT =
  "Regime de apuração dos tributos federais pelo Simples Nacional e o ISSQN pela NFS-e conforme respectiva legislação municipal do tributo";

function field(label: string, value: string, span = 1, bold = false): Cell {
  return {
    colSpan: span,
    stack: [
      { text: label, style: "lbl" },
      { text: value || DASH, style: bold ? "valB" : "val" },
    ],
  };
}

/** Completa a linha até 4 colunas; estende a última célula se sobrar espaço. */
function gridRow(cells: Cell[]): Row {
  const total = cells.reduce((s, c) => s + (c.colSpan ?? 1), 0);
  if (total < COLS && cells.length > 0) {
    cells[cells.length - 1].colSpan = (cells[cells.length - 1].colSpan ?? 1) + (COLS - total);
  }
  const out: Row = [];
  for (const c of cells) {
    out.push(c);
    const span = c.colSpan ?? 1;
    for (let i = 1; i < span; i++) out.push({});
  }
  return out;
}

function sectionRow(title: string, align: "left" | "center" = "left"): Row {
  return [{ text: title, colSpan: COLS, style: "sec", alignment: align }, {}, {}, {}];
}

function enderecoPessoa(p: {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
}): string {
  return joinEndereco([p.logradouro, p.numero, p.complemento, p.bairro]);
}

export function buildDanfseDoc(data: NfseData, qrImage: string | null): unknown {
  const body: Row[] = [];

  // ── Faixa: Chave de acesso + números ──────────────────────────────────
  body.push(gridRow([field("Chave de Acesso da NFS-e", orDash(data.chave), COLS)]));
  body.push(
    gridRow([
      field("Número da NFS-e", orDash(data.numeroNfse)),
      field("Competência da NFS-e", fmtData(data.competencia)),
      field("Data e Hora da emissão da NFS-e", fmtDataHora(data.dhEmiNfse), 2),
    ]),
  );
  body.push(
    gridRow([
      field("Número da DPS", orDash(data.numeroDps)),
      field("Série da DPS", orDash(data.serieDps)),
      field("Data e Hora da emissão da DPS", fmtDataHora(data.dhEmiDps), 2),
    ]),
  );

  // ── Emitente / Prestador ──────────────────────────────────────────────
  body.push(sectionRow("EMITENTE DA NFS-e — Prestador do Serviço"));
  body.push(
    gridRow([
      field("CNPJ / CPF / NIF", fmtCnpjCpf(data.emit.cnpjCpf), 2),
      field("Inscrição Municipal", orDash(data.emit.im)),
      field("Telefone", fmtFone(data.emit.fone)),
    ]),
  );
  body.push(
    gridRow([
      field("Nome / Nome Empresarial", orDash(data.emit.nome), 2),
      field("E-mail", orDash(data.emit.email), 2),
    ]),
  );
  body.push(
    gridRow([
      field("Endereço", enderecoPessoa(data.emit), 2),
      field("Município", municipioLabel(data.emit.cMun)),
      field("CEP", fmtCep(data.emit.cep)),
    ]),
  );
  body.push(
    gridRow([
      field("Simples Nacional na Data de Competência", fmtSimplesNacional(data.opSimpNac), 2),
      field(
        "Regime de Apuração Tributária pelo SN",
        optanteSimplesNacional(data.opSimpNac) ? SN_APURACAO_TXT : DASH,
        2,
      ),
    ]),
  );

  // ── Tomador ───────────────────────────────────────────────────────────
  body.push(sectionRow("TOMADOR DO SERVIÇO"));
  if (data.toma) {
    const t = data.toma;
    body.push(
      gridRow([
        field("CNPJ / CPF / NIF", fmtCnpjCpf(t.cnpjCpf), 2),
        field("Inscrição Municipal", orDash(t.im)),
        field("Telefone", fmtFone(t.fone)),
      ]),
    );
    body.push(
      gridRow([
        field("Nome / Nome Empresarial", orDash(t.nome), 2),
        field("E-mail", orDash(t.email), 2),
      ]),
    );
    body.push(
      gridRow([
        field("Endereço", enderecoPessoa(t), 2),
        field("Município", municipioLabel(t.cMun)),
        field("CEP", fmtCep(t.cep)),
      ]),
    );
  } else {
    body.push(gridRow([field("Tomador", "NÃO IDENTIFICADO NA NFS-e", COLS)]));
  }

  // ── Intermediário ─────────────────────────────────────────────────────
  if (data.interm) {
    const m = data.interm;
    body.push(sectionRow("INTERMEDIÁRIO DO SERVIÇO"));
    body.push(
      gridRow([
        field("CNPJ / CPF / NIF", fmtCnpjCpf(m.cnpjCpf), 2),
        field("Nome / Nome Empresarial", orDash(m.nome), 2),
      ]),
    );
  } else {
    body.push(sectionRow("INTERMEDIÁRIO DO SERVIÇO NÃO IDENTIFICADO NA NFS-e", "center"));
  }

  // ── Serviço prestado ──────────────────────────────────────────────────
  body.push(sectionRow("SERVIÇO PRESTADO"));
  body.push(
    gridRow([
      field("Código de Tributação Nacional", fmtCodTrib(data.cTribNac)),
      field("Código de Tributação Municipal", orDash(data.cTribMun)),
      field("Local da Prestação", orDash(data.localPrestacao)),
      field("País da Prestação", orDash(data.paisPrestacao)),
    ]),
  );
  body.push(gridRow([field("Descrição do Serviço", orDash(data.xDescServ), COLS)]));

  // ── Tributação municipal (layout oficial do DANFSe, NT-008) ───────────
  body.push(sectionRow("TRIBUTAÇÃO MUNICIPAL"));
  body.push(
    gridRow([
      field("Tributação do ISSQN", fmtTribIssqn(data.tribISSQN)),
      field("País Resultado da Prestação do Serviço", orDash(data.paisResultado)),
      field("Município de Incidência do ISSQN", orDash(data.cLocIncid ? municipioLabel(data.cLocIncid) : data.localIncidencia)),
      field("Regime Especial de Tributação", fmtRegEspTrib(data.regEspTrib)),
    ]),
  );
  body.push(
    gridRow([
      field("Tipo de Imunidade", orDash(data.tpImunidade)),
      field("Suspensão da Exigibilidade do ISSQN", fmtSuspExig(data.tpSusp)),
      field("Número Processo Suspensão", orDash(data.nProcSusp)),
      field("Benefício Municipal", orDash(data.benefMun)),
    ]),
  );
  body.push(
    gridRow([
      field("Valor do Serviço", fmtBRL(data.vServ)),
      field("Desconto Incondicionado", data.vDescIncond ? fmtBRL(data.vDescIncond) : DASH),
      field("Total Deduções / Reduções", data.vDeducao ? fmtBRL(data.vDeducao) : DASH),
      field("Cálculo do BM", data.calcBM ? fmtBRL(data.calcBM) : DASH),
    ]),
  );
  body.push(
    gridRow([
      field("BC ISSQN", data.vBC ? fmtBRL(data.vBC) : DASH),
      field("Alíquota Aplicada", data.pAliq ? fmtPct(data.pAliq) : DASH),
      field("Retenção do ISSQN", fmtRetIssqn(data.tpRetISSQN)),
      field("ISSQN Apurado", data.vISSQN ? fmtBRL(data.vISSQN) : DASH),
    ]),
  );

  // ── Tributação federal ────────────────────────────────────────────────
  // NT-007: vRetCSLL = soma das retenções de PIS+COFINS+CSLL; tpRetPisCofins
  // descreve o que foi retido; vPis/vCofins são débito de apuração própria.
  const vPisN = toNumber(data.vPis);
  const vCofinsN = toNumber(data.vCofins);
  const debitoPisCofins = (vPisN ?? 0) + (vCofinsN ?? 0);
  const temDebitoPisCofins = vPisN != null || vCofinsN != null;
  body.push(sectionRow("TRIBUTAÇÃO FEDERAL"));
  body.push(
    gridRow([
      field("IRRF", data.vRetIRRF ? fmtBRL(data.vRetIRRF) : DASH),
      field("Contribuição Previdenciária - Retida", data.vRetCP ? fmtBRL(data.vRetCP) : DASH),
      field("Contribuições Sociais - Retidas", data.vRetCSLL ? fmtBRL(data.vRetCSLL) : DASH),
      field("Descrição Contrib. Sociais - Retidas", data.tpRetPisCofins ? fmtRetPisCofins(data.tpRetPisCofins) : DASH),
    ]),
  );
  body.push(
    gridRow([
      field("PIS - Débito Apuração Própria", vPisN != null ? fmtBRL(vPisN) : DASH),
      field("COFINS - Débito Apuração Própria", vCofinsN != null ? fmtBRL(vCofinsN) : DASH),
    ]),
  );

  // ── Valor total da NFS-e ──────────────────────────────────────────────
  const issqnRet = issqnRetido(data.tpRetISSQN);
  body.push(sectionRow("VALOR TOTAL DA NFS-e"));
  body.push(
    gridRow([
      field("Valor do Serviço", fmtBRL(data.vServ)),
      field("Desconto Condicionado", data.vDescCond ? fmtBRL(data.vDescCond) : DASH),
      field("Desconto Incondicionado", data.vDescIncond ? fmtBRL(data.vDescIncond) : DASH),
      field("ISSQN Retido", issqnRet && data.vISSQN ? fmtBRL(data.vISSQN) : DASH),
    ]),
  );
  body.push(
    gridRow([
      field("Total das Retenções Federais", data.vTotalRet ? fmtBRL(data.vTotalRet) : DASH),
      field("PIS/COFINS - Débito Apur. Própria", temDebitoPisCofins ? fmtBRL(debitoPisCofins) : DASH, 3),
    ]),
  );
  body.push(
    gridRow([
      field("Valor Líquido da NFS-e", data.vLiq ? fmtBRL(data.vLiq) : DASH, COLS, true),
    ]),
  );

  // ── Totais aproximados dos tributos ───────────────────────────────────
  body.push(sectionRow("TOTAIS APROXIMADOS DOS TRIBUTOS"));
  body.push(
    gridRow([
      field("Federais", data.pTotTribFed ? fmtPct(data.pTotTribFed) : DASH),
      field("Estaduais", data.pTotTribEst ? fmtPct(data.pTotTribEst) : DASH),
      field("Municipais", data.pTotTribMun ? fmtPct(data.pTotTribMun) : DASH),
    ]),
  );

  // ── Informações complementares ────────────────────────────────────────
  body.push(sectionRow("INFORMAÇÕES COMPLEMENTARES"));
  body.push(gridRow([field("", orDash(data.xInfComp), COLS)]));

  const headerRight: Cell[] = [];
  if (qrImage) headerRight.push({ image: qrImage, width: 72, alignment: "right" });
  headerRight.push({ text: orDash(data.localEmissao), style: "hdMun" });
  headerRight.push({
    text: "A autenticidade desta NFS-e pode ser verificada pela leitura do QR ou pela consulta da chave no portal nacional da NFS-e.",
    style: "hdNote",
  });

  return {
    pageSize: "A4",
    pageMargins: [28, 22, 28, 22],
    defaultStyle: { font: "Roboto", fontSize: 8, color: "#161616" },
    content: [
      {
        columns: [
          { width: 96, image: NFSE_LOGO_DATAURL, fit: [96, 50], margin: [0, 2, 0, 0] },
          {
            width: "*",
            stack: [
              { text: "DANFSe", style: "title" },
              { text: "Documento Auxiliar da NFS-e", style: "subtitle" },
              { text: "versão 1.0", style: "subtitle2" },
            ],
            alignment: "center",
            margin: [0, 6, 0, 0],
          },
          { width: 128, stack: headerRight, alignment: "right" },
        ],
        columnGap: 8,
        margin: [0, 0, 0, 4],
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 539, y2: 0, lineWidth: 1, lineColor: "#2f7d96" }], margin: [0, 0, 0, 4] },
      {
        table: { headerRows: 0, widths: ["*", "*", "*", "*"], body },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => "#b7c6cc",
          vLineColor: () => "#b7c6cc",
          paddingLeft: () => 5,
          paddingRight: () => 5,
          paddingTop: () => 1.6,
          paddingBottom: () => 2.4,
        },
      },
    ],
    styles: {
      title: { fontSize: 17, bold: true, color: "#1f6f8b", letterSpacing: 1 },
      subtitle: { fontSize: 8.5, color: "#3a3a3a" },
      subtitle2: { fontSize: 7, color: "#7a8a90" },
      hdMun: { fontSize: 8, bold: true, alignment: "right", margin: [0, 3, 0, 0] },
      hdNote: { fontSize: 5.5, color: "#6b7a80", alignment: "right", margin: [0, 2, 0, 0] },
      sec: { fontSize: 8, bold: true, color: "#10333f", fillColor: "#dfe8ec", margin: [0, 0.5, 0, 0.5] },
      lbl: { fontSize: 6, color: "#7a8a90" },
      val: { fontSize: 8.5, color: "#161616" },
      valB: { fontSize: 10, bold: true, color: "#1f6f8b" },
    },
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
