// Trindade (salvo no Supabase como campus "florianopolis").
//
// O PDF do RU Trindade mudou de layout 3 vezes entre 2025 e 2026 (verificado no
// backtest com 52 PDFs históricos):
//   A) lista "DIA | CARDÁPIO PROGRAMADO" (até mai/2026): nome do dia inicia o bloco,
//      data dd/mm/yyyy na coluna esquerda, rótulos CARNE/SALADA 1/SOBREMESA+MOLHO.
//   B) lista atual (jun/2026+): linha de arroz inicia o bloco (o nome do DOMINGO
//      aparece no RODAPÉ do próprio bloco), data "17-ago-26".
//   C) tabela colunar Seg–Sex (semana de terceirizada, jul/2026): sem data por dia,
//      intervalo apenas no título ("Cardápio de 27 à 31/07/2026").
//
// Por isso o parser é multi-estratégia: tenta a lista (detectando A vs B pela
// posição da linha de arroz), cai para a tabela genérica, e pontua o melhor
// resultado. Dias são SEMPRE alocados nos 7 slots Seg→Dom pelo nome.

import type { CampusScraper, Menu, MenuItem } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';
import { fetchBinary } from '../lib/http.js';
import { extrairItens, agruparEmLinhas, numeroDePaginas, type TextItem } from '../lib/pdf.js';
import { extrairSemana, DIAS_MAIUSCULO_FEIRA } from '../lib/table.js';
import { parseDataExtenso, normalizarData, extrairData } from '../lib/dates.js';
import { alocarSlots, inferirDatas, indiceDoDia, type DiaParseado } from '../lib/slots.js';

const URL_SITE = 'https://ru.ufsc.br/ru/';

const REGEX_DIA = /segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo/i;
const REGEX_CORTE = /lista de ingredientes|card[áa]pio sujeito/i;
const X_ESQUERDA = 110; // coluna do dia/data; conteúdo fica à direita disso

function parseDataTrindade(raw: string): string | null {
  // Tolera espaços em volta dos separadores — o pdf.js às vezes fatia a data em
  // várias células ("11" "-" "mai" "-" "26"), que chegam aqui re-juntadas.
  const extensa = raw.toLowerCase().match(/(\d{1,2})\s*[\/-]\s*([a-zç]{3,})\s*[\/-]\s*(\d{2,4})/);
  if (extensa) return parseDataExtenso(`${extensa[1]}-${extensa[2]}-${extensa[3]}`);
  const numerica = raw.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/);
  if (numerica) return normalizarData(`${numerica[1]}/${numerica[2]}/${numerica[3]}`, 0);
  return null;
}

// Rótulos das linhas de conteúdo (ambos layouts de lista).
const REGEX_ROTULO =
  /^(carne(?:\s+almo[çc]o|\s+jantar?)?|complemento(?:\s+almo[çc]o|\s+jantar?)?|saladas?(?:\s*\d)?|sobremesa|molho\s+salada)\s*:\s*(.*)$/i;

/** Processa as células de conteúdo de uma linha visual, acumulando itens no dia. */
function processarCelulas(celulas: TextItem[], destino: DiaParseado) {
  let pendenteComplemento: string | null = null;
  for (const c of celulas) {
    const m = c.str.match(REGEX_ROTULO);
    if (m) {
      const rotulo = m[1];
      const valor = m[2].trim();
      if (/^complemento/i.test(rotulo)) {
        if (valor) destino.itens.push(`${rotulo.toUpperCase()}: ${valor}`);
        else pendenteComplemento = rotulo.toUpperCase();
      } else if (valor) {
        destino.itens.push(valor);
      }
      // rótulo sem valor (ex. "Carne:" | "Saladas:"): células seguintes são valores crus
    } else if (pendenteComplemento) {
      destino.itens.push(`${pendenteComplemento}: ${c.str}`);
      pendenteComplemento = null;
    } else {
      destino.itens.push(c.str);
    }
  }
}

/**
 * A fronteira entre a coluna dia/data e o conteúdo VARIA entre as eras do PDF
 * (conteúdo em x≈121, 145 ou 175) — derivamos do próprio PDF pela posição dos
 * rótulos ("Carne:", "Complemento:", linha de arroz), com fallback no default.
 */
function detectarXConteudo(linhas: TextItem[][]): number {
  let min = Infinity;
  for (const l of linhas) {
    for (const c of l) {
      if (REGEX_ROTULO.test(c.str) || /^arroz\b/i.test(c.str)) min = Math.min(min, c.x);
    }
  }
  return isFinite(min) ? Math.max(60, min - 5) : X_ESQUERDA;
}

/** Estratégia de lista (layouts A e B). Retorna null se não reconhecer. */
function parsearLista(itens: TextItem[]): MenuItem[] | null {
  let linhas = agruparEmLinhas(itens);

  // Corta tudo a partir de "LISTA DE INGREDIENTES"/rodapé — abaixo disso só há ruído
  // que imita rótulos ("ARROZ: arroz parboilizado, sal…").
  const idxCorte = linhas.findIndex((l) => REGEX_CORTE.test(l.map((c) => c.str).join(' ')));
  if (idxCorte >= 0) linhas = linhas.slice(0, idxCorte);

  const xConteudo = detectarXConteudo(linhas);

  const ehLinhaAncora = (l: TextItem[]) => l.some((c) => c.x < xConteudo && REGEX_DIA.test(c.str));
  const ancoras = linhas.filter(ehLinhaAncora);
  if (ancoras.length < 4) return null;

  // Layout B: as linhas de nome de dia trazem a linha de arroz na MESMA linha visual.
  const ehArroz = (c: TextItem) => c.x >= xConteudo && c.x <= xConteudo + 130 && /^arroz\b/i.test(c.str);
  const ancorasComArroz = ancoras.filter((l) => l.some(ehArroz)).length;
  const layoutB = ancorasComArroz >= Math.ceil(ancoras.length / 2);

  const ehInicioBloco = layoutB
    ? (l: TextItem[]) => l.some(ehArroz)
    : ehLinhaAncora;

  const inicios = linhas.map((l, i) => (ehInicioBloco(l) ? i : -1)).filter((i) => i >= 0);
  if (inicios.length < 4) return null;

  const dias: DiaParseado[] = [];
  inicios.forEach((ini, k) => {
    const fim = k + 1 < inicios.length ? inicios[k + 1] : linhas.length;
    const bloco = linhas.slice(ini, fim);
    const dia: DiaParseado = { nomeDetectado: '', data: '', itens: [] };
    for (const linha of bloco) {
      const esquerda = linha.filter((c) => c.x < xConteudo);
      if (esquerda.length) {
        if (!dia.nomeDetectado) {
          const nome = esquerda.find((c) => REGEX_DIA.test(c.str));
          if (nome) dia.nomeDetectado = nome.str;
        }
        // Junta as células antes de parsear — a data pode vir fatiada ("11" "-" "mai" "-" "26").
        if (!dia.data) dia.data = parseDataTrindade(esquerda.map((c) => c.str).join(' ')) ?? '';
      }
      processarCelulas(linha.filter((c) => c.x >= xConteudo), dia);
    }
    if (dia.itens.length) dias.push(dia);
  });

  return inferirDatas(alocarSlots(dias, DIAS_MAIUSCULO_FEIRA));
}

/** Estratégia de tabela colunar (layout C). Datas vêm do título quando ausentes. */
function parsearTabela(itens: TextItem[]): MenuItem[] {
  const RUIDO_TABELA = /^(saladas?|acompanhamentos?|carnes?|guarni[çc][ãa]o|sobremesas?|op[çc][ãa]o vegetariana)$/i;
  const slots = extrairSemana(itens, {
    diaLabels: DIAS_MAIUSCULO_FEIRA,
    normalizarData: (raw) => parseDataTrindade(raw) ?? extrairData(raw, new Date().getFullYear()),
    descartar: (s) =>
      RUIDO_TABELA.test(s.trim()) ||
      /fort refei[çc]|eventos ltda|card[áa]pio sujeito|nutricionista|elaborado/i.test(s),
  });

  // Sem data por coluna: usa o intervalo do título ("Cardápio de 27 à 31/07/2026").
  if (slots.every((s) => !s.data)) {
    const titulo = itens.map((i) => i.str).join(' ');
    const m = titulo.match(/(\d{1,2})\s*(?:à|a|até|-)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
    if (m) {
      const primeiroComItens = slots.findIndex((s) => s.itens.length > 0);
      if (primeiroComItens >= 0) {
        slots[primeiroComItens] = {
          ...slots[primeiroComItens],
          data: `${m[1].padStart(2, '0')}/${m[3].padStart(2, '0')}/${m[4]}`,
        };
        return inferirDatas(slots);
      }
    }
  }
  return slots;
}

const pontuacao = (dias: MenuItem[] | null) =>
  dias ? dias.filter((d) => d.itens.length > 0 && d.data).length : -1;

function parsearPagina(itens: TextItem[]): MenuItem[] | null {
  const lista = parsearLista(itens);
  if (pontuacao(lista) >= 5) return lista;
  const tabela = parsearTabela(itens);
  return pontuacao(tabela) > pontuacao(lista) ? tabela : lista;
}

/** Parse puro a partir do buffer do PDF (exportado para backtest). */
export async function parseTrindadePdf(buf: Uint8Array): Promise<Menu> {
  let dias = parsearPagina(await extrairItens(buf, 1));

  // Semanas que estendem para a página 2 (raro): parseia a página SEPARADAMENTE
  // (os espaços de coordenadas y são independentes) e preenche só os slots vazios.
  if (pontuacao(dias) < 5 && (await numeroDePaginas(buf)) > 1) {
    const p2 = parsearPagina(await extrairItens(buf, 2));
    if (p2) {
      if (!dias) dias = p2;
      else {
        dias = dias.map((d, i) => (d.itens.length === 0 && p2[i].itens.length > 0 ? p2[i] : d));
        dias = inferirDatas(dias);
      }
    }
  }

  if (!dias) throw new Error('Não foi possível reconhecer o layout do PDF do RU Trindade.');

  const datas = dias.map((d) => d.data).filter(Boolean);
  return {
    diaInicial: datas[0] ?? null,
    diaFinal: datas[datas.length - 1] ?? null,
    cardapio: dias,
  };
}

async function scrape(): Promise<Menu> {
  const $ = await carregarPagina(URL_SITE);
  // A página intercala cardápios de almoço com "CARDÁPIO CAFÉ" (café da manhã,
  // layout diferente) — e o café costuma ser o último link da semana. Filtramos
  // sobre o href DECODIFICADO (acentos chegam URL-encoded).
  const candidatos = $(".content li a[href$='.pdf']")
    .toArray()
    .map((el) => $(el).attr('href'))
    .filter((h): h is string => {
      if (!h) return false;
      const dec = decodeURIComponent(h);
      return !/caf[ée]/i.test(dec);
    });
  const ultimo = candidatos[candidatos.length - 1];
  if (!ultimo) throw new Error('Nenhum link de PDF de almoço encontrado no site do RU (Trindade).');

  const buf = await fetchBinary(resolverUrl(ultimo, URL_SITE));
  return parseTrindadePdf(buf);
}

export const trindade: CampusScraper = { campus: 'florianopolis', scrape };
