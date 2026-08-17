// Blumenau publica o cardápio apenas como imagem PNG. Não há parsing: o app
// (menu-display.tsx) detecta `cardapio.url_imagem` e renderiza a imagem.

import type { CampusScraper, Menu } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';

const URL_SITE = 'https://ru.blumenau.ufsc.br/cardapios/';

async function scrape(): Promise<Menu> {
  const $ = await carregarPagina(URL_SITE);
  // Aceita png/jpg/jpeg — o RU pode trocar o formato de exportação a qualquer momento.
  const img = $("img[src*='cardapio']")
    .toArray()
    .map((el) => $(el).attr('src'))
    .find((s): s is string => !!s && /\.(png|jpe?g)(\?.*)?$/i.test(s));
  if (!img) {
    throw new Error('Nenhuma imagem de cardápio encontrada na página do RU Blumenau.');
  }
  // Força https: os paginas.ufsc.br servem TLS válido e iOS (ATS) bloqueia http.
  const url = resolverUrl(img, URL_SITE).replace(/^http:\/\//, 'https://');
  return {
    diaInicial: null,
    diaFinal: null,
    cardapio: { url_imagem: url },
    fonteUrl: URL_SITE,
  };
}

export const blumenau: CampusScraper = { campus: 'blumenau', scrape };
