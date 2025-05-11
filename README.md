# Cardápios UFSC

API para obter os cardápios dos Restaurantes Universitários da UFSC.

## Como rodar localmente

### Pré-requisitos

- Python 3.x
- pip (gerenciador de pacotes do Python)

### Configuração do ambiente

1. Clone o repositório:

```bash
git clone https://github.com/seu-usuario/cardapios-ufsc.git
cd cardapios-ufsc
```

2. Crie um ambiente virtual:

```bash
python3 -m venv venv
```

3. Ative o ambiente virtual:

```bash
# No macOS/Linux:
source venv/bin/activate

# No Windows:
.\venv\Scripts\activate
```

4. Instale as dependências:

```bash
pip install -r requirements.txt
```

5. Configure as variáveis de ambiente:

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas configurações.

### Executando o projeto

1. Com o ambiente virtual ativado, execute:

```bash
python main.py
```

2. A API estará disponível em `http://localhost:5003`
