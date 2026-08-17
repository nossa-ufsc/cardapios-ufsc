// Espelha o contrato consumido pelo app (nossa-ufsc/types.ts). NÃO alterar sem
// atualizar o app: features/menu/hooks/use-menu.ts lê exatamente esta estrutura.

export interface MenuItem {
  dia: string;
  data: string;
  itens: string[];
}

export interface Menu {
  cardapio: MenuItem[] | { url_imagem: string };
  diaInicial: string | null;
  diaFinal: string | null;
}

export interface CampusScraper {
  /** Chave usada na coluna `campus` da tabela `menus` do Supabase. */
  campus: string;
  scrape(): Promise<Menu>;
}
