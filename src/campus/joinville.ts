// Joinville: PDF com tabela semanal (lattice). Fonte já funcionava; reimplementado
// com reconstrução por coordenadas. Preserva `dia` sem "-FEIRA" e `data` em d/m/yyyy.

import type { CampusScraper, Menu, MenuCategoria, MenuItem } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';
import { fetchBinary } from '../lib/http.js';
import { extrairItens, type TextItem } from '../lib/pdf.js';
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

// Desde nov/2026 o PDF tem duas faixas, cada uma aberta por uma linha que atravessa
// a tabela: "CAFÉ DA MANHÃ (07:00 às 08:30) …" e "ALMOÇO / JANTAR (11:00 às 13:30 /
// 17:00 às 19:00)". Sem separar, o café virava "pratos" do almoço e o rótulo da
// faixa entrava como item.
const ROTULO_CAFE = /caf[ée] da manh[ãa]/i;
const ROTULO_ALMOCO = /almo[çc]o\s*\/\s*jantar/i;
const SEM_ATENDIMENTO = /sem atendimento/i;

// Linhas da mesma célula ficam a ≤12pt; células vizinhas, a ≥13pt (em geral 18).
// O default de 18 grudava itens vizinhos ("Molho rosê Arroz Parboilizado").
const MERGE_GAP = 12;

const normalizarData = (raw: string) => {
  // Joinville é salvo historicamente em d/m/yyyy (sem zero-pad).
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${Number(m[1])}/${Number(m[2])}/${ano}`;
};

/** Item que começa em minúscula é a 2ª linha do anterior ("Pão tipo francês c/" + "geléia"). */
const emendarContinuacoes = (itens: string[]) =>
  itens.reduce<string[]>((acc, item) => {
    if (acc.length && /^[a-zà-öø-ÿ]/.test(item)) acc[acc.length - 1] += ` ${item}`;
    else acc.push(item);
    return acc;
  }, []);

const semana = (itens: TextItem[]) =>
  extrairSemana(itens, {
    diaLabels: DIAS_MAIUSCULO,
    normalizarData,
    descartar: (s) => RUIDO.test(s) || ROTULO_CAFE.test(s) || ROTULO_ALMOCO.test(s),
    mergeGap: MERGE_GAP,
  }).map((d) => ({ ...d, itens: emendarContinuacoes(d.itens) }));

// A faixa do almoço segue sempre a mesma ordem de linhas: saladas, molho, arroz,
// arroz integral, feijão e, depois do feijão, guarnição, opção vegetariana, carne e
// sobremesa. Depois do feijão a POSIÇÃO decide ("Feijão branco" ali é a opção
// vegetariana, não base); antes dele, o nome.
const DEPOIS_DO_FEIJAO: MenuCategoria[] = ['guarnicao', 'vegetariano', 'carne', 'sobremesa'];

function categorizar(itens: string[]): MenuCategoria[] {
  const porNome = inferirPorVizinhos(itens.map((i) => classificarPorNome(i)));
  const feijao = itens.findIndex((i) => /^feij[ãa]o/i.test(i.trim()));
  if (feijao === -1 || itens.length - feijao - 1 !== DEPOIS_DO_FEIJAO.length) return porNome;
  return itens.map((_, i) => (i > feijao ? DEPOIS_DO_FEIJAO[i - feijao - 1] : porNome[i]));
}

/** Parse puro a partir do buffer do PDF (exportado para backtest). */
export async function parseJoinvillePdf(buf: Uint8Array): Promise<Menu> {
  const itens = await extrairItens(buf, 1);

  const rotuloCafe = itens.find((it) => ROTULO_CAFE.test(it.str));
  const rotuloAlmoco = itens.find((it) => ROTULO_ALMOCO.test(it.str));
  // Com as duas faixas, o café é o que fica entre os dois rótulos; cabeçalho e
  // datas (acima do rótulo do café) entram nas duas extrações.
  const comCafe = !!rotuloCafe && !!rotuloAlmoco && rotuloCafe.y > rotuloAlmoco.y;
  const dias: MenuItem[] = comCafe
    ? semana(itens.filter((it) => it.y > rotuloCafe!.y || it.y < rotuloAlmoco!.y))
    : semana(itens);

  if (comCafe) {
    const cafe = semana(itens.filter((it) => it.y > rotuloAlmoco!.y));
    cafe.forEach((c, i) => {
      const doDia = c.itens.filter((item) => !SEM_ATENDIMENTO.test(item));
      if (dias[i] && doDia.length) dias[i].cafe = doDia;
    });
  }

  for (const d of dias) {
    if (!d.itens.length) continue;
    const cats = categorizar(d.itens);
    d.pratos = d.itens.map((nome, i) => prato({ ...extrairRefeicao(nome), categoria: cats[i] }));
  }

  const datas = dias.map((d) => d.data).filter(Boolean);
  const menu: Menu = {
    diaInicial: datas[0] ?? null,
    diaFinal: datas[datas.length - 1] ?? null,
    cardapio: dias,
  };
  if (rotuloAlmoco) menu.refeicoes = ['almoco', 'jantar'];
  return menu;
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
