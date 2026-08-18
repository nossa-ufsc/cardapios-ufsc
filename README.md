# Cardápios UFSC

Raspagem dos cardápios dos Restaurantes Universitários da UFSC, executada
**inteiramente no GitHub Actions** (TypeScript + Bun) — sem Python e sem servidor
web/Render. Cada RU é raspado, parseado e persistido via `upsert` na tabela
`menus` do Supabase (uma linha por RU — a coluna `campus` é a chave do restaurante:
Florianópolis tem dois, `florianopolis` = Trindade e `cca`), consumida pelo app.

## Campi e fontes

| Campus (`campus` no Supabase) | Fonte | Formato |
| --- | --- | --- |
| `florianopolis` (Trindade) | `ru.ufsc.br/ru/` | PDF (texto) |
| `cca` (RU do CCA, Itacorubi) | `ru.ufsc.br/cca-2/` | PDF (1 página por dia + tabela; lista mais-novo-primeiro) |
| `joinville` | `restaurante.joinville.ufsc.br/cardapio-da-semana/` | PDF (tabela) |
| `ararangua` | `ara.ufsc.br/ru/` | PDF (tabela) |
| `curitibanos` | `ru.curitibanos.ufsc.br/cardapio` | PDF mensal (tabela) |
| `blumenau` | `ru.blumenau.ufsc.br/cardapios/` | Imagem PNG |

O parsing de PDF usa [`unpdf`](https://github.com/unjs/unpdf) (pdf.js): texto corrido
para o Trindade e **reconstrução de tabela por coordenadas** para os demais — sem
dependências nativas (ghostscript/opencv), o que roda direto no runner do Actions.

## Formato de saída (contrato com o app)

```ts
// v1 — INALTERADO. É tudo que versões antigas do app leem.
interface MenuItem { dia: string; data: string; itens: string[]; pratos?: MenuPrato[] }
interface Menu {
  cardapio: MenuItem[] | { url_imagem: string }; // imagem só no Blumenau
  diaInicial: string | null;                     // dd/mm/yyyy
  diaFinal: string | null;                       // dd/mm/yyyy
  // v2 — tudo OPCIONAL e aditivo (o app antigo ignora chaves desconhecidas)
  versao?: 2;
  refeicoes?: ('almoco' | 'jantar')[];  // quando a fonte declara (Trindade, Curitibanos)
  fonteUrl?: string;                    // PDF/página original
  atualizadoEm?: string;                // ISO 8601
}
interface MenuPrato {
  nome: string;
  categoria: 'base' | 'carne' | 'vegetariano' | 'guarnicao' | 'salada' | 'molho' | 'sobremesa' | 'outro';
  refeicao?: 'almoco' | 'jantar';       // ausente = vale para as duas
  alergenos?: { gluten?: boolean; lacteos?: boolean; origemAnimal?: boolean }; // só o que a fonte DECLARA
  ingredientes?: string;                // lista de ingredientes publicada pela fonte
}
```

Campi não-imagem emitem exatamente 7 dias (Segunda→Domingo). `itens` continua sendo a
lista plana de sempre; `pratos` é a mesma comida estruturada, presente só quando o
parser do campus reconhece a estrutura (senão o app cai no v1). Não remova/renomeie
campo v1 nem mude o formato de `itens` sem atualizar o app
(`features/menu/hooks/use-menu.ts`).

### De onde vem cada informação v2

| Campus | Categorias | Almoço/Jantar | Alergênicos | Ingredientes |
| --- | --- | --- | --- | --- |
| Trindade | rótulos do PDF ("Carne:", "Complemento:", "Saladas:"; molho/sobremesa por posição) | "(Jantar)", "Carne almoço:" etc. | "contém glúten/lactose" na lista de ingredientes | páginas "LISTA DE INGREDIENTES", casadas por nome e dia |
| CCA | rótulos "Saladas:/Acompanhamentos:/Proteína animal:/Fruta:" das páginas por dia (base/vegetariano/guarnição por nome+posição dentro de Acompanhamentos); nas férias só a tabela da pág. 1 (mesmos rótulos, sem ingredientes) | — (cardápio único) | "(Não) contém glúten / lactose / produtos de origem animal" declarado por prato | mesma linha "Nome: ingredientes (…)" |
| Joinville | classificador por palavra-chave + ordem fixa das linhas | — | — | — |
| Araranguá | bloco FIXO por palavra-chave; 1º prato com flags = carne, 2º = guarnição; "2 OPÇÕES"/"1 OPÇÃO" | — | "CONTÉM LÁCTEOS/GLÚTEN: SIM/NÃO", "COM/SEM ADIÇÃO INTENCIONAL DE ORIGEM ANIMAL" | página 2 (CARNES/GUARNIÇÕES) |
| Curitibanos | faixas horizontais SALADA/SOBREMESA/PRATOS QUENTES/(CARNE)/OPÇÃO VEGETARIANA + gap relativo quando o cabeçalho não sai como texto | título "ALMOÇO E JANTAR" | legenda "*CG"/"*CL" | — |
| Blumenau | — (imagem) | — | — | — |

Regra: rótulo estrutural da fonte vence; o classificador por nome
(`src/lib/categorias.ts`) é fallback e devolve 'outro' quando não tem certeza.
`bun scripts/inspecionar.ts <campus> <arquivo.pdf>` mostra os pratos de um PDF local.

## Rodar localmente

Pré-requisito: [Bun](https://bun.sh).

```bash
bun install
cp .env.example .env   # preencha SUPABASE_URL e SUPABASE_KEY

# validar um campus sem tocar no banco (imprime o JSON):
bun src/index.ts florianopolis --dry-run

# gravar só o snapshot em data/, sem upsert:
bun src/index.ts joinville --skip-db

# execução real (upsert no Supabase + snapshot):
bun src/index.ts curitibanos
```

Campi válidos: `florianopolis` (ou `trindade`), `cca`, `joinville`, `ararangua`,
`curitibanos`, `blumenau`.

Nota CCA: PDFs com menos de 3 dias servidos (fim de semana avulso, semana de
manutenção) são rejeitados pela validação — o job falha e o banco mantém a semana
anterior (o app mostra o aviso de "desatualizado"), por desenho.

## Automação (GitHub Actions)

- **`Gerar Cardápios`** (`.github/workflows/menus.yml`): cron seg/qua 11:00 BRT.
  Raspa os 5 campi em paralelo (matrix), faz upsert no Supabase e, num job final,
  commita os snapshots em `data/*.json`.
- **`Keep-alive`** (`.github/workflows/keepalive.yml`): backstop semanal.

### Por que os commits (keep-alive)

O GitHub desativa workflows agendados após **60 dias sem atividade** (commits do
`GITHUB_TOKEN` **não** contam). Por isso os workflows commitam via **deploy key
SSH** (`MENU_COMMIT_SSH_KEY`): cada execução (2x/semana) atualiza `data/*.json` +
`data/last-run.txt`, mantendo o repositório ativo automaticamente e ainda gerando
um histórico versionado dos cardápios.

### Secrets necessários (Settings → Secrets and variables → Actions)

| Secret | Uso |
| --- | --- |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_KEY` | chave com permissão de escrita na tabela `menus` (a anon key atende — RLS permite) |
| `MENU_COMMIT_SSH_KEY` | chave privada da deploy key (write) cadastrada no repositório |

Para regenerar a deploy key: `ssh-keygen -t ed25519 -N "" -f key`, cadastrar
`key.pub` em Settings → Deploy keys (com *write access*) e `key` como o secret.

## Snapshots

`data/<campus>.json` guarda o último cardápio gerado de cada campus (fonte de
verdade é o Supabase; os snapshots são histórico + mecanismo de keep-alive).

## Backtest

Os parsers são validados contra PDFs históricos com os mesmos invariantes da
validação pré-upsert (`src/lib/validate.ts`):

```bash
bun scripts/baixar-corpus.ts /tmp/corpus   # baixa todos os PDFs linkados nas páginas dos RUs
bun scripts/backtest.ts /tmp/corpus         # ✓/✗ por PDF + cobertura v2 (dias com pratos, ingredientes, alergênicos)
```
