// Envio ao Convex (backend novo do app): POST {CONVEX_SITE_URL}/ingest/menu com
// Bearer INGEST_API_KEY — o mesmo esquema do onibus-ufsc.
//
// TRANSIÇÃO: o Supabase continua sendo o destino principal (o app publicado lê de
// lá). O Convex recebe uma cópia; sem as envs o envio é pulado, e uma falha só
// gera aviso — nunca derruba o job nem impede o upsert no Supabase.

import type { Menu } from './types.js';

export async function enviarMenuParaConvex(
  restaurantKey: string,
  menu: Menu
): Promise<'enviado' | 'sem-config'> {
  const base = process.env.CONVEX_SITE_URL?.replace(/\/$/, '');
  const chave = process.env.INGEST_API_KEY;
  if (!base || !chave) return 'sem-config';

  const res = await fetch(`${base}/ingest/menu`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
    body: JSON.stringify({ restaurantKey, menu }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Convex /ingest/menu -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return 'enviado';
}
