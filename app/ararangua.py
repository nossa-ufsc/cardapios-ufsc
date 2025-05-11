import requests
import os
from bs4 import BeautifulSoup
from docx import Document
from datetime import datetime

DIAS_FIXOS = [
    "SEGUNDA-FEIRA", "TERÇA-FEIRA", "QUARTA-FEIRA",
    "QUINTA-FEIRA", "SEXTA-FEIRA", "SÁBADO", "DOMINGO"
]

def baixar_ultimo_cardapio_ararangua(url_site):
    """
    Baixa o último cardápio disponível no site do RU de Araranguá.
    
    Args:
        url_site (str): URL do site do RU de Araranguá
        
    Returns:
        str: Nome do arquivo baixado
        
    Raises:
        Exception: Se houver erro ao acessar o site ou baixar o arquivo
    """
    try:
        response = requests.get(url_site, timeout=5)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"❌ Erro ao tentar acessar a página: {e}")
        raise Exception("Erro ao tentar acessar o site da UFSC.")

    soup = BeautifulSoup(response.content, "html.parser")
    
    # Procura o link do cardápio dentro da div com id que começa com "target-id"
    cardapio_div = soup.find("div", id=lambda x: x and x.startswith("target-id"))
    if not cardapio_div:
        raise Exception("Div do cardápio não encontrada no site.")
        
    link_cardapio = cardapio_div.find("a", href=lambda x: x and x.endswith('.docx'))
    if not link_cardapio:
        raise Exception("Link para o cardápio não encontrado no site.")
        
    url_cardapio = link_cardapio['href']
    nome_arquivo = url_cardapio.split("/")[-1]
    
    print(f"📥 Último cardápio encontrado: {url_cardapio}")
    
    try:
        docx_response = requests.get(url_cardapio, timeout=5)
        docx_response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"❌ Erro ao tentar baixar o arquivo: {e}")
        raise Exception("Erro ao tentar baixar o cardápio do site da UFSC.")
        
    with open(nome_arquivo, "wb") as f:
        f.write(docx_response.content)
        
    return nome_arquivo

def ler_docx(caminho_docx):
    """
    Lê um arquivo DOCX e extrai o conteúdo das tabelas.
    
    Args:
        caminho_docx (str): Caminho para o arquivo DOCX
        
    Returns:
        list: Lista de dicionários contendo os dados das tabelas
    """
    print(f"\n📄 Lendo arquivo: {caminho_docx}\n")
    
    try:
        doc = Document(caminho_docx)
    except Exception as e:
        print(f"❌ Erro ao tentar abrir o arquivo DOCX: {e}")
        raise Exception("Erro ao tentar abrir o arquivo DOCX.")
        
    # Extrai o conteúdo das tabelas
    tabelas = []
    for tabela in doc.tables:
        dados_tabela = []
        for linha in tabela.rows:
            dados_linha = [celula.text.strip() for celula in linha.cells]
            dados_tabela.append(dados_linha)
        tabelas.append(dados_tabela)
        
    return tabelas

def extrair_datas(texto):
    """
    Extrai as datas do texto do cardápio.
    
    Args:
        texto (str): Texto contendo as datas
        
    Returns:
        list: Lista com as datas encontradas
    """
    import re
    padrao_data = r"\b\d{2}/\d{2}/\d{4}\b"
    datas = re.findall(padrao_data, texto)
    if len(datas) >= 7:
        return datas[:7]
    else:
        raise Exception("❌ Não foi possível extrair 7 datas do texto.")

def extrair_ano_do_arquivo(nome_arquivo):
    """
    Extrai o ano do nome do arquivo do cardápio.
    
    Args:
        nome_arquivo (str): Nome do arquivo do cardápio
        
    Returns:
        int: Ano extraído do nome do arquivo
    """
    import re
    # Procura por um ano no nome do arquivo
    match = re.search(r'(\d{4})', nome_arquivo)
    if match:
        return int(match.group(1))
    # Se não encontrar, retorna o ano atual
    return datetime.now().year

def parsear_cardapio_ararangua(tabela, nome_arquivo=None):
    """
    Parseia a tabela do cardápio do RU de Araranguá.
    
    Args:
        tabela (list): Lista de listas contendo os dados da tabela
        nome_arquivo (str, optional): Nome do arquivo para extrair o ano
        
    Returns:
        dict: Dicionário contendo o cardápio e as datas inicial e final
    """
    if not tabela or len(tabela) < 6:
        raise Exception("❌ Formato de tabela inválido")
        
    # Primeira linha contém os dias e datas
    dias_datas = tabela[0][1:]  # Ignora a primeira célula "Cardápio"
    
    # Extrai o ano do arquivo ou usa o ano atual
    ano = extrair_ano_do_arquivo(nome_arquivo) if nome_arquivo else datetime.now().year
    
    # Extrai as datas dos dias
    datas = []
    for dia_data in dias_datas:
        data = dia_data.split('\n')[1]  # Pega a segunda linha que contém a data
        # Adiciona o ano se não estiver presente
        if len(data.split('/')) == 2:
            data = f"{data}/{ano}"
        datas.append(data)
    
    # Inicializa o cardápio para cada dia
    cardapio_final = []
    
    # Para cada dia da semana
    for i in range(7):
        cardapio_dia = {
            "dia": DIAS_FIXOS[i],
            "data": datas[i],
            "itens": []
        }
        
        # Adiciona todos os itens do dia
        for linha in tabela[1:]:  # Pula a primeira linha (dias e datas)
            if i+1 < len(linha):  # Verifica se existe item para este dia
                # Pega todos os itens da célula, não apenas o primeiro
                itens_celula = linha[i+1].split('\n')
                for item in itens_celula:
                    item = item.strip()
                    # Ignora itens vazios, 'nan' e itens que começam com "CONTÉM"
                    if item and item.lower() != 'nan' and not item.upper().startswith('CONTÉM'):
                        cardapio_dia["itens"].append(item)
        
        cardapio_final.append(cardapio_dia)
    
    return {
        "diaInicial": datas[0] if datas else None,
        "diaFinal": datas[-1] if datas else None,
        "cardapio": cardapio_final
    }