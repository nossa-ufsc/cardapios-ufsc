// Curitibanos: PDF MENSAL (várias páginas, uma semana por página). O parser antigo
// concatenava tudo e gerava saída corrompida (45 "dias", diaFinal="Farofa"). Aqui
// extraímos cada semana por coordenadas e selecionamos a semana corrente — o app
// só entende 7 dias (Seg→Dom).

import type { CampusScraper, Menu, MenuItem, MenuPrato, MenuCategoria } from '../lib/types.js';
import { carregarPagina, resolverUrl } from '../lib/html.js';
import { fetchBinary } from '../lib/http.js';
import { extrairItens, numeroDePaginas, agruparEmLinhas, juntarCelulas, type TextItem } from '../lib/pdf.js';
import { extrairSemana, colunasDaSemana, DIAS_TITLE_FEIRA } from '../lib/table.js';
import { indiceDoDia } from '../lib/slots.js';
import { classificarPorNome, extrairAlergenos, limparMarcadores, prato } from '../lib/categorias.js';
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
  let almocoEJantar = false;
  for (let p = 1; p <= totalPaginas; p++) {
    const itens = await extrairItens(buf, p);
    const opts = {
      diaLabels: DIAS_TITLE_FEIRA,
      normalizarData: (raw: string) => extrairData(raw, ano),
      descartar: ehRuido,
      // Neste PDF os gaps de "prato novo" (~14pt) e de "quebra de linha" (~7-14pt)
      // se sobrepõem — corta baixo (11) e depois emenda continuações que começam
      // com minúscula ("Macarrão ao" + "molho rose").
      mergeGap: MERGE_GAP,
    };
    const semana = extrairSemana(itens, opts);
    // Emenda continuações de linha: item que começa com minúscula é a segunda
    // linha do prato anterior ("Macarrão ao" + "molho rose"), não um prato novo.
    const emendada = semana.map((d) => ({ ...d, itens: emendarContinuacoes(d.itens) }));

    if (emendada.some((d) => d.itens.length > 0)) {
      anexarPratos(emendada, itens, opts);
      semanas.push(emendada);
    }
    if (/almo[çc]o\s*(e|\/)\s*jantar/i.test(itens.map((i) => i.str).join(' '))) almocoEJantar = true;
  }

  const semana = selecionarSemanaAtual(semanas, ref);
  const datas = semana.map((d) => d.data).filter(Boolean);
  const menu: Menu = {
    diaInicial: datas[0] ?? null,
    diaFinal: datas[datas.length - 1] ?? null,
    cardapio: semana,
  };
  if (almocoEJantar) menu.refeicoes = ['almoco', 'jantar'];
  return menu;
}

const MERGE_GAP = 11;

function emendarContinuacoes(itens: string[]): string[] {
  return itens.reduce<string[]>((acc, item) => {
    if (acc.length && /^[a-zà-öø-ÿ]/.test(item)) acc[acc.length - 1] += ` ${item}`;
    else acc.push(item);
    return acc;
  }, []);
}

// ─── v2: faixas de seção ─────────────────────────────────────────────────────
// A tabela tem cabeçalhos de FAIXA horizontais, centralizados e atravessando todas
// as colunas ("SALADAS", "SOBREMESA", "PRATOS QUENTES", "OPÇÃO VEGETARIANA" e, em
// alguns meses, "CARNE"). Um item pertence à faixa cujo cabeçalho está logo acima.
// O layout mudou várias vezes (backtest com 41 PDFs mensais): o passo entre linhas
// varia (14pt ou 26pt), os cabeçalhos podem vir fatiados em células ("PRATOS |
// QUENTES") ou nem sair como texto (aí só sobra o ESPAÇO que ocupavam), e a ordem
// carne/guarnição dentro de PRATOS QUENTES se inverte. Por isso:
//   - cabeçalho é reconhecido pelo texto da LINHA inteira;
//   - uma quebra de faixa sem cabeçalho é um gap vertical bem maior que o passo
//     típico da coluna (relativo, não absoluto);
//   - dentro de PRATOS QUENTES, arroz/feijão viram 'base' por palavra-chave e, se
//     a coluna NÃO tem faixa própria de carne/vegetariano, o classificador por
//     nome separa carne e opção vegetariana da guarnição.

const FAIXAS: [RegExp, MenuCategoria][] = [
  [/^saladas?$/i, 'salada'],
  [/^sobremesas?$/i, 'sobremesa'],
  [/^pratos?\s*quentes?$/i, 'guarnicao'],
  [/^carnes?$/i, 'carne'],
  [/^(op[çc][ãa]o(\s+vegetariana)?|vegetariana)$/i, 'vegetariano'],
  [/^guarni[çc][ãa]o$|^acompanhamentos?$/i, 'guarnicao'],
];

function faixaDe(texto: string): MenuCategoria | null {
  const t = texto.replace(/\s+/g, ' ').trim();
  for (const [re, cat] of FAIXAS) if (re.test(t)) return cat;
  return null;
}

/** Cabeçalhos de faixa da página: linhas cujo texto inteiro é um rótulo de seção. */
function cabecalhosDeFaixa(itens: TextItem[]): { y: number; categoria: MenuCategoria }[] {
  const out: { y: number; categoria: MenuCategoria }[] = [];
  for (const linha of agruparEmLinhas(itens)) {
    if (linha.length > 3) continue;
    const cat = faixaDe(linha.map((c) => c.str).join(' '));
    if (cat) out.push({ y: linha[0].y, categoria: cat });
  }
  return out.sort((a, b) => b.y - a.y); // de cima para baixo
}

/** Depois de uma faixa sem cabeçalho legível, a ordem canônica do layout atual. */
const PROXIMA_FAIXA: Partial<Record<MenuCategoria, MenuCategoria>> = {
  guarnicao: 'carne',
  carne: 'vegetariano',
};

/** Quantil baixo dos gaps = passo entre linhas (a mediana seria puxada pelos gaps de faixa). */
function passoTipico(gaps: number[]): number {
  if (!gaps.length) return 0;
  const s = [...gaps].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.35)];
}

/** Só marcadores de legenda ("*CL", "*CG/CL")? */
const ehSoMarcador = (s: string) => limparMarcadores(s) === '';
// Legendas de rodapé que em meses antigos caem dentro das colunas ("2.CL – CONTÉM
// LACTOSE", "*TV: TEMPERO VERDE", "4.*TRAÇOS DE GLÚTEN"). Filtro só do v2 — o v1
// fica como está para não alterar `itens`.
const LEGENDA = /^\d\s*\.|tempero verde|tra[çc]os de gl[úu]ten|cont[ée]m (lactose|leite|gl[úu]ten)|^\*\s*t[vg]\b|^[–-]\s*/i;

function anexarPratos(
  semana: MenuItem[],
  itens: TextItem[],
  opts: Parameters<typeof colunasDaSemana>[1]
) {
  const faixas = cabecalhosDeFaixa(itens);
  const brutas = colunasDaSemana(itens, opts);
  if (!brutas || faixas.length < 2) return; // sem faixas reconhecíveis: fica só o v1

  brutas.cabecalho.forEach((cab, i) => {
    const slot = indiceDoDia(cab.str);
    if (slot === null || !semana[slot]?.itens.length) return;

    const coluna = brutas.colunas[i].filter((it) => it.str.toLowerCase() !== 'nan' && !ehRuido(it.str) && !LEGENDA.test(it.str));
    if (!coluna.length) return;

    // Passo típico entre linhas da coluna (14pt ou 26pt conforme o mês).
    const gaps: number[] = [];
    for (let k = 1; k < coluna.length; k++) {
      const g = coluna[k - 1].y - coluna[k].y;
      if (g >= 5) gaps.push(g);
    }
    const passo = passoTipico(gaps) || 14;
    const gapEntreFaixas = Math.max(passo * 1.7, 20);
    const gapJuncao = Math.max(MERGE_GAP, passo * 0.65);

    // Agrupa em faixas: nova faixa quando há cabeçalho entre o item anterior e
    // este, ou quando o gap é bem maior que o passo (cabeçalho que não saiu como texto).
    const grupos: { categoria: MenuCategoria; porCabecalho: boolean; itens: TextItem[] }[] = [];
    let yAnterior: number | null = null;
    for (const it of coluna) {
      const cabecalhoEntre = faixas.find((f) => f.y > it.y && (yAnterior === null || f.y < yAnterior));
      const atual = grupos[grupos.length - 1];
      if (!atual) {
        if (cabecalhoEntre) grupos.push({ categoria: cabecalhoEntre.categoria, porCabecalho: true, itens: [it] });
        // senão: acima da 1ª faixa (título/datas) — ignora
      } else if (cabecalhoEntre) {
        grupos.push({ categoria: cabecalhoEntre.categoria, porCabecalho: true, itens: [it] });
      } else if (yAnterior !== null && yAnterior - it.y > gapEntreFaixas && PROXIMA_FAIXA[atual.categoria]) {
        grupos.push({ categoria: PROXIMA_FAIXA[atual.categoria]!, porCabecalho: false, itens: [it] });
      } else {
        atual.itens.push(it);
      }
      yAnterior = it.y;
    }

    const temFaixa = (c: MenuCategoria) => grupos.some((g) => g.categoria === c);
    const pratos: MenuPrato[] = [];
    for (const g of grupos) {
      // CARNE/OPÇÃO VEGETARIANA têm UM prato por dia: as linhas são o mesmo nome
      // quebrado ("Strogonoff" + "Frango"); nas outras faixas, mesma junção do v1
      // (gap curto + emenda de continuação em minúscula).
      const umPrato = g.categoria === 'carne' || g.categoria === 'vegetariano';
      const nomes = emendarContinuacoes(
        juntarCelulas(g.itens, umPrato ? Infinity : gapJuncao)
          .map((s) => s.trim())
          .filter((s) => s && !ehRuido(s) && !LEGENDA.test(s))
      );
      for (const bruto of nomes) {
        const alergenos = extrairAlergenos(bruto);
        if (ehSoMarcador(bruto)) {
          // Célula só com "*CL"/"*CG": pertence ao prato anterior da faixa.
          const ultimo = pratos[pratos.length - 1];
          if (ultimo && alergenos) pratos[pratos.length - 1] = prato({ ...ultimo, alergenos: { ...(ultimo.alergenos ?? {}), ...alergenos } });
          continue;
        }
        const nome = limparMarcadores(bruto);
        let categoria = g.categoria;
        if (g.categoria === 'guarnicao') {
          const kw = classificarPorNome(nome);
          if (kw === 'base') categoria = 'base';
          else if (kw === 'carne' && !temFaixa('carne')) categoria = 'carne';
          else if (kw === 'vegetariano' && !temFaixa('vegetariano')) categoria = 'vegetariano';
        }
        pratos.push(prato({ nome, categoria, alergenos }));
      }
    }
    if (pratos.length) semana[slot].pratos = pratos;
  });
}

async function scrape(): Promise<Menu> {
  const $ = await carregarPagina(URL_SITE);
  const link = $("#content .content a[href$='.pdf']").first().attr('href');
  if (!link) throw new Error('Nenhum PDF encontrado no site do RU de Curitibanos.');

  const url = resolverUrl(link, URL_SITE);
  const buf = await fetchBinary(url);
  return { ...(await parseCuritibanosPdf(buf)), fonteUrl: url };
}

export const curitibanos: CampusScraper = { campus: 'curitibanos', scrape };
