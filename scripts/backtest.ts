// Backtest dos parsers contra um corpus de PDFs históricos.
//
// Uso: bun scripts/backtest.ts <dir>
//   <dir> deve conter subpastas trindade/ joinville/ ararangua/ curitibanos/
//   com PDFs (qualquer nome). Para o Curitibanos (PDF mensal), a "data de hoje"
//   é derivada do próprio PDF (2ª semana coberta) p/ a seleção de semana.
//
// Aplica EXATAMENTE os mesmos invariantes da validação pré-upsert de produção
// (src/lib/validate.ts), exceto o frescor (PDFs históricos são antigos).
// Exit 1 se houver qualquer falha.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Menu, MenuItem } from '../src/lib/types.js';
import { violacoes, LABELS_POR_CAMPUS } from '../src/lib/validate.js';
import { parseTrindadePdf } from '../src/campus/trindade.js';
import { parseJoinvillePdf } from '../src/campus/joinville.js';
import { parseAraranguaPdf } from '../src/campus/ararangua.js';
import { parseCuritibanosPdf } from '../src/campus/curitibanos.js';

const CAMPUS_KEY: Record<string, string> = {
  trindade: 'florianopolis',
  joinville: 'joinville',
  ararangua: 'ararangua',
  curitibanos: 'curitibanos',
};

function parseData(s: string): Date | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

async function parsear(campus: string, buf: Uint8Array, anoDoArquivo: number): Promise<Menu> {
  if (campus === 'trindade') return parseTrindadePdf(buf);
  if (campus === 'joinville') return parseJoinvillePdf(buf);
  if (campus === 'ararangua') return parseAraranguaPdf(buf, anoDoArquivo);
  // Curitibanos: mensal — precisa de um "hoje" dentro do mês do PDF. 1º passe pega
  // a 1ª semana; o 2º usa (1ª data + 9 dias) para cair na 2ª semana do mês.
  const preview = await parseCuritibanosPdf(buf, new Date(2000, 0, 1));
  const dias = preview.cardapio as MenuItem[];
  const primeira = dias.map((d) => parseData(d.data)).find(Boolean);
  const hoje = primeira ? new Date(primeira.getTime() + 9 * 86_400_000) : new Date();
  return parseCuritibanosPdf(buf, hoje);
}

/** Ano aproximado do PDF a partir do path (p/ datas sem ano em PDFs históricos). */
function anoDoArquivo(nome: string): number {
  const m = nome.match(/20\d{2}/);
  return m ? Number(m[0]) : new Date().getFullYear();
}

async function main() {
  const raiz = process.argv[2];
  if (!raiz) {
    console.error('Uso: bun scripts/backtest.ts <dir-do-corpus>');
    process.exit(2);
  }

  let totalOk = 0;
  const falhas: string[] = [];

  for (const campus of ['trindade', 'joinville', 'ararangua', 'curitibanos'] as const) {
    let arquivos: string[] = [];
    try {
      arquivos = readdirSync(join(raiz, campus))
        .filter((f) => !f.endsWith('.txt'))
        .sort();
    } catch {
      continue;
    }
    console.log(`\n═══ ${campus.toUpperCase()} (${arquivos.length} PDFs) ═══`);

    for (const arq of arquivos) {
      const buf = new Uint8Array(readFileSync(join(raiz, campus, arq)));
      let resultado: Menu | null = null;
      let erros: string[] = [];
      try {
        resultado = await parsear(campus, buf, anoDoArquivo(arq));
        erros = violacoes(resultado, { labels: LABELS_POR_CAMPUS[CAMPUS_KEY[campus]] });
      } catch (e) {
        erros = [`EXCEÇÃO: ${e instanceof Error ? e.message : String(e)}`];
      }

      const dias = resultado && Array.isArray(resultado.cardapio) ? (resultado.cardapio as MenuItem[]) : [];
      const nItens = dias.reduce((s, d) => s + d.itens.length, 0);
      // v2: cobertura de `pratos` (dias com itens que também têm pratos) e extras.
      const comItens = dias.filter((d) => d.itens.length).length;
      const comPratos = dias.filter((d) => d.itens.length && d.pratos?.length).length;
      const pratos = dias.flatMap((d) => d.pratos ?? []);
      const nOutro = pratos.filter((p) => p.categoria === 'outro').length;
      const nIng = pratos.filter((p) => p.ingredientes).length;
      const nAlerg = pratos.filter((p) => p.alergenos).length;
      const v2 = comPratos
        ? ` | v2 ${comPratos}/${comItens} dias, ${pratos.length} pratos${nOutro ? `, ${nOutro} outro` : ''}${nIng ? `, ${nIng} ingr` : ''}${nAlerg ? `, ${nAlerg} alerg` : ''}`
        : ' | v2 —';

      if (erros.length === 0) {
        totalOk++;
        console.log(`  ✓ ${arq}  [${resultado?.diaInicial} → ${resultado?.diaFinal}] ${nItens} itens${v2}`);
      } else {
        console.log(`  ✗ ${arq}`);
        erros.slice(0, 6).forEach((e) => console.log(`      ${e}`));
        if (erros.length > 6) console.log(`      … +${erros.length - 6} erros`);
        falhas.push(`${campus}/${arq}`);
      }
    }
  }

  console.log(`\n════════ RESUMO: ${totalOk} ok, ${falhas.length} falhas ════════`);
  if (falhas.length) {
    console.log('Falhas:');
    falhas.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main();
