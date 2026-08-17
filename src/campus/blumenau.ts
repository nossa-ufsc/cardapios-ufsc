// Blumenau publica o cardápio apenas como imagem PNG. Não há parsing: o app
// (menu-display.tsx) detecta `cardapio.url_imagem` e renderiza a imagem.

import type { CampusScraper, Menu } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';

const URL_SITE = 'https://ru.blumenau.ufsc.br/cardapios/';

async function scrape(): Promise<Menu> {
  const $ = await carregarPagina(URL_SITE);
  const img = $("img[src*='cardapio'][src$='.png']").first();
  const src = img.attr('src');
  if (!src) {
    throw new Error('Nenhuma imagem de cardápio encontrada na página do RU Blumenau.');
  }
  return {
    diaInicial: null,
    diaFinal: null,
    cardapio: { url_imagem: resolverUrl(src, URL_SITE) },
  };
}

export const blumenau: CampusScraper = { campus: 'blumenau', scrape };
