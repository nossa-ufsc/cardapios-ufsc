from flask import Flask, jsonify, request
import app.trindade as trindade
import app.joinville as joinville
import app.ararangua as ararangua
from app.curitibanos import baixar_ultimo_cardapio_curitibanos, ler_pdf, processar_tabela_semana, processar_array_tabelas
from app.blumenau import gerar_cardapio_blumenau
from app.database import salvar_menu
from functools import wraps
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

def require_api_key(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if app.debug: 
            return f(*args, **kwargs)
        api_key = request.headers.get('X-API-Key')
        if api_key and api_key == os.getenv('API_KEY'):
            return f(*args, **kwargs)
        return jsonify({"error": "Chave de API inválida ou ausente"}), 401
    return decorated_function

@app.route("/gerar_cardapio_trindade", methods=["GET"])
@require_api_key
def gerar_cardapio_trindade():
    url = "https://ru.ufsc.br/ru/"
    pdf = trindade.baixar_ultimo_cardapio_trindade(url)
    texto = trindade.ler_pdf(pdf)
    datas = trindade.extrair_datas(texto)
    parsed = trindade.parsear_cardapio(texto)
    resultado = trindade.montar_cardapio_trindade(parsed, datas)
    os.remove(pdf)
    
    try:
        salvar_menu('florianopolis', resultado)
    except Exception as e:
        print(f"Erro ao salvar o cardápio para o campus Trindade: {e}")
        
    return jsonify(resultado)

@app.route("/gerar_cardapio_joinville")
@require_api_key
def get_cardapio_joinville():
    try:
        url = "https://restaurante.joinville.ufsc.br/cardapio-da-semana/"
        nome_arquivo = joinville.baixar_ultimo_cardapio_joinville(url)
        cardapio = joinville.extrair_tabela_pdf(nome_arquivo)
        if not cardapio:
            return jsonify({"error": "Cardápio não encontrado"}), 404
            
        try:
            salvar_menu('joinville', cardapio)
        except Exception as e:
            print(f"Erro ao salvar o cardápio para o campus Joinville: {e}")
            
        return jsonify(cardapio)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/gerar_cardapio_ararangua")
@require_api_key
def get_cardapio_ararangua():
    try:
        url = "https://ara.ufsc.br/ru/"
        nome_arquivo = ararangua.baixar_ultimo_cardapio_ararangua(url)
        tabelas = ararangua.ler_docx(nome_arquivo)
        cardapio = ararangua.parsear_cardapio_ararangua(tabelas[0], nome_arquivo)
        os.remove(nome_arquivo)
        
        try:
            salvar_menu('ararangua', cardapio)
        except Exception as e:
            print(f"Erro ao salvar o cardápio para o campus Ararangua: {e}")
            
        return jsonify(cardapio)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/gerar_cardapio_curitibanos', methods=['GET'])
@require_api_key
def cardapio_curitibanos():
    try:
        pdf_file = baixar_ultimo_cardapio_curitibanos("https://ru.curitibanos.ufsc.br/cardapio")
        try:
            texto = ler_pdf(pdf_file)
            resultado = processar_array_tabelas(processar_tabela_semana(texto))
            
            try:
                salvar_menu('curitibanos', resultado)
            except Exception as e:
                print(f"Erro ao salvar o cardápio para o campus Curitibanos: {e}")
                
            return jsonify(resultado)
        finally:
            if os.path.exists(pdf_file):
                os.remove(pdf_file)
    except Exception as e:
        return jsonify({"erro": str(e)}), 500

@app.route("/gerar_cardapio_blumenau")
@require_api_key
def get_cardapio_blumenau():
    try:
        cardapio = gerar_cardapio_blumenau()
        
        try:
            salvar_menu('blumenau', cardapio)
        except Exception as e:
            print(f"Erro ao salvar o cardápio para o campus Blumenau: {e}")
            
        return jsonify(cardapio)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5003)
