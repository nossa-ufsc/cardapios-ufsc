// Curitibanos: PDF MENSAL (várias páginas, uma semana por página). O parser antigo
// concatenava tudo e gerava saída corrompida (45 "dias", diaFinal="Farofa"). Aqui
// extraímos cada semana por coordenadas e selecionamos a semana corrente — o app
// só entende 7 dias (Seg→Dom).

import type { CampusScraper, Menu, MenuItem } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';
import { fetchBinary } from '../lib/http.js';
import { extrairItens, numeroDePaginas } from '../lib/pdf.js';
import { extrairSemana, DIAS_TITLE_FEIRA } from '../lib/table.js';
import { parseDataFlex, hojeBrasilia } from '../lib/dates.js';
import { selecionarSemanaAtual } from '../lib/week.js';

const URL_SITE = 'https://ru.curitibanos.ufsc.br/cardapio';

// Rótulos de seção (centralizados na tabela) e legendas — não são pratos.
const RUIDO =
  /^(salada|pratos?\s*quentes?|carne|bebida|sobremesa|opção vegetariana|guarnição|acompanhamento|lanche)\b|almoço\/jantar|cardápio|sujeito à altera|nutricionista|CRN\s*\d|^\*?c[lg]\b|contém (leite|glúten)|^obs|bebida:|água/i;

async function scrape(): Promise<Menu> {
  const $ = await carregarPagina(URL_SITE);
  const link = $("#content .content a[href$='.pdf']").first().attr('href');
  if (!link) throw new Error('Nenhum PDF encontrado no site do RU de Curitibanos.');

  const buf = await fetchBinary(resolverUrl(link, URL_SITE));
  const ano = hojeBrasilia().getFullYear();
  const totalPaginas = await numeroDePaginas(buf);

  const semanas: MenuItem[][] = [];
  for (let p = 1; p <= totalPaginas; p++) {
    const itens = await extrairItens(buf, p);
    const semana = extrairSemana(itens, {
      diaLabels: DIAS_TITLE_FEIRA,
      normalizarData: (raw) => parseDataFlex(raw, ano),
      descartar: (s) => RUIDO.test(s),
    });
    if (semana.some((d) => d.itens.length > 0)) semanas.push(semana);
  }

  const semana = selecionarSemanaAtual(semanas, hojeBrasilia());
  const datas = semana.map((d) => d.data).filter(Boolean);
  return {
    diaInicial: datas[0] ?? null,
    diaFinal: datas[datas.length - 1] ?? null,
    cardapio: semana,
  };
}

export const curitibanos: CampusScraper = { campus: 'curitibanos', scrape };
