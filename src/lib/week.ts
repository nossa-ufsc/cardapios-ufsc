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
 */
export function selecionarSemanaAtual(semanas: MenuItem[][], hoje: Date): MenuItem[] {
  const validas = semanas.filter((s) => s.length > 0);
  if (validas.length === 0) return [];

  const hoje0 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  for (const semana of validas) {
    const ini = inicioDaSemana(semana);
    const fim = fimDaSemana(semana);
    if (ini && fim && hoje0 >= ini && hoje0 <= fim) return semana;
  }

  const futura = validas.find((s) => {
    const fim = fimDaSemana(s);
    return fim && hoje0 <= fim;
  });

  return futura ?? validas[validas.length - 1];
}
