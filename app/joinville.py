import requests
import os
import pandas as pd
import camelot
from bs4 import BeautifulSoup

def baixar_ultimo_cardapio_joinville(url_site):
    try:
        response = requests.get(url_site, timeout=5)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"❌ Erro ao tentar acessar a página: {e}")
        raise Exception("Erro ao tentar acessar o site do RU de Joinville.")

    soup = BeautifulSoup(response.content, "html.parser")
    # Procurando links de PDF dentro da seção content
    lista_links = soup.select("#content a[href$='.pdf']")
    if not lista_links:
        raise Exception("Nenhum link para PDF encontrado no site.")

    ultimo_link = lista_links[-1]['href']
    nome_arquivo = ultimo_link.split("/")[-1]

    print(f"📥 Último PDF encontrado: {ultimo_link}")

    try:
        pdf_response = requests.get(ultimo_link, timeout=5)
        pdf_response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"❌ Erro ao tentar baixar o PDF: {e}")
        raise Exception("Erro ao tentar baixar o PDF do site do RU de Joinville.")

    with open(nome_arquivo, "wb") as f:
        f.write(pdf_response.content)

    return nome_arquivo

def criar_objetos_dias(linhas):
    if not linhas or len(linhas) < 2:
        return []
    
    # Pega os dias da semana da primeira linha
    dias = linhas[0]
    # Pega as datas da segunda linha
    datas = linhas[1]
    
    # Cria um objeto para cada dia
    objetos_dias = []
    for i in range(len(dias)):
        dia_obj = {
            "dia": dias[i],
            "data": datas[i],
            "itens": []
        }
        
        # Adiciona os itens de cada linha para este dia
        for j, linha in enumerate(linhas[2:]):  # Pula as duas primeiras linhas (dias e datas)
            if i < len(linha):  # Verifica se existe item para este dia
                item = linha[i]
                if item:  # Só adiciona se o item não for vazio
                    dia_obj["itens"].append(item)
        
        objetos_dias.append(dia_obj)
    
    return objetos_dias

def extrair_tabela_pdf(caminho_pdf):
    try:
        # Extrai todas as tabelas do PDF
        tabelas = camelot.read_pdf(
            caminho_pdf,
            pages='all',  # Lê todas as páginas
            flavor='lattice'  # Usa detecção de linhas da tabela
        )
        
        if not tabelas:
            raise Exception("Nenhuma tabela encontrada no PDF")
        
        # Processa cada tabela
        for i, tabela in enumerate(tabelas):
            # Converte a tabela do camelot para pandas DataFrame
            df = tabela.df
            
            # Remove linhas vazias e colunas vazias
            df = df.dropna(how='all').dropna(axis=1, how='all')
            
            # Limpa a formatação dos dados
            for col in df.columns:
                df[col] = df[col].astype(str).apply(lambda x: x.replace('\r', ' ').strip())
            
            # Converte cada linha em um array de strings
            linhas = []
            for _, row in df.iterrows():
                linha = [str(val).strip() for val in row if pd.notna(val) and str(val).strip()]
                if linha:  # Só adiciona se houver valores não vazios
                    linhas.append(linha)
            
            # Cria os objetos dos dias
            objetos_dias = criar_objetos_dias(linhas)
            
            # Remove o arquivo PDF após o processamento
            try:
                os.remove(caminho_pdf)
                print(f"✅ Arquivo PDF removido: {caminho_pdf}")
            except Exception as e:
                print(f"⚠️ Não foi possível remover o arquivo PDF: {e}")
            
            datas = [dia['data'] for dia in objetos_dias if dia.get('data')]
            
            return {
                "diaInicial": datas[0] if datas else None,
                "diaFinal": datas[-1] if datas else None,
                "cardapio": objetos_dias
            }
    except Exception as e:
        raise Exception(f"Erro ao extrair tabela do PDF: {e}")
