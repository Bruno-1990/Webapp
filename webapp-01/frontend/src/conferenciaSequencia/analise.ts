/**
 * Conferência da sequência numérica de NF-e a partir do export da SEFAZ.
 *
 * O ponto central: os "padrões" de numeração que aparecem misturados na coluna
 * `Num.` **não** são separados por faixa/magnitude — eles são as **séries** da
 * nota, e a série está escrita dentro da própria Chave de Acesso. A chave tem
 * 44 dígitos com layout fixo:
 *
 *     cUF(2) AAMM(4) CNPJ(14) mod(2) SÉRIE(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
 *     32     2606    414245…  55     001      000262424  1     29317930  9
 *
 * Ler a série da chave é exato; agrupar por magnitude quebra no dia em que duas
 * séries tiverem faixas próximas.
 *
 * O `AAMM` da chave também importa: ele diz o mês de emissão **real** da nota.
 * Notas de meses anteriores transmitidas com atraso caem no relatório do mês
 * atual e pertencem à sequência do mês de origem — se entrarem na conferência
 * deste período, o menor número da série despenca e a ferramenta acusa milhares
 * de faltantes que não existem. Por isso elas são separadas antes da contagem.
 */

export type Celula = string | number | boolean | Date | null;

export type EscopoNota = "periodo" | "anterior";

export type Nota = {
  /** Linha na planilha de origem (1-based), para o usuário conseguir voltar lá. */
  linha: number;
  valores: Celula[];
  chave: string;
  serie: string;
  numero: number;
  aamm: string;
  modelo: string;
  /** Dígito 35 da chave: 1 = normal, o resto é contingência/SVC. */
  tpEmis: string;
  data: Celula;
  situacao: string;
  escopo: EscopoNota;
};

/**
 * Faixa contígua de números sem nota, com a data das notas que a cercam.
 * Quando as duas batem, o furo tem dia certo — foi o caso de 97% dos furos no
 * arquivo que serviu de referência. Quando divergem, o furo cai numa janela.
 */
export type Bloco = {
  de: number;
  ate: number;
  dataAntes: Celula;
  dataDepois: Celula;
};

export type SerieInfo = {
  serie: string;
  /** Todas as notas da série, ordenadas por número (inclui as de mês anterior). */
  todas: Nota[];
  doPeriodo: Nota[];
  mesAnterior: Nota[];
  /** Notas cuja chave aparece em mais de uma linha do arquivo. */
  duplicadas: Nota[];
  canceladas: Nota[];
  denegadas: Nota[];
  /** Notas emitidas fora do modo normal (tpEmis ≠ 1): contingência, SVC, SCAN. */
  contingencia: Nota[];
  faltantes: number[];
  blocos: Bloco[];
  primeira: number | null;
  ultima: number | null;
  esperadas: number;
  /** Em quantos dias distintos há furo, e em quantos dias houve emissão. */
  diasComFuro: number;
  diasComEmissao: number;
};

export type Conferencia = {
  arquivo: string;
  aba: string;
  /** AAMM predominante nas chaves — o período que está sendo conferido. */
  periodo: string;
  cabecalhos: string[];
  notas: Nota[];
  series: SerieInfo[];
  totalFaltantes: number;
  /** Linhas descartadas por não ter chave de 44 dígitos nem número utilizável. */
  ignoradas: number;
};

/** Quantas linhas do topo varrer procurando o cabeçalho. */
const MAX_LINHAS_CABECALHO = 15;

/** Minúsculo, sem acento e sem pontuação — para casar nomes de coluna. */
function norm(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // tira acentos soltos, espacos e pontuacao
}

function soDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** Converte para número quando o valor é numérico (o export vem tudo como texto). */
export function talvezNumero(v: Celula): Celula {
  if (typeof v !== "string") return v;
  const t = v.trim().replace(/\s/g, "");
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+[.,]\d+$/.test(t)) return Number(t.replace(",", "."));
  return v;
}

/**
 * Normaliza um valor de célula do ExcelJS, que pode chegar como rich text,
 * hyperlink, fórmula ou erro em vez de primitivo.
 */
function celula(v: unknown): Celula {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return v as Celula;
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.richText)) {
    return (o.richText as Array<{ text?: string }>).map((p) => p.text ?? "").join("");
  }
  if ("result" in o) return celula(o.result);
  if ("text" in o) return celula(o.text);
  if ("error" in o) return String(o.error);
  return String(v);
}

/** Lê a 1ª aba com dados numa grade 2D. `.xls` (BIFF) só o SheetJS abre. */
export async function lerGrade(file: File): Promise<{ grade: Celula[][]; aba: string }> {
  const buf = await file.arrayBuffer();

  if (/\.xls$/i.test(file.name)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const nome = wb.SheetNames.find((n) => wb.Sheets[n]) ?? wb.SheetNames[0];
    if (!nome) throw new Error("A planilha não tem nenhuma aba com dados.");
    const grade = XLSX.utils.sheet_to_json<Celula[]>(wb.Sheets[nome], {
      header: 1,
      raw: true,
      defval: null,
    });
    return { grade, aba: nome };
  }

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0) ?? wb.worksheets[0];
  if (!ws) throw new Error("A planilha não tem nenhuma aba com dados.");

  const colunas = Math.max(1, ws.actualColumnCount || ws.columnCount || 1);
  const grade: Celula[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const linha: Celula[] = [];
    for (let c = 1; c <= colunas; c++) linha.push(celula(row.getCell(c).value));
    grade.push(linha);
  }
  return { grade, aba: ws.name };
}

/**
 * Acha a linha de cabeçalho. No export da SEFAZ a linha 1 é o título
 * ("NFEs Emitidas") e a 2 é o cabeçalho, mas varremos o topo para aguentar
 * variações de layout.
 */
function acharCabecalho(grade: Celula[][]): number {
  const limite = Math.min(MAX_LINHAS_CABECALHO, grade.length);
  for (let i = 0; i < limite; i++) {
    const chaves = grade[i].map(norm);
    const temChave = chaves.some((c) => c.startsWith("chave"));
    const temNum = chaves.some((c) => c === "num" || c.startsWith("numero") || c === "nnf");
    if (temChave || temNum) return i;
  }
  return -1;
}

function acharColuna(cabecalhos: string[], ...alvos: string[]): number {
  const chaves = cabecalhos.map(norm);
  for (const alvo of alvos) {
    const exato = chaves.indexOf(alvo);
    if (exato >= 0) return exato;
  }
  for (const alvo of alvos) {
    const prefixo = chaves.findIndex((c) => c.startsWith(alvo));
    if (prefixo >= 0) return prefixo;
  }
  return -1;
}

/** Agrupa números faltantes em intervalos contíguos. */
export function agruparBlocos(faltantes: number[], porNumero?: Map<number, Nota>): Bloco[] {
  const out: Bloco[] = [];
  for (const n of faltantes) {
    const ultimo = out[out.length - 1];
    if (ultimo && n === ultimo.ate + 1) ultimo.ate = n;
    else out.push({ de: n, ate: n, dataAntes: null, dataDepois: null });
  }
  if (porNumero) {
    // Um furo só existe entre duas notas presentes, então os dois vizinhos
    // sempre estão no mapa — a data deles data o furo.
    for (const b of out) {
      b.dataAntes = porNumero.get(b.de - 1)?.data ?? null;
      b.dataDepois = porNumero.get(b.ate + 1)?.data ?? null;
    }
  }
  return out;
}

/** Chave estável para contar dias distintos, seja a data texto ou Date. */
function chaveDia(v: Celula): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim();
}

export function analisarGrade(grade: Celula[][], arquivo: string, aba: string): Conferencia {
  const iCab = acharCabecalho(grade);
  if (iCab < 0) {
    throw new Error(
      'Não encontrei o cabeçalho da planilha. Esperava uma coluna "Chave Acesso" ou "Num." nas primeiras linhas.',
    );
  }

  const cabecalhos = grade[iCab].map((c) => (c == null ? "" : String(c)));
  const iChave = acharColuna(cabecalhos, "chaveacesso", "chavedeacesso", "chave");
  const iNum = acharColuna(cabecalhos, "num", "numero", "numeronota", "nnf");
  const iData = acharColuna(cabecalhos, "dataemissao", "emissao", "data");
  const iSit = acharColuna(cabecalhos, "situacao", "status");
  if (iChave < 0 && iNum < 0) {
    throw new Error('A planilha não tem nem a coluna "Chave Acesso" nem "Num.".');
  }

  const notas: Nota[] = [];
  let ignoradas = 0;

  for (let r = iCab + 1; r < grade.length; r++) {
    const valores = grade[r];
    if (valores.every((v) => v == null || String(v).trim() === "")) continue;

    const chave = iChave >= 0 ? soDigitos(valores[iChave]) : "";
    let serie = "?";
    let numero: number | null = null;
    let aamm = "";
    let modelo = "";
    let tpEmis = "";

    if (chave.length === 44) {
      aamm = chave.slice(2, 6);
      modelo = chave.slice(20, 22);
      serie = String(Number(chave.slice(22, 25)));
      numero = Number(chave.slice(25, 34));
      tpEmis = chave.slice(34, 35);
    } else if (iNum >= 0) {
      // Sem chave válida sobra o número declarado; a série fica indeterminada.
      const n = talvezNumero(valores[iNum] ?? null);
      if (typeof n === "number" && Number.isFinite(n)) numero = n;
    }

    if (numero == null) {
      ignoradas++;
      continue;
    }

    notas.push({
      linha: r + 1,
      valores,
      chave,
      serie,
      numero,
      aamm,
      modelo,
      tpEmis,
      data: iData >= 0 ? (valores[iData] ?? null) : null,
      situacao: iSit >= 0 ? String(valores[iSit] ?? "").trim() : "",
      escopo: "periodo",
    });
  }

  if (notas.length === 0) throw new Error("Nenhuma nota encontrada na planilha.");

  // Período = AAMM predominante nas chaves.
  const contaAamm = new Map<string, number>();
  for (const n of notas) {
    if (n.aamm) contaAamm.set(n.aamm, (contaAamm.get(n.aamm) ?? 0) + 1);
  }
  let periodo = "";
  let maior = 0;
  for (const [k, v] of contaAamm) {
    if (v > maior) {
      maior = v;
      periodo = k;
    }
  }

  for (const n of notas) {
    n.escopo = !periodo || !n.aamm || n.aamm === periodo ? "periodo" : "anterior";
  }

  // Duplicadas são globais (mesma chave em duas linhas), não por série.
  const contaChave = new Map<string, number>();
  for (const n of notas) {
    if (n.chave) contaChave.set(n.chave, (contaChave.get(n.chave) ?? 0) + 1);
  }

  const porSerie = new Map<string, Nota[]>();
  for (const n of notas) {
    const lista = porSerie.get(n.serie);
    if (lista) lista.push(n);
    else porSerie.set(n.serie, [n]);
  }

  const series: SerieInfo[] = [];
  for (const [serie, itens] of porSerie) {
    itens.sort((a, b) => a.numero - b.numero || a.linha - b.linha);
    const doPeriodo = itens.filter((n) => n.escopo === "periodo");
    const mesAnterior = itens.filter((n) => n.escopo === "anterior");

    const faltantes: number[] = [];
    let primeira: number | null = null;
    let ultima: number | null = null;
    const porNumero = new Map<number, Nota>();
    for (const n of doPeriodo) if (!porNumero.has(n.numero)) porNumero.set(n.numero, n);
    if (doPeriodo.length > 0) {
      primeira = doPeriodo[0].numero;
      ultima = doPeriodo[doPeriodo.length - 1].numero;
      for (let x = primeira; x <= ultima; x++) if (!porNumero.has(x)) faltantes.push(x);
    }

    const blocos = agruparBlocos(faltantes, porNumero);
    const diasFuro = new Set<string>();
    for (const b of blocos) {
      if (b.dataAntes != null) diasFuro.add(chaveDia(b.dataAntes));
      if (b.dataDepois != null) diasFuro.add(chaveDia(b.dataDepois));
    }
    const diasEmissao = new Set(doPeriodo.map((n) => chaveDia(n.data)).filter(Boolean));

    series.push({
      serie,
      todas: itens,
      doPeriodo,
      mesAnterior,
      duplicadas: itens.filter((n) => n.chave && (contaChave.get(n.chave) ?? 0) > 1),
      canceladas: doPeriodo.filter((n) => norm(n.situacao).includes("cancel")),
      denegadas: doPeriodo.filter((n) => norm(n.situacao).includes("deneg")),
      contingencia: doPeriodo.filter((n) => n.tpEmis && n.tpEmis !== "1"),
      faltantes,
      blocos,
      primeira,
      ultima,
      esperadas: primeira != null && ultima != null ? ultima - primeira + 1 : 0,
      diasComFuro: diasFuro.size,
      diasComEmissao: diasEmissao.size,
    });
  }

  series.sort(ordenarSeries);

  return {
    arquivo,
    aba,
    periodo,
    cabecalhos,
    notas,
    series,
    totalFaltantes: series.reduce((s, i) => s + i.faltantes.length, 0),
    ignoradas,
  };
}

/** Séries numéricas em ordem; a indeterminada ("?") por último. */
function ordenarSeries(a: SerieInfo, b: SerieInfo): number {
  const na = Number(a.serie);
  const nb = Number(b.serie);
  const va = Number.isFinite(na);
  const vb = Number.isFinite(nb);
  if (va && vb) return na - nb;
  if (va) return -1;
  if (vb) return 1;
  return a.serie.localeCompare(b.serie);
}

export async function conferirArquivo(file: File): Promise<Conferencia> {
  const { grade, aba } = await lerGrade(file);
  return analisarGrade(grade, file.name, aba);
}

/** "2606" → "06/2026". */
export function rotuloPeriodo(aamm: string): string {
  if (!/^\d{4}$/.test(aamm)) return "—";
  return `${aamm.slice(2)}/20${aamm.slice(0, 2)}`;
}

export function rotuloSerie(serie: string): string {
  return serie === "?" ? "Sem série" : `Série ${serie}`;
}
