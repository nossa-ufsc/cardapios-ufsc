// Araranguá: a fonte trocou de .docx para PDF (o scraper antigo, que buscava .docx,
// quebrou 100%). Agora baixamos o PDF do cardápio e reconstruímos a tabela por
// coordenadas. A página também lista um PDF institucional (conexão do projetor),
// então filtramos pelo href que contém "cardapio".

import type { CampusScraper, Menu, MenuItem } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';
import { fetchBinary } from '../lib/http.js';
import { extrairItens } from '../lib/pdf.js';
import { extrairSemana, DIAS_MAIUSCULO_FEIRA } from '../lib/table.js';
import { extrairData, anoParaMes, hojeBrasilia, type AnoPadrao } from '../lib/dates.js';

const URL_SITE = 'https://ara.ufsc.br/ru/';

const RUIDO =
  /cont[ée]m\s+(l[áa]cteos|gl[úu]te[nm])|adição|intencional|origem animal|nutricionista|CRN\s*\d|sujeito à altera|^\d+\s*op[çc]|^\d*\s*op[çc][ãa]o/i;

// O pdf.js às vezes fatia a legenda "SEM ADIÇÃO INTENCIONAL DE ORIGEM ANIMAL" em
// células soltas ("SEM", "COM", "ANIMAL DE"…). Qualquer célula composta SÓ por
// palavras da legenda é ruído — nenhum prato real é feito só delas.
const FRAGMENTO_LEGENDA = /^((sem|com|de|animal|origem|adi[çc][ãa]o|intencional)\s*)+$/i;
const ehRuido = (s: string) => RUIDO.test(s) || FRAGMENTO_LEGENDA.test(s.trim());

/** Parse puro a partir do buffer do PDF (exportado para backtest). */
export async function parseAraranguaPdf(buf: Uint8Array, ano?: number): Promise<Menu> {
  const itens = await extrairItens(buf, 1);
  // Sem ano explícito (produção), resolve por mês — dd/mm na virada de ano não
  // pode herdar o ano errado (dez visto em jan é do ano anterior, e vice-versa).
  const anoBase: AnoPadrao = ano ?? anoParaMes(hojeBrasilia());

  const semana = extrairSemana(itens, {
    diaLabels: DIAS_MAIUSCULO_FEIRA,
    normalizarData: (raw) => extrairData(raw, anoBase),
    descartar: ehRuido,
    xMinBody: 90, // ignora a coluna de rótulos (FIXO/CARNE/GUARNIÇÃO/SOBREMESA) à esquerda
  });

  // Emenda continuações de linha ("Proteína" + "vegetal") — item que começa com
  // minúscula é a segunda linha do item anterior, não um item novo.
  const dias: MenuItem[] = semana.map((d) => ({
    ...d,
    itens: d.itens.reduce<string[]>((acc, item) => {
      if (acc.length && /^[a-zà-öø-ÿ]/.test(item)) acc[acc.length - 1] += ` ${item}`;
      else acc.push(item);
      return acc;
    }, []),
  }));

  const datas = dias.map((d) => d.data).filter(Boolean);
  return {
    diaInicial: datas[0] ?? null,
    diaFinal: datas[datas.length - 1] ?? null,
    cardapio: dias,
  };
}

async function scrape(): Promise<Menu> {
  const $ = await carregarPagina(URL_SITE);
  // Decodifica o href antes de filtrar — "Cardápio-…pdf" chega URL-encoded.
  const candidatos = $("a[href*='.pdf']")
    .toArray()
    .map((el) => $(el).attr('href'))
    .filter((h): h is string => {
      if (!h) return false;
      const dec = decodeURIComponent(h);
      return /card[áa]pio|cardapio/i.test(dec);
    });
  const link = candidatos[candidatos.length - 1];
  if (!link) throw new Error('Nenhum PDF de cardápio encontrado no site do RU de Araranguá.');

  const buf = await fetchBinary(resolverUrl(link, URL_SITE));
  return parseAraranguaPdf(buf);
}

export const ararangua: CampusScraper = { campus: 'ararangua', scrape };
