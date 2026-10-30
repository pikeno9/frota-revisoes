// Anúncios da NaPista em SP: o JSON da busca vem em <script id="__NEXT_DATA__">, em
// props.pageProps.searchResult (offers e offersTotal). 48 por página; a página N é ?pn=N.
// O caminho vai sem o ano e o ano entra como /<ano>: a busca por ano é a que corta o total
// para dezenas ou centenas (conferido em 29/10/2026). A página do anúncio (/anuncios/) não é lida.
import { pegarComEspera } from './http.js';
import { tipoVendedor } from './vendedor.js';

export const POR_PAGINA = 48;
const BASE = 'https://napista.com.br/busca';
const espera = ms => new Promise(r => setTimeout(r, ms));

export const urlBusca = (caminho, ano, n = 1) => `${BASE}/${caminho}/${ano}${n > 1 ? `?pn=${n}` : ''}`;
export const urlAnuncio = id => `https://napista.com.br/anuncios/${id}`;

export function lerPagina(html) {
  const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('NaPista: página sem __NEXT_DATA__');
  const r = JSON.parse(m[1])?.props?.pageProps?.searchResult;
  if (!r || !Array.isArray(r.offers)) throw new Error('NaPista: página sem a lista de anúncios');
  return { total: Number(r.offersTotal) || 0, offers: r.offers };
}

// Só usados, de ano-modelo >= anoMin, cuja versão (nome completo, com marca e modelo) casa com a expressão.
// A busca traz também modelos parecidos (o Mobi na do Argo, o T-Cross na do Tera): a expressão separa.
export function filtrar(offers, { versao = null, anoMin }) {
  const re = versao ? new RegExp(versao, 'i') : null;
  return offers
    .filter(o => !o.newVehicle && o.id != null && Number(o.modelYear) >= anoMin
      && Number(o.price) > 0 && o.mileage != null && Number.isFinite(Number(o.mileage)) && Number(o.mileage) >= 0
      && (!re || re.test(String(o.versionName ?? ''))))
    .map(o => ({
      id_externo: `napista:${o.id}`, versao: o.versionName, ano_modelo: Number(o.modelYear),
      ano_fabricacao: o.manufacturedYear == null ? null : Number(o.manufacturedYear),
      km: Math.round(Number(o.mileage)), preco: Number(o.price), loja: o.seller ?? null,
      tipo_vendedor: tipoVendedor(o.seller, true), cidade: o.location?.city ?? null,
      url: urlAnuncio(o.id), leilao: null,
    }));
}

// Um ano por vez, de anoMin a anoMax, página por página até a vazia ou até passar do total.
export async function anuncios({ caminho, versao = null, anoMin, anoMax, maxPaginas = 20, pausaMs = 2000, esperaMs = 30000 }, buscar = fetch) {
  const vistos = new Map();
  let primeira = true;
  for (let ano = anoMin; ano <= anoMax; ano++) {
    for (let n = 1; n <= maxPaginas; n++) {
      if (!primeira) await espera(pausaMs);
      primeira = false;
      const { total, offers } = lerPagina(await pegarComEspera(buscar, urlBusca(caminho, ano, n), 'NaPista', 'html', { esperaMs }));
      if (!offers.length) break;
      for (const a of filtrar(offers, { versao, anoMin })) vistos.set(a.id_externo, a);
      if (n * POR_PAGINA >= total) break;
    }
  }
  return [...vistos.values()];
}
