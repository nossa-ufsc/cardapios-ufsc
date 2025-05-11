import requests
import os
from bs4 import BeautifulSoup
import tabula
import pandas as pd

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

DIAS_FIXOS = [
    "Segunda feira",
    "Terça feira",
    "Quarta feira",
    "Quinta feira",
    "Sexta feira",
    "Sábado",
    "Domingo"
]

CAMPOS_PADRAO = [
    "carne",
    "salada",
    "molho_salada",
    "sobremesa",
    "complementos"
]

def baixar_ultimo_cardapio_curitibanos(url_site):
    try:
        response = requests.get(url_site, timeout=5)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        raise Exception("Erro ao tentar acessar o site da UFSC Curitibanos.")

    soup = BeautifulSoup(response.content, "html.parser")
    primeiro_link = soup.select_one("#content .content a[href$='.pdf']")
    
    if not primeiro_link:
        raise Exception("Nenhum link PDF encontrado na página.")

    pdf_url = primeiro_link['href']
    nome_arquivo = pdf_url.split("/")[-1]

    try:
        pdf_response = requests.get(pdf_url, timeout=5)
        pdf_response.raise_for_status()
    except requests.exceptions.RequestException as e:
        raise Exception("Erro ao tentar baixar o PDF do site da UFSC Curitibanos.")

    with open(nome_arquivo, "wb") as f:
        f.write(pdf_response.content)

    return nome_arquivo

def ler_pdf(caminho_pdf):
    try:
        tabelas = tabula.read_pdf(
            caminho_pdf,
            pages='all',
            multiple_tables=True,
            lattice=True,
            guess=True,
            pandas_options={'header': None}
        )
        
        if not tabelas:
            raise Exception("Nenhuma tabela encontrada no PDF")
        
        semanas = []
        i = 0
        
        while i < len(tabelas):
            tabela = tabelas[i].dropna(how='all').dropna(axis=1, how='all')
            
            for col in tabela.columns:
                tabela[col] = tabela[col].astype(str).apply(lambda x: x.replace('\r', ' ').strip())
            
            linhas = []
            for _, row in tabela.iterrows():
                linha = [str(val).strip() for val in row if pd.notna(val) and str(val).strip()]
                if linha:
                    linhas.append(linha)
            
            if not linhas:
                i += 1
                continue
            
            if len(linhas) < 5 and i + 1 < len(tabelas):
                proxima_tabela = tabelas[i + 1].dropna(how='all').dropna(axis=1, how='all')
                for col in proxima_tabela.columns:
                    proxima_tabela[col] = proxima_tabela[col].astype(str).apply(lambda x: x.replace('\r', ' ').strip())
                
                for _, row in proxima_tabela.iterrows():
                    linha = [str(val).strip() for val in row if pd.notna(val) and str(val).strip()]
                    if linha:
                        linhas.append(linha)
                
                i += 2
            else:
                i += 1
            
            primeira_linha_idx = -1
            for idx, linha in enumerate(linhas):
                linha_str = ' '.join(linha).lower()
                if 'segunda' in linha_str and ('feira' in linha_str or 'feira' in linha_str):
                    primeira_linha_idx = idx
                    break
            
            if primeira_linha_idx > 0:
                linhas = linhas[primeira_linha_idx:]
            
            colunas = []
            max_cols = max(len(linha) for linha in linhas)
            
            for col_idx in range(max_cols):
                coluna = []
                for linha in linhas:
                    if col_idx < len(linha):
                        coluna.append(linha[col_idx])
                    else:
                        coluna.append(None)
                colunas.append(coluna)
            
            semanas.append(colunas)
        
        return semanas
        
    except Exception as e:
        raise Exception(f"Erro ao processar PDF: {e}")

def processar_tabela_semana(tabelas):
    if not tabelas:
        return []
    
    resultados = []
    
    for tabela in tabelas:
        if not tabela:
            resultados.append([])
            continue
            
        max_cols = max(len(linha) for linha in tabela)
        
        colunas_agrupadas = []
        for col_idx in range(max_cols):
            coluna = []
            for linha in tabela:
                if col_idx < len(linha):
                    coluna.append(linha[col_idx])
                else:
                    coluna.append(None)
            colunas_agrupadas.append(coluna)
        
        colunas_agrupadas[0][0] = "DIA"
        resultados.append(colunas_agrupadas)
    
    return resultados

def transformar_em_objetos(colunas):
    if not colunas or len(colunas) < 2:
        return []
        
    num_dias = len(colunas[0])
    
    dias = []
    for dia_idx in range(1, num_dias):
        dia = {
            "dia": colunas[0][dia_idx],
            "data": colunas[1][dia_idx],
            "carne": None,
            "complemento": [],
            "salada": None,
            "sobremesa": None,
            "bebida": None
        }
        
        for coluna in colunas:
            if not coluna or len(coluna) <= dia_idx:
                continue
                
            valor = str(coluna[dia_idx]).strip() if coluna[dia_idx] and str(coluna[dia_idx]).lower() != 'nan' else None
            
            if valor:
                cabecalho = str(coluna[0]).strip().lower()
                
                if 'proteína' in cabecalho:
                    dia['carne'] = valor
                elif 'guarnição' in cabecalho:
                    dia['complemento'].append(valor)
                elif 'salada' in cabecalho:
                    dia['salada'] = valor
                elif 'sobremesa' in cabecalho:
                    dia['sobremesa'] = valor
                elif 'bebida' in cabecalho:
                    dia['bebida'] = valor
                elif cabecalho == 'nan':
                    dia['complemento'].append(valor)
        
        dias.append(dia)
    
    return dias

def processar_array_tabelas(tabelas):
    if not tabelas:
        return []
        
    resultados = []
    for tabela in tabelas:
        objetos = transformar_em_objetos(tabela)
        resultados.extend(objetos)
    
    return resultados

# 🔥 Função final usada no endpoint
def gerar_cardapio_curitibanos_via_groq():
    url_site = "https://ru.curitibanos.ufsc.br/cardapio"
    pdf_filename = baixar_ultimo_cardapio_curitibanos(url_site)

    try:
        # Lê e processa as semanas
        semanas = ler_pdf(pdf_filename)
        resultados = processar_tabela_semana(semanas)
        
        return resultados
    finally:
        if os.path.exists(pdf_filename):
            os.remove(pdf_filename)