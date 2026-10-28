export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
export const TEMPO_LIMITE_MS = 30000;

export async function pegar(buscar, url, rotulo, tipo = 'json') {
  const r = await buscar(url, { headers: { 'User-Agent': UA, Accept: tipo === 'json' ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
  if (!r.ok) throw new Error(`${rotulo} respondeu ${r.status}`);
  return tipo === 'json' ? r.json() : r.text();
}
