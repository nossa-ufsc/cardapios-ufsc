// Curitibanos: PDF MENSAL (várias páginas, uma semana por página). O parser antigo
// concatenava tudo e gerava saída corrompida (45 "dias", diaFinal="Farofa"). Aqui
// extraímos cada semana por coordenadas e selecionamos a semana corrente — o app
// só entende 7 dias (Seg→Dom).

import type { CampusScraper, Menu, MenuItem } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';
import { fetchBinary } from '../lib/http.js';
import { extrairItens, numeroDePaginas } from '../lib/pdf.js';
import { extrairSemana, DIAS_TITLE_FEIRA } from '../lib/table.js';
import { extrairData, anoParaMes, hojeBrasilia } from '../lib/dates.js';
import { selecionarSemanaAtual } from '../lib/week.js';

const URL_SITE = 'https://ru.curitibanos.ufsc.br/cardapio';

// Rótulos de seção e legendas — não são pratos. IMPORTANTE: os rótulos de seção
// exigem match EXATO da célula ("CARNE", "SALADA"...); um prefixo aqui apagaria
// pratos legítimos como "Carne moída com milho" ou "Salada de cenoura".
const RUIDO_EXATO =
  /^(saladas?|pratos?\s*quentes?|carnes?|sobremesas?|op[çc][ãa]o vegetariana|guarni[çc][ãa]o|acompanhamentos?|lanches?|bebida(:\s*[áa]gua)?|almoço\/jantar)$/i;
const RUIDO_PARCIAL =
  /card[áa]pio (restaurante|ufsc|-)|sujeito a? ?altera[çc]|nutricionista|CRN\s*\d|^\*\s*c[lg]\s*-|cont[ée]m (leite|gl[úu]te[nm])|^obs\b/i;
const ehRuido = (s: string) => RUIDO_EXATO.test(s.trim()) || RUIDO_PARCIAL.test(s);

/** Parse puro a partir do buffer do PDF; `hoje` é injetável para backtest. */
export async function parseCuritibanosPdf(buf: Uint8Array, hoje?: Date): Promise<Menu> {
  const ref = hoje ?? hojeBrasilia();
  // dd/mm ou dd/mmm sem ano: resolve por mês (virada de ano dez↔jan correta).
  const ano = anoParaMes(ref);
  const totalPaginas = await numeroDePaginas(buf);

  const semanas: MenuItem[][] = [];
  for (let p = 1; p <= totalPaginas; p++) {
    const itens = await extrairItens(buf, p);
    const semana = extrairSemana(itens, {
      diaLabels: DIAS_TITLE_FEIRA,
      normalizarData: (raw) => extrairData(raw, ano),
      descartar: ehRuido,
      // Neste PDF os gaps de "prato novo" (~14pt) e de "quebra de linha" (~7-14pt)
      // se sobrepõem — corta baixo (11) e depois emenda continuações que começam
      // com minúscula ("Macarrão ao" + "molho rose").
      mergeGap: 11,
    });
    // Emenda continuações de linha: item que começa com minúscula é a segunda
    // linha do prato anterior ("Macarrão ao" + "molho rose"), não um prato novo.
    const emendada = semana.map((d) => ({
      ...d,
      itens: d.itens.reduce<string[]>((acc, item) => {
        if (acc.length && /^[a-zà-öø-ÿ]/.test(item)) acc[acc.length - 1] += ` ${item}`;
        else acc.push(item);
        return acc;
      }, []),
    }));

    if (emendada.some((d) => d.itens.length > 0)) semanas.push(emendada);
  }

  const semana = selecionarSemanaAtual(semanas, ref);
  const datas = semana.map((d) => d.data).filter(Boolean);
  return {
    diaInicial: datas[0] ?? null,
    diaFinal: datas[datas.length - 1] ?? null,
    cardapio: semana,
  };
}

async function scrape(): Promise<Menu> {
  const $ = await carregarPagina(URL_SITE);
  const link = $("#content .content a[href$='.pdf']").first().attr('href');
  if (!link) throw new Error('Nenhum PDF encontrado no site do RU de Curitibanos.');

  const buf = await fetchBinary(resolverUrl(link, URL_SITE));
  return parseCuritibanosPdf(buf);
}

export const curitibanos: CampusScraper = { campus: 'curitibanos', scrape };
