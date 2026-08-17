// Persistência no Supabase. Equivalente ao app/database.py::salvar_menu.
// Faz upsert na tabela `menus` (uma linha por campus). Requer as envs
// SUPABASE_URL e SUPABASE_KEY (a mesma service key usada hoje pelo Render).

import { createClient } from '@supabase/supabase-js';
import type { Menu } from './types.js';

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL e SUPABASE_KEY são obrigatórios para salvar o cardápio.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function salvarMenu(campus: string, menu: Menu): Promise<void> {
  const { data, error } = await client()
    .from('menus')
    .upsert({ campus, menu }, { onConflict: 'campus' })
    .select();

  if (error) {
    throw new Error(`Erro ao salvar o cardápio para o campus ${campus}: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`Falha ao salvar o cardápio para o campus ${campus} (nenhuma linha retornada).`);
  }
}
