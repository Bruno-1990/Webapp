import { emptyRow, type NfeRow } from "./cols.js";
import { isEventoXml, parseEventoXml, type EventoRow } from "./evento.js";
import { parseNfeXml } from "./parse.js";

export interface XmlInput {
  fileName: string;
  content: string;
}

export interface ConsolidateResult {
  /** Linhas da aba PRODUTOS (eventos não entram aqui). */
  rows: NfeRow[];
  /** Eventos (cancelamento, carta de correção, manifestação…) na ordem de leitura. */
  eventos: EventoRow[];
}

export function consolidateXmlsFull(inputs: XmlInput[]): ConsolidateResult {
  const rows: NfeRow[] = [];
  const eventos: EventoRow[] = [];
  if (inputs.length === 0) return { rows, eventos };

  for (const { fileName, content } of inputs) {
    if (isEventoXml(content)) {
      const evento = parseEventoXml(content, fileName);
      if (evento) {
        eventos.push(evento);
        continue;
      }
      // Não deu para ler como evento: cai no caminho de NF-e para o problema
      // continuar visível na aba principal.
    }

    const block: NfeRow[] = [];
    try {
      const parsed = parseNfeXml(content, fileName);
      if (parsed.length > 0) {
        block.push(...parsed);
      } else {
        const r = emptyRow();
        r.chNFe = `VAZIO: ${fileName}`;
        r.xProd = "Nenhum item <det/prod> encontrado";
        block.push(r);
      }
    } catch (e) {
      const r = emptyRow();
      r.chNFe = `ERRO: ${fileName}`;
      r.xProd = e instanceof Error ? e.message : String(e);
      block.push(r);
    }

    // Duas linhas em branco separam arquivos — nunca no começo nem no fim.
    if (rows.length > 0) {
      rows.push(emptyRow(), emptyRow());
    }
    rows.push(...block);
  }

  return { rows, eventos };
}

export function consolidateXmls(inputs: XmlInput[]): NfeRow[] {
  return consolidateXmlsFull(inputs).rows;
}

export function consolidateFromPaths(
  readFile: (path: string) => string,
  paths: string[]
): NfeRow[] {
  const inputs: XmlInput[] = paths.map((p) => {
    const fileName = p.replace(/^.*[/\\]/, "");
    return { fileName, content: readFile(p) };
  });
  return consolidateXmls(inputs);
}
