import requests
import os
import re
import json
from bs4 import BeautifulSoup
from markitdown import MarkItDown

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

def baixar_ultimo_cardapio_cca(url_site):
    try:
        response = requests.get(url_site, timeout=5)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"❌ Erro ao acessar a página: {e}")
        raise Exception("Erro ao tentar acessar o site da UFSC.")

    soup = BeautifulSoup(response.content, "html.parser")
    lista_links = soup.select(".content li a[href$='.pdf']")

    if not lista_links:
        raise Exception("Nenhum link PDF encontrado na página.")

    primeiro_link = lista_links[0]['href']
    nome_arquivo = primeiro_link.split("/")[-1]

    try:
        pdf_response = requests.get(primeiro_link, timeout=5)
        pdf_response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"❌ Erro ao baixar o PDF: {e}")
        raise Exception("Erro ao tentar baixar o PDF do site da UFSC.")

    with open(nome_arquivo, "wb") as f:
        f.write(pdf_response.content)

    return nome_arquivo

def gerar_cardapio_groq(texto_dia):
    if not GROQ_API_KEY:
        raise Exception("❌ GROQ_API_KEY não encontrada. Configure no ambiente.")

    prompt = f"""
Abaixo está o texto de um cardápio universitário referente a apenas UM dia:

{texto_dia}

Seu trabalho é extrair apenas o nome dos alimentos, ignorando descrições de ingredientes e informações nutricionais.

Organize o cardápio no seguinte formato JSON:
{{
  "dia": "",
  "data": "",
  "itens": []
}}

Regras importantes:
- Pegue apenas o nome principal do alimento (exemplo: "Arroz integral", "Feijão", etc).
- Ignore listas de ingredientes.
- Se não houver algum item, retorne um array vazio.
- Responda apenas o JSON, sem explicações.
"""

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    body = {
        "model": "llama3-8b-8192",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 800
    }

    try:
        response = requests.post(GROQ_API_URL, headers=headers, json=body, timeout=5)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"❌ Erro na requisição para o GROQ: {e}")
        raise Exception("Erro na chamada à API do GROQ.")

    content = response.json()['choices'][0]['message']['content']

    try:
        match = re.search(r'(\{.*\})', content, re.DOTALL)
        if match:
            json_clean = match.group(1)
            parsed = json.loads(json_clean)
            return parsed
        else:
            print("⚠️ Não foi possível encontrar JSON válido na resposta.")
            return None
    except Exception as e:
        print(f"⚠️ Erro tentando carregar JSON: {e}")
        return None

def criar_objeto_none(dia_nome):
    return {
        "dia": dia_nome.upper() + "-FEIRA",
        "data": None,
        "itens": []
    }

def extrair_dias_texto(texto_completo):
    padrao = r"(Segunda feira|Terça feira|Quarta feira|Quinta feira|Sexta feira|Sábado|Domingo)\s*–\s*\d{2}/\d{2}/\d{4}"

    matches = list(re.finditer(padrao, texto_completo))
    blocos = {}
    for i in range(len(matches)):
        inicio = matches[i].start()
        fim = matches[i+1].start() if i+1 < len(matches) else len(texto_completo)
        nome_dia = matches[i].group(1)
        blocos[nome_dia] = texto_completo[inicio:fim].strip()

    return blocos

def ler_pdf_com_markitdown(caminho_pdf):
    md = MarkItDown(enable_plugins=False)
    result = md.convert(caminho_pdf)
    return result.text_content

# 🔥 Função final usada no endpoint
def gerar_cardapio_cca_via_groq():
    url_site = "https://ru.ufsc.br/cca-2/"
    pdf_filename = baixar_ultimo_cardapio_cca(url_site)

    try:
        texto_completo = ler_pdf_com_markitdown(pdf_filename)
        dias_detectados = extrair_dias_texto(texto_completo)

        resultados = []
        for dia_nome in DIAS_FIXOS:
            if dia_nome in dias_detectados:
                texto_dia = dias_detectados[dia_nome]
                resultado = gerar_cardapio_groq(texto_dia)
                resultados.append(resultado)
            else:
                resultados.append(criar_objeto_none(dia_nome))

        return resultados
    finally:
        if os.path.exists(pdf_filename):
            os.remove(pdf_filename)
