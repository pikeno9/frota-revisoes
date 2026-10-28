// Anúncios da Mobiauto em SP: o JSON da página vem em <script id="__NEXT_DATA__">,
// em props.pageProps.deals. 24 por página; a página N é o caminho "/pagina-N"
// (o parâmetro ?page=N é ignorado pelo site, conferido em 28/10/2026).
import { pegar } from '../coletores/http.js';

export const POR_PAGINA = 24;
const BASE = 'https://www.mobiauto.com.br/comprar/carros/sp';
const espera = ms => new Promise(r => setTimeout(r, ms));

export const urlPagina = (caminho, n) => `${BASE}/${caminho}${n > 1 ? `/pagina-${n}` : ''}`;

export function lerPagina(html) {
  const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Mobiauto: página sem __NEXT_DATA__');
  const deals = JSON.parse(m[1])?.props?.pageProps?.deals;
  if (!deals || !Array.isArray(deals.results)) throw new Error('Mobiauto: página sem a lista de anúncios');
  return { numResults: Number(deals.numResults) || 0, results: deals.results };
}

// Só usados (sem deal0km), de ano-modelo >= anoMin, cuja versão casa com a expressão do modelo.
export function filtrar(results, { versao = null, anoMin }) {
  const re = versao ? new RegExp(versao, 'i') : null;
  return results
    .filter(r => !r.deal0km && Number(r.trim?.model?.year) >= anoMin && Number(r.price) > 0 && Number.isFinite(Number(r.km))
      && (!re || re.test(String(r.trim?.name ?? ''))))
    .map(r => ({
      id_externo: `mobiauto:${r.id}`, versao: r.trim.name, ano_modelo: Number(r.trim.model.year),
      ano_fabricacao: r.trim.productionYear == null ? null : Number(r.trim.productionYear),
      km: Math.round(Number(r.km)), preco: Number(r.price), loja: r.dealer?.name ?? null,
    }));
}

// Percorre as páginas até maxPaginas, até a página vir vazia ou até passar do total.
// Um anúncio que aparece em duas páginas conta uma vez.
export async function anuncios({ caminho, versao = null, anoMin, maxPaginas = 40, pausaMs = 2000 }, buscar = fetch) {
  const vistos = new Map();
  for (let n = 1; n <= maxPaginas; n++) {
    if (n > 1) await espera(pausaMs);
    const { numResults, results } = lerPagina(await pegar(buscar, urlPagina(caminho, n), 'Mobiauto', 'html'));
    if (!results.length) break;
    for (const a of filtrar(results, { versao, anoMin })) vistos.set(a.id_externo, a);
    if (n * POR_PAGINA >= numResults) break;
  }
  return [...vistos.values()];
}
