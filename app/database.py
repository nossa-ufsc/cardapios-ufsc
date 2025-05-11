from supabase import create_client
import os
from typing import Dict, Any
from dotenv import load_dotenv

load_dotenv()

supabase = create_client(
    os.getenv('SUPABASE_URL'),
    os.getenv('SUPABASE_KEY')
)

def salvar_menu(campus: str, menu: Dict[str, Any]) -> None:
    try:
        result = supabase.table('menus').upsert({
            'campus': campus,
            'menu': menu
        }).execute()
        
        if not result.data:
            raise Exception(f"Falha ao salvar o cardápio para o campus {campus}")
            
    except Exception as e:
        raise Exception(f"Erro ao salvar o cardápio para o campus {campus}: {str(e)}") 