// Camada de rede. Replica o comportamento padrão do `requests` do Python:
// segue redirects (as URLs *.paginas.ufsc.br respondem 301 http→https) e usa
// um User-Agent de browser (alguns sites da UFSC variam a resposta por UA).

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Sites da UFSC podem ser lentos a partir dos runners do GitHub (EUA) — timeout
// generoso e retry com backoff para absorver instabilidade transitória.
const TIMEOUT_MS = 60_000;
const TENTATIVAS = 3;

async function request(url: string): Promise<Response> {
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return res;
      // 5xx/429 valem retry; 4xx não vai melhorar.
      if (res.status < 500 && res.status !== 429) {
        throw new Error(`GET ${url} -> HTTP ${res.status}`);
      }
      ultimoErro = new Error(`GET ${url} -> HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof Error && /-> HTTP 4/.test(e.message)) throw e;
      ultimoErro = e;
    }
    if (tentativa < TENTATIVAS) {
      console.error(`⚠ Tentativa ${tentativa}/${TENTATIVAS} falhou para ${url}; aguardando…`);
      await new Promise((r) => setTimeout(r, 5_000 * tentativa));
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error(String(ultimoErro));
}

/** Baixa uma página HTML como texto (fetch já descomprime gzip/br). */
export async function fetchHtml(url: string): Promise<string> {
  const res = await request(url);
  return res.text();
}

/** Baixa um binário (PDF/imagem) como Uint8Array, pronto para o pdf.js. */
export async function fetchBinary(url: string): Promise<Uint8Array> {
  const res = await request(url);
  return new Uint8Array(await res.arrayBuffer());
}
