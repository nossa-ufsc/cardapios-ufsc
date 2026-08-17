// Utilitários compartilhados do contrato v2 (`pratos`): classificação por
// palavra-chave (usada só onde a fonte NÃO rotula a seção), marcadores de
// refeição "(Almoço)/(Jantar)", declarações de alergênicos e casamento de nomes
// com listas de ingredientes.
//
// Princípio: quando a fonte traz rótulo estrutural (Trindade "Carne:", Araranguá
// coluna FIXO/CARNE, Curitibanos faixas SALADA/CARNE…), o rótulo VENCE. O
// classificador por palavra-chave é o fallback e devolve null quando não tem
// certeza — melhor "outro" que uma categoria errada.

import type { MenuAlergenos, MenuCategoria, MenuPrato, MenuRefeicao } from './types.js';

export const ORDEM_CATEGORIAS: MenuCategoria[] = [
  'base', 'carne', 'vegetariano', 'guarnicao', 'salada', 'molho', 'sobremesa', 'outro',
];

/** Minúsculas, sem acentos, espaços colapsados. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Classificação por palavra-chave ─────────────────────────────────────────
// Ordem importa: as regras mais específicas vêm antes das genéricas.

const REGRAS: [RegExp, MenuCategoria][] = [
  // salada / molho / sobremesa: bem delimitados
  [/^saladas?\b|^mix (de )?folhas|^folhas|^tabule|^vinagrete$|^salpicao|^maionese|^legumes? (cru|cozido)|^(alface|pepino|tomate|rucula|agriao|acelga|chicoria|rabanete|almeirao|escarola|espinafre|radicchio|couve|repolho|cenoura|beterraba|brocolis|couve flor|abobrinha|pimentao|cebola|palmito|milho|grao de bico|moranga|chuchu)( (ralad[ao]|cru[ao]|cozid[ao]|em cubos|picad[ao]|folha|roxo|verde|natural|fatiad[ao]|em rodelas|em tiras|com [a-z ]+|e [a-z ]+))?$/, 'salada'],
  [/^molho\b|^vinagrete\b|^azeite|^limao$/, 'molho'],
  [/^(fruta|frutas|pudim|docinho|doce|gelatina|iogurte|bombom|pacoca|pe de moleque|sagu|mousse|pave|bolo|sorvete|brigadeiro|arroz doce|canjica|cocada|banana|maca|laranja|mamao|melancia|melao|abacaxi|bergamota|ponkan|poka|morgote|tangerina|pera|uva|goiaba|manga|kiwi|caqui|elaborada)\b/, 'sobremesa'],
  // base fixa
  [/^arroz\b|^feijao (preto|carioca|vermelho|fradinho|com|de|mulatinho)|^feijao$|^feijoada|^feijoada vegetariana/, 'base'],
  // vegetariano / proteína vegetal
  [/vegetarian|vegan|\bpts\b|proteina (de )?(soja|vegetal|texturizada)|^soja\b|^lentilha|^grao de bico|^ervilha|^omelete|^tofu|^falafel|^hamburguer (de )?(soja|lentilha|grao)|^bolinho (de )?(lentilha|pts|soja|grao)|^quibe (de )?(abobora|soja)|^kibe (de )?(abobora|soja)|\bptn\b|^panqueca (de )?(pts|lentilha|soja|legumes)|^strogonoff (de )?(pts|soja|legumes)|^escondidinho (de )?(pts|soja|lentilha)/, 'vegetariano'],
  // carne (proteína animal)
  [/\b(frango|carne|bife|bisteca|peixe|almondega|almondegas|suin[ao]|porco|lombo|pernil|costela|linguic|salsich|coxa|sobrecoxa|sassami|file|isca|strogonoff|moida|quibe|kibe|hamburguer|bovin|acem|patinho|coxao|musculo|maminha|alcatra|picanha|cupim|paleta|chuleta|carre|copa|bacon|calabresa|entrevero|rocambole|shawarma|nuggets|empanad|tilapia|merluza|pescad|sardinha|atum|ovo|omelet|dobradinha|panqueca de carne|escondidinho de carne|churrasco|espetinho|galinha|peru|chester|steak|xadrez|parmegiana|milanesa)\b/, 'carne'],
  // guarnição / acompanhamento
  [/^(polenta|farofa|pure|batata|aipim|mandioca|macaxeira|pirao|legumes|macarrao|espaguete|nhoque|lasanha|panqueca|creme de|quirera|canja|sopa|abobora|cenoura|chuchu|couve|repolho|brocolis|couve flor|vagem|beterraba|milho|mandioquinha|inhame|cuscuz|risoto|talharim|penne|parafuso|fusilli|ravioli|torta|bolinho|quiche|suffle|sufle|escondidinho|moranga|banana da terra|angu|tutu|virado|arroz carreteiro|arroz a grega|salada de maionese|maionese|refogad|gratinad|sautee|saute|assad|frit|cozid)/, 'guarnicao'],
];

/**
 * Para itens que o classificador não resolveu, infere pela vizinhança na ordem
 * da fonte (tabelas sem rótulo, ex. Joinville, seguem sempre a mesma sequência:
 * base → carne → guarnição → vegetariano → molho → saladas → sobremesa).
 * Só preenche os casos inequívocos; o resto vira 'outro'.
 */
export function inferirPorVizinhos(cats: (MenuCategoria | null)[]): MenuCategoria[] {
  return cats.map((c, i) => {
    if (c) return c;
    const antes = cats.slice(0, i).reverse().find(Boolean) ?? null;
    const depois = cats.slice(i + 1).find(Boolean) ?? null;
    if (antes === 'carne' && (depois === 'vegetariano' || depois === 'molho' || depois === 'salada')) return 'guarnicao';
    if (antes === 'guarnicao' && (depois === 'molho' || depois === 'salada')) return 'vegetariano';
    if (antes === 'guarnicao' && depois === 'vegetariano') return 'guarnicao';
    if (antes === 'base' && depois === 'guarnicao') return 'carne';
    if (antes === 'salada' && depois === 'salada') return 'salada';
    if (antes === 'salada' && depois === null) return 'sobremesa';
    return 'outro';
  });
}

/**
 * Classifica um nome de prato pelo texto. Retorna null quando nenhuma regra bate —
 * quem chama decide o fallback (posição na tabela ou 'outro').
 */
export function classificarPorNome(nome: string): MenuCategoria | null {
  const n = normalizar(nome);
  if (!n) return null;
  for (const [re, cat] of REGRAS) if (re.test(n)) return cat;
  return null;
}

// ─── Refeição ────────────────────────────────────────────────────────────────

const RE_REFEICAO_SUFIXO = /\s*\((a|j|almo[çc]o|janta?r?)\)\s*$/i;

/**
 * Separador de alternativas dentro de uma célula ("Arroz branco / Feijão",
 * "Feijão com vegetais (A)/ Feijão preto (J)"). Exige espaço em pelo menos um
 * lado da barra ou um marcador "(A)/(J)" antes dela — assim "c/ molho" e
 * "Pokã/Morgote" continuam inteiros.
 */
export const SEPARADOR_ALTERNATIVAS = /(?<=\))\s*\/\s*|(?<!\bc)\s*\/\s+|\s+\/\s*/i;

/** "Feijão com vegetais (Almoço)" → { nome: "Feijão com vegetais", refeicao: 'almoco' }. */
export function extrairRefeicao(nome: string): { nome: string; refeicao?: MenuRefeicao } {
  const m = nome.match(RE_REFEICAO_SUFIXO);
  if (!m) return { nome: nome.trim() };
  return { nome: nome.replace(RE_REFEICAO_SUFIXO, '').trim(), refeicao: refeicaoDe(m[1]) };
}

export function refeicaoDe(texto: string): MenuRefeicao | undefined {
  const t = texto.trim().toLowerCase();
  if (/almo[çc]o/.test(t) || t === 'a') return 'almoco';
  if (/janta/.test(t) || t === 'j') return 'jantar';
  return undefined;
}

// ─── Alergênicos ─────────────────────────────────────────────────────────────

/**
 * Lê declarações explícitas num texto ("CONTÉM GLÚTEN: SIM", "contém lácteos",
 * "SEM ADIÇÃO INTENCIONAL DE ORIGEM ANIMAL", legenda "*CG"/"*CL" do Curitibanos).
 * Retorna undefined se não houver nenhuma.
 */
export function extrairAlergenos(texto: string): MenuAlergenos | undefined {
  const t = normalizar(texto);
  const out: MenuAlergenos = {};

  // "contem gluten sim" | "contem gluten nao" | "contem gluten" | "nao contem gluten".
  // Varre em sequência: numa célula "CONTÉM LÁCTEOS: NÃO CONTÉM GLÚTEN: SIM" o
  // "nao" é consumido pelo lácteos e NÃO vira negação do glúten.
  const re = /(nao )?contem (glute[nm]|lacteos|leite|lactose|derivados de leite)( sim| nao)?/g;
  for (const m of t.matchAll(re)) {
    const contem = !(m[1] || m[3] === ' nao');
    if (m[2].startsWith('glut')) out.gluten = contem;
    else out.lacteos = contem;
  }

  // Legenda Curitibanos no texto BRUTO: "*CG" = contém glúten, "*CL" = contém leite.
  if (/[*/]\s*CG\b|\bCG\s*\*/i.test(texto)) out.gluten = true;
  if (/[*/]\s*CL\b|\bCL\s*\*/i.test(texto)) out.lacteos = true;

  if (/sem adicao intencional de origem animal/.test(t)) out.origemAnimal = false;
  else if (/com adicao intencional de origem animal/.test(t)) out.origemAnimal = true;

  return Object.keys(out).length ? out : undefined;
}

/** Remove os marcadores de legenda "*CG"/"*CL" do nome (Curitibanos). */
export function limparMarcadores(nome: string): string {
  return nome
    .replace(/\s*[*/]\s*(c[gl]|t[gv])\b\*?/gi, '') // "*CL", "* CG", "/CL" (em "*CG/CL"), "*TG", "*TV"
    .replace(/\s*\bc[gl]\s*\*/gi, '') // "CL*"
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Casamento com listas de ingredientes ────────────────────────────────────

/**
 * Anexa `ingredientes` (e alergênicos declarados neles) aos pratos a partir de um
 * dicionário {nomeNormalizado → ingredientes} da fonte. Duas passadas: primeiro os
 * casamentos EXATOS (após singularizar), depois os parciais — prefixo/contido em
 * qualquer direção ("FRANGO ASSADO COM GERGELIM" na tabela vs "FRANGO ASSADO" na
 * lista) — sem reutilizar chaves já casadas exatamente (evita "Feijoada" pegar a
 * lista de "Feijoada vegetariana" quando esta também está no dia).
 */
export function anexarIngredientes(pratos: MenuPrato[], lista: Map<string, string> | undefined): MenuPrato[] {
  if (!lista || !pratos.length) return pratos;
  const chaves = Array.from(lista.keys()).map((k) => ({ original: k, sing: singularizar(k) }));
  const nomes = pratos.map((p) => singularizar(normalizar(p.nome)));
  const usadas = new Set<string>();
  const escolha: (string | undefined)[] = pratos.map(() => undefined);

  nomes.forEach((n, i) => {
    const hit = chaves.find((c) => c.sing === n);
    if (hit) {
      escolha[i] = hit.original;
      usadas.add(hit.original);
    }
  });
  nomes.forEach((n, i) => {
    if (escolha[i] || n.length < 5) return;
    let melhor: { original: string; sing: string } | null = null;
    for (const c of chaves) {
      if (usadas.has(c.original)) continue;
      const menor = c.sing.length < n.length ? c.sing : n;
      const maior = c.sing.length < n.length ? n : c.sing;
      if (menor.length < 5) continue;
      if (!maior.startsWith(menor + ' ') && !maior.includes(' ' + menor + ' ') && !maior.endsWith(' ' + menor)) continue;
      // Chave contida no nome ("Arroz integral" ⊃ "arroz"): só aceita se o que sobra
      // no nome for qualificador de preparo — "integral" muda o prato (e os
      // alergênicos), "cozida" não. Ingrediente errado é pior que ingrediente ausente.
      if (menor === c.sing && !soQualificadores(n, c.sing)) continue;
      // Entre candidatas, a mais curta é a mais próxima do nome (menos "extra").
      if (!melhor || c.sing.length < melhor.sing.length) melhor = c;
    }
    if (melhor) escolha[i] = melhor.original;
  });

  return pratos.map((p, i) => {
    const chave = escolha[i];
    if (!chave) return p;
    const ing = lista.get(chave)!;
    const alergenos = { ...(p.alergenos ?? {}), ...(extrairAlergenos(ing) ?? {}) };
    return prato({ ...p, ingredientes: ing, alergenos });
  });
}

const QUALIFICADORES = new Set([
  'cozido', 'cozida', 'assado', 'assada', 'refogado', 'refogada', 'frito', 'frita', 'grelhado', 'grelhada',
  'ralado', 'ralada', 'natural', 'simples', 'ao', 'forno', 'em', 'rodela', 'folha', 'com', 'erva', 'i', 'ii', 'iii',
  'de', 'da', 'do', 'e', 'parboilizado', 'branco',
]);

/** As palavras de `nome` que não estão em `chave` são só qualificadores de preparo? */
function soQualificadores(nome: string, chave: string): boolean {
  const base = new Set(chave.split(' '));
  return nome.split(' ').every((w) => base.has(w) || QUALIFICADORES.has(w));
}

/** "almondegas com azeitonas" → "almondega com azeitona" (plural simples, p/ casar nomes). */
function singularizar(s: string): string {
  return s
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');
}

/** Cria um MenuPrato omitindo chaves indefinidas (JSON limpo). */
export function prato(p: MenuPrato): MenuPrato {
  const out: MenuPrato = { nome: p.nome, categoria: p.categoria };
  if (p.refeicao) out.refeicao = p.refeicao;
  if (p.alergenos && Object.keys(p.alergenos).length) out.alergenos = p.alergenos;
  if (p.ingredientes) out.ingredientes = p.ingredientes;
  return out;
}
