// Coletor de preços de revisão da Volkswagen.
//
// O site vwbr.com.br/Revisao é um wizard jQuery com sessão no servidor, mas
// SEM token anti-CSRF nos endpoints AJAX — então dá para replicar headless
// com um cookie jar simples. Sequência por modelo:
//   GET  /Revisao/                       → cria a sessão (cookie)
//   POST default/index {Mes,Ano}         → habilita os modelos da data de entrega
//   GET  default/getversao               → descobre o sufixo ShowPlanoNovo da versão
//   GET  default/getar                   → descobre se a versão é com ar
//   GET  default/getcidades / getregiao  → idCidade e código de região
//   POST default/regiao {form}           → fixa a região na sessão
//   POST default/veiculo {form}          → fixa o veículo na sessão
//   POST default/getrevisao/{1..10}      → JSON; preço = itens + mão de obra
//
// Preços dependem de localização → usamos São Paulo/SP (configurável abaixo).
//
// Uso:
//   node scrape-vw.js          → coleta e envia para API_URL
//   node scrape-vw.js --dry    → coleta e só imprime

import { enviar } from './ingest.js';

const BASE = 'https://www.vwbr.com.br/revisao';
const PAGINA = 'https://www.vwbr.com.br/Revisao/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Localização da cotação. SP/São Paulo conforme definido para a frota.
const ESTADO = 'SP';
const CIDADE = 'São Paulo';

// Modelos da frota na VW. `modelo`/`versaoBase` = como o site os chama;
// `appModelo` = como está no nosso banco.
const ALVOS = [
  { modelo: 'Polo Track', versaoBase: '1.0 MPI', ano: 2026, appModelo: 'Polo Track' },
  { modelo: 'Tera',       versaoBase: '1.0 MPI', ano: 2026, appModelo: 'Tera' },
];

// ── cookie jar mínimo sobre o fetch nativo ──
function criarSessao() {
  const jar = {};
  const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const guardar = res => {
    for (const linha of (res.headers.getSetCookie?.() || [])) {
      const par = linha.split(';')[0];
      const i = par.indexOf('=');
      if (i > 0) jar[par.slice(0, i).trim()] = par.slice(i + 1).trim();
    }
  };
  async function req(url, { method = 'GET', body, json } = {}) {
    const headers = { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' };
    const ck = cookieHeader();
    if (ck) headers['Cookie'] = ck;
    if (body != null) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const res = await fetch(url, { method, headers, body });
    guardar(res);
    if (!res.ok) throw new Error(`${res.status} em ${url}`);
    return json ? res.json() : res.text();
  }
  return { req };
}

const enc = encodeURIComponent;
const form = obj => Object.entries(obj).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');

async function coletarModelo(alvo) {
  const { modelo, versaoBase, ano } = alvo;
  const s = criarSessao();

  await s.req(PAGINA);                                              // sessão
  await s.req(`${BASE}/default/index`, { method: 'POST', body: form({ Mes: 1, Ano: ano }) });

  const versoes = await s.req(`${BASE}/default/getversao?Veiculo=${enc(modelo)}&Ano=${ano}`, { json: true });
  const vObj = versoes.find(v => v.Versao === versaoBase) || versoes[0];
  const versaoVal = `${vObj.Versao}|${vObj.ShowPlanoNovo}`;

  const ar = await s.req(`${BASE}/default/getar?Veiculo=${enc(modelo)}&Ano=${ano}&Versao=${enc(versaoBase)}`, { json: true });
  const ac = ar.VersaoComAr ? 'true' : 'false';

  const cidades = await s.req(`${BASE}/default/getcidades?estadoUF=${ESTADO}`, { json: true });
  const cid = cidades.find(c => c.nome.toLowerCase() === CIDADE.toLowerCase());
  if (!cid) throw new Error(`cidade ${CIDADE} não encontrada em ${ESTADO}`);
  const reg = await s.req(`${BASE}/default/getregiao?cidadeID=${cid.idCidade}`, { json: true });
  const regiao = reg[0].localizacao.regiao;

  const campos = {
    'data-mes': 1, 'data-ano': ano, AC: ac, Regiao: regiao,
    Veiculo: modelo, Ano: ano, Versao: versaoVal, Estado: ESTADO, Cidade: cid.nome,
  };
  await s.req(`${BASE}/default/regiao`, { method: 'POST', body: form(campos) });
  await s.req(`${BASE}/default/veiculo`, { method: 'POST', body: form(campos) });

  const revs = [];
  for (let n = 1; n <= 10; n++) {
    const r = await s.req(`${BASE}/default/getrevisao/${n}`, { method: 'POST', body: '', json: true });
    const d = r.Data;
    const valor = +(d.total_ItensSubstituidos + d.total_MaoDeObra).toFixed(2);
    revs.push({ ordem: n, km: n * 10000, valor });
  }
  return revs;
}

async function coletar() {
  const itens = [];
  for (const alvo of ALVOS) {
    try {
      const revs = await coletarModelo(alvo);
      console.log(`✓ ${alvo.appModelo}: ${revs.length} revisões`);
      for (const r of revs) {
        itens.push({
          montadora: 'Volkswagen',
          modelo: alvo.appModelo,
          revisao: `${r.ordem}ª revisão (${r.km.toLocaleString('pt-BR')} km)`,
          valor: r.valor,
        });
      }
    } catch (e) {
      console.warn(`✗ ${alvo.appModelo}: ${e.message}`);
    }
  }
  return itens;
}

async function main() {
  const itens = await coletar();
  console.log(`\nTotal: ${itens.length} preços coletados.`);
  if (process.argv.includes('--dry')) { console.log(JSON.stringify(itens, null, 2)); return; }
  console.log('API:', await enviar(itens, 'scraper-vw'));
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
