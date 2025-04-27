from flask import Flask, jsonify
import app.trindade as trindade
import app.cca as cca
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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5003)
