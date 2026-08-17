// Espelha o contrato consumido pelo app (nossa-ufsc/types.ts). NÃO alterar sem
// atualizar o app: features/menu/hooks/use-menu.ts lê exatamente esta estrutura.
//
// COMPATIBILIDADE: os campos originais (`dia`, `data`, `itens`, `cardapio`,
// `diaInicial`, `diaFinal`) são o contrato v1 e continuam sendo emitidos
// EXATAMENTE como antes — versões antigas do app só leem esses e ignoram o resto.
// Tudo que é novo (v2) é OPCIONAL e aditivo: `pratos` por dia e metadados no Menu.
// Regra: nunca remova/renomeie campo v1, nunca mude o formato de `itens`.

/** Categoria de um prato, usada pelo app para agrupar e dar ícone/título. */
export type MenuCategoria =
  | 'base' // arroz, feijão — o "fixo" do dia
  | 'carne' // prato principal (proteína animal)
  | 'vegetariano' // opção vegetariana/proteína vegetal (PTS, lentilha, grão de bico…)
  | 'guarnicao' // acompanhamento/complemento (farofa, polenta, purê…)
  | 'salada'
  | 'molho' // molho para salada
  | 'sobremesa'
  | 'outro';

export type MenuRefeicao = 'almoco' | 'jantar';

/**
 * Declarações de alergênicos/dieta feitas EXPLICITAMENTE pela fonte. Campo ausente
 * = a fonte não declarou nada (não significa "não contém"). `true` = contém;
 * `false` = a fonte declara que NÃO contém (ex. Araranguá "CONTÉM GLÚTEN: NÃO").
 */
export interface MenuAlergenos {
  gluten?: boolean;
  lacteos?: boolean;
  /** "COM/SEM ADIÇÃO INTENCIONAL DE ORIGEM ANIMAL" (Araranguá). */
  origemAnimal?: boolean;
}

export interface MenuPrato {
  nome: string;
  categoria: MenuCategoria;
  /** Ausente = vale para todas as refeições servidas. */
  refeicao?: MenuRefeicao;
  alergenos?: MenuAlergenos;
  /** Lista de ingredientes publicada pela fonte (Trindade, Araranguá). */
  ingredientes?: string;
}

export interface MenuItem {
  dia: string;
  data: string;
  /** v1 — lista plana de strings, INALTERADA. */
  itens: string[];
  /** v2 — mesmos pratos, estruturados. Presente só quando o parser do campus suporta. */
  pratos?: MenuPrato[];
}

export interface Menu {
  cardapio: MenuItem[] | { url_imagem: string };
  diaInicial: string | null;
  diaFinal: string | null;
  /** v2 — 2 quando `pratos`/metadados estão presentes. Ausente = v1. */
  versao?: 2;
  /** Refeições cobertas por este cardápio, quando a fonte declara. */
  refeicoes?: MenuRefeicao[];
  /** URL do PDF/imagem original (para o app oferecer "abrir original"). */
  fonteUrl?: string;
  /** ISO 8601 do momento da raspagem. */
  atualizadoEm?: string;
}

export interface CampusScraper {
  /** Chave usada na coluna `campus` da tabela `menus` do Supabase. */
  campus: string;
  scrape(): Promise<Menu>;
}
