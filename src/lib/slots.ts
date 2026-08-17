// Alinhamento de dias em 7 slots fixos (Seg→Dom). PDFs reais têm semanas parciais
// (Seg–Sex, Qua–Dom, feriados) e layouts que mudam; alinhar POR NOME do dia evita o
// erro clássico de alinhar por posição (terça aparecendo no slot de segunda).

import type { MenuItem } from './types.js';

const NOMES: [RegExp, number][] = [
  [/segunda/i, 0],
  [/ter[çc]a/i, 1],
  [/quarta/i, 2],
  [/quinta/i, 3],
  [/sexta/i, 4],
  [/s[áa]bado/i, 5],
  [/domingo/i, 6],
];

/** Índice 0-6 (Seg→Dom) a partir de qualquer grafia ("TERÇA-FEIRA", "Terça - feira"…). */
export function indiceDoDia(nome: string): number | null {
  for (const [re, idx] of NOMES) if (re.test(nome)) return idx;
  return null;
}

export interface DiaParseado {
  /** Nome do dia como apareceu na fonte (usado só para detectar o slot). */
  nomeDetectado: string;
  data: string; // dd/mm/yyyy ou ''
  itens: string[];
}

/**
 * Distribui dias parseados nos 7 slots fixos, rotulando com `labels` (formato do
 * campus). Dias sem nome reconhecível são descartados; em conflito (duas "segundas",
 * ex. semana 22–30/dez), vence a primeira ocorrência.
 */
export function alocarSlots(dias: DiaParseado[], labels: string[]): MenuItem[] {
  const slots: MenuItem[] = labels.map((l) => ({ dia: l, data: '', itens: [] }));
  for (const d of dias) {
    const idx = indiceDoDia(d.nomeDetectado);
    if (idx === null) continue;
    if (slots[idx].itens.length > 0 || slots[idx].data) continue; // primeira ocorrência vence
    slots[idx] = { dia: labels[idx], data: d.data, itens: d.itens };
  }
  return slots;
}

function paraDate(data: string): Date | null {
  const m = data.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function paraStr(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * Completa datas ausentes por aritmética de slots (slot i = dataConhecida + (i - slotConhecido)
 * dias). Só preenche slots que têm itens — dias realmente ausentes ficam sem data.
 */
export function inferirDatas(slots: MenuItem[]): MenuItem[] {
  let ref: { idx: number; date: Date } | null = null;
  slots.forEach((s, i) => {
    if (ref) return;
    const d = paraDate(s.data);
    if (d) ref = { idx: i, date: d };
  });
  if (!ref) return slots;
  const { idx: refIdx, date: refDate } = ref as { idx: number; date: Date };
  return slots.map((s, i) => {
    if (s.data || s.itens.length === 0) return s;
    const d = new Date(refDate.getTime());
    d.setDate(d.getDate() + (i - refIdx));
    return { ...s, data: paraStr(d) };
  });
}
