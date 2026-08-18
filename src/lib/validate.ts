// Validação de sanidade do Menu ANTES do upsert. Regra de ouro do pipeline: o dado
// antigo no banco é sempre melhor que dado vazio/corrompido — qualquer parse
// degradado deve FALHAR O JOB ruidosamente, nunca sobrescrever o Supabase.
//
// Usada pelo CLI (pré-upsert) e pelo backtest histórico (scripts/backtest.ts),
// para que produção e teste apliquem exatamente os mesmos invariantes.

import type { Menu, MenuItem } from './types.js';
import { ORDEM_CATEGORIAS } from './categorias.js';

const RUIDO =
  /cont[ée]m\s+(l[áa]cteos|gl[úu]te[nm]|leite)|nutricionista|CRN\s*\d|sujeito a? ?altera|lista de ingredientes|adição intencional/i;

export interface OpcoesValidacao {
  /** Rótulos de dia esperados (ordem Seg→Dom). */
  labels: string[];
  /** Mínimo de dias com itens (semanas de feriado reduzem; default 3). */
  minDiasComItens?: number;
  /**
   * Se informado, exige frescor: hoje deve estar dentro de
   * [diaInicial - 7d, diaFinal + 2d]. Omitir em backtest de PDFs históricos.
   */
  hoje?: Date;
}

function parseData(data: string): Date | null {
  const m = data.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

/** Retorna a lista de violações (vazia = menu OK). */
export function violacoes(menu: Menu, opts: OpcoesValidacao): string[] {
  const erros: string[] = [];

  if (!Array.isArray(menu.cardapio)) {
    // Menu de imagem (Blumenau) valida separadamente.
    const url = (menu.cardapio as { url_imagem?: string })?.url_imagem;
    if (!url || !/^https?:\/\/.+\.(png|jpe?g|webp)/i.test(url)) {
      erros.push(`imagem: url_imagem inválida (${url})`);
    }
    return erros;
  }

  const dias = menu.cardapio as MenuItem[];
  if (dias.length !== 7) erros.push(`estrutura: ${dias.length} dias (esperado 7)`);

  if (dias.length === opts.labels.length) {
    dias.forEach((d, i) => {
      if (d.dia !== opts.labels[i]) erros.push(`rotulo: dia[${i}]="${d.dia}" ≠ "${opts.labels[i]}"`);
    });
  }

  // Todo dia com itens precisa de data válida, e datas devem respeitar a aritmética
  // dos slots (slot i - slot j = i - j dias).
  const datas = dias.map((d) => parseData(d.data));
  let refIdx = -1;
  dias.forEach((d, i) => {
    if (d.itens.length > 0 && !datas[i]) erros.push(`data: ${d.dia} tem itens mas data inválida ("${d.data}")`);
    if (datas[i] && refIdx === -1) refIdx = i;
  });
  if (refIdx === -1) {
    erros.push('data: nenhuma data válida');
  } else {
    dias.forEach((_, i) => {
      if (i === refIdx || !datas[i]) return;
      const diff = Math.round((datas[i]!.getTime() - datas[refIdx]!.getTime()) / 86_400_000);
      if (diff !== i - refIdx) {
        erros.push(`data: slot ${i} (${dias[i].data}) não é ${i - refIdx} dia(s) após slot ${refIdx} (${dias[refIdx].data})`);
      }
    });
  }

  const comItens = dias.filter((d) => d.itens.length > 0).length;
  const minDias = opts.minDiasComItens ?? 3;
  if (comItens < minDias) erros.push(`conteudo: só ${comItens} dias com itens (mínimo ${minDias})`);

  const comData = dias.filter((d) => d.data);
  if (comData.length) {
    if (menu.diaInicial !== comData[0].data) erros.push(`intervalo: diaInicial=${menu.diaInicial} ≠ ${comData[0].data}`);
    if (menu.diaFinal !== comData[comData.length - 1].data)
      erros.push(`intervalo: diaFinal=${menu.diaFinal} ≠ ${comData[comData.length - 1].data}`);
  }

  dias.forEach((d) => {
    d.itens.forEach((item) => {
      if (RUIDO.test(item)) erros.push(`ruido: "${item.slice(0, 60)}"`);
      if (item.length > 160) erros.push(`item gigante (${item.length} chars): "${item.slice(0, 50)}…"`);
      if (!item.trim()) erros.push(`item vazio em ${d.dia}`);
    });
    // v2 (`pratos`) é opcional, mas quando existe tem de ser coerente com `itens`:
    // é a mesma comida estruturada, não pode vir vazia nem com lixo.
    if (d.pratos) {
      if (d.itens.length >= 3 && d.pratos.length < 3) erros.push(`pratos: ${d.dia} tem ${d.itens.length} itens mas só ${d.pratos.length} pratos`);
      if (d.itens.length === 0 && d.pratos.length > 0) erros.push(`pratos: ${d.dia} sem itens mas com pratos`);
      d.pratos.forEach((p) => {
        if (!p.nome?.trim()) erros.push(`pratos: nome vazio em ${d.dia}`);
        if (p.nome.length > 160) erros.push(`pratos: nome gigante em ${d.dia}: "${p.nome.slice(0, 50)}…"`);
        if (RUIDO.test(p.nome)) erros.push(`pratos: ruido em ${d.dia}: "${p.nome.slice(0, 60)}"`);
        if (!ORDEM_CATEGORIAS.includes(p.categoria)) erros.push(`pratos: categoria inválida "${p.categoria}" em ${d.dia}`);
        if (p.refeicao && p.refeicao !== 'almoco' && p.refeicao !== 'jantar') erros.push(`pratos: refeicao inválida "${p.refeicao}" em ${d.dia}`);
      });
    }
  });

  if (menu.refeicoes && !menu.refeicoes.every((r) => r === 'almoco' || r === 'jantar')) {
    erros.push(`refeicoes inválidas: ${JSON.stringify(menu.refeicoes)}`);
  }

  if (opts.hoje) {
    const ini = menu.diaInicial ? parseData(menu.diaInicial) : null;
    const fim = menu.diaFinal ? parseData(menu.diaFinal) : null;
    const t = opts.hoje.getTime();
    if (ini && t < ini.getTime() - 7 * 86_400_000) erros.push(`frescor: cardápio começa longe no futuro (${menu.diaInicial})`);
    if (fim && t > fim.getTime() + 2 * 86_400_000) erros.push(`frescor: cardápio vencido (diaFinal=${menu.diaFinal})`);
  }

  return erros;
}

/** Lança erro agregado se o menu violar qualquer invariante. */
export function validarMenu(menu: Menu, opts: OpcoesValidacao): void {
  const erros = violacoes(menu, opts);
  if (erros.length) {
    throw new Error(`Menu reprovado na validação (upsert abortado):\n  - ${erros.join('\n  - ')}`);
  }
}

export const LABELS_POR_CAMPUS: Record<string, string[]> = {
  florianopolis: ['SEGUNDA-FEIRA', 'TERÇA-FEIRA', 'QUARTA-FEIRA', 'QUINTA-FEIRA', 'SEXTA-FEIRA', 'SÁBADO', 'DOMINGO'],
  joinville: ['SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO', 'DOMINGO'],
  ararangua: ['SEGUNDA-FEIRA', 'TERÇA-FEIRA', 'QUARTA-FEIRA', 'QUINTA-FEIRA', 'SEXTA-FEIRA', 'SÁBADO', 'DOMINGO'],
  curitibanos: ['Segunda feira', 'Terça feira', 'Quarta feira', 'Quinta feira', 'Sexta feira', 'Sábado', 'Domingo'],
  blumenau: [],
  cca: ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'],
};
