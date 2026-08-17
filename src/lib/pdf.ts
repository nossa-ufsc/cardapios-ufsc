// Extração de PDF via unpdf (pdf.js). Substitui markitdown (texto) E camelot (tabelas),
// sem nenhuma dependência nativa (ghostscript/opencv). Duas estratégias:
//   - extrairTexto: fluxo de texto linear (Trindade).
//   - extrairColunasPorDia: reconstrói uma tabela semanal agrupando os itens de texto
//     por coluna (posição x) — cada coluna é um dia da semana. Validado nos PDFs reais
//     de Joinville, Curitibanos e Araranguá.

import { extractText, getDocumentProxy } from 'unpdf';

export interface TextItem {
  x: number;
  y: number;
  str: string;
}

async function carregar(buf: Uint8Array) {
  // pdf.js "transfere" (desanexa) o ArrayBuffer recebido, então clonamos a cada
  // chamada para permitir múltiplos carregamentos do mesmo PDF (ex.: PDF mensal
  // do Curitibanos, lido página a página).
  return getDocumentProxy(buf.slice());
}

/** Texto corrido do PDF inteiro (todas as páginas mescladas). */
export async function extrairTexto(buf: Uint8Array): Promise<string> {
  const pdf = await carregar(buf);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** Itens de texto posicionados de uma página (1-based). */
export async function extrairItens(buf: Uint8Array, pagina: number): Promise<TextItem[]> {
  const pdf = await carregar(buf);
  const page = await pdf.getPage(pagina);
  const content = await page.getTextContent();
  const itens: TextItem[] = [];
  for (const item of content.items as any[]) {
    const str = (item.str ?? '').trim();
    if (!str) continue;
    itens.push({ x: Math.round(item.transform[4]), y: Math.round(item.transform[5]), str });
  }
  return itens;
}

export async function numeroDePaginas(buf: Uint8Array): Promise<number> {
  const pdf = await carregar(buf);
  return pdf.numPages;
}

/**
 * Agrupa itens de texto em linhas visuais (mesma coordenada y, com tolerância).
 * A comparação é sempre contra a ÂNCORA da linha corrente (o primeiro item dela),
 * não contra o último item — senão baselines em "escada" (y=700,695,690,…) fazem
 * linhas distintas colapsarem em uma só por drift encadeado.
 * Cada linha vem ordenada da esquerda para a direita.
 */
export function agruparEmLinhas(itens: TextItem[], toleranciaY = 6): TextItem[][] {
  const ordenados = [...itens].sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas: TextItem[][] = [];
  let atual: TextItem[] = [];
  let ancoraY: number | null = null;
  for (const it of ordenados) {
    if (ancoraY === null || Math.abs(it.y - ancoraY) <= toleranciaY) {
      if (ancoraY === null) ancoraY = it.y;
      atual.push(it);
    } else {
      linhas.push(ordenarLinha(atual));
      atual = [it];
      ancoraY = it.y;
    }
  }
  if (atual.length) linhas.push(ordenarLinha(atual));
  return linhas;
}

const ordenarLinha = (linha: TextItem[]) => [...linha].sort((a, b) => a.x - b.x);

/**
 * Particiona os itens de texto nas N colunas de dias pelos PONTOS MÉDIOS entre os
 * centros x adjacentes (sem tolerância absoluta — elimina o caso "item exatamente
 * entre duas colunas" e o de célula mais larga que a tolerância). As bordas externas
 * ganham margem simétrica à meia-distância da coluna vizinha; itens fora delas (ou
 * à esquerda de `xMin`) são descartados.
 *
 * Retorna, para cada coluna, os itens ordenados de cima para baixo (tiebreak x).
 */
export function distribuirEmColunas(
  itens: TextItem[],
  centrosX: number[],
  opts: { xMin?: number } = {}
): TextItem[][] {
  const n = centrosX.length;
  const colunas: TextItem[][] = centrosX.map(() => []);
  if (n === 0) return colunas;

  // Limites entre colunas; margens externas espelham a meia-distância vizinha.
  const meioEsq = n > 1 ? (centrosX[1] - centrosX[0]) / 2 : 60;
  const meioDir = n > 1 ? (centrosX[n - 1] - centrosX[n - 2]) / 2 : 60;
  const limites: number[] = [centrosX[0] - meioEsq];
  for (let i = 0; i < n - 1; i++) limites.push((centrosX[i] + centrosX[i + 1]) / 2);
  limites.push(centrosX[n - 1] + meioDir);

  for (const it of itens) {
    if (opts.xMin !== undefined && it.x < opts.xMin) continue;
    if (it.x < limites[0] || it.x > limites[n]) continue;
    let idx = 0;
    while (idx < n - 1 && it.x >= limites[idx + 1]) idx++;
    colunas[idx].push(it);
  }
  return colunas.map((col) => col.sort((a, b) => b.y - a.y || a.x - b.x));
}

/**
 * Junta itens de uma coluna que estão em linhas visuais consecutivas muito próximas
 * (quebra de linha dentro da mesma célula) em uma única string, preservando o
 * agrupamento lógico. `gap` é a distância vertical máxima para considerar continuação.
 */
export function juntarCelulas(coluna: TextItem[], gap = 12): string[] {
  const celulas: string[] = [];
  let buffer: string[] = [];
  let ultimoY: number | null = null;
  for (const it of coluna) {
    if (ultimoY !== null && ultimoY - it.y <= gap) {
      buffer.push(it.str);
    } else {
      if (buffer.length) celulas.push(buffer.join(' '));
      buffer = [it.str];
    }
    ultimoY = it.y;
  }
  if (buffer.length) celulas.push(buffer.join(' '));
  return celulas;
}

/**
 * Detecta os centros x das colunas a partir de uma linha "cabeçalho" conhecida
 * (a que contém os nomes dos dias). Recebe a linha já agrupada e retorna os x.
 */
export function centrosDeColuna(linhaCabecalho: TextItem[]): number[] {
  return linhaCabecalho.map((it) => it.x);
}
