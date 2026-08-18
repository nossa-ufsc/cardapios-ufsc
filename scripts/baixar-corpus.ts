// Baixa um corpus de PDFs históricos das páginas dos RUs para o backtest.
//
// Uso: bun scripts/baixar-corpus.ts <dir-destino>
//   Cria <dir>/trindade, <dir>/joinville, <dir>/ararangua, <dir>/curitibanos, <dir>/cca com
//   todos os PDFs de cardápio linkados nas páginas (o Trindade filtra os "CAFÉ").
//   PDFs já presentes não são baixados de novo. *.pdf está no .gitignore.

import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { carregarPagina, resolverUrl } from '../src/lib/html.js';
import { fetchBinary } from '../src/lib/http.js';

const FONTES: { campus: string; url: string; seletor: string; filtro?: (hrefDecodificado: string) => boolean }[] = [
  {
    campus: 'trindade',
    url: 'https://ru.ufsc.br/ru/',
    seletor: ".content li a[href$='.pdf']",
    filtro: (h) => !/caf[ée]/i.test(h),
  },
  { campus: 'joinville', url: 'https://restaurante.joinville.ufsc.br/cardapio-da-semana/', seletor: "#content a[href$='.pdf']" },
  {
    campus: 'ararangua',
    url: 'https://ara.ufsc.br/ru/',
    seletor: "a[href*='.pdf']",
    filtro: (h) => /card[áa]pio/i.test(h),
  },
  { campus: 'curitibanos', url: 'https://ru.curitibanos.ufsc.br/cardapio', seletor: "#content .content a[href$='.pdf']" },
  {
    // Lista do mais novo p/ o mais antigo; os arquivos de 2023/2024 respondem 404 (pulados).
    campus: 'cca',
    url: 'https://ru.ufsc.br/cca-2/',
    seletor: "#content .content a[href$='.pdf']",
    filtro: (h) => /card[áa]pio/i.test(h) && !/caf[ée]/i.test(h),
  },
];

async function existe(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const raiz = process.argv[2];
  if (!raiz) {
    console.error('Uso: bun scripts/baixar-corpus.ts <dir-destino>');
    process.exit(2);
  }
  for (const fonte of FONTES) {
    const dir = join(raiz, fonte.campus);
    await mkdir(dir, { recursive: true });
    const $ = await carregarPagina(fonte.url);
    const hrefs = Array.from(
      new Set(
        $(fonte.seletor)
          .toArray()
          .map((el) => $(el).attr('href'))
          .filter((h): h is string => !!h && (fonte.filtro?.(decodeURIComponent(h)) ?? true))
      )
    );
    console.log(`\n${fonte.campus}: ${hrefs.length} PDFs`);
    let baixados = 0;
    for (const href of hrefs) {
      const url = resolverUrl(href, fonte.url);
      const nome = decodeURIComponent(url.split('/').slice(-3).join('_')).replace(/[^\w.\-]+/g, '_');
      const destino = join(dir, nome);
      if (await existe(destino)) continue;
      try {
        await writeFile(destino, await fetchBinary(url));
        baixados++;
        process.stdout.write('.');
      } catch (e) {
        console.error(`\n  ✗ ${url}: ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log(`\n  ${baixados} novos`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
