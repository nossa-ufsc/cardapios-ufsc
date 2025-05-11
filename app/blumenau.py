import requests
import json
from bs4 import BeautifulSoup

def baixar_ultimo_cardapio_blumenau(url_site):
    try:
        response = requests.get(url_site, timeout=5)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"❌ Erro ao acessar a página: {e}")
        raise Exception("Erro ao tentar acessar o site do RU Blumenau.")

    soup = BeautifulSoup(response.content, "html.parser")
    
    # Procura por imagens PNG que contenham "cardapio" no nome
    lista_imagens = soup.select("img[src*='cardapio'][src$='.png']")

    if not lista_imagens:
        raise Exception("Nenhuma imagem do cardápio encontrada na página.")

    primeiro_link = lista_imagens[0]['src']
    
    return {
        "url_imagem": primeiro_link
    }

def gerar_cardapio_blumenau():
    url_site = "https://ru.blumenau.ufsc.br/cardapios/"
    return baixar_ultimo_cardapio_blumenau(url_site)