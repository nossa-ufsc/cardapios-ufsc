// Trindade (salvo no Supabase como campus "florianopolis").
//
// O PDF do RU Trindade mudou de layout 3 vezes entre 2025 e 2026 (verificado no
// backtest com 52 PDFs históricos):
//   A) lista "DIA | CARDÁPIO PROGRAMADO" (até mai/2026): nome do dia inicia o bloco,
//      data dd/mm/yyyy na coluna esquerda, rótulos CARNE/SALADA 1/SOBREMESA+MOLHO.
//   B) lista atual (jun/2026+): linha de arroz inicia o bloco (o nome do DOMINGO
//      aparece no RODAPÉ do próprio bloco), data "17-ago-26".
//   C) tabela colunar Seg–Sex (semana de terceirizada, jul/2026): sem data por dia,
//      intervalo apenas no título ("Cardápio de 27 à 31/07/2026").
//
// Por isso o parser é multi-estratégia: tenta a lista (detectando A vs B pela
// posição da linha de arroz), cai para a tabela genérica, e pontua o melhor
// resultado. Dias são SEMPRE alocados nos 7 slots Seg→Dom pelo nome.

import type { CampusScraper, Menu, MenuItem, MenuPrato, MenuCategoria, MenuRefeicao } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';
import { fetchBinary } from '../lib/http.js';
import { extrairItens, agruparEmLinhas, numeroDePaginas, type TextItem } from '../lib/pdf.js';
import { extrairSemana, DIAS_MAIUSCULO_FEIRA } from '../lib/table.js';
import { parseDataExtenso, normalizarData, extrairData } from '../lib/dates.js';
import { alocarSlots, inferirDatas, indiceDoDia, type DiaParseado } from '../lib/slots.js';
import {
  classificarPorNome, inferirPorVizinhos, extrairRefeicao, refeicaoDe, anexarIngredientes,
  normalizar, prato, SEPARADOR_ALTERNATIVAS,
} from '../lib/categorias.js';

const URL_SITE = 'https://ru.ufsc.br/ru/';

const REGEX_DIA = /segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo/i;
const REGEX_CORTE = /lista de ingredientes|card[áa]pio sujeito/i;
const X_ESQUERDA = 110; // coluna do dia/data; conteúdo fica à direita disso

function parseDataTrindade(raw: string): string | null {
  // Tolera espaços em volta dos separadores — o pdf.js às vezes fatia a data em
  // várias células ("11" "-" "mai" "-" "26"), que chegam aqui re-juntadas.
  const extensa = raw.toLowerCase().match(/(\d{1,2})\s*[\/-]\s*([a-zç]{3,})\s*[\/-]\s*(\d{2,4})/);
  if (extensa) return parseDataExtenso(`${extensa[1]}-${extensa[2]}-${extensa[3]}`);
  const numerica = raw.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/);
  if (numerica) return normalizarData(`${numerica[1]}/${numerica[2]}/${numerica[3]}`, 0);
  return null;
}

// Rótulos das linhas de conteúdo (ambos layouts de lista).
const REGEX_ROTULO =
  /^(carne(?:\s+almo[çc]o|\s+jantar?)?|complemento(?:\s+almo[çc]o|\s+jantar?)?|saladas?(?:\s*\d)?|sobremesa|molho\s+salada)\s*:\s*(.*)$/i;

/**
 * Estado da seção corrente dentro de um bloco de dia (persiste entre linhas):
 * o rótulo "Saladas:" abre uma região onde as linhas seguintes (sem rótulo)
 * trazem saladas, o molho e a sobremesa.
 */
interface EstadoBloco {
  categoria: MenuCategoria | null;
  refeicao?: MenuRefeicao;
  /** Células sem rótulo vistas depois de "Saladas:" (classificadas no fim do bloco). */
  posSaladas: string[];
}

export const novoEstado = (): EstadoBloco => ({ categoria: null, posSaladas: [] });

const REGEX_MOLHO = /^(molho|vinagrete|azeite|lim[ãa]o)\b/i;
// Variante de rótulo que o v1 NÃO reconhece (mantido assim p/ não alterar `itens`),
// mas que o v2 trata: "Complemento (jantar):", "Carne (almoço): X".
const REGEX_ROTULO_V2 =
  /^(carne|complemento|saladas?(?:\s*\d)?|sobremesa|molho(?:\s+salada)?)\s*(?:\(\s*(almo[çc]o|jantar?)\s*\))?\s*:\s*(.*)$/i;

function categoriaDoRotulo(rotulo: string): { categoria: MenuCategoria; refeicao?: MenuRefeicao } {
  const r = rotulo.toLowerCase();
  const refeicao = refeicaoDe(r);
  if (r.startsWith('carne')) return { categoria: 'carne', refeicao };
  if (r.startsWith('complemento')) return { categoria: 'guarnicao', refeicao };
  if (r.startsWith('salada')) return { categoria: 'salada' };
  if (r.startsWith('sobremesa')) return { categoria: 'sobremesa' };
  if (r.startsWith('molho')) return { categoria: 'molho' };
  return { categoria: 'outro' };
}

/** "Feijoada / Feijoada vegetariana" → 2 pratos; "(Jantar)"/"(J)" vira `refeicao`. */
function emitirPratos(valor: string, categoria: MenuCategoria, refeicao: MenuRefeicao | undefined, destino: MenuPrato[]) {
  // A linha do arroz/feijão nunca é carne/complemento: no layout A ela vem DEPOIS
  // de "Carne:" sem rótulo próprio e herdaria a seção errada.
  const linhaBase = /\b(arroz|feij[ãa]o)\b/i.test(valor);
  for (const parte of valor.split(SEPARADOR_ALTERNATIVAS)) {
    const { nome, refeicao: refSufixo } = extrairRefeicao(parte);
    if (!nome) continue;
    let cat = categoria;
    if (linhaBase || classificarPorNome(nome) === 'base') cat = 'base';
    if ((cat === 'carne' || cat === 'base') && /vegetarian|vegan/i.test(nome)) cat = 'vegetariano';
    destino.push(prato({ nome, categoria: cat, refeicao: refSufixo ?? refeicao }));
  }
}

/** Processa as células de conteúdo de uma linha visual, acumulando itens (v1) e pratos (v2) no dia. */
function processarCelulas(celulas: TextItem[], destino: DiaParseado, estado: EstadoBloco) {
  const pratos = (destino.pratos ??= []);
  let pendenteComplemento: string | null = null;
  for (const c of celulas) {
    const m = c.str.match(REGEX_ROTULO);
    if (m) {
      const rotulo = m[1];
      const valor = m[2].trim();
      const sec = categoriaDoRotulo(rotulo);
      estado.categoria = sec.categoria;
      estado.refeicao = sec.refeicao;
      if (/^complemento/i.test(rotulo)) {
        if (valor) destino.itens.push(`${rotulo.toUpperCase()}: ${valor}`);
        else pendenteComplemento = rotulo.toUpperCase();
      } else if (valor) {
        destino.itens.push(valor);
      }
      if (valor) emitirPratos(valor, sec.categoria, sec.refeicao, pratos);
      // rótulo sem valor (ex. "Carne:" | "Saladas:"): células seguintes são valores crus
    } else if (pendenteComplemento) {
      destino.itens.push(`${pendenteComplemento}: ${c.str}`);
      emitirPratos(c.str, 'guarnicao', estado.refeicao, pratos);
      pendenteComplemento = null;
    } else {
      destino.itens.push(c.str);
      const v2 = c.str.match(REGEX_ROTULO_V2);
      if (v2) {
        const sec = categoriaDoRotulo(v2[1]);
        estado.categoria = sec.categoria;
        estado.refeicao = v2[2] ? refeicaoDe(v2[2]) : sec.refeicao;
        if (v2[3].trim()) emitirPratos(v2[3], estado.categoria, estado.refeicao, pratos);
      } else if (estado.categoria === 'salada') {
        // Região pós-"Saladas:": só dá para saber o que é sobremesa no fim do bloco.
        estado.posSaladas.push(c.str);
      } else if (estado.categoria) {
        emitirPratos(c.str, estado.categoria, estado.refeicao, pratos);
      } else {
        // Antes de qualquer rótulo (linha do arroz/feijão): classificação por
        // palavra-chave ("RU fechado" etc. vira 'outro').
        emitirPratos(c.str, classificarPorNome(c.str.split(SEPARADOR_ALTERNATIVAS)[0]) ?? 'outro', undefined, pratos);
      }
    }
  }
}

/**
 * Fecha a região pós-"Saladas:" de um bloco: molho por regex, a ÚLTIMA célula é a
 * sobremesa (fruta), o resto são saladas. Layout A (antigo) rotula SOBREMESA/MOLHO
 * explicitamente e não passa por aqui.
 */
function fecharBloco(destino: DiaParseado, estado: EstadoBloco) {
  const pratos = (destino.pratos ??= []);
  const cels = estado.posSaladas;
  const temSobremesaExplicita = cels.some((s) => classificarPorNome(s) === 'sobremesa');
  cels.forEach((s, i) => {
    let categoria: MenuCategoria = 'salada';
    if (REGEX_MOLHO.test(s)) categoria = 'molho';
    else if (classificarPorNome(s) === 'sobremesa') categoria = 'sobremesa';
    else if (!temSobremesaExplicita && i === cels.length - 1 && cels.length > 1) categoria = 'sobremesa';
    emitirPratos(s, categoria, undefined, pratos);
  });
  estado.posSaladas = [];
}

/**
 * A fronteira entre a coluna dia/data e o conteúdo VARIA entre as eras do PDF
 * (conteúdo em x≈121, 145 ou 175) — derivamos do próprio PDF pela posição dos
 * rótulos ("Carne:", "Complemento:", linha de arroz), com fallback no default.
 */
function detectarXConteudo(linhas: TextItem[][]): number {
  let min = Infinity;
  for (const l of linhas) {
    for (const c of l) {
      if (REGEX_ROTULO.test(c.str) || /^arroz\b/i.test(c.str)) min = Math.min(min, c.x);
    }
  }
  return isFinite(min) ? Math.max(60, min - 5) : X_ESQUERDA;
}

/** Estratégia de lista (layouts A e B). Retorna null se não reconhecer. */
function parsearLista(itens: TextItem[]): MenuItem[] | null {
  let linhas = agruparEmLinhas(itens);

  // Corta tudo a partir de "LISTA DE INGREDIENTES"/rodapé — abaixo disso só há ruído
  // que imita rótulos ("ARROZ: arroz parboilizado, sal…").
  const idxCorte = linhas.findIndex((l) => REGEX_CORTE.test(l.map((c) => c.str).join(' ')));
  if (idxCorte >= 0) linhas = linhas.slice(0, idxCorte);

  const xConteudo = detectarXConteudo(linhas);

  const ehLinhaAncora = (l: TextItem[]) => l.some((c) => c.x < xConteudo && REGEX_DIA.test(c.str));
  const ancoras = linhas.filter(ehLinhaAncora);
  if (ancoras.length < 4) return null;

  // Layout B: as linhas de nome de dia trazem a linha de arroz na MESMA linha visual.
  const ehArroz = (c: TextItem) => c.x >= xConteudo && c.x <= xConteudo + 130 && /^arroz\b/i.test(c.str);
  const ancorasComArroz = ancoras.filter((l) => l.some(ehArroz)).length;
  const layoutB = ancorasComArroz >= Math.ceil(ancoras.length / 2);

  const ehInicioBloco = layoutB
    ? (l: TextItem[]) => l.some(ehArroz)
    : ehLinhaAncora;

  const inicios = linhas.map((l, i) => (ehInicioBloco(l) ? i : -1)).filter((i) => i >= 0);
  if (inicios.length < 4) return null;

  const dias: DiaParseado[] = [];
  inicios.forEach((ini, k) => {
    const fim = k + 1 < inicios.length ? inicios[k + 1] : linhas.length;
    const bloco = linhas.slice(ini, fim);
    const dia: DiaParseado = { nomeDetectado: '', data: '', itens: [], pratos: [] };
    const estado = novoEstado();
    for (const linha of bloco) {
      const esquerda = linha.filter((c) => c.x < xConteudo);
      if (esquerda.length) {
        if (!dia.nomeDetectado) {
          const nome = esquerda.find((c) => REGEX_DIA.test(c.str));
          if (nome) dia.nomeDetectado = nome.str;
        }
        // Junta as células antes de parsear — a data pode vir fatiada ("11" "-" "mai" "-" "26").
        if (!dia.data) dia.data = parseDataTrindade(esquerda.map((c) => c.str).join(' ')) ?? '';
      }
      processarCelulas(linha.filter((c) => c.x >= xConteudo), dia, estado);
    }
    fecharBloco(dia, estado);
    if (dia.itens.length) dias.push(dia);
  });

  return inferirDatas(alocarSlots(dias, DIAS_MAIUSCULO_FEIRA));
}

/** Estratégia de tabela colunar (layout C). Datas vêm do título quando ausentes. */
function parsearTabela(itens: TextItem[]): MenuItem[] {
  const RUIDO_TABELA = /^(saladas?|acompanhamentos?|carnes?|guarni[çc][ãa]o|sobremesas?|op[çc][ãa]o vegetariana)$/i;
  const slots = extrairSemana(itens, {
    diaLabels: DIAS_MAIUSCULO_FEIRA,
    normalizarData: (raw) => parseDataTrindade(raw) ?? extrairData(raw, new Date().getFullYear()),
    descartar: (s) =>
      RUIDO_TABELA.test(s.trim()) ||
      /fort refei[çc]|eventos ltda|card[áa]pio sujeito|nutricionista|elaborado/i.test(s),
  });

  slots.forEach((s) => {
    if (s.itens.length) s.pratos = pratosPorClassificador(s.itens);
  });

  // Sem data por coluna: usa o intervalo do título ("Cardápio de 27 à 31/07/2026").
  if (slots.every((s) => !s.data)) {
    const titulo = itens.map((i) => i.str).join(' ');
    const m = titulo.match(/(\d{1,2})\s*(?:à|a|até|-)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
    if (m) {
      const primeiroComItens = slots.findIndex((s) => s.itens.length > 0);
      if (primeiroComItens >= 0) {
        slots[primeiroComItens] = {
          ...slots[primeiroComItens],
          data: `${m[1].padStart(2, '0')}/${m[3].padStart(2, '0')}/${m[4]}`,
        };
        return inferirDatas(slots);
      }
    }
  }
  return slots;
}

/** Fallback sem rótulos (layout C): classificador por nome + vizinhança. */
function pratosPorClassificador(itens: string[]): MenuPrato[] {
  const cats = inferirPorVizinhos(itens.map((i) => classificarPorNome(i)));
  return itens.map((nome, i) => prato({ ...extrairRefeicao(nome), categoria: cats[i] }));
}

const pontuacao = (dias: MenuItem[] | null) =>
  dias ? dias.filter((d) => d.itens.length > 0 && d.data).length : -1;

function parsearPagina(itens: TextItem[]): MenuItem[] | null {
  const lista = parsearLista(itens);
  if (pontuacao(lista) >= 5) return lista;
  const tabela = parsearTabela(itens);
  return pontuacao(tabela) > pontuacao(lista) ? tabela : lista;
}

/** Parse puro a partir do buffer do PDF (exportado para backtest). */
export async function parseTrindadePdf(buf: Uint8Array): Promise<Menu> {
  let dias = parsearPagina(await extrairItens(buf, 1));

  // Semanas que estendem para a página 2 (raro): parseia a página SEPARADAMENTE
  // (os espaços de coordenadas y são independentes) e preenche só os slots vazios.
  if (pontuacao(dias) < 5 && (await numeroDePaginas(buf)) > 1) {
    const p2 = parsearPagina(await extrairItens(buf, 2));
    if (p2) {
      if (!dias) dias = p2;
      else {
        dias = dias.map((d, i) => (d.itens.length === 0 && p2[i].itens.length > 0 ? p2[i] : d));
        dias = inferirDatas(dias);
      }
    }
  }

  if (!dias) throw new Error('Não foi possível reconhecer o layout do PDF do RU Trindade.');

  // v2: lista de ingredientes (páginas seguintes) → `ingredientes` + alergênicos por prato.
  const ingredientes = await extrairListaDeIngredientes(buf);
  dias = dias.map((d, i) =>
    d.pratos?.length ? { ...d, pratos: anexarIngredientes(d.pratos, ingredientes.get(i)) } : d
  );

  const datas = dias.map((d) => d.data).filter(Boolean);
  const menu: Menu = {
    diaInicial: datas[0] ?? null,
    diaFinal: datas[datas.length - 1] ?? null,
    cardapio: dias,
  };
  const temJantar = dias.some((d) => d.pratos?.some((p) => p.refeicao === 'jantar'));
  if (temJantar) menu.refeicoes = ['almoco', 'jantar'];
  return menu;
}

// ─── Lista de ingredientes ───────────────────────────────────────────────────
// A partir da 2ª página o PDF traz "LISTA DE INGREDIENTES": um cabeçalho por dia
// ("Terça-Feira: 18/08/2026") e linhas "NOME DO PRATO: ingrediente, ingrediente…"
// (com quebras de linha na continuação). É a única fonte de "contém glúten" etc.

const REGEX_CABECALHO_DIA = /^(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(\s*-?\s*feira)?\s*[:\-–]?\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?/i;
const REGEX_ENTRADA = /^([A-ZÀ-Ü0-9][A-ZÀ-Ü0-9 ,.'’()\-\/]{1,80}?):\s*(.*)$/;

/** Mapa slot do dia (0-6) → { nomeNormalizado → ingredientes }. */
async function extrairListaDeIngredientes(buf: Uint8Array): Promise<Map<number, Map<string, string>>> {
  const porDia = new Map<number, Map<string, string>>();
  const paginas = await numeroDePaginas(buf);
  let diaAtual: number | null = null;
  let entradaAtual: { dia: number; chave: string; texto: string } | null = null;
  let dentroDaLista = false;

  const fechar = () => {
    if (!entradaAtual) return;
    const mapa = porDia.get(entradaAtual.dia) ?? new Map<string, string>();
    mapa.set(entradaAtual.chave, entradaAtual.texto.replace(/\s+/g, ' ').trim());
    porDia.set(entradaAtual.dia, mapa);
    entradaAtual = null;
  };

  for (let p = 1; p <= paginas; p++) {
    const linhas = agruparEmLinhas(await extrairItens(buf, p));
    for (const linha of linhas) {
      const texto = linha.map((c) => c.str).join(' ').trim();
      if (!dentroDaLista) {
        if (/lista de ingredientes/i.test(texto)) dentroDaLista = true;
        continue;
      }
      if (REGEX_CABECALHO_DIA.test(texto)) {
        fechar();
        diaAtual = indiceDoDia(texto);
        continue;
      }
      if (diaAtual === null) continue;
      const m = texto.match(REGEX_ENTRADA);
      // Nome do prato vem em CAIXA ALTA; uma continuação ("orégano") não casa.
      if (m && m[1] === m[1].toUpperCase() && /[A-ZÀ-Ü]{3}/.test(m[1])) {
        fechar();
        entradaAtual = { dia: diaAtual, chave: normalizar(m[1]), texto: m[2] };
      } else if (entradaAtual) {
        entradaAtual.texto += ' ' + texto;
      }
    }
  }
  fechar();
  return porDia;
}

async function scrape(): Promise<Menu> {
  const $ = await carregarPagina(URL_SITE);
  // A página intercala cardápios de almoço com "CARDÁPIO CAFÉ" (café da manhã,
  // layout diferente) — e o café costuma ser o último link da semana. Filtramos
  // sobre o href DECODIFICADO (acentos chegam URL-encoded).
  const candidatos = $(".content li a[href$='.pdf']")
    .toArray()
    .map((el) => $(el).attr('href'))
    .filter((h): h is string => {
      if (!h) return false;
      const dec = decodeURIComponent(h);
      return !/caf[ée]/i.test(dec);
    });
  const ultimo = candidatos[candidatos.length - 1];
  if (!ultimo) throw new Error('Nenhum link de PDF de almoço encontrado no site do RU (Trindade).');

  const url = resolverUrl(ultimo, URL_SITE);
  const buf = await fetchBinary(url);
  return { ...(await parseTrindadePdf(buf)), fonteUrl: url };
}

export const trindade: CampusScraper = { campus: 'florianopolis', scrape };
