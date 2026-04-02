import { describe, expect, it } from "vitest";
import { parseNfeXml } from "./parse.js";

const minimalNfe = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe35200112345678901234550010000000011234567890">
    <ide>
      <nNF>1</nNF>
      <dhEmi>2024-01-15T10:00:00-03:00</dhEmi>
      <tpNF>1</tpNF>
      <finNFe>1</finNFe>
      <indPres>2</indPres>
    </ide>
    <emit>
      <CNPJ>12345678000199</CNPJ>
      <xNome>Emitente Teste</xNome>
    </emit>
    <dest>
      <CNPJ>98765432000188</CNPJ>
      <xNome>Destinatário</xNome>
    </dest>
    <det nItem="1">
      <prod>
        <cProd>001</cProd>
        <xProd>Produto A</xProd>
        <NCM>12345678</NCM>
        <CFOP>5102</CFOP>
        <uCom>UN</uCom>
        <qCom>2</qCom>
        <vUnCom>10.00</vUnCom>
        <vProd>20.00</vProd>
      </prod>
      <imposto>
        <ICMS>
          <ICMS00>
            <orig>0</orig>
            <CST>00</CST>
            <pICMS>18.00</pICMS>
            <vICMS>3.60</vICMS>
          </ICMS00>
        </ICMS>
        <PIS>
          <PISAliq>
            <pPIS>1.65</pPIS>
            <vPIS>0.33</vPIS>
          </PISAliq>
        </PIS>
        <COFINS>
          <COFINSAliq>
            <pCOFINS>7.60</pCOFINS>
            <vCOFINS>1.52</vCOFINS>
          </COFINSAliq>
        </COFINS>
      </imposto>
    </det>
  </infNFe>
</NFe>`;

describe("parseNfeXml", () => {
  it("extrai linha de produto e cabeçalho", () => {
    const rows = parseNfeXml(minimalNfe, "test.xml");
    expect(rows.length).toBe(1);
    expect(rows[0]!.nNF).toBe("1");
    expect(rows[0]!.dhEmi).toBe("15/01/2024 - 10:00:00");
    expect(rows[0]!.cProd).toBe("001");
    expect(rows[0]!.xProd).toBe("Produto A");
    expect(rows[0]!.emit_CNPJ).toBe("12345678000199");
    expect(rows[0]!["CSOSN/CST"]).toBe("00");
    expect(rows[0]!.indPres).toBe("2 - Operação não presencial, pela Internet");
    expect(rows[0]!.indPres_raw).toBe("2");
    expect(rows[0]!.finNFe).toBe("1 - NF-e normal");
    expect(rows[0]!.finNFe_raw).toBe("1");
    expect(rows[0]!["Alerta Fiscal"]).toBe("");
  });

  it("marca alerta para operação intermediada (marketplace)", () => {
    const xml = minimalNfe.replace("</ide>", "<indIntermed>1</indIntermed></ide>");
    const rows = parseNfeXml(xml, "marketplace.xml");
    expect(rows[0]!["Alerta Fiscal"]).toContain("operação não presencial com intermediação");
  });
});
