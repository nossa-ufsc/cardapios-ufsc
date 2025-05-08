import requests
import os
import pandas as pd
import tabula
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
            "cardapio": {
                "carne": "",
                "salada": "",
                "molho_salada": "",
                "sobremesa": "",
                "complementos": []
            }
        }
        
        # Adiciona os itens de cada linha para este dia
        for j, linha in enumerate(linhas[2:]):  # Pula as duas primeiras linhas (dias e datas)
            if i < len(linha):  # Verifica se existe item para este dia
                item = linha[i]
                
                # Organiza os itens nas categorias corretas
                if j == 3:  # 4º item é a carne
                    dia_obj["cardapio"]["carne"] = item
                elif j == 6:  # 7º item é o molho da salada
                    dia_obj["cardapio"]["molho_salada"] = item
                elif j == 7:  # 8º item é a primeira salada
                    dia_obj["cardapio"]["salada"] = item
                elif j == 8:  # 9º item é a segunda salada
                    dia_obj["cardapio"]["salada"] += f", {item}"
                elif j == 9:  # 10º item é a sobremesa
                    dia_obj["cardapio"]["sobremesa"] = item
                elif j < 3:  # Primeiros 3 itens são complementos (arroz, arroz integral, feijão)
                    dia_obj["cardapio"]["complementos"].append(item)
                elif j == 4 or j == 5:  # 5º e 6º itens são complementos
                    dia_obj["cardapio"]["complementos"].append(item)
        
        objetos_dias.append(dia_obj)
    
    return objetos_dias

def extrair_tabela_pdf(caminho_pdf):
    try:
        # Extrai todas as tabelas do PDF
        tabelas = tabula.read_pdf(
            caminho_pdf,
            pages='all',  # Lê todas as páginas
            multiple_tables=True,  # Extrai múltiplas tabelas
            lattice=True,  # Usa detecção de linhas da tabela
            guess=True,  # Tenta adivinhar a estrutura da tabela
            pandas_options={'header': None}  # Não usa a primeira linha como cabeçalho
        )
        
        if not tabelas:
            raise Exception("Nenhuma tabela encontrada no PDF")
        
        # Processa cada tabela
        for i, tabela in enumerate(tabelas):
            # Remove linhas vazias e colunas vazias
            tabela = tabela.dropna(how='all').dropna(axis=1, how='all')
            
            # Limpa a formatação dos dados
            for col in tabela.columns:
                tabela[col] = tabela[col].astype(str).apply(lambda x: x.replace('\r', ' ').strip())
            
            # Converte cada linha em um array de strings
            linhas = []
            for _, row in tabela.iterrows():
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
            
            return objetos_dias
    except Exception as e:
        raise Exception(f"Erro ao extrair tabela do PDF: {e}")
