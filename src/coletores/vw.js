// Volkswagen: wizard jQuery com sessão no servidor e sem token anti-CSRF,
// replicado com um cookie jar sobre o fetch. A VW publica 10 revisões: do 11
// em diante o site devolve de novo a 1ª (conferido em 28/10/2026).
import { UA } from './http.js';

const BASE = 'https://www.vwbr.com.br/revisao';
const PAGINA = 'https://www.vwbr.com.br/Revisao/';
const enc = encodeURIComponent;
const form = obj => Object.entries(obj).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');

function sessao(buscar) {
  const jar = {};
  return async function req(url, { method = 'GET', body, json } = {}) {
    const headers = { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' };
    const ck = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (ck) headers.Cookie = ck;
    if (body != null) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const res = await buscar(url, { method, headers, body });
    for (const linha of res.headers.getSetCookie?.() || []) {
      const par = linha.split(';')[0];
      const i = par.indexOf('=');
      if (i > 0) jar[par.slice(0, i).trim()] = par.slice(i + 1).trim();
    }
    if (!res.ok) throw new Error(`VW respondeu ${res.status} em ${url.replace(BASE, '')}`);
    return json ? res.json() : res.text();
  };
}

export async function coletar(p, buscar = fetch) {
  const { modelo, versao, ano, estado = 'SP', cidade = 'São Paulo', revisoes = 10 } = p;
  const req = sessao(buscar);

  await req(PAGINA);
  await req(`${BASE}/default/index`, { method: 'POST', body: form({ Mes: 1, Ano: ano }) });

  const versoes = await req(`${BASE}/default/getversao?Veiculo=${enc(modelo)}&Ano=${ano}`, { json: true });
  const v = versoes.find(x => x.Versao === versao);
  if (!v) throw new Error(`VW: versão "${versao}" não existe para ${modelo} ${ano}`);
  const ar = await req(`${BASE}/default/getar?Veiculo=${enc(modelo)}&Ano=${ano}&Versao=${enc(versao)}`, { json: true });

  const cidades = await req(`${BASE}/default/getcidades?estadoUF=${estado}`, { json: true });
  const cid = cidades.find(c => c.nome.toLowerCase() === cidade.toLowerCase());
  if (!cid) throw new Error(`VW: cidade ${cidade} não encontrada em ${estado}`);
  const reg = await req(`${BASE}/default/getregiao?cidadeID=${cid.idCidade}`, { json: true });

  const campos = {
    'data-mes': 1, 'data-ano': ano, AC: ar.VersaoComAr ? 'true' : 'false', Regiao: reg[0].localizacao.regiao,
    Veiculo: modelo, Ano: ano, Versao: `${v.Versao}|${v.ShowPlanoNovo}`, Estado: estado, Cidade: cid.nome,
  };
  await req(`${BASE}/default/regiao`, { method: 'POST', body: form(campos) });
  await req(`${BASE}/default/veiculo`, { method: 'POST', body: form(campos) });

  const itens = [];
  for (let n = 1; n <= revisoes; n++) {
    const r = await req(`${BASE}/default/getrevisao/${n}`, { method: 'POST', body: '', json: true });
    if (!r?.Data) throw new Error(`VW: ${n}ª revisão sem dados`);
    itens.push({ ordem: n, km: n * 10000, meses: null, valor: +(r.Data.total_ItensSubstituidos + r.Data.total_MaoDeObra).toFixed(2) });
  }
  return itens;
}
