# Cardápios UFSC

Raspagem dos cardápios dos Restaurantes Universitários da UFSC, executada
**inteiramente no GitHub Actions** (TypeScript + Bun) — sem Python e sem servidor
web/Render. Cada campus é raspado, parseado e persistido via `upsert` na tabela
`menus` do Supabase (uma linha por campus), consumida pelo app.

## Campi e fontes

| Campus (`campus` no Supabase) | Fonte | Formato |
| --- | --- | --- |
| `florianopolis` (Trindade) | `ru.ufsc.br/ru/` | PDF (texto) |
| `joinville` | `restaurante.joinville.ufsc.br/cardapio-da-semana/` | PDF (tabela) |
| `ararangua` | `ara.ufsc.br/ru/` | PDF (tabela) |
| `curitibanos` | `ru.curitibanos.ufsc.br/cardapio` | PDF mensal (tabela) |
| `blumenau` | `ru.blumenau.ufsc.br/cardapios/` | Imagem PNG |

O parsing de PDF usa [`unpdf`](https://github.com/unjs/unpdf) (pdf.js): texto corrido
para o Trindade e **reconstrução de tabela por coordenadas** para os demais — sem
dependências nativas (ghostscript/opencv), o que roda direto no runner do Actions.

## Formato de saída (contrato com o app)

```ts
interface MenuItem { dia: string; data: string; itens: string[] }
interface Menu {
  cardapio: MenuItem[] | { url_imagem: string }; // imagem só no Blumenau
  diaInicial: string | null;                     // dd/mm/yyyy
  diaFinal: string | null;                       // dd/mm/yyyy
}
```

Campi não-imagem emitem exatamente 7 dias (Segunda→Domingo). Não altere este
formato sem atualizar o app (`features/menu/hooks/use-menu.ts`).

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

Campi válidos: `florianopolis` (ou `trindade`), `joinville`, `ararangua`,
`curitibanos`, `blumenau`.

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
