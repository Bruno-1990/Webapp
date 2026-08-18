import { describe, expect, it } from "vitest";
import { consolidateXmlsFull } from "./consolidate.js";
import {
  VINCULO_AUSENTE,
  VINCULO_ENCONTRADO,
  chavesCanceladas,
  isEventoXml,
  parseEventoXml,
  vincularEventos,
} from "./evento.js";

const CHAVE = "32260713841087000171550000000192911002835206";

const cancelamento = `<?xml version="1.0"?>
<procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <evento versao="1.00">
    <infEvento Id="ID1101113226071384108700017155000000019291100283520601">
      <cOrgao>32</cOrgao>
      <tpAmb>1</tpAmb>
      <CNPJ>13841087000171</CNPJ>
      <chNFe>${CHAVE}</chNFe>
      <dhEvento>2026-07-03T09:25:54-03:00</dhEvento>
      <tpEvento>110111</tpEvento>
      <nSeqEvento>1</nSeqEvento>
      <detEvento versao="1.00">
        <descEvento>Cancelamento</descEvento>
        <nProt>232260104069673</nProt>
        <xJust>ERRO DE EMISSAO</xJust>
      </detEvento>
    </infEvento>
  </evento>
  <retEvento versao="1.00">
    <infEvento>
      <cStat>135</cStat>
      <xMotivo>Evento registrado e vinculado a NF-e</xMotivo>
      <chNFe>${CHAVE}</chNFe>
      <tpEvento>110111</tpEvento>
      <nSeqEvento>1</nSeqEvento>
      <dhRegEvento>2026-07-03T09:25:55-03:00</dhRegEvento>
      <nProt>232260104069674</nProt>
    </infEvento>
  </retEvento>
</procEventoNFe>`;

const nfe = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${CHAVE}">
    <ide>
      <nNF>19291</nNF>
      <dhEmi>2026-07-03T09:25:45-03:00</dhEmi>
      <tpNF>1</tpNF>
    </ide>
    <emit><CNPJ>13841087000171</CNPJ><xNome>METALTELAS</xNome></emit>
    <dest><CNPJ>98765432000188</CNPJ><xNome>WVS CONSTRUTORA</xNome></dest>
    <det nItem="1"><prod><cProd>1</cProd><xProd>Tela</xProd><vProd>400.00</vProd></prod></det>
    <det nItem="2"><prod><cProd>2</cProd><xProd>Arame</xProd><vProd>295.00</vProd></prod></det>
  </infNFe>
</NFe>`;

describe("isEventoXml", () => {
  it("reconhece evento e ignora NF-e", () => {
    expect(isEventoXml(cancelamento)).toBe(true);
    expect(isEventoXml(nfe)).toBe(false);
  });
});

describe("parseEventoXml", () => {
  it("extrai dados do pedido e do retorno da SEFAZ", () => {
    const ev = parseEventoXml(cancelamento, "cancel.xml")!;
    expect(ev).not.toBeNull();
    expect(ev.chNFe).toBe(CHAVE);
    expect(ev.tpEvento).toBe("110111");
    expect(ev.descEvento).toBe("Cancelamento");
    expect(ev.nSeqEvento).toBe("1");
    expect(ev.dhEvento).toBe("03/07/2026 - 09:25:54");
    expect(ev.nProt).toBe("232260104069673");
    expect(ev.xJust).toBe("ERRO DE EMISSAO");
    expect(ev.cStat).toBe("135");
    expect(ev.xMotivo).toBe("Evento registrado e vinculado a NF-e");
    expect(ev.autor).toBe("13841087000171");
    expect(ev.arquivo).toBe("cancel.xml");
  });

  it("rotula pelo tpEvento quando não há descEvento", () => {
    const semDesc = cancelamento
      .replace("<descEvento>Cancelamento</descEvento>", "")
      .replace("<tpEvento>110111</tpEvento>", "<tpEvento>110110</tpEvento>");
    expect(parseEventoXml(semDesc, "cce.xml")!.descEvento).toBe("Carta de Correção");
  });

  it("devolve null para XML que não é evento", () => {
    expect(parseEventoXml(nfe, "nfe.xml")).toBeNull();
  });
});

describe("consolidateXmlsFull", () => {
  it("separa eventos da aba de produtos", () => {
    const { rows, eventos } = consolidateXmlsFull([
      { fileName: "nfe.xml", content: nfe },
      { fileName: "cancel.xml", content: cancelamento },
    ]);
    expect(eventos.length).toBe(1);
    expect(rows.length).toBe(2); // dois itens, sem linha VAZIO do evento
    expect(rows.some((r) => r.chNFe.startsWith("VAZIO:"))).toBe(false);
  });

  it("não deixa linhas em branco nas pontas quando o lote termina em evento", () => {
    const { rows } = consolidateXmlsFull([
      { fileName: "a.xml", content: nfe },
      { fileName: "b.xml", content: nfe },
      { fileName: "cancel.xml", content: cancelamento },
    ]);
    expect(rows[0]!.chNFe).toBe(CHAVE);
    expect(rows.at(-1)!.chNFe).toBe(CHAVE);
    // 2 itens + 2 separadores + 2 itens
    expect(rows.length).toBe(6);
  });

  it("trata XML de evento corrompido pelo caminho de NF-e", () => {
    const quebrado = "<procEventoNFe><infEvento><chNFe>x</chNFe>";
    const { rows, eventos } = consolidateXmlsFull([
      { fileName: "ruim.xml", content: quebrado },
    ]);
    expect(eventos.length).toBe(0);
    expect(rows.length).toBe(1);
    expect(rows[0]!.chNFe).toMatch(/^(VAZIO|ERRO)/);
  });
});

describe("chavesCanceladas", () => {
  const ev = (over: Record<string, string>) => {
    const base = parseEventoXml(cancelamento, "e.xml")!;
    return { ...base, ...over };
  };

  it("inclui cancelamento e cancelamento por substituição", () => {
    expect(chavesCanceladas([ev({})]).has(CHAVE)).toBe(true);
    expect(chavesCanceladas([ev({ tpEvento: "110112" })]).has(CHAVE)).toBe(true);
  });

  it("aceita cStat 155 (homologado fora de prazo)", () => {
    expect(chavesCanceladas([ev({ cStat: "155" })]).has(CHAVE)).toBe(true);
  });

  it("ignora carta de correção e manifestação do destinatário", () => {
    expect(chavesCanceladas([ev({ tpEvento: "110110" })]).size).toBe(0);
    expect(chavesCanceladas([ev({ tpEvento: "210220" })]).size).toBe(0);
  });

  it("ignora cancelamento rejeitado pela SEFAZ", () => {
    expect(chavesCanceladas([ev({ cStat: "573" })]).size).toBe(0);
  });

  it("aceita evento sem retEvento (sem cStat)", () => {
    expect(chavesCanceladas([ev({ cStat: "" })]).has(CHAVE)).toBe(true);
  });
});

describe("vincularEventos", () => {
  it("liga o evento à NF-e recíproca e soma os produtos", () => {
    const { rows, eventos } = consolidateXmlsFull([
      { fileName: "nfe.xml", content: nfe },
      { fileName: "cancel.xml", content: cancelamento },
    ]);
    const [v] = vincularEventos(eventos, rows);
    expect(v!.produtoRowIndex).toBe(0);
    expect(v!.values.nNF).toBe("19291");
    expect(v!.values.emit_xNome).toBe("METALTELAS");
    expect(v!.values.dest_xNome).toBe("WVS CONSTRUTORA");
    expect(v!.values.vProd).toBe("695.00");
    expect(v!.values.vinculo).toBe(VINCULO_ENCONTRADO);
    expect(v!.values.link).toBe("PRODUTOS · linha 2");
  });

  it("marca como ausente quando a NF-e não veio no lote", () => {
    const { rows, eventos } = consolidateXmlsFull([
      { fileName: "cancel.xml", content: cancelamento },
    ]);
    const [v] = vincularEventos(eventos, rows);
    expect(v!.produtoRowIndex).toBeNull();
    expect(v!.values.vinculo).toBe(VINCULO_AUSENTE);
    expect(v!.values.link).toBe("");
    expect(v!.values.nNF).toBe("");
  });
});
