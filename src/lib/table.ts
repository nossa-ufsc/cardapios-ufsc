// Parser genérico de "tabela semanal" de PDF (dias da semana em colunas), montado
// a partir das primitivas de pdf.ts. Reconstrói cada coluna por posição x e junta
// quebras de linha dentro de uma mesma célula por proximidade vertical.
//
// Robustez (validada por backtest contra PDFs históricos):
//   - Cada coluna é alocada no slot canônico Seg→Dom pelo NOME do dia no cabeçalho,
//     nunca por posição — uma semana de feriado (Ter→Dom) não desloca os rótulos.
//   - A linha de datas é procurada POR CONTEÚDO nas linhas abaixo do cabeçalho (e no
//     próprio cabeçalho), não assumida como "a próxima linha".
//   - A saída tem SEMPRE 7 dias; dias ausentes ficam com itens vazios, e datas
//     ausentes de dias presentes são inferidas por aritmética de slots.

import type { MenuItem } from './types.js';
import { agruparEmLinhas, distribuirEmColunas, juntarCelulas, type TextItem } from './pdf.js';
import { indiceDoDia, alocarSlots, inferirDatas, type DiaParseado } from './slots.js';

const REGEX_DIA = /segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo/i;
const REGEX_TEM_DATA = /\d{1,2}\/(\d{1,2}|[a-zç]{3,})/i;

export interface OpcoesTabela {
  /** Rótulos de dia emitidos (ordem Seg→Dom), preservando o formato que o app espera. */
  diaLabels: string[];
  /** Extrai/normaliza a data de um texto de célula. Retorne null se não houver. */
  normalizarData: (raw: string) => string | null;
  /** Descarta um item (ruído: legendas, alergênicos, rótulos de seção). */
  descartar?: (item: string) => boolean;
  /** Gap vertical máximo p/ juntar linhas da mesma célula. */
  mergeGap?: number;
  /** Ignora itens à esquerda deste x (coluna de rótulos tipo FIXO/CARNE). */
  xMinBody?: number;
}

/**
 * Extrai UMA semana (sempre 7 slots Seg→Dom) dos itens de texto de uma página.
 * Retorna [] se não encontrar um cabeçalho com nomes de dias.
 */
export function extrairSemana(itens: TextItem[], opts: OpcoesTabela): MenuItem[] {
  const linhas = agruparEmLinhas(itens);

  // 1) Linha de cabeçalho = a que tem mais nomes de dia distintos.
  let idxCabecalho = -1;
  let maisDias = 0;
  linhas.forEach((linha, i) => {
    const distintos = new Set(
      linha.map((it) => indiceDoDia(it.str)).filter((v): v is number => v !== null)
    ).size;
    if (distintos > maisDias) {
      maisDias = distintos;
      idxCabecalho = i;
    }
  });
  if (idxCabecalho === -1 || maisDias < 3) return [];

  // Alguns PDFs quebram "Segunda - feira" em células; usa só a célula que carrega o
  // nome. Duas células do mesmo dia (raro) → mantém a primeira.
  const vistos = new Set<number>();
  const cabecalho = linhas[idxCabecalho].filter((it) => {
    const idx = indiceDoDia(it.str);
    if (idx === null || vistos.has(idx)) return false;
    vistos.add(idx);
    return true;
  });
  const centrosX = cabecalho.map((it) => it.x);

  // 2) Linha de datas: procura por conteúdo nas até 3 linhas abaixo do cabeçalho
  //    (ou no próprio cabeçalho, caso "SEGUNDA 18/08" na mesma célula/linha).
  let idxDatas = -1;
  for (let i = idxCabecalho + 1; i <= Math.min(idxCabecalho + 3, linhas.length - 1); i++) {
    const comData = linhas[i].filter((it) => REGEX_TEM_DATA.test(it.str)).length;
    if (comData >= 2) {
      idxDatas = i;
      break;
    }
  }

  const datasPorColuna: (string | null)[] = centrosX.map(() => null);
  const fonteDatas = idxDatas >= 0 ? linhas[idxDatas] : linhas[idxCabecalho];
  distribuirEmColunas(fonteDatas, centrosX).forEach((col, i) => {
    const texto = col.map((c) => c.str).join(' ');
    datasPorColuna[i] = opts.normalizarData(texto);
  });

  // 3) Corpo = itens abaixo da última linha estrutural (datas se houver, senão cabeçalho).
  const yEstrutura = Math.min(...(idxDatas >= 0 ? linhas[idxDatas] : linhas[idxCabecalho]).map((it) => it.y));
  const corpo = itens.filter((it) => it.y < yEstrutura - 2);
  const colunas = distribuirEmColunas(corpo, centrosX, { xMin: opts.xMinBody });

  const mergeGap = opts.mergeGap ?? 18;
  const descartar = opts.descartar ?? (() => false);

  const diasParseados: DiaParseado[] = centrosX.map((_, i) => {
    // Filtra o ruído ANTES de juntar células — senão uma anotação vertical próxima
    // seria mesclada dentro do nome do prato.
    const limpos = colunas[i].filter((it) => it.str.toLowerCase() !== 'nan' && !descartar(it.str));
    const celulas = juntarCelulas(limpos, mergeGap)
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== 'nan' && !descartar(s));
    return {
      nomeDetectado: cabecalho[i].str,
      data: datasPorColuna[i] ?? '',
      itens: celulas,
    };
  });

  return inferirDatas(alocarSlots(diasParseados, opts.diaLabels));
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
