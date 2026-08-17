// Araranguá: a fonte trocou de .docx para PDF (o scraper antigo, que buscava .docx,
// quebrou 100%). Agora baixamos o PDF do cardápio e reconstruímos a tabela por
// coordenadas. A página também lista um PDF institucional (conexão do projetor),
// então filtramos pelo href que contém "cardapio".

import type { CampusScraper, Menu, MenuItem, MenuPrato, MenuCategoria } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';
import { fetchBinary } from '../lib/http.js';
import { extrairItens, agruparEmLinhas, numeroDePaginas, type TextItem } from '../lib/pdf.js';
import { extrairSemana, colunasDaSemana, DIAS_MAIUSCULO_FEIRA } from '../lib/table.js';
import { indiceDoDia } from '../lib/slots.js';
import { classificarPorNome, extrairAlergenos, anexarIngredientes, normalizar, prato } from '../lib/categorias.js';
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

  const opts = {
    diaLabels: DIAS_MAIUSCULO_FEIRA,
    normalizarData: (raw: string) => extrairData(raw, anoBase),
    descartar: ehRuido,
    xMinBody: 90, // ignora a coluna de rótulos (FIXO/CARNE/GUARNIÇÃO/SOBREMESA) à esquerda
    alinhamento: 'esquerda' as const, // texto começa no x do cabeçalho de cada dia
  };
  const semana = extrairSemana(itens, opts);

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

  // v2: pratos com categoria + alergênicos declarados na própria célula, e a
  // lista de ingredientes da página 2.
  const ingredientes = await extrairListaDeIngredientes(buf);
  const brutas = colunasDaSemana(itens, opts);
  if (brutas) {
    brutas.cabecalho.forEach((cab, i) => {
      const slot = indiceDoDia(cab.str);
      if (slot === null || !dias[slot]?.itens.length) return;
      const pratos = pratosDaColuna(brutas.colunas[i]);
      if (pratos.length) dias[slot].pratos = anexarIngredientes(pratos, ingredientes);
    });
  }

  const datas = dias.map((d) => d.data).filter(Boolean);
  return {
    diaInicial: datas[0] ?? null,
    diaFinal: datas[datas.length - 1] ?? null,
    cardapio: dias,
  };
}

// ─── v2: estrutura de uma coluna (dia) ───────────────────────────────────────
// De cima para baixo cada dia traz: o bloco FIXO (arroz branco, arroz integral,
// feijão, proteína vegetal), a CARNE seguida das flags "CONTÉM LÁCTEOS/GLÚTEN",
// a GUARNIÇÃO seguida das flags + "COM/SEM ADIÇÃO INTENCIONAL DE ORIGEM ANIMAL",
// e por fim "2 OPÇÕES" (saladas) e "1 OPÇÃO" (sobremesa). O rótulo da linha fica
// numa coluna à esquerda com alinhamento vertical inconsistente, então a ORDEM
// dos pratos flagados é a referência: 1º = carne, 2º = guarnição.

const REGEX_FLAG = /cont[ée]m\s+(l[áa]cteos|gl[úu]te[nm]|leite|lactose)|adi[çc][ãa]o|intencional|origem\s+animal/i;
const REGEX_OPCOES = /^(\d+)\s*op[çc][õoaãÕOAÃ]/i;
const REGEX_FIXO = /^(arroz|feij[ãa]o|prote[íi]na)/i;
const GAP_CONTINUACAO = 30; // FIXO (22pt) é tratado à parte; carne→guarnição sempre tem flags no meio

function pratosDaColuna(coluna: TextItem[]): MenuPrato[] {
  const pratos: MenuPrato[] = [];
  let atual: { nome: string; y: number; flags: string[] } | null = null;
  let flagados = 0;

  const fechar = () => {
    if (!atual) return;
    const idx = flagados++;
    const categoria: MenuCategoria = idx === 0 ? 'carne' : idx === 1 ? 'guarnicao' : classificarPorNome(atual.nome) ?? 'outro';
    pratos.push(prato({ nome: atual.nome, categoria, alergenos: extrairAlergenos(atual.flags.join(' ')) }));
    atual = null;
  };

  for (const it of coluna) {
    const s = it.str.trim();
    if (!s || s.toLowerCase() === 'nan') continue;
    const opc = s.match(REGEX_OPCOES);
    if (opc) {
      // "2 OPÇÕES" (saladas) e "1 OPÇÃO" (sobremesa): a fonte só informa a quantidade.
      fechar();
      const n = Number(opc[1]);
      const jaTemSalada = pratos.some((p) => p.categoria === 'salada');
      pratos.push(prato({ nome: `${n} ${n === 1 ? 'opção' : 'opções'}`, categoria: jaTemSalada ? 'sobremesa' : 'salada' }));
      continue;
    }
    if (RUIDO.test(s) && !REGEX_FLAG.test(s)) continue;
    if (FRAGMENTO_LEGENDA.test(s) || REGEX_FLAG.test(s)) {
      // Flag/legenda: pertence ao prato corrente (fragmentos "SEM"/"ADIÇÃO"/"ANIMAL"
      // vêm fatiados pelo pdf.js — juntamos tudo e deixamos o extrator ler).
      if (atual) atual.flags.push(s);
      continue;
    }
    if (flagados === 0 && !atual) {
      const ultimo = pratos[pratos.length - 1];
      // Bloco fixo: emenda continuação minúscula ("Proteína" + "vegetal")…
      if (ultimo && /^[a-zà-öø-ÿ]/.test(s) && (ultimo.categoria === 'base' || ultimo.categoria === 'vegetariano')) {
        ultimo.nome += ` ${s}`;
        ultimo.categoria = classificarPorNome(ultimo.nome) ?? 'base';
        continue;
      }
      // …e emite arroz/feijão/proteína vegetal por palavra-chave.
      if (REGEX_FIXO.test(s)) {
        pratos.push(prato({ nome: s, categoria: classificarPorNome(s) ?? 'base' }));
        continue;
      }
    }
    // Nome de prato: continuação do corrente (perto e sem flags ainda) ou novo prato.
    if (atual && atual.flags.length === 0 && atual.y - it.y <= GAP_CONTINUACAO) {
      atual.nome += ` ${s}`;
      atual.y = it.y;
    } else {
      fechar();
      atual = { nome: s, y: it.y, flags: [] };
    }
  }
  fechar();
  return pratos;
}

// ─── Lista de ingredientes (página 2) ────────────────────────────────────────
// "CARNES:" / "GUARNIÇÕES" como títulos e linhas "NOME DO PRATO: ingredientes."
// Sem separação por dia — casamos por nome ao longo da semana.

async function extrairListaDeIngredientes(buf: Uint8Array): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const paginas = await numeroDePaginas(buf);
  for (let p = 2; p <= paginas; p++) {
    for (const linha of agruparEmLinhas(await extrairItens(buf, p))) {
      const texto = linha.map((c) => c.str).join(' ').trim();
      const m = texto.match(/^([A-ZÀ-Ü][A-ZÀ-Ü0-9 ,.'’()\-\/]{2,80}?):\s*(.+)$/);
      if (!m || /^(carnes?|guarni[çc][õo]es|saladas?|sobremesas?)$/i.test(m[1].trim())) continue;
      mapa.set(normalizar(m[1]), m[2].replace(/\s+/g, ' ').trim());
    }
  }
  return mapa;
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

  const url = resolverUrl(link, URL_SITE);
  const buf = await fetchBinary(url);
  return { ...(await parseAraranguaPdf(buf)), fonteUrl: url };
}

export const ararangua: CampusScraper = { campus: 'ararangua', scrape };
