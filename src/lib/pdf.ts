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
 * Cada linha vem ordenada da esquerda para a direita.
 */
export function agruparEmLinhas(itens: TextItem[], toleranciaY = 6): TextItem[][] {
  const ordenados = [...itens].sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas: TextItem[][] = [];
  let atual: TextItem[] = [];
  let ultimoY: number | null = null;
  for (const it of ordenados) {
    if (ultimoY === null || Math.abs(it.y - ultimoY) <= toleranciaY) {
      atual.push(it);
    } else {
      linhas.push(ordenarLinha(atual));
      atual = [it];
    }
    ultimoY = it.y;
  }
  if (atual.length) linhas.push(ordenarLinha(atual));
  return linhas;
}

const ordenarLinha = (linha: TextItem[]) => [...linha].sort((a, b) => a.x - b.x);

/**
 * A partir dos centros x das N colunas de dias, distribui todos os itens de texto
 * da página em N baldes (colunas). Itens fora de qualquer coluna (rótulos à esquerda,
 * legendas) são descartados quando `xMin` é informado.
 *
 * Retorna, para cada coluna, a lista de itens ordenados de cima para baixo — depois
 * agrupados em "células" por proximidade vertical.
 */
export function distribuirEmColunas(
  itens: TextItem[],
  centrosX: number[],
  opts: { toleranciaX?: number; xMin?: number } = {}
): TextItem[][] {
  const tol = opts.toleranciaX ?? 55;
  const colunas: TextItem[][] = centrosX.map(() => []);
  for (const it of itens) {
    if (opts.xMin !== undefined && it.x < opts.xMin) continue;
    let melhor = -1;
    let menorDist = Infinity;
    centrosX.forEach((cx, i) => {
      const d = Math.abs(it.x - cx);
      if (d < menorDist) {
        menorDist = d;
        melhor = i;
      }
    });
    if (melhor >= 0 && menorDist <= tol) colunas[melhor].push(it);
  }
  return colunas.map((col) => col.sort((a, b) => b.y - a.y));
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
