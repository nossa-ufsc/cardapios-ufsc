// Trindade (salvo no Supabase como campus "florianopolis"). PDF com layout de
// tabela: coluna x≈36 traz o nome do dia e a data; x≈145 os rótulos
// (Arroz/Carne/Complemento/Saladas); x≈298+ os pratos.
//
// O formato do PDF mudou (a data virou "17-ago-26"), quebrando o parser antigo
// baseado em regex dd/mm/yyyy. Aqui parseamos por coordenadas e convertemos a data.
// Estilo dos itens preserva o comportamento consumido pelo app (features/menu):
// prato de carne e saladas "puros"; complemento mantém o prefixo (o app o remove
// em formatMenuItem); a linha de arroz/feijão entra como item.

import type { CampusScraper, Menu, MenuItem } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';
import { fetchBinary } from '../lib/http.js';
import { extrairItens, agruparEmLinhas, numeroDePaginas, type TextItem } from '../lib/pdf.js';
import { parseDataExtenso } from '../lib/dates.js';

const URL_SITE = 'https://ru.ufsc.br/ru/';

const REGEX_DIA = /^(SEGUNDA-FEIRA|TERÇA-FEIRA|QUARTA-FEIRA|QUINTA-FEIRA|SEXTA-FEIRA|SÁBADO|DOMINGO)/i;
const REGEX_PARAR = /lista de ingredientes|restaurante universit|programação semanal|cardápio sujeito/i;
const REGEX_DATA = /\d{1,2}[\/-][a-zç]{3,}[\/-]\d{2,4}/i;

const X_CONTEUDO = 140; // itens de menu ficam a partir daqui; x≈36 é a coluna dia/data.

// Toda coluna de dia começa por uma linha de arroz ("Arroz ... / ... integral ...").
// Segmentamos por ela porque o bloco do DOMINGO tem o nome/data no rodapé (não no topo),
// o que quebraria uma segmentação por nome do dia.
const ehLinhaArroz = (c: TextItem) =>
  c.x >= 120 && c.x <= 210 && /arroz/i.test(c.str) && /integral/i.test(c.str);

function processarLinha(linha: TextItem[], destino: MenuItem) {
  // Data (coluna da esquerda), às vezes na mesma linha do "Carne:".
  const celulaData = linha.find((c) => c.x < 80 && REGEX_DATA.test(c.str));
  if (celulaData && !destino.data) destino.data = parseDataExtenso(celulaData.str) ?? '';

  const conteudo = linha.filter((c) => c.x >= X_CONTEUDO);
  if (conteudo.length === 0) return;

  const rotulo = conteudo[0].str;
  const valores = conteudo.slice(1).map((c) => c.str);

  if (/^complemento/i.test(rotulo)) {
    const prefixo = rotulo.replace(/:\s*$/, '').toUpperCase();
    const val = valores.join(' ').trim();
    if (val) destino.itens.push(`${prefixo}: ${val}`);
  } else if (/^carne/i.test(rotulo)) {
    valores.forEach((v) => destino.itens.push(v));
  } else if (/^saladas?:/i.test(rotulo)) {
    valores.forEach((v) => destino.itens.push(v));
  } else {
    // Sem rótulo com dois-pontos: linha de arroz, salada/molho/fruta — cada célula é um item.
    conteudo.forEach((c) => destino.itens.push(c.str));
  }
}

function parsearDias(itens: TextItem[]): MenuItem[] {
  const linhas = agruparEmLinhas(itens).filter(
    (l) => !(REGEX_PARAR.test(l.map((c) => c.str).join(' ')) && !l.some((c) => REGEX_DIA.test(c.str)))
  );

  // Índices das linhas de arroz = início de cada bloco de dia.
  const inicios = linhas.map((l, i) => (l.some(ehLinhaArroz) ? i : -1)).filter((i) => i >= 0);
  const dias: MenuItem[] = [];

  inicios.forEach((ini, k) => {
    const fim = k + 1 < inicios.length ? inicios[k + 1] : linhas.length;
    const bloco = linhas.slice(ini, fim);
    const dia: MenuItem = { dia: '', data: '', itens: [] };
    for (const linha of bloco) {
      const nome = linha.find((c) => c.x < 80 && REGEX_DIA.test(c.str));
      if (nome && !dia.dia) dia.dia = nome.str.toUpperCase();
      processarLinha(linha, dia);
    }
    dias.push(dia);
  });

  return dias;
}

async function scrape(): Promise<Menu> {
  const $ = await carregarPagina(URL_SITE);
  const links = $(".content li a[href$='.pdf']");
  const ultimo = links.last().attr('href');
  if (!ultimo) throw new Error('Nenhum link de PDF encontrado no site do RU (Trindade).');

  const buf = await fetchBinary(resolverUrl(ultimo, URL_SITE));

  // A tabela do cardápio fica na 1ª página; páginas seguintes são ingredientes.
  // Se por acaso não fecharem 7 dias, varre também a 2ª página.
  let itens = await extrairItens(buf, 1);
  let dias = parsearDias(itens);
  if (dias.length < 7 && (await numeroDePaginas(buf)) > 1) {
    const p2 = await extrairItens(buf, 2);
    dias = parsearDias([...itens, ...p2]);
  }

  const datas = dias.map((d) => d.data).filter(Boolean);
  return {
    diaInicial: datas[0] ?? null,
    diaFinal: datas[datas.length - 1] ?? null,
    cardapio: dias,
  };
}

export const trindade: CampusScraper = { campus: 'florianopolis', scrape };
