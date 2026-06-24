/**
 * PDF simples para os XMLs de evento da NFS-e (ex.: cancelamento por
 * substituição). Mostra o tipo, o motivo, a chave da nota e a chave substituta.
 */
import type { EventoData } from "./parseNfse.js";
import { DASH, fmtCnpjCpf, fmtDataHora, orDash } from "./format.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any[];

function row(label: string, value: string): Row {
  return [
    { text: label, style: "lbl" },
    { text: value || DASH, style: "val" },
  ];
}

export function buildEventoDoc(data: EventoData): unknown {
  const motivo = [data.cMotivo, data.xMotivo].filter((s) => s && s.trim()).join(" - ");
  return {
    pageSize: "A4",
    pageMargins: [28, 28, 28, 28],
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#111" },
    content: [
      { text: "Evento da NFS-e", style: "title" },
      { text: orDash(data.tipo), style: "subtitle", margin: [0, 2, 0, 10] },
      {
        table: {
          widths: [150, "*"],
          body: [
            row("Sequência do Evento", orDash(data.nSeqEvento)),
            row("Chave da NFS-e", orDash(data.chave)),
            row("Chave Substituta", orDash(data.chSubstituta)),
            row("Motivo", orDash(motivo)),
            row("CNPJ / CPF do Autor", fmtCnpjCpf(data.cnpjAutor)),
            row("Data/Hora do Evento", fmtDataHora(data.dhEvento)),
            row("Data/Hora do Processamento", fmtDataHora(data.dhProc)),
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => "#b9c4ca",
          vLineColor: () => "#b9c4ca",
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
    ],
    styles: {
      title: { fontSize: 15, bold: true, color: "#0b3a49" },
      subtitle: { fontSize: 10, color: "#444" },
      lbl: { fontSize: 8, bold: true, color: "#52636b" },
      val: { fontSize: 9, color: "#111" },
    },
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
