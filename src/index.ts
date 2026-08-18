// CLI: bun src/index.ts <campus> [--dry-run] [--skip-db]
//
// Raspa um campus, faz upsert no Supabase e grava um snapshot versionado em
// data/<campus>.json.
//   --dry-run   apenas imprime o JSON (não toca no banco nem no snapshot).
//   --skip-db   grava o snapshot mas NÃO faz upsert (útil p/ semear data/ localmente).

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CampusScraper } from './lib/types.js';
import { salvarMenu } from './lib/supabase.js';
import { validarMenu, LABELS_POR_CAMPUS } from './lib/validate.js';
import { hojeBrasilia } from './lib/dates.js';

import { trindade } from './campus/trindade.js';
import { joinville } from './campus/joinville.js';
import { ararangua } from './campus/ararangua.js';
import { curitibanos } from './campus/curitibanos.js';
import { blumenau } from './campus/blumenau.js';
import { cca } from './campus/cca.js';

const SCRAPERS: Record<string, CampusScraper> = {
  // aceita tanto a chave do campus quanto o nome "trindade"
  trindade,
  florianopolis: trindade,
  cca, // 2º RU de Florianópolis (Itacorubi) — chave própria na tabela `menus`
  joinville,
  ararangua,
  curitibanos,
  blumenau,
};

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const alvo = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  const skipDb = process.argv.includes('--skip-db');

  if (!alvo || !SCRAPERS[alvo]) {
    console.error(`Uso: bun src/index.ts <${Object.keys(SCRAPERS).join('|')}> [--dry-run]`);
    process.exit(2);
  }

  const scraper = SCRAPERS[alvo];
  console.error(`▶ Raspando campus "${scraper.campus}"…`);
  const menu = await scraper.scrape();
  // Metadados v2 (aditivos — o app antigo ignora chaves desconhecidas).
  menu.versao = 2;
  menu.atualizadoEm = new Date().toISOString();

  // Validação de sanidade ANTES de qualquer persistência: um parse degradado
  // (0 itens, datas vazias, dias trocados, cardápio vencido) deve falhar o job —
  // nunca sobrescrever o dado bom que já está no banco.
  validarMenu(menu, {
    labels: LABELS_POR_CAMPUS[scraper.campus] ?? [],
    hoje: hojeBrasilia(),
  });
  const dias = Array.isArray(menu.cardapio) ? menu.cardapio : [];
  const comPratos = dias.filter((d) => d.pratos?.length).length;
  console.error(`✓ Validação de sanidade passou (${dias.filter((d) => d.itens.length).length} dias com itens, ${comPratos} com pratos v2).`);

  if (dryRun) {
    console.log(JSON.stringify(menu, null, 2));
    console.error('✓ dry-run: nada foi salvo.');
    return;
  }

  if (skipDb) {
    console.error('• --skip-db: upsert no Supabase ignorado.');
  } else {
    await salvarMenu(scraper.campus, menu);
    console.error(`✓ Upsert no Supabase concluído (campus=${scraper.campus}).`);
  }

  const arquivo = join(RAIZ, 'data', `${scraper.campus}.json`);
  await mkdir(dirname(arquivo), { recursive: true });
  await writeFile(arquivo, JSON.stringify(menu, null, 2) + '\n', 'utf8');
  console.error(`✓ Snapshot gravado em data/${scraper.campus}.json`);
}

main().catch((err) => {
  console.error(`✗ Erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
