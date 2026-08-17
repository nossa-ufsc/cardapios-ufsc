// Parser genérico de "tabela semanal" de PDF (dias da semana em colunas), montado
// a partir das primitivas de pdf.ts. Reconstrói cada coluna (= um dia) por posição x
// e junta quebras de linha dentro de uma mesma célula por proximidade vertical.
//
// Empiricamente (PDFs reais de Joinville/Araranguá/Curitibanos): a quebra de linha
// dentro de uma célula tem gap vertical <= ~17, enquanto pratos distintos têm gap >= ~22.
// Um limiar de ~18 separa os dois casos com folga.

import type { MenuItem } from './types.js';
import {
  agruparEmLinhas,
  distribuirEmColunas,
  juntarCelulas,
  type TextItem,
} from './pdf.js';

const REGEX_DIA = /segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo/i;

export interface OpcoesTabela {
  /** Rótulos de dia emitidos (ordem Seg→Dom), preservando o formato que o app espera. */
  diaLabels: string[];
  /** Converte o texto de data cru da célula para o formato final. Retorne null p/ descartar. */
  normalizarData: (raw: string) => string | null;
  /** Descarta um item (ruído: legendas, alergênicos, footers). */
  descartar?: (item: string) => boolean;
  /** Gap vertical máximo p/ juntar linhas da mesma célula. */
  mergeGap?: number;
  /** Ignora itens à esquerda deste x (coluna de rótulos tipo FIXO/CARNE). */
  xMinBody?: number;
}

/**
 * Extrai UMA semana (7 dias) a partir dos itens de texto de uma página.
 * Retorna [] se não encontrar o cabeçalho com nomes de dias.
 */
export function extrairSemana(itens: TextItem[], opts: OpcoesTabela): MenuItem[] {
  const linhas = agruparEmLinhas(itens);

  // 1) Linha de cabeçalho = a que tem mais nomes de dia.
  let idxCabecalho = -1;
  let maisDias = 0;
  linhas.forEach((linha, i) => {
    const n = linha.filter((it) => REGEX_DIA.test(it.str)).length;
    if (n > maisDias) {
      maisDias = n;
      idxCabecalho = i;
    }
  });
  if (idxCabecalho === -1 || maisDias < 3) return [];

  const cabecalho = linhas[idxCabecalho].filter((it) => REGEX_DIA.test(it.str));
  const centrosX = cabecalho.map((it) => it.x);
  const yCabecalho = Math.min(...linhas[idxCabecalho].map((it) => it.y));

  // 2) Linha de datas = próxima linha abaixo do cabeçalho.
  const linhaDatas = linhas[idxCabecalho + 1] ?? [];
  const yDatas = linhaDatas.length ? Math.min(...linhaDatas.map((it) => it.y)) : yCabecalho;
  const colDatas = distribuirEmColunas(linhaDatas, centrosX, { xMin: opts.xMinBody });
  const datas = colDatas.map((col) => {
    const raw = col.map((c) => c.str).join('');
    return opts.normalizarData(raw);
  });

  // 3) Corpo = itens abaixo da linha de datas.
  const corpo = itens.filter((it) => it.y < yDatas - 2);
  const colunas = distribuirEmColunas(corpo, centrosX, { xMin: opts.xMinBody });

  const mergeGap = opts.mergeGap ?? 18;
  const descartar = opts.descartar ?? (() => false);

  return centrosX.map((_, i) => {
    // Filtra o ruído (alergênicos, legendas) ANTES de juntar as células — senão
    // uma anotação vertical próxima seria mesclada dentro do nome do prato.
    const limpos = colunas[i].filter((it) => it.str.toLowerCase() !== 'nan' && !descartar(it.str));
    const celulas = juntarCelulas(limpos, mergeGap)
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== 'nan' && !descartar(s));
    return {
      dia: opts.diaLabels[i] ?? '',
      data: datas[i] ?? '',
      itens: celulas,
    };
  });
}

export const DIAS_MAIUSCULO_FEIRA = [
  'SEGUNDA-FEIRA', 'TERÇA-FEIRA', 'QUARTA-FEIRA',
  'QUINTA-FEIRA', 'SEXTA-FEIRA', 'SÁBADO', 'DOMINGO',
];

export const DIAS_MAIUSCULO = [
  'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO', 'DOMINGO',
];

export const DIAS_TITLE_FEIRA = [
  'Segunda feira', 'Terça feira', 'Quarta feira',
  'Quinta feira', 'Sexta feira', 'Sábado', 'Domingo',
];
