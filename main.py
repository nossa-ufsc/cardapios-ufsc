from flask import Flask, jsonify
import app.trindade as trindade
import app.cca as cca
import app.joinville as joinville
import app.ararangua as ararangua
from app.curitibanos import baixar_ultimo_cardapio_curitibanos, ler_pdf, processar_tabela_semana, processar_array_tabelas
from app.blumenau import gerar_cardapio_blumenau

import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

@app.route("/gerar_cardapio_trindade", methods=["GET"])
def gerar_cardapio_trindade():
    url = "https://ru.ufsc.br/ru/"
    pdf = trindade.baixar_ultimo_cardapio_trindade(url)
    texto = trindade.ler_pdf(pdf)
    datas = trindade.extrair_datas(texto)
    parsed = trindade.parsear_cardapio(texto)
    resultado = trindade.montar_cardapio_trindade(parsed, datas)
    os.remove(pdf)
    return jsonify(resultado)

@app.route("/gerar_cardapio_cca", methods=["GET"])
def gerar_cardapio_cca():
    resultado = cca.gerar_cardapio_cca_via_groq()
    return jsonify(resultado)

@app.route("/gerar_cardapio_joinville")
def get_cardapio_joinville():
    try:
        url = "https://restaurante.joinville.ufsc.br/cardapio-da-semana/"
        nome_arquivo = joinville.baixar_ultimo_cardapio_joinville(url)
        cardapio = joinville.extrair_tabela_pdf(nome_arquivo)
        if not cardapio:
            return jsonify({"error": "Cardápio não encontrado"}), 404
        return jsonify(cardapio)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/gerar_cardapio_ararangua")
def get_cardapio_ararangua():
    try:
        url = "https://ara.ufsc.br/ru/"
        nome_arquivo = ararangua.baixar_ultimo_cardapio_ararangua(url)
        tabelas = ararangua.ler_docx(nome_arquivo)
        cardapio = ararangua.parsear_cardapio_ararangua(tabelas[0], nome_arquivo)
        os.remove(nome_arquivo)
        return jsonify(cardapio)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/gerar_cardapio_curitibanos', methods=['GET'])
def cardapio_curitibanos():
    try:
        pdf_file = baixar_ultimo_cardapio_curitibanos("https://ru.curitibanos.ufsc.br/cardapio")
        try:
            texto = ler_pdf(pdf_file)
            resultado = processar_array_tabelas(processar_tabela_semana(texto))
            return jsonify(resultado)
        finally:
            if os.path.exists(pdf_file):
                os.remove(pdf_file)
    except Exception as e:
        return jsonify({"erro": str(e)}), 500

@app.route("/gerar_cardapio_blumenau")
def get_cardapio_blumenau():
    try:
        cardapio = gerar_cardapio_blumenau()
        return jsonify(cardapio)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5003)
