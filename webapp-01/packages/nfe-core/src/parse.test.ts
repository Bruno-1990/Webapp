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

  it("extrai série, IE/UF, base de cálculo e totais da nota", () => {
    const xml = minimalNfe
      .replace("<nNF>1</nNF>", "<natOp>Venda de Mercadoria</natOp><serie>1</serie><nNF>1</nNF><tpEmis>1</tpEmis>")
      .replace(
        "<xNome>Emitente Teste</xNome>",
        "<xNome>Emitente Teste</xNome><enderEmit><UF>ES</UF></enderEmit><IE>083540652</IE><IEST>123</IEST>"
      )
      .replace(
        "<xNome>Destinatário</xNome>",
        "<xNome>Destinatário</xNome><enderDest><UF>SP</UF></enderDest><IE>082338019</IE>"
      )
      .replace("<xProd>", "<cEAN>SEM GTIN</cEAN><xProd>")
      .replace("<vProd>20.00</vProd>", "<vProd>20.00</vProd><vOutro>1.50</vOutro>")
      .replace("<pICMS>", "<modBC>3</modBC><vBC>20.00</vBC><pICMS>")
      .replace(
        "<PIS>",
        "<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>20.00</vBC><pIPI>5.00</pIPI><vIPI>1.00</vIPI></IPITrib></IPI><PIS>"
      )
      .replace(
        "</det>",
        `</det><total><ICMSTot><vBC>20.00</vBC><vICMS>3.60</vICMS><vICMSDeson>0.50</vICMSDeson>
        <vICMSUFDest>0.00</vICMSUFDest><vFCP>0</vFCP><vBCST>0.00</vBCST><vST>0.00</vST>
        <vFCPST>0</vFCPST><vFCPSTRet>0</vFCPSTRet><vProd>20.00</vProd><vFrete>2.00</vFrete>
        <vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>1.00</vIPI><vIPIDevol>0.00</vIPIDevol>
        <vPIS>0.33</vPIS><vCOFINS>1.52</vCOFINS><vOutro>1.50</vOutro><vNF>24.50</vNF></ICMSTot></total>`
      );
    const r = parseNfeXml(xml, "completa.xml")[0]!;
    expect(r.serie).toBe("1");
    expect(r.natOp).toBe("Venda de Mercadoria");
    expect(r.tpEmis).toBe("1");
    expect(r.emit_UF).toBe("ES");
    expect(r.emit_IE).toBe("083540652");
    expect(r.emit_IEST).toBe("123");
    expect(r.dest_UF).toBe("SP");
    expect(r.dest_IE).toBe("082338019");
    expect(r.cEAN).toBe("SEM GTIN");
    expect(r.vOutro).toBe("1.50");
    expect(r.modBC).toBe("3");
    expect(r.vBC).toBe("20.00");
    expect(r.vBC_IPI).toBe("20.00");
    expect(r.tot_vBC).toBe("20.00");
    expect(r.tot_vICMSDeson).toBe("0.50");
    expect(r.tot_vICMSUFRemet).toBe("");
    expect(r.tot_vFrete).toBe("2.00");
    expect(r.tot_vOutro).toBe("1.50");
    expect(r.tot_vNF).toBe("24.50");
  });

  it("marca alerta para operação intermediada (marketplace)", () => {
    const xml = minimalNfe.replace("</ide>", "<indIntermed>1</indIntermed></ide>");
    const rows = parseNfeXml(xml, "marketplace.xml");
    expect(rows[0]!["Alerta Fiscal"]).toContain("operação não presencial com intermediação");
  });
});
