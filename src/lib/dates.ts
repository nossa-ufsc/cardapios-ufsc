// Utilidades de data. As fontes da UFSC usam formatos variados; o app espera
// `dd/mm/yyyy` (features/menu/utils/menu.ts::parseBrazilianDate) — exceto Joinville,
// que historicamente é salvo como `d/m/yyyy` (sem zero-pad) e é preservado assim.

const MESES_PT: Record<string, string> = {
  jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
  jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
};

const pad2 = (n: string | number) => String(n).padStart(2, '0');

/** Expande ano de 2 dígitos para 4 (26 -> 2026). */
function expandirAno(ano: string): string {
  if (ano.length === 4) return ano;
  if (ano.length === 2) return `20${ano}`;
  return ano;
}

/**
 * Converte "17-ago-26" ou "17/ago/2026" -> "17/08/2026".
 * Usado pelo Trindade, cujo PDF passou a usar mês por extenso abreviado.
 */
export function parseDataExtenso(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})[\/-]([a-zç]{3,})[\/-](\d{2,4})$/);
  if (!m) return null;
  const [, dia, mesRaw, ano] = m;
  const mes = MESES_PT[mesRaw.slice(0, 3)];
  if (!mes) return null;
  return `${pad2(dia)}/${mes}/${expandirAno(ano)}`;
}

/**
 * Garante `dd/mm/yyyy` a partir de "17/08" ou "17/08/2026".
 * Se faltar o ano, usa `anoPadrao`.
 */
export function normalizarData(raw: string, anoPadrao: number): string | null {
  const partes = raw.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!partes) return null;
  const [, dia, mes, ano] = partes;
  const anoFinal = ano ? expandirAno(ano) : String(anoPadrao);
  return `${pad2(dia)}/${pad2(mes)}/${anoFinal}`;
}

/**
 * Parser flexível: aceita "01/ago", "01/08", "01/ago/2026", "01/08/2026" -> dd/mm/yyyy.
 * Usa `anoPadrao` quando o ano não vem na string. Retorna null se não reconhecer.
 */
export function parseDataFlex(raw: string, anoPadrao: number): string | null {
  const limpo = raw.trim().toLowerCase();
  // dd/mês-abreviado (com ou sem ano)
  const comMes = limpo.match(/^(\d{1,2})[\/-]([a-zç]{3,})(?:[\/-](\d{2,4}))?$/);
  if (comMes) {
    const mes = MESES_PT[comMes[2].slice(0, 3)];
    if (!mes) return null;
    const ano = comMes[3] ? expandirAno(comMes[3]) : String(anoPadrao);
    return `${pad2(comMes[1])}/${mes}/${ano}`;
  }
  // dd/mm (com ou sem ano)
  return normalizarData(limpo, anoPadrao);
}

/**
 * Busca uma data DENTRO de um texto (não-ancorado — sobrevive a células com texto
 * extra, ex. "18/08 Almoço"). Aceita dd/mm/yyyy, dd/mm, dd-mmm-yy e dd/mmm.
 */
export function extrairData(raw: string, anoPadrao: number): string | null {
  const numerica = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  const extensa = raw.toLowerCase().match(/(\d{1,2})[\/-]([a-zç]{3,})(?:[\/-](\d{2,4}))?/);
  // Preferência: o match mais específico (com mês por extenso só se o numérico falhar
  // ou se o "mês" numérico for inválido).
  if (numerica && Number(numerica[2]) >= 1 && Number(numerica[2]) <= 12) {
    const ano = numerica[3] ? expandirAno(numerica[3]) : String(anoPadrao);
    return `${pad2(numerica[1])}/${pad2(numerica[2])}/${ano}`;
  }
  if (extensa) {
    const mes = MESES_PT[extensa[2].slice(0, 3)];
    if (mes) {
      const ano = extensa[3] ? expandirAno(extensa[3]) : String(anoPadrao);
      return `${pad2(extensa[1])}/${mes}/${ano}`;
    }
  }
  return null;
}

/**
 * Data de hoje no fuso de Brasília, correta em qualquer fuso do runner (o antigo
 * shift de -3h dava o dia errado antes das 03:00 quando rodado em máquina UTC-3).
 */
export function hojeBrasilia(): Date {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
