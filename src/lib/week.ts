// Seleção da semana corrente entre várias semanas (usado por Curitibanos, cujo PDF
// é mensal). O app só entende UMA semana de 7 dias (Seg→Dom), então reduzimos.

import type { MenuItem } from './types.js';

function parseDDMMYYYY(data: string): Date | null {
  const m = data.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

/** Data final (último dia com data válida) de uma semana. */
function fimDaSemana(dias: MenuItem[]): Date | null {
  for (let i = dias.length - 1; i >= 0; i--) {
    const d = parseDDMMYYYY(dias[i].data);
    if (d) return d;
  }
  return null;
}

function inicioDaSemana(dias: MenuItem[]): Date | null {
  for (const dia of dias) {
    const d = parseDDMMYYYY(dia.data);
    if (d) return d;
  }
  return null;
}

/**
 * Escolhe a semana que contém `hoje`; se nenhuma contiver (virada de mês/lacuna),
 * pega a primeira semana ainda não encerrada; se todas já passaram, a última.
 *
 * Lança erro se NENHUMA semana tiver datas parseáveis — devolver "a última" nesse
 * caso seria servir uma semana arbitrária com cara de sucesso (a validação pré-upsert
 * pegaria depois, mas aqui o erro é mais informativo).
 */
export function selecionarSemanaAtual(semanas: MenuItem[][], hoje: Date): MenuItem[] {
  const validas = semanas.filter((s) => s.length > 0);
  if (validas.length === 0) return [];

  const datadas = validas.filter((s) => inicioDaSemana(s) !== null);
  if (datadas.length === 0) {
    throw new Error('Nenhuma semana do PDF tem datas parseáveis — formato de data mudou?');
  }

  const hoje0 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  for (const semana of datadas) {
    const ini = inicioDaSemana(semana);
    const fim = fimDaSemana(semana);
    if (ini && fim && hoje0 >= ini && hoje0 <= fim) return semana;
  }

  const futura = datadas.find((s) => {
    const fim = fimDaSemana(s);
    return fim && hoje0 <= fim;
  });

  return futura ?? datadas[datadas.length - 1];
}

/**
 * Os sites dos RUs publicam a semana seguinte antes da atual acabar (ex.: na sexta
 * 27/11/2026 o Trindade e Araranguá já listavam 30/11–06/12). Pegar sempre o link mais
 * novo apagava o cardápio de hoje no app. Aqui: tenta do mais novo para o mais antigo
 * e fica com o primeiro que cobre `hoje`; se nenhum cobrir, devolve o mais novo.
 *
 * `links` vem do MAIS NOVO para o mais antigo. Só desce para links mais antigos
 * enquanto o atual começa depois de hoje, e no máximo `limite` downloads.
 */
export async function escolherCardapioDaSemana<T extends { diaInicial: string | null; diaFinal: string | null }>(
  links: string[],
  carregar: (link: string) => Promise<T>,
  hoje: Date,
  limite = 3
): Promise<T> {
  const hoje0 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const maisNovo = await carregar(links[0]);

  let atual = maisNovo;
  for (let i = 1; i < Math.min(links.length, limite); i++) {
    const ini = atual.diaInicial ? parseDDMMYYYY(atual.diaInicial) : null;
    if (!ini || ini <= hoje0) break;
    try {
      atual = await carregar(links[i]);
    } catch {
      break; // PDF antigo com layout que não parseia: melhor ficar com o mais novo
    }
  }

  const ini = atual.diaInicial ? parseDDMMYYYY(atual.diaInicial) : null;
  const fim = atual.diaFinal ? parseDDMMYYYY(atual.diaFinal) : null;
  return ini && fim && hoje0 >= ini && hoje0 <= fim ? atual : maisNovo;
}
