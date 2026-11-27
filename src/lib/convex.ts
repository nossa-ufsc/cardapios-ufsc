// Envio ao Convex (backend novo do app): POST {CONVEX_SITE_URL}/ingest/menu com
// Bearer INGEST_API_KEY — o mesmo esquema do onibus-ufsc. CONVEX_SITE_URL aceita
// vários deployments separados por vírgula (dev e prod); a mesma chave vale nos dois.
//
// TRANSIÇÃO: o Supabase continua sendo o destino principal (o app publicado lê de
// lá). O Convex recebe uma cópia; sem as envs o envio é pulado, e uma falha só
// gera aviso — nunca derruba o job nem impede o upsert no Supabase.

import type { Menu } from './types.js';

export async function enviarMenuParaConvex(
  restaurantKey: string,
  menu: Menu
): Promise<'enviado' | 'sem-config'> {
  const bases = convexSiteUrls();
  const chave = process.env.INGEST_API_KEY;
  if (!bases.length || !chave) return 'sem-config';

  const erros: string[] = [];
  for (const base of bases) {
    const res = await fetch(`${base}/ingest/menu`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
      body: JSON.stringify({ restaurantKey, menu }),
      signal: AbortSignal.timeout(60_000),
    }).catch((err: unknown) => err as Error);
    if (res instanceof Error) erros.push(`${base}: ${res.message}`);
    else if (!res.ok) erros.push(`${base}: HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  if (erros.length) throw new Error(`Convex /ingest/menu -> ${erros.join(' | ')}`);
  return 'enviado';
}

function convexSiteUrls(): string[] {
  return (process.env.CONVEX_SITE_URL ?? '')
    .split(',')
    .map((url) => url.trim().replace(/\/$/, ''))
    .filter(Boolean);
}
