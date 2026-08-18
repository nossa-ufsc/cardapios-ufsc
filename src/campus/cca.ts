// RU do CCA (Itacorubi, Florianópolis) — salvo no Supabase como campus "cca".
//
// Fonte: https://ru.ufsc.br/cca-2/ (Cardápios RUs → "Campus Florianópolis – CCA").
// A página lista os PDFs do MAIS NOVO para o mais antigo (o oposto do Trindade).
// O RU do CCA é terceirizado ("Fort refeições e eventos Ltda") e o PDF tem um
// template estável desde pelo menos mar/2025:
//   - página 1: tabela colunar Seg–Sex (7 colunas a partir do SÁBADO nas semanas em
//     que o Trindade fecha e o CCA cobre o fim de semana), sem data por coluna;
//   - páginas 2..N: UMA PÁGINA POR DIA servido (feriado não tem página), com
//     cabeçalho "Segunda feira – 17/08/2026" e seções rotuladas "Saladas:",
//     "Acompanhamentos:", "Proteína animal:", "Fruta:", cada prato como
//     "Nome: ingredientes (Não contém glúten, não contém lactose, contém produtos
//     de origem animal)".
// As páginas por dia são a fonte primária: dão data exata, categoria pelo rótulo
// estrutural, ingredientes e declaração de alergênicos de TODOS os pratos. Nas
// férias o PDF vem só com a página 1 → fallback pela tabela (sem ingredientes).
// Este é o mesmo template do "layout C" do Trindade (semana terceirizada).

import type { CampusScraper, Menu, MenuAlergenos, MenuCategoria, MenuPrato } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';
import { fetchBinary } from '../lib/http.js';
import { extrairItens, agruparEmLinhas, numeroDePaginas, type TextItem } from '../lib/pdf.js';
import { colunasDaSemana } from '../lib/table.js';
import { alocarSlots, inferirDatas, indiceDoDia, type DiaParseado } from '../lib/slots.js';
import { classificarPorNome, normalizar, prato } from '../lib/categorias.js';
import { LABELS_POR_CAMPUS } from '../lib/validate.js';

const URL_SITE = 'https://ru.ufsc.br/cca-2/';
const LABELS_CCA = LABELS_POR_CAMPUS.cca;

// "Segunda feira – 17/08/2026", "Sábado – 01/08/2026" (a linha pode terminar com
// "eventos Ltda", vindo do cabeçalho da empresa na mesma altura).
const REGEX_CABECALHO_DIA =
  /^(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(?:\s*-?\s*feira)?\s*[:\-–]?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i;
const REGEX_RODAPE = /sujeito a? ?altera|nutricionista|CRN\s*\d|elaborad[oa] pel/i;
const REGEX_LEGUMINOSA = /lentilha|ervilha|soja|gr[ãa]os?\b|trigo|feij[ãa]o branco/i;

type Secao = 'saladas' | 'acompanhamentos' | 'proteina' | 'sobremesa';

/** Rótulo de seção no início da linha (normalizada); devolve também o resto da linha. */
function detectarSecao(linha: string): { secao: Secao; resto: string } | null {
  const m = linha.match(/^(saladas?|acompanhamentos?|prote[ií]na animal|frutas?|sobremesas?)\s*:?\s*(.*)$/i);
  if (!m) return null;
  const rot = normalizar(m[1]);
  const secao: Secao = rot.startsWith('salada')
    ? 'saladas'
    : rot.startsWith('acompanhamento')
      ? 'acompanhamentos'
      : rot.startsWith('proteina')
        ? 'proteina'
        : 'sobremesa';
  return { secao, resto: m[2].trim() };
}

/**
 * "(Não contém glúten, não contém lactose, contém produtos de origem animal)" →
 * flags. Divide por vírgula ANTES de normalizar — `extrairAlergenos` (genérico)
 * normaliza primeiro e o "não" da cláusula seguinte é engolido como sufixo da
 * anterior, invertendo o glúten.
 */
export function parseDeclaracaoAlergenos(texto: string): MenuAlergenos | undefined {
  const out: MenuAlergenos = {};
  for (const parte of texto.split(/[,;]|\s+e\s+(?=n[ãa]o|cont)/i)) {
    const m = normalizar(parte).match(/^(nao )?contem (gluten|lactose|lacteos|produtos? de origem animal)/);
    if (!m) continue;
    const contem = !m[1];
    if (m[2] === 'gluten') out.gluten = contem;
    else if (m[2] === 'lactose' || m[2] === 'lacteos') out.lacteos = contem;
    else out.origemAnimal = contem;
  }
  return Object.keys(out).length ? out : undefined;
}

interface Entrada {
  nome: string;
  ingredientes?: string;
  alergenos?: MenuAlergenos;
}

/**
 * "Nome: ingredientes. (declaração)" | "Nome (declaração)" | "Nome" → partes.
 * A declaração é sempre o ÚLTIMO parêntese — os ingredientes podem ter parênteses
 * próprios ("Feijão, (podendo variar em preto, carioca ou vermelho), água…").
 */
function dividirEntrada(texto: string): Entrada | null {
  const t = texto.replace(/\s+/g, ' ').trim();
  const iPar = t.lastIndexOf('(');
  const iDois = t.indexOf(':');
  const temDoisPontos = iDois >= 0 && (iPar < 0 || iDois < iPar);
  const fimNome = temDoisPontos ? iDois : iPar >= 0 ? iPar : t.length;
  const nome = t.slice(0, fimNome).replace(/[.\s:]+$/, '').trim();
  if (!nome) return null;
  const e: Entrada = { nome };
  if (temDoisPontos) {
    const ing = t.slice(iDois + 1, iPar >= 0 ? iPar : t.length).replace(/[.\s]+$/, '').trim();
    if (ing) e.ingredientes = ing;
  }
  if (iPar >= 0) {
    const fecha = t.lastIndexOf(')');
    const decl = t.slice(iPar + 1, fecha > iPar ? fecha : t.length);
    const al = parseDeclaracaoAlergenos(decl);
    if (al) e.alergenos = al;
  }
  return e;
}

/**
 * Categoria a partir do rótulo estrutural (fonte vence) + posição/nome dentro dele.
 * `temProteina`: a página tem a seção "Proteína animal:"? Quando a fonte esquece o
 * rótulo (visto em 11/11/2025), a carne cai em Acompanhamentos — nesse caso a
 * ÚLTIMA entrada que o classificador reconhece como carne vira o prato principal.
 */
function categorizar(secao: Secao, entradas: Entrada[], temProteina: boolean): MenuPrato[] {
  if (secao === 'saladas') {
    return entradas.map((e) => montar(e, classificarPorNome(e.nome) === 'molho' ? 'molho' : 'salada'));
  }
  if (secao === 'proteina') return entradas.map((e) => montar(e, 'carne'));
  if (secao === 'sobremesa') return entradas.map((e) => montar(e, 'sobremesa'));

  let carne: Entrada | null = null;
  if (!temProteina) {
    carne = [...entradas].reverse().find((e) => classificarPorNome(e.nome) === 'carne') ?? null;
  }
  // Acompanhamentos: arroz/feijão (base) e depois [proteína vegetal, guarnição] —
  // quando só sobra um, decide pelo nome (leguminosa = vegetariano).
  const semCarne = entradas.filter((e) => e !== carne);
  const base = semCarne.filter((e) => classificarPorNome(e.nome) === 'base');
  const resto = semCarne.filter((e) => classificarPorNome(e.nome) !== 'base');
  const cats: MenuCategoria[] =
    resto.length >= 2
      ? resto.map((e, i) => (i === 0 ? 'vegetariano' : 'guarnicao'))
      : resto.map((e) =>
          REGEX_LEGUMINOSA.test(e.nome) || classificarPorNome(e.nome) === 'vegetariano' ? 'vegetariano' : 'guarnicao'
        );
  return [
    ...base.map((e) => montar(e, 'base')),
    ...resto.map((e, i) => montar(e, cats[i])),
    ...(carne ? [montar(carne, 'carne')] : []),
  ];
}

const montar = (e: Entrada, categoria: MenuCategoria) =>
  prato({ nome: e.nome, categoria, alergenos: e.alergenos, ingredientes: e.ingredientes });

const balanco = (s: string) => (s.match(/\(/g)?.length ?? 0) - (s.match(/\)/g)?.length ?? 0);

/**
 * Parseia UMA página por dia. Retorna null se a página não tiver cabeçalho de dia.
 * Uma entrada continua na linha seguinte quando o parêntese da declaração ficou
 * aberto OU quando a linha seguinte começa em minúscula/"(" ("…chimichurri e" /
 * "sal. (Não contém glúten…)", "(Não contém glúten, contém lactose…)") — toda
 * entrada nova começa com maiúscula.
 */
function parsearPaginaDoDia(linhas: string[]): DiaParseado | null {
  let cabecalho: RegExpMatchArray | null = null;
  let secao: Secao | null = null;
  const brutas = new Map<Secao, string[]>();

  const anexar = (texto: string) => {
    if (!secao) return;
    const lista = brutas.get(secao) ?? [];
    lista.push(texto);
    brutas.set(secao, lista);
  };
  const continuar = (texto: string) => {
    const lista = secao ? brutas.get(secao) : undefined;
    if (lista?.length) lista[lista.length - 1] += ' ' + texto;
  };
  const ultimaAberta = () => {
    const lista = secao ? brutas.get(secao) : undefined;
    return !!lista?.length && balanco(lista[lista.length - 1]) > 0;
  };

  for (const linha of linhas) {
    if (!cabecalho) {
      cabecalho = linha.match(REGEX_CABECALHO_DIA);
      continue;
    }
    if (REGEX_RODAPE.test(linha)) break;
    if (ultimaAberta() || /^[\p{Ll}(]/u.test(linha)) {
      continuar(linha);
      continue;
    }
    const s = detectarSecao(linha);
    if (s) {
      secao = s.secao;
      if (s.resto) anexar(s.resto);
    } else {
      anexar(linha);
    }
  }
  if (!cabecalho) return null;

  const pratos: MenuPrato[] = [];
  const temProteina = (brutas.get('proteina')?.length ?? 0) > 0;
  for (const sec of ['saladas', 'acompanhamentos', 'proteina', 'sobremesa'] as Secao[]) {
    const entradas = (brutas.get(sec) ?? []).map(dividirEntrada).filter((e): e is Entrada => !!e);
    if (entradas.length) pratos.push(...categorizar(sec, entradas, temProteina));
  }
  const [, nome, dd, mm, yyyy] = cabecalho;
  const data = `${dd.padStart(2, '0')}/${mm.padStart(2, '0')}/${yyyy}`;
  // Erro de digitação na fonte ("Quinta feira – 27/08/2025", que era quarta): o NOME
  // do dia vence; a data é inferida pelos vizinhos (inferirDatas) depois dos slots.
  const coerente = diaDaSemana(data) === indiceDoDia(nome);
  return { nomeDetectado: nome, data: coerente ? data : '', itens: pratos.map((p) => p.nome), pratos };
}

const paraDate = (data: string) => {
  const [d, m, y] = data.split('/').map(Number);
  return new Date(y, m - 1, d);
};

/** Índice Seg=0…Dom=6 de uma data dd/mm/yyyy. */
const diaDaSemana = (data: string) => (paraDate(data).getDay() + 6) % 7;

function segundaFeiraDe(data: string): number {
  const dt = paraDate(data);
  dt.setDate(dt.getDate() - diaDaSemana(data));
  return dt.getTime();
}

/**
 * O app (e a validação) só entendem UMA semana Seg→Dom. PDFs de 7 dias que começam
 * no sábado ("Cardápio de 01 à 07/08/2026") atravessam duas semanas: fica a semana
 * com mais dias (empate → a mais recente); o resto é descartado. Dias sem data
 * (cabeçalho incoerente) acompanham a semana vencedora.
 */
export function selecionarSemanaDominante(dias: DiaParseado[]): DiaParseado[] {
  const grupos = new Map<number, DiaParseado[]>();
  const semData: DiaParseado[] = [];
  for (const d of dias) {
    if (!d.data) {
      semData.push(d);
      continue;
    }
    const k = segundaFeiraDe(d.data);
    grupos.set(k, [...(grupos.get(k) ?? []), d]);
  }
  let melhor: DiaParseado[] = [];
  let melhorK = -Infinity;
  for (const [k, g] of grupos) {
    if (g.length > melhor.length || (g.length === melhor.length && k > melhorK)) {
      melhor = g;
      melhorK = k;
    }
  }
  return [...melhor, ...semData];
}

// ─── Fallback: tabela da página 1 ────────────────────────────────────────────
// Nas férias (jan–fev, jul) o PDF vem SÓ com a página 1 — a tabela colunar, sem
// datas por coluna e frequentemente com 7 colunas a partir de Domingo/Sábado. As
// células têm os mesmos rótulos de seção (Saladas/Acompanhamentos/Carne/Sobremesa)
// e quebras de linha cuja continuação começa SEMPRE em minúscula ("Macarrão ao
// alho" / "poró"), o que é mais confiável que a distância vertical (o passo de uma
// quebra é igual ao passo até a linha seguinte).

const REGEX_RUIDO_TABELA = /^(fort refei|eventos ltda|feriado|fechado|manuten[çc][ãa]o|nan)$|^fechado para/i;
// Na tabela, "Fruta" é o ITEM da seção Sobremesa (não rótulo como nas páginas por dia).
const REGEX_ROTULO_TABELA = /^(saladas?|acompanhamentos?|carnes?|prote[ií]na animal|sobremesas?)$/i;
const REGEX_TITULO =
  /card[áa]pio\s+de\s+(\d{1,2})(?:[./](\d{1,2}))?(?:[./](\d{2,4}))?\s*(?:à|a|até|-|–)\s*(\d{1,2})[./](\d{1,2})[./](\d{2,4})/i;

/** Data inicial (dd/mm/yyyy) do título "Cardápio de 25 à 31/01/2026" / "de 29.12.24 a 04.01.2025". */
function dataInicialDoTitulo(texto: string): string | null {
  const m = texto.match(REGEX_TITULO);
  if (!m) return null;
  const [, d1, m1, a1, , m2, a2] = m;
  const ano2 = a2.length === 2 ? 2000 + Number(a2) : Number(a2);
  const mes1 = Number(m1 ?? m2);
  let ano1 = a1 ? (a1.length === 2 ? 2000 + Number(a1) : Number(a1)) : ano2;
  if (!a1 && mes1 > Number(m2)) ano1 = ano2 - 1; // "29.12 a 04.01.2025"
  return `${d1.padStart(2, '0')}/${String(mes1).padStart(2, '0')}/${ano1}`;
}

/** Junta os fragmentos de uma coluna em células: mesma linha → mesma célula; linha nova só se começa em maiúscula. */
function celulasDaColuna(coluna: TextItem[]): string[] {
  const celulas: string[] = [];
  let yAnterior: number | null = null;
  for (const it of coluna) {
    const mesmaLinha = yAnterior !== null && Math.abs(yAnterior - it.y) <= 3;
    const continuacao = /^[\p{Ll}]/u.test(it.str) && !mesmaLinha;
    if (celulas.length && (mesmaLinha || continuacao)) {
      const ant = celulas[celulas.length - 1];
      // Fragmento curto na mesma linha ("Ervi" + "lha", "R" + "abanete") = palavra
      // partida pelo pdf.js; um fragmento longo ou terminado em preposição leva espaço.
      const semEspaco = mesmaLinha && ant.length <= 4 && !/\b(de|do|da|em|ao|com|e|c\/|a|na|no)$/i.test(ant);
      celulas[celulas.length - 1] = semEspaco ? ant + it.str : `${ant} ${it.str}`;
    } else {
      celulas.push(it.str);
    }
    yAnterior = it.y;
  }
  return celulas.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function diasDaTabela(itens: TextItem[]): DiaParseado[] {
  const sem = colunasDaSemana(itens, { diaLabels: LABELS_CCA, normalizarData: () => null });
  if (!sem) return [];
  const inicio = dataInicialDoTitulo(itens.map((i) => i.str).join(' '));
  const idxInicio = inicio ? diaDaSemana(inicio) : null;

  const dias: DiaParseado[] = [];
  sem.cabecalho.forEach((cab, i) => {
    let secao: Secao | null = null;
    const brutas = new Map<Secao, Entrada[]>();
    for (const celula of celulasDaColuna(sem.colunas[i])) {
      if (REGEX_RUIDO_TABELA.test(celula) || REGEX_RODAPE.test(celula)) continue;
      const rot = detectarSecao(celula);
      if (rot && REGEX_ROTULO_TABELA.test(celula)) {
        secao = rot.secao;
        continue;
      }
      if (/^carnes?$/i.test(celula)) {
        secao = 'proteina';
        continue;
      }
      if (!secao) continue;
      brutas.set(secao, [...(brutas.get(secao) ?? []), { nome: celula }]);
    }
    const temProteina = (brutas.get('proteina')?.length ?? 0) > 0;
    const pratos: MenuPrato[] = [];
    for (const sec of ['saladas', 'acompanhamentos', 'proteina', 'sobremesa'] as Secao[]) {
      const entradas = brutas.get(sec);
      if (entradas?.length) pratos.push(...categorizar(sec, entradas, temProteina));
    }
    if (!pratos.length) return;

    // Data = início do título + deslocamento pelo NOME do dia (a 1ª coluna pode ser
    // domingo/sábado). Sem título parseável, fica sem data (inferirDatas depois).
    let data = '';
    const idxDia = indiceDoDia(cab.str);
    if (inicio && idxInicio !== null && idxDia !== null) {
      const dt = paraDate(inicio);
      dt.setDate(dt.getDate() + ((idxDia - idxInicio + 7) % 7));
      data = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
    }
    dias.push({ nomeDetectado: cab.str, data, itens: pratos.map((p) => p.nome), pratos });
  });
  return dias;
}

/** Parse puro a partir do buffer do PDF (exportado para backtest/inspeção). */
export async function parseCcaPdf(buf: Uint8Array): Promise<Menu> {
  const paginas = await numeroDePaginas(buf);
  let dias: DiaParseado[] = [];
  for (let p = 2; p <= paginas; p++) {
    const linhas = agruparEmLinhas(await extrairItens(buf, p)).map((l) =>
      l.map((c) => c.str).join(' ').replace(/\s+/g, ' ').trim()
    );
    const dia = parsearPaginaDoDia(linhas);
    if (dia && dia.itens.length) dias.push(dia);
  }
  if (dias.length < 3) dias = diasDaTabela(await extrairItens(buf, 1));
  if (dias.length < 3) {
    throw new Error(`Layout do PDF do RU CCA não reconhecido (${dias.length} dia(s) reconhecidos).`);
  }

  const semana = inferirDatas(alocarSlots(selecionarSemanaDominante(dias), LABELS_CCA));
  const datas = semana.map((d) => d.data).filter(Boolean);
  return {
    diaInicial: datas[0] ?? null,
    diaFinal: datas[datas.length - 1] ?? null,
    cardapio: semana,
  };
}

async function scrape(): Promise<Menu> {
  const $ = await carregarPagina(URL_SITE);
  // Lista do mais novo para o mais antigo → o PRIMEIRO PDF de cardápio é o atual.
  // Filtra sobre o href decodificado (acentos chegam URL-encoded).
  const candidatos = $("#content .content a[href$='.pdf']")
    .toArray()
    .map((el) => $(el).attr('href'))
    .filter((h): h is string => {
      if (!h) return false;
      const dec = decodeURIComponent(h);
      return /card[áa]pio/i.test(dec) && !/caf[ée]/i.test(dec);
    });
  const primeiro = candidatos[0];
  if (!primeiro) throw new Error('Nenhum PDF de cardápio encontrado na página do RU CCA.');

  const url = resolverUrl(primeiro, URL_SITE);
  const buf = await fetchBinary(url);
  return { ...(await parseCcaPdf(buf)), fonteUrl: url };
}

export const cca: CampusScraper = { campus: 'cca', scrape };
