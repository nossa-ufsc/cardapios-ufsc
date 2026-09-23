// Leitura mínima de .docx (WordprocessingML) → itens de texto posicionados, no
// mesmo formato que `pdf.ts` produz, para reaproveitar os parsers dos campi.
// Não há coordenadas reais: cada parágrafo/linha de tabela vira uma "linha
// visual" (y decrescente) e cada célula de tabela ocupa uma coluna sintética
// (x = X_INICIAL + coluna * LARGURA_COLUNA), bastando para os parsers que
// separam "coluna da esquerda" de "conteúdo" por x.

import { unzipSync } from 'fflate';
import * as cheerio from 'cheerio';
import type { TextItem } from './pdf.js';

const X_INICIAL = 20;
const LARGURA_COLUNA = 150;
const PASSO_Y = 12;

export interface OpcoesDocx {
  /**
   * Como juntar parágrafos múltiplos de uma mesma célula: `separar` emite um
   * item por parágrafo (default); a função recebe os parágrafos e devolve os
   * itens desejados (ex.: juntar "Arroz / Arroz integral / Feijão").
   */
  celula?: (paragrafos: string[]) => string[];
}

function textoDoParagrafo($: cheerio.CheerioAPI, p: any): string {
  return $(p)
    .find('w\\:t')
    .toArray()
    .map((t) => $(t).text())
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Itens de texto do corpo do documento, em ordem, numa única "página". */
export function extrairItensDocx(buf: Uint8Array, opcoes: OpcoesDocx = {}): TextItem[] {
  const arquivos = unzipSync(buf);
  const xml = arquivos['word/document.xml'];
  if (!xml) throw new Error('.docx sem word/document.xml');
  const $ = cheerio.load(new TextDecoder().decode(xml), { xml: true });
  const celula = opcoes.celula ?? ((ps) => ps);

  const itens: TextItem[] = [];
  let y = 10_000;
  const novaLinha = () => (y -= PASSO_Y);

  // Filhos diretos do corpo: parágrafos soltos e tabelas, na ordem do documento.
  $('w\\:body')
    .children()
    .each((_, el) => {
      const tag = (el as any).tagName ?? (el as any).name;
      if (tag === 'w:p') {
        const str = textoDoParagrafo($, el);
        if (str) itens.push({ x: X_INICIAL, y: novaLinha(), str });
      } else if (tag === 'w:tbl') {
        $(el)
          .children('w\\:tr')
          .each((_, tr) => {
            const linhaY = novaLinha();
            $(tr)
              .children('w\\:tc')
              .each((coluna, tc) => {
                const paragrafos = $(tc)
                  .children('w\\:p')
                  .toArray()
                  .map((p) => textoDoParagrafo($, p))
                  .filter(Boolean);
                if (!paragrafos.length) return;
                const x = X_INICIAL + coluna * LARGURA_COLUNA;
                for (const str of celula(paragrafos)) itens.push({ x, y: linhaY, str });
              });
          });
      }
    });
  return itens;
}
