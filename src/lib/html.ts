// Parsing de HTML com cheerio (substitui BeautifulSoup). Mantém os mesmos
// seletores CSS usados pelos scrapers Python originais.

import * as cheerio from 'cheerio';
import { fetchHtml } from './http.js';

export async function carregarPagina(url: string): Promise<cheerio.CheerioAPI> {
  const html = await fetchHtml(url);
  return cheerio.load(html);
}

/** Resolve um href/src relativo contra a URL base da página. */
export function resolverUrl(href: string, base: string): string {
  return new URL(href, base).toString();
}
