// Inspeção rápida do parse de UM PDF local, com o contrato v2 (`pratos`) aberto:
//   bun scripts/inspecionar.ts <trindade|joinville|ararangua|curitibanos|cca> <arquivo.pdf> [índices de dia, ex. 0,3]
// Imprime por dia: categoria | nome | refeição | ING (tem ingredientes) | alergênicos.
import { readFileSync } from 'node:fs';
import { parseTrindadePdf } from '../src/campus/trindade.js';
import { parseJoinvillePdf } from '../src/campus/joinville.js';
import { parseAraranguaPdf } from '../src/campus/ararangua.js';
import { parseCuritibanosPdf } from '../src/campus/curitibanos.js';
import { parseCcaPdf } from '../src/campus/cca.js';
const [campus, arq, soDias] = process.argv.slice(2);
const buf = new Uint8Array(readFileSync(arq));
const fn: any = { trindade: parseTrindadePdf, joinville: parseJoinvillePdf, ararangua: parseAraranguaPdf, curitibanos: parseCuritibanosPdf, cca: parseCcaPdf }[campus];
const m = await fn(buf);
console.log('refeicoes', m.refeicoes, 'intervalo', m.diaInicial, m.diaFinal);
const dias = m.cardapio as any[];
for (const [i, d] of dias.entries()) {
  if (soDias && !soDias.split(',').includes(String(i))) continue;
  console.log(`== ${d.dia} ${d.data}  (${d.itens.length} itens, ${d.pratos?.length ?? '-'} pratos)`);
  if (!d.pratos) { d.itens.forEach((s: string) => console.log('   v1:', s)); continue; }
  for (const p of d.pratos) console.log(`  ${p.categoria.padEnd(11)} ${p.nome.padEnd(45).slice(0, 45)} ${(p.refeicao ?? '').padEnd(6)} ${p.ingredientes ? 'ING' : '   '} ${p.alergenos ? JSON.stringify(p.alergenos) : ''}`);
}
