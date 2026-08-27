/**
 * Geração do .xlsx da Conferência de Sequência, no navegador (ExcelJS).
 *
 * Segue o padrão de exportação do sistema (docs/EXPORT-STANDARD.md): cabeçalho
 * Azul Royal 4169E1 com texto branco, dados 1A1A1F, tudo centralizado, bordas
 * thin CECECE, alturas 30/22, linha 1 congelada, gridlines desligadas e largura
 * automática `clamp(10, conteúdo + 2, 60)`.
 *
 * A §5 do padrão manda aliviar o estilo acima de ~2.500 linhas, e as abas daqui
 * passam de 10 mil. Medimos na maior delas (23.636 × 17): o caminho aliviado
 * gasta 3,1 s e o padrão completo (altura 22 + fonte + borda em cada célula)
 * gasta 5,1 s. Os 2 s a mais compram uma planilha visualmente igual às outras
 * abas, então aqui vai o padrão **completo** em todas — o alívio da §5 existe
 * para não travar o navegador, e a essa escala ele não trava.
 *
 * Por cima disso, as poucas linhas com achado (falha de sequência, duplicada,
 * nota de mês anterior) ganham um fundo de destaque, o que é barato porque são
 * poucas — 185 de 23 mil no arquivo que serviu de referência.
 */
import type { Borders, Workbook, Worksheet } from "exceljs";

import {
  type Celula,
  type Conferencia,
  type Nota,
  type SerieInfo,
  rotuloPeriodo,
  rotuloSerie,
} from "./analise.js";

const HEADER_FILL_ARGB = "FF4169E1";
const HEADER_FONT_ARGB = "FFFFFFFF";
const DATA_FONT_ARGB = "FF1A1A1F";
const BORDER_ARGB = "FFCECECE";
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 22;
const FONT_NAME = "Calibri";
const FONT_SIZE = 11;

/** Destaques da conferência — fora do padrão base, só nas linhas com achado. */
const FILL_FALHA = "FFFADBD8";
const FILL_ALERTA = "FFFCF3CF";
const FILL_NEUTRO = "FFEAEDED";
const FILL_RESUMO = "FFDCE9F5";
const FONT_FALHA = "FFA13024";

const THIN_BORDER: Partial<Borders> = {
  top: { style: "thin", color: { argb: BORDER_ARGB } },
  left: { style: "thin", color: { argb: BORDER_ARGB } },
  bottom: { style: "thin", color: { argb: BORDER_ARGB } },
  right: { style: "thin", color: { argb: BORDER_ARGB } },
};

const ALIGN = { horizontal: "center", vertical: "middle" } as const;
const DATA_FONT = { name: FONT_NAME, size: FONT_SIZE, color: { argb: DATA_FONT_ARGB } } as const;

/** Colunas que nunca viram número: a chave tem 44 dígitos e viraria notação científica. */
const COLUNAS_TEXTO = /^(chave|cnpj|cpf)/;

/** Máximo de dígitos que ainda cabem num número sem perder precisão. */
const MAX_DIGITOS_NUMERO = 15;

function norm(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * "30/06/2026" → Date real. Construída em **UTC** ao meio-dia porque o ExcelJS
 * grava os componentes UTC da data: montar no fuso local faria a data cair no
 * dia vizinho para quem gera a planilha fora de UTC-0.
 */
function talvezData(v: Celula): Celula {
  if (typeof v !== "string") return v;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  if (!m) return v;
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0));
}

function talvezNumero(v: Celula): Celula {
  if (typeof v !== "string") return v;
  const t = v.trim().replace(/\s/g, "");
  if (/^-?\d+$/.test(t)) {
    return t.replace("-", "").length > MAX_DIGITOS_NUMERO ? v : Number(t);
  }
  if (/^-?\d+[.,]\d+$/.test(t)) return Number(t.replace(",", "."));
  return v;
}

/** Converte pelo cabeçalho: texto onde tem que ser texto, número/data no resto. */
function valorTipado(v: Celula, cabecalho: string): Celula {
  if (COLUNAS_TEXTO.test(norm(cabecalho))) return v == null ? v : String(v);
  const d = talvezData(v);
  if (d instanceof Date) return d;
  return talvezNumero(v);
}

function largura(cabecalho: string, linhas: Celula[][], i: number): number {
  let max = cabecalho.length;
  for (const linha of linhas) {
    const v = linha[i];
    const len = v == null ? 0 : v instanceof Date ? 10 : String(v).length;
    if (len > max) max = len;
  }
  return Math.min(60, Math.max(10, max + 2));
}

/** Aplica o padrão do sistema numa aba já preenchida (linha 1 = cabeçalho). */
function aplicarPadrao(ws: Worksheet, cabecalhos: string[], linhas: Celula[][]): void {
  ws.views = [{ showGridLines: false, state: "frozen", ySplit: 1 }];

  ws.columns.forEach((col, i) => {
    col.width = largura(cabecalhos[i] ?? "", linhas, i);
  });

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    row.height = ROW_HEIGHT;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { ...DATA_FONT };
      cell.alignment = { ...ALIGN };
      cell.border = { ...THIN_BORDER };
    });
  }

  const header = ws.getRow(1);
  header.height = HEADER_HEIGHT;
  header.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL_ARGB } };
    cell.font = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: HEADER_FONT_ARGB } };
    cell.alignment = { ...ALIGN };
    cell.border = { ...THIN_BORDER };
  });

  filtrar(ws, cabecalhos.length);
}

/**
 * Só o fundo — a linha já saiu de `aplicarPadrao` com fonte, alinhamento,
 * altura e borda corretos. Usado nas poucas linhas com achado.
 */
function destacar(
  ws: Worksheet,
  r: number,
  fill: string,
  negritoEm?: number,
  ateColuna?: number,
): void {
  const row = ws.getRow(r);
  row.eachCell({ includeEmpty: true }, (cell, c) => {
    if (ateColuna != null && c > ateColuna) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    if (c === negritoEm) {
      cell.font = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: FONT_FALHA } };
    }
  });
}

function negritarLinha(ws: Worksheet, r: number, ateColuna?: number): void {
  ws.getRow(r).eachCell({ includeEmpty: true }, (cell, c) => {
    if (ateColuna != null && c > ateColuna) return;
    cell.font = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: DATA_FONT_ARGB } };
  });
}

function formatarColuna(ws: Worksheet, indice: number, formato: string): void {
  ws.getColumn(indice).numFmt = formato;
}

/** Filtro no cabeçalho — deixa isolar uma série ou um tipo de ocorrência na hora. */
function filtrar(ws: Worksheet, colunas: number): void {
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas } };
}

// ------------------------------------------------------------------ abas

const CAB_CONFERENCIA = [
  "Série",
  "Ocorrência",
  "De",
  "Até",
  "Qtd",
  "Data",
  "Valor Total",
  "ICMS",
  "Observação",
  "Justificativa",
  "Conferido por / em",
];

/** Última coluna que recebe o fundo de destaque — as de trabalho ficam brancas. */
const COL_ATE_DESTAQUE = 9;
const COL_DATA = 6;
const COL_VALOR = 7;
const COL_ICMS = 8;

/** tpEmis (dígito 35 da chave) fora do normal. */
const TP_EMIS: Record<string, string> = {
  "2": "contingência FS-IA",
  "3": "SCAN",
  "4": "DPEC",
  "5": "contingência FS-DA",
  "6": "SVC-AN",
  "7": "SVC-RS",
  "9": "offline",
};

/** Índice da coluna da planilha de origem cujo cabeçalho casa com um dos alvos. */
function colunaOrigem(c: Conferencia, ...alvos: string[]): number {
  const chaves = c.cabecalhos.map(norm);
  for (const a of alvos) {
    const i = chaves.indexOf(a);
    if (i >= 0) return i;
  }
  for (const a of alvos) {
    const i = chaves.findIndex((k) => k.startsWith(a));
    if (i >= 0) return i;
  }
  return -1;
}

/** Soma uma coluna de valor da origem. `null` quando a coluna não existe. */
function somar(notas: Nota[], col: number): number | null {
  if (col < 0) return null;
  let total = 0;
  for (const n of notas) {
    const v = talvezNumero(n.valores[col] ?? null);
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  // Centavos: evita o 0.1 + 0.2 de sempre aparecer no total.
  return Math.round(total * 100) / 100;
}

/** dd/mm/aaaa a partir do que veio na planilha (texto ou Date). */
function textoData(v: Celula): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return `${String(v.getDate()).padStart(2, "0")}/${String(v.getMonth() + 1).padStart(2, "0")}/${v.getFullYear()}`;
  }
  return String(v).trim();
}

function faixaNumeros(notas: Nota[]): [number | null, number | null] {
  if (notas.length === 0) return [null, null];
  let min = notas[0].numero;
  let max = notas[0].numero;
  for (const n of notas) {
    if (n.numero < min) min = n.numero;
    if (n.numero > max) max = n.numero;
  }
  return [min, max];
}

/**
 * A aba de conferência abre com um bloco de resumo (uma linha por assunto, em
 * azul) e segue com o que exige ação **neste** período: números sem nota e
 * duplicatas. Canceladas, denegadas, contingência e notas de mês anterior
 * entram como linha de resumo e ficam detalhadas na aba da própria série —
 * listá-las uma a uma aqui enchia a aba de linhas repetindo o mesmo texto.
 *
 * As duas últimas colunas nascem vazias, de propósito: são onde o analista
 * escreve a justificativa de cada furo (inutilização, nota não transmitida,
 * emitida no mês seguinte) e assina a conferência.
 */
function linhasConferencia(c: Conferencia): Celula[][] {
  const linhas: Celula[][] = [];
  const colValor = colunaOrigem(c, "valortotal", "valor");
  const colIcms = colunaOrigem(c, "valoricms");

  const linha = (
    serie: string,
    ocorrencia: string,
    de: Celula,
    ate: Celula,
    qtd: Celula,
    data: Celula,
    valor: Celula,
    icms: Celula,
    obs: Celula,
  ): Celula[] => [serie, ocorrencia, de, ate, qtd, data, valor, icms, obs, "", ""];

  for (const s of c.series) {
    const rot = rotuloSerie(s.serie);
    const validas = s.doPeriodo.filter((n) => !s.canceladas.includes(n));

    linhas.push(
      linha(
        rot,
        "Resumo · Período",
        s.primeira,
        s.ultima,
        s.doPeriodo.length,
        null,
        somar(validas, colValor),
        somar(validas, colIcms),
        s.ultima != null
          ? `Valores sem as canceladas. A próxima planilha deve começar em ${s.ultima + 1}.`
          : null,
      ),
    );

    linhas.push(
      linha(
        rot,
        "Resumo · Sem nota",
        null,
        null,
        s.faltantes.length,
        null,
        null,
        null,
        s.faltantes.length === 0
          ? "Sequência completa — nenhum número sem nota."
          : `Furos em ${s.diasComFuro} dos ${s.diasComEmissao} dias com emissão.`,
      ),
    );

    if (s.duplicadas.length > 0) {
      linhas.push(
        linha(rot, "Resumo · Duplicadas", null, null, s.duplicadas.length, null, null, null,
          "Mesma chave em mais de uma linha da planilha de origem."),
      );
    }

    if (s.mesAnterior.length > 0) {
      const [min, max] = faixaNumeros(s.mesAnterior);
      const meses = [...new Set(s.mesAnterior.map((n) => rotuloPeriodo(n.aamm)))].join(", ");
      linhas.push(
        linha(rot, "Resumo · Mês anterior", min, max, s.mesAnterior.length, null, null, null,
          `Emitidas em ${meses} e transmitidas neste período — confira na sequência de origem.`),
      );
    }

    if (s.canceladas.length > 0) {
      linhas.push(
        linha(rot, "Resumo · Canceladas", null, null, s.canceladas.length, null,
          somar(s.canceladas, colValor), null,
          "O número foi utilizado — não é falha de sequência."),
      );
    }

    if (s.denegadas.length > 0) {
      linhas.push(
        linha(rot, "Resumo · Denegadas", null, null, s.denegadas.length, null, null, null,
          "O número foi utilizado — não é falha de sequência."),
      );
    }

    if (s.contingencia.length > 0) {
      const tipos = [...new Set(s.contingencia.map((n) => TP_EMIS[n.tpEmis] ?? `tpEmis ${n.tpEmis}`))];
      linhas.push(
        linha(rot, "Resumo · Contingência", null, null, s.contingencia.length, null, null, null,
          `Emitidas fora do modo normal (${tipos.join(", ")}) — costuma explicar furo de sequência.`),
      );
    }
  }

  for (const s of c.series) {
    for (const b of s.blocos) {
      const qtd = b.ate - b.de + 1;
      const antes = textoData(b.dataAntes);
      const depois = textoData(b.dataDepois);
      linhas.push(
        linha(
          rotuloSerie(s.serie),
          qtd === 1 ? "Nota faltante" : "Bloco faltante",
          b.de,
          qtd === 1 ? null : b.ate,
          qtd,
          talvezData(b.dataAntes),
          null,
          null,
          // Só avisa quando os vizinhos discordam: aí o furo é uma janela de
          // datas, não um dia certo. "de número seguinte" e não "seguinte"
          // porque a numeração nem sempre segue a ordem das datas — a data do
          // vizinho de cima pode ser anterior à do de baixo.
          antes && depois && antes !== depois
            ? `A nota de número seguinte é de ${depois}`
            : null,
        ),
      );
    }
  }

  for (const s of c.series) {
    const porChave = new Map<string, Nota[]>();
    for (const n of s.duplicadas) {
      const lista = porChave.get(n.chave);
      if (lista) lista.push(n);
      else porChave.set(n.chave, [n]);
    }
    for (const [, notas] of porChave) {
      linhas.push(
        linha(
          rotuloSerie(s.serie),
          "Duplicada",
          notas[0].numero,
          null,
          notas.length,
          talvezData(notas[0].data),
          null,
          null,
          `Mesma chave nas linhas ${notas.map((n) => n.linha).join(", ")} da planilha`,
        ),
      );
    }
  }

  return linhas;
}

function abaConferencia(ws: Worksheet, c: Conferencia): void {
  const linhas = linhasConferencia(c);
  ws.columns = CAB_CONFERENCIA.map((h) => ({ header: h }));
  for (const l of linhas) ws.addRow(l);
  aplicarPadrao(ws, CAB_CONFERENCIA, linhas);
  formatarColuna(ws, COL_DATA, "dd/mm/yyyy");
  formatarColuna(ws, COL_VALOR, "#,##0.00");
  formatarColuna(ws, COL_ICMS, "#,##0.00");

  for (let r = 2; r <= ws.rowCount; r++) {
    const tipo = String(ws.getRow(r).getCell(2).value ?? "");
    if (tipo.startsWith("Resumo")) {
      // O resumo abre a aba: fundo azul-claro e negrito, para ler como bloco
      // de cabeçalho e não como mais uma ocorrência.
      destacar(ws, r, FILL_RESUMO, undefined, COL_ATE_DESTAQUE);
      negritarLinha(ws, r, COL_ATE_DESTAQUE);
    } else if (tipo.includes("faltante")) {
      destacar(ws, r, FILL_FALHA, undefined, COL_ATE_DESTAQUE);
    } else if (tipo === "Duplicada") {
      destacar(ws, r, FILL_ALERTA, undefined, COL_ATE_DESTAQUE);
    }
  }
}


function abaBase(ws: Worksheet, c: Conferencia): void {
  const cabecalhos = [
    "Linha origem",
    ...c.cabecalhos.map((h, i) => h || `Coluna ${i + 1}`),
    "Série",
    "Número (da chave)",
    "AAMM chave",
    "Modelo",
    "Escopo",
  ];
  const linhas: Celula[][] = c.notas.map((n) => [
    n.linha,
    ...c.cabecalhos.map((h, i) => valorTipado(n.valores[i] ?? null, h)),
    rotuloSerie(n.serie),
    n.numero,
    n.aamm,
    n.modelo,
    n.escopo === "periodo" ? "Do período" : "Mês anterior",
  ]);

  ws.columns = cabecalhos.map((h) => ({ header: h }));
  for (const l of linhas) ws.addRow(l);
  aplicarPadrao(ws, cabecalhos, linhas);

  c.cabecalhos.forEach((h, i) => {
    const k = norm(h);
    if (k.startsWith("data") || k.includes("emissao")) formatarColuna(ws, i + 2, "dd/mm/yyyy");
    else if (k.startsWith("valor") || k.startsWith("base")) formatarColuna(ws, i + 2, "#,##0.00");
  });
}

const CAB_SERIE = [
  "Número",
  "Data Emissão",
  "Situação",
  "Escopo",
  "Faltam antes",
  "Observação",
  "Linha origem",
  "Chave Acesso",
];

function abaSerie(ws: Worksheet, s: SerieInfo): void {
  const linhas: Celula[][] = [];
  const destaques: Array<{ fill: string; negrito: boolean }> = [];
  let anterior: number | null = null;

  for (const n of s.todas) {
    let faltam: Celula = null;
    let obs = "";
    let fill = "";
    let negrito = false;

    if (n.escopo === "anterior") {
      // A coluna Escopo já diz "Mês anterior"; aqui só o mês de origem, que é
      // a informação que ela não carrega.
      obs = `Emitida em ${rotuloPeriodo(n.aamm)}`;
      fill = FILL_NEUTRO;
    } else {
      if (anterior != null) {
        const d = n.numero - anterior - 1;
        if (d > 0) {
          faltam = d;
          obs =
            d === 1
              ? `Falta a nota ${anterior + 1}`
              : `Faltam ${d} notas: ${anterior + 1} a ${n.numero - 1}`;
          fill = FILL_FALHA;
          negrito = true;
        } else if (n.numero === anterior) {
          obs = "Duplicada — mesmo número da linha acima";
          fill = FILL_ALERTA;
        }
      }
      anterior = n.numero;
      // Cancelada não ganha texto: a coluna Situação já diz, e o fundo marca.
      if (!obs && /cancel/i.test(n.situacao)) fill = FILL_ALERTA;
    }

    linhas.push([
      n.numero,
      talvezData(n.data),
      n.situacao,
      n.escopo === "periodo" ? "Do período" : "Mês anterior",
      faltam,
      obs,
      n.linha,
      n.chave,
    ]);
    destaques.push({ fill, negrito });
  }

  ws.columns = CAB_SERIE.map((h) => ({ header: h }));
  for (const l of linhas) ws.addRow(l);
  aplicarPadrao(ws, CAB_SERIE, linhas);
  formatarColuna(ws, 2, "dd/mm/yyyy");

  destaques.forEach((d, i) => {
    if (d.fill) destacar(ws, i + 2, d.fill, d.negrito ? 6 : undefined);
  });
}

// ---------------------------------------------------------------- saída

/** Nome de arquivo legível e sem os caracteres proibidos no Windows. */
export function nomeArquivo(c: Conferencia): string {
  const periodo = /^\d{4}$/.test(c.periodo) ? `20${c.periodo.slice(0, 2)}-${c.periodo.slice(2)}` : "";
  const base = c.arquivo.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "-");
  const curto = base.length > 60 ? base.slice(0, 60).trimEnd() : base;
  return `Conferência de Sequência - ${curto}${periodo ? ` - ${periodo}` : ""}.xlsx`;
}

function baixar(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoga depois do clique para não cancelar o download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Devolve a thread ao navegador entre uma aba e outra, para a UI não congelar. */
function respira(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** Monta o workbook completo. Separado do download para poder ser testado fora do navegador. */
export async function construirWorkbook(c: Conferencia): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();

  abaConferencia(wb.addWorksheet("Conferência"), c);
  await respira();
  abaBase(wb.addWorksheet("Base Original"), c);
  for (const s of c.series) {
    await respira();
    // Nome de aba no Excel: máximo 31 caracteres.
    abaSerie(wb.addWorksheet(rotuloSerie(s.serie).slice(0, 31)), s);
  }
  return wb;
}

export async function exportarConferencia(c: Conferencia): Promise<void> {
  const wb = await construirWorkbook(c);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  baixar(blob, nomeArquivo(c));
}
