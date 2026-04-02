import { emptyRow, type NfeRow } from "./cols.js";
import { parseNfeXml } from "./parse.js";

export interface XmlInput {
  fileName: string;
  content: string;
}

export function consolidateXmls(inputs: XmlInput[]): NfeRow[] {
  if (inputs.length === 0) return [];

  const allRows: NfeRow[] = [];
  const lastIdx = inputs.length - 1;

  for (let idx = 0; idx < inputs.length; idx++) {
    const { fileName, content } = inputs[idx]!;
    try {
      const rows = parseNfeXml(content, fileName);
      if (rows.length > 0) {
        allRows.push(...rows);
      } else {
        const r = emptyRow();
        r.chNFe = `VAZIO: ${fileName}`;
        r.xProd = "Nenhum item <det/prod> encontrado";
        allRows.push(r);
      }
    } catch (e) {
      const r = emptyRow();
      r.chNFe = `ERRO: ${fileName}`;
      r.xProd = e instanceof Error ? e.message : String(e);
      allRows.push(r);
    }

    if (idx < lastIdx) {
      allRows.push(emptyRow());
      allRows.push(emptyRow());
    }
  }

  return allRows;
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
