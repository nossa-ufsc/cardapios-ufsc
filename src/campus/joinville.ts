// Joinville: PDF com tabela semanal (lattice). Fonte já funcionava; reimplementado
// com reconstrução por coordenadas. Preserva `dia` sem "-FEIRA" e `data` em d/m/yyyy.

import type { CampusScraper, Menu, MenuItem } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';
import { fetchBinary } from '../lib/http.js';
import { extrairItens } from '../lib/pdf.js';
import { extrairSemana, DIAS_MAIUSCULO } from '../lib/table.js';
import { classificarPorNome, inferirPorVizinhos, extrairRefeicao, prato } from '../lib/categorias.js';
import { selecionarSemanaAtual } from '../lib/week.js';
import { hojeBrasilia } from '../lib/dates.js';

const URL_SITE = 'https://restaurante.joinville.ufsc.br/cardapio-da-semana/';

// O RU publica a semana seguinte antes da atual acabar (ex.: 26/10–1º/11 já no ar
// em 22/10), então "último link" não é "semana atual". Parseamos os mais recentes
// e escolhemos pela data.
const CANDIDATOS = 3;

const RUIDO = /cardápio sujeito|sujeito à altera|nutricionista|CRN\s*\d/i;

/** Parse puro a partir do buffer do PDF (exportado para backtest). */
export async function parseJoinvillePdf(buf: Uint8Array): Promise<Menu> {
  const itens = await extrairItens(buf, 1);

  const dias: MenuItem[] = extrairSemana(itens, {
    diaLabels: DIAS_MAIUSCULO,
    // Joinville é salvo historicamente em d/m/yyyy (sem zero-pad).
    normalizarData: (raw) => {
      const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (!m) return null;
      const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${Number(m[1])}/${Number(m[2])}/${ano}`;
    },
    descartar: (s) => RUIDO.test(s),
  });

  // v2: a tabela não tem rótulos de seção, mas segue sempre a mesma ordem de
  // linhas (arroz, arroz integral, feijão, carne, guarnição, leguminosa/vegetariano,
  // molho, saladas, sobremesa). Classificamos por palavra-chave e resolvemos o que
  // sobrar pela vizinhança nessa ordem.
  for (const d of dias) {
    if (!d.itens.length) continue;
    const cats = inferirPorVizinhos(d.itens.map((i) => classificarPorNome(i)));
    d.pratos = d.itens.map((nome, i) => prato({ ...extrairRefeicao(nome), categoria: cats[i] }));
  }

  const datas = dias.map((d) => d.data).filter(Boolean);
  return {
    diaInicial: datas[0] ?? null,
    diaFinal: datas[datas.length - 1] ?? null,
    cardapio: dias,
  };
}

async function scrape(): Promise<Menu> {
  const $ = await carregarPagina(URL_SITE);
  const hrefs = $("#content a[href$='.pdf']")
    .map((_, a) => $(a).attr('href'))
    .get()
    .filter(Boolean);
  if (!hrefs.length) throw new Error('Nenhum link de PDF encontrado no site do RU de Joinville.');

  const urls = [...new Set(hrefs.map((h) => resolverUrl(h, URL_SITE)))].slice(-CANDIDATOS);
  const menus: Menu[] = [];
  for (const url of urls) {
    try {
      menus.push({ ...(await parseJoinvillePdf(await fetchBinary(url))), fonteUrl: url });
    } catch (err) {
      console.error(`• Joinville: ignorando ${url} (${err instanceof Error ? err.message : err})`);
    }
  }
  if (!menus.length) throw new Error('Nenhum PDF do RU de Joinville pôde ser lido.');

  const semanas = menus.map((m) => m.cardapio as MenuItem[]);
  const escolhida = selecionarSemanaAtual(semanas, hojeBrasilia());
  return menus[semanas.indexOf(escolhida)];
}

export const joinville: CampusScraper = { campus: 'joinville', scrape };
