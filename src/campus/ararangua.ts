// Araranguá: a fonte trocou de .docx para PDF (o scraper antigo, que buscava .docx,
// quebrou 100%). Agora baixamos o PDF do cardápio e reconstruímos a tabela por
// coordenadas. A página também lista um PDF institucional (conexão do projetor),
// então filtramos pelo href que contém "cardapio".

import type { CampusScraper, Menu, MenuItem } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';
import { fetchBinary } from '../lib/http.js';
import { extrairItens } from '../lib/pdf.js';
import { extrairSemana, DIAS_MAIUSCULO_FEIRA } from '../lib/table.js';
import { normalizarData, hojeBrasilia } from '../lib/dates.js';

const URL_SITE = 'https://ara.ufsc.br/ru/';

const RUIDO =
  /cont[ée]m\s+(l[áa]cteos|gl[úu]te[nm])|adição|intencional|origem animal|nutricionista|CRN\s*\d|sujeito à altera|^\d+\s*op[çc]|^\d*\s*op[çc][ãa]o/i;

async function scrape(): Promise<Menu> {
  const $ = await carregarPagina(URL_SITE);
  const candidatos = $("a[href$='.pdf']")
    .toArray()
    .map((el) => $(el).attr('href'))
    .filter((h): h is string => !!h && /cardapio/i.test(h));
  const link = candidatos[candidatos.length - 1];
  if (!link) throw new Error('Nenhum PDF de cardápio encontrado no site do RU de Araranguá.');

  const buf = await fetchBinary(resolverUrl(link, URL_SITE));
  const itens = await extrairItens(buf, 1);
  const ano = hojeBrasilia().getFullYear();

  const dias: MenuItem[] = extrairSemana(itens, {
    diaLabels: DIAS_MAIUSCULO_FEIRA,
    normalizarData: (raw) => normalizarData(raw, ano),
    descartar: (s) => RUIDO.test(s),
    xMinBody: 90, // ignora a coluna de rótulos (FIXO/CARNE/GUARNIÇÃO/SOBREMESA) à esquerda
  });

  const datas = dias.map((d) => d.data).filter(Boolean);
  return {
    diaInicial: datas[0] ?? null,
    diaFinal: datas[datas.length - 1] ?? null,
    cardapio: dias,
  };
}

export const ararangua: CampusScraper = { campus: 'ararangua', scrape };
