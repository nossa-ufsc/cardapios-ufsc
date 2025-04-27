import requests
import os
import re
import json
from bs4 import BeautifulSoup
from markitdown import MarkItDown

DIAS_FIXOS = [
    "SEGUNDA-FEIRA", "TERÇA-FEIRA", "QUARTA-FEIRA",
    "QUINTA-FEIRA", "SEXTA-FEIRA", "SÁBADO", "DOMINGO"
]

def baixar_ultimo_cardapio_trindade(url_site):
    try:
        response = requests.get(url_site, timeout=5)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"❌ Erro ao tentar acessar a página: {e}")
        raise Exception("Erro ao tentar acessar o site da UFSC.")

    soup = BeautifulSoup(response.content, "html.parser")
    lista_links = soup.select(".content li a[href$='.pdf']")
    if not lista_links:
        raise Exception("Nenhum link para PDF encontrado no site.")

    primeiro_link = lista_links[0]['href']
    nome_arquivo = primeiro_link.split("/")[-1]

    print(f"📥 Último PDF encontrado: {primeiro_link}")

    try:
        pdf_response = requests.get(primeiro_link, timeout=5)
        pdf_response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"❌ Erro ao tentar baixar o PDF: {e}")
        raise Exception("Erro ao tentar baixar o PDF do site da UFSC.")

    with open(nome_arquivo, "wb") as f:
        f.write(pdf_response.content)

    return nome_arquivo

def ler_pdf(caminho_pdf):
    print(f"\n📄 Lendo e convertendo arquivo: {caminho_pdf}\n")
    md = MarkItDown(enable_plugins=False)
    result = md.convert(caminho_pdf)
    return result.text_content

def extrair_datas(texto):
    padrao_data = r"\b\d{2}/\d{2}/\d{4}\b"
    datas = re.findall(padrao_data, texto)
    if len(datas) >= 7:
        return datas[:7]
    else:
        raise Exception("❌ Não foi possível extrair 7 datas do texto.")

def parsear_cardapio(texto):
    linhas = texto.splitlines()
    linhas = [linha.strip() for linha in linhas if linha.strip()]
    dias_cardapio, dia_atual = [], None

    for linha in linhas:
        linha_upper = linha.upper()

        if linha_upper.startswith("CARNE:") or linha_upper.startswith("CARNE ALMOÇO:") or linha_upper.startswith("CARNE JANTAR:"):
            if dia_atual:
                dias_cardapio.append(dia_atual)

            dia_atual = {
                "carne": None, "carne_almoco": None, "carne_jantar": None,
                "salada": [], "molho_salada": None, "sobremesa": None,
                "complementos": []
            }

            if linha_upper.startswith("CARNE:"):
                dia_atual["carne"] = linha.split(":", 1)[1].strip()
            elif linha_upper.startswith("CARNE ALMOÇO:"):
                dia_atual["carne_almoco"] = linha.split(":", 1)[1].strip()
            elif linha_upper.startswith("CARNE JANTAR:"):
                dia_atual["carne_jantar"] = linha.split(":", 1)[1].strip()

        elif dia_atual:
            if "SOBREMESA:" in linha_upper and "MOLHO SALADA" in linha_upper:
                partes = linha.split("MOLHO SALADA")
                dia_atual["sobremesa"] = partes[0].replace("SOBREMESA:", "").strip()
                dia_atual["molho_salada"] = partes[1].strip(": ").strip()
            elif linha_upper.startswith("SOBREMESA:"):
                dia_atual["sobremesa"] = linha.split(":", 1)[1].strip()
            elif "MOLHO SALADA" in linha_upper:
                parts = linha.split("MOLHO SALADA")
                if len(parts) == 2:
                    dia_atual["molho_salada"] = parts[1].strip(": ").strip()
            elif linha_upper.startswith("SALADA 1:") or linha_upper.startswith("SALADA 2:") or linha_upper.startswith("SALADA:"):
                dia_atual["salada"].append(linha.split(":", 1)[1].strip())
            else:
                dia_atual["complementos"].append(linha)

    if dia_atual:
        dias_cardapio.append(dia_atual)

    return dias_cardapio

def montar_cardapio_trindade(parsed_cardapio, datas_iniciais):
    cardapio_final = []

    for idx, dia_nome in enumerate(DIAS_FIXOS):
        cardapio_dia = {
            "dia": dia_nome,
            "data": datas_iniciais[idx] if idx < len(datas_iniciais) else None,
            "cardapio": {
                "carne": None, "carne_almoco": None, "carne_jantar": None,
                "salada": None, "molho_salada": None, "sobremesa": None,
                "complementos": []
            }
        }

        if idx < len(parsed_cardapio):
            dia = parsed_cardapio[idx]
            cardapio_dia["cardapio"]["carne"] = dia.get("carne")
            cardapio_dia["cardapio"]["carne_almoco"] = dia.get("carne_almoco")
            cardapio_dia["cardapio"]["carne_jantar"] = dia.get("carne_jantar")
            cardapio_dia["cardapio"]["salada"] = ", ".join(dia.get("salada", [])) if dia.get("salada") else None
            cardapio_dia["cardapio"]["molho_salada"] = dia.get("molho_salada")
            cardapio_dia["cardapio"]["sobremesa"] = dia.get("sobremesa")
            cardapio_dia["cardapio"]["complementos"] = dia.get("complementos", [])

        cardapio_final.append(cardapio_dia)

    return cardapio_final
