import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, servidor } from './ajuda.js';
import { semearRevenda } from './sinteticos.js';
import { criarApp } from '../src/app.js';
import { gerarHash, tokenConfere } from '../src/auth.js';
import { recalcularEstudos } from '../src/revenda/dados.js';

const HOJE = '2026-10-28';
const ENV = { ADMIN_SENHA_HASH: gerarHash('certa'), SESSION_SECRET: 'segredo-de-teste', REVENDA_TOKEN: 'token-do-kpis' };
const JSON_ = { 'Content-Type': 'application/json' };

async function subir({ env = ENV, semear = true, deps = {} } = {}) {
  const db = bancoNovo();
  if (semear) { semearRevenda(db, HOJE); recalcularEstudos(db, HOJE); }
  const s = await servidor(criarApp({ db, env, deps: { coletores: {}, buscarFrota: null, enviar: null, hoje: () => HOJE, ...deps } }));
  const r = await fetch(`${s.url}/api/entrar`, { method: 'POST', headers: JSON_, body: JSON.stringify({ usuario: 'enrico', senha: 'certa' }) });
  return { db, ...s, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const PROJ = '/api/revenda/projecao?modelo=polo-track&meses=12&km=70000&canal=atacado';

test('tokenConfere: só com Bearer exato e token configurado', () => {
  assert.equal(tokenConfere('Bearer abc', 'abc'), true);
  assert.equal(tokenConfere('bearer abc', 'abc'), true);
  assert.equal(tokenConfere('Bearer abcd', 'abc'), false);
  assert.equal(tokenConfere('abc', 'abc'), false);
  assert.equal(tokenConfere('Bearer abc', undefined), false);
  assert.equal(tokenConfere('Bearer abc', ''), false);
  assert.equal(tokenConfere(undefined, 'abc'), false);
});

test('sem login tudo da Revenda dá 401', async () => {
  const { url, fechar } = await subir();
  for (const [m, c] of [['GET', PROJ], ['GET', '/api/revenda/modelos'], ['GET', '/api/revenda/modelos/polo-track'], ['PATCH', '/api/revenda/modelos/1'],
    ['GET', '/api/revenda/premissas'], ['PUT', '/api/revenda/premissas'], ['GET', '/api/revenda/vendas'], ['POST', '/api/revenda/vendas']]) {
    const r = await fetch(url + c, { method: m, headers: JSON_, body: m === 'GET' ? undefined : '{}' });
    assert.equal(r.status, 401, `${m} ${c}`);
  }
  await fechar();
});

test('token do KPIs abre só a projeção', async () => {
  const { url, fechar } = await subir();
  const bearer = t => ({ Authorization: `Bearer ${t}` });
  const r = await fetch(url + PROJ, { headers: bearer('token-do-kpis') });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const j = await r.json();
  assert.equal(j.modelo, 'polo-track');
  assert.ok(j.p10.nominal < j.p50.nominal && j.p50.nominal < j.p90.nominal);
  assert.equal(j.insumos.data_estudo, HOJE);
  assert.equal(j.insumos.n_anuncios, 60);
  assert.deepEqual(j.insumos.premissas, { atacado_pct_base: 85, motorista_pct_base: 100, varejo_negociacao_pct: 5 });
  assert.equal((await fetch(url + PROJ, { headers: bearer('errado') })).status, 401);
  assert.equal((await fetch(`${url}/api/revenda/modelos`, { headers: bearer('token-do-kpis') })).status, 401);
  assert.equal((await fetch(`${url}/api/revenda/vendas`, { headers: bearer('token-do-kpis') })).status, 401);
  // O token não vale para escrever, nem na própria rota da projeção.
  assert.equal((await fetch(`${url}/api/revenda/premissas`, { method: 'PUT', headers: { ...JSON_, ...bearer('token-do-kpis') }, body: '{"atacado_pct_base":1}' })).status, 401);
  await fechar();
});

test('sem REVENDA_TOKEN nenhum Bearer passa', async () => {
  const { url, fechar } = await subir({ env: { ...ENV, REVENDA_TOKEN: '' } });
  assert.equal((await fetch(url + PROJ, { headers: { Authorization: 'Bearer ' } })).status, 401);
  assert.equal((await fetch(url + PROJ, { headers: { Authorization: 'Bearer token-do-kpis' } })).status, 401);
  await fechar();
});

test('projeção logado: validação, preço informado e interpolação', async () => {
  const { url, cookie, fechar } = await subir();
  const get = c => fetch(url + c, { headers: { Cookie: cookie } });
  const ok = await (await get('/api/revenda/projecao?modelo=polo-track&meses=12&km=40000&canal=motorista&preco=100000')).json();
  assert.ok(Math.abs(ok.p50.pct - 0.99 ** 12) < 1e-6, 'motorista a 100% e km no típico: % = r_12');
  assert.equal(ok.preco, 100000);
  assert.equal(ok.preco_informado, true);
  const nove = await (await get('/api/revenda/projecao?modelo=polo-track&meses=9&km=30000&canal=motorista&preco=100000')).json();
  assert.ok(Math.abs(nove.p50.pct - (0.99 ** 6 + 0.99 ** 12) / 2) < 1e-6, 'aos 9 meses o km de referência é 40.000 × 9 / 12 = 30.000');
  assert.equal(nove.insumos.km_referencia, 30000);
  assert.equal((await get('/api/revenda/projecao?modelo=polo-track&km=40000&canal=motorista')).status, 200, 'sem meses vale 12');
  for (const [c, s] of [['meses=&km=1', 400], ['meses=30&km=1', 400], ['meses=12&km=1&canal=leilao', 400], ['meses=12', 400], ['meses=12&km=1&preco=-5', 400],
    ['meses=12&km=-1', 400], ['meses=12&km=abc', 400], ['meses=1.5&km=1', 400], ['meses=12&km=1&preco=abc', 400]]) {
    const r = await get(`/api/revenda/projecao?modelo=polo-track&${c}`);
    assert.equal(r.status, s, c);
    assert.equal(typeof (await r.json()).erro, 'string', c);
  }
  assert.equal((await get('/api/revenda/projecao?modelo=nada&km=1')).status, 404);
  await fechar();
});

test('projeção devolve o que o estudo emprestou, sem NaN', async () => {
  const { url, cookie, fechar } = await subir();
  const j = await (await fetch(`${url}${PROJ}`, { headers: { Cookie: cookie } })).json();
  for (const k of ['r_emprestado', 'km_emprestado', 'km_tipico', 'fator_10mil', 'referencia_fipe']) assert.ok(k in j.insumos, k);
  assert.equal(j.insumos.km_emprestado, false);
  assert.equal(j.insumos.km_tipico, 40000);
  const texto = JSON.stringify(j);
  assert.ok(!texto.includes('NaN'));
  await fechar();
});

test('estudo sem prazo ou sem preço dá erro JSON, nunca número nulo', async () => {
  const { url, cookie, db, fechar } = await subir();
  const polo = db.prepare("SELECT id FROM modelos WHERE slug = 'polo-track'").get().id;
  const e = db.prepare('SELECT id, dados FROM estudos WHERE modelo_id = ?').get(polo);
  const d = JSON.parse(e.dados);
  d.r = { 6: null, 12: null, 18: null, 24: null };
  db.prepare('UPDATE estudos SET dados = ? WHERE id = ?').run(JSON.stringify(d), e.id);
  const r = await fetch(`${url}${PROJ}`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 422);
  assert.equal(typeof (await r.json()).erro, 'string');
  d.r = JSON.parse(e.dados).r;
  d.fipe_0km_atual = null;
  db.prepare('UPDATE estudos SET dados = ? WHERE id = ?').run(JSON.stringify(d), e.id);
  const sem = await fetch(`${url}${PROJ}`, { headers: { Cookie: cookie } });
  assert.equal(sem.status, 422);
  const com = await fetch(`${url}${PROJ}&preco=80000`, { headers: { Cookie: cookie } });
  assert.equal(com.status, 200);
  await fechar();
});

test('modelo sem estudo dá 404 na projeção', async () => {
  const { url, cookie, fechar } = await subir({ semear: false });
  const r = await fetch(`${url}${PROJ}`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).erro, 'modelo sem estudo');
  await fechar();
});

test('lista e detalhe dos modelos', async () => {
  const { url, cookie, fechar } = await subir();
  const lista = await (await fetch(`${url}/api/revenda/modelos`, { headers: { Cookie: cookie } })).json();
  assert.equal(lista.length, 6);
  const polo = lista.find(m => m.slug === 'polo-track');
  assert.equal(polo.n_anuncios, 60);
  assert.equal(polo.data_estudo, HOJE);
  assert.ok(polo.p50_12m['30000'] > polo.p50_12m['70000']);
  assert.deepEqual([polo.origem_r12, polo.ref_nome], [null, null]);
  for (const m of lista) assert.ok([null, 'ref', 'outros'].includes(m.origem_r12), m.slug);
  for (const m of lista.filter(x => x.origem_r12 === 'ref')) assert.ok(m.ref_codigo, m.slug);
  const d = await (await fetch(`${url}/api/revenda/modelos/polo-track`, { headers: { Cookie: cookie } })).json();
  assert.equal(d.serie_fipe.length, 36);
  assert.deepEqual(Object.keys(d.serie_fipe[0]), ['referencia', 'zero_km', 'ano_anterior']);
  assert.equal(d.anuncios.length, 60);
  assert.equal(d.estudo.km.km_tipico, 40000);
  assert.equal(d.parametros.mobiauto_versao, '^Track');
  assert.equal((await fetch(`${url}/api/revenda/modelos/nada`, { headers: { Cookie: cookie } })).status, 404);
  await fechar();
});

test('premissas: fora de 0 a 200, texto ou chave desconhecida dão 400', async () => {
  const { url, cookie, db, fechar } = await subir();
  const put = corpo => fetch(`${url}/api/revenda/premissas`, { method: 'PUT', headers: { ...JSON_, Cookie: cookie }, body: JSON.stringify(corpo) });
  for (const corpo of [{ atacado_pct_base: 250 }, { atacado_pct_base: -1 }, { atacado_pct_base: '80' }, { outra: 5 }, {}]) {
    assert.equal((await put(corpo)).status, 400, JSON.stringify(corpo));
  }
  const r = await put({ atacado_pct_base: 80 });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).premissas.find(p => p.chave === 'atacado_pct_base').valor, 80);
  assert.equal(db.prepare("SELECT valor FROM premissas WHERE chave = 'varejo_negociacao_pct'").get().valor, 5);
  const g = await (await fetch(`${url}/api/revenda/premissas`, { headers: { Cookie: cookie } })).json();
  assert.equal(g.premissas.length, 3);
  assert.equal(g.modelos.length, 6);
  await fechar();
});

test('escritas da Revenda só aceitam JSON (415)', async () => {
  const { url, cookie, fechar } = await subir();
  const h = { 'Content-Type': 'text/plain', Cookie: cookie };
  assert.equal((await fetch(`${url}/api/revenda/premissas`, { method: 'PUT', headers: h, body: '{}' })).status, 415);
  assert.equal((await fetch(`${url}/api/revenda/vendas`, { method: 'POST', headers: h, body: '{}' })).status, 415);
  assert.equal((await fetch(`${url}/api/revenda/modelos/1`, { method: 'PATCH', headers: h, body: '{}' })).status, 415);
  await fechar();
});

test('parâmetros FIPE e Mobiauto de um modelo', async () => {
  const { url, cookie, db, fechar } = await subir();
  const id = db.prepare("SELECT id FROM modelos WHERE slug = 'byd-king'").get().id;
  const patch = corpo => fetch(`${url}/api/revenda/modelos/${id}`, { method: 'PATCH', headers: { ...JSON_, Cookie: cookie }, body: JSON.stringify(corpo) });
  assert.equal((await patch({ mobiauto_versao: '([' })).status, 400);
  assert.equal((await patch({ fipe_combustivel: 1 })).status, 400);
  assert.equal((await patch({ mobiauto_caminho: 'BYD King' })).status, 400);
  assert.equal((await patch({ outra: 1 })).status, 400);
  assert.equal((await patch({ fipe_modelo_ref: 12122, mobiauto_versao: '^GL' })).status, 200);
  const m = db.prepare('SELECT fipe_modelo, fipe_modelo_ref, mobiauto_versao FROM modelos WHERE id = ?').get(id);
  assert.deepEqual({ ...m }, { fipe_modelo: 11078, fipe_modelo_ref: 12122, mobiauto_versao: '^GL' });
  const r = await fetch(`${url}/api/revenda/modelos/abc`, { method: 'PATCH', headers: { ...JSON_, Cookie: cookie }, body: '{}' });
  assert.equal(r.status, 404);
  await fechar();
});

test('vendas: registra, recusa inválida e lista com o previsto', async () => {
  const { url, cookie, fechar } = await subir();
  const post = corpo => fetch(`${url}/api/revenda/vendas`, { method: 'POST', headers: { ...JSON_, Cookie: cookie }, body: JSON.stringify(corpo) });
  const venda = { placa: 'abc-1d23', modelo: 'polo-track', data: HOJE, km: 40000, preco: 70000, canal: 'motorista' };
  assert.equal((await post(venda)).status, 201);
  for (const ruim of [{ placa: 'X1' }, { modelo: 'nada' }, { data: '2026-13-01' }, { data: '2026-02-31' }, { data: '2025-02-29' },{ data: '2030-01-01' }, { km: -1 }, { preco: 10 }, { canal: 'leilao' }]) {
    assert.equal((await post({ ...venda, ...ruim })).status, 400, JSON.stringify(ruim));
  }
  const lista = await (await fetch(`${url}/api/revenda/vendas`, { headers: { Cookie: cookie } })).json();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].placa, 'ABC1D23');
  const previsto = Math.round(100000 * 0.99 ** 10 * 0.99 ** 12);
  assert.ok(Math.abs(lista[0].previsto - previsto) <= 1, `${lista[0].previsto} ≈ ${previsto}`);
  assert.ok(Math.abs(lista[0].diferenca - (70000 - lista[0].previsto) / lista[0].previsto) < 1e-12);
  await fechar();
});

test('botão Coletar agora não roda a Revenda', async () => {
  let chamou = false;
  const revenda = { ipca: { serie: async () => { chamou = true; return []; } } };
  const { url, cookie, fechar } = await subir({ deps: { revenda } });
  const r = await fetch(`${url}/api/coletas`, { method: 'POST', headers: { ...JSON_, Cookie: cookie }, body: '{}' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).revenda, null);
  assert.equal(chamou, false);
  await fechar();
});

test('telas da Revenda abrem a casca do front', async () => {
  const { url, fechar } = await subir({ semear: false });
  for (const c of ['/revenda', '/revenda/simulador', '/revenda/premissas', '/revenda/vendas', '/revenda/polo-track']) {
    const r = await fetch(url + c);
    assert.equal(r.status, 200, c);
    assert.match(await r.text(), /<main id="tela"/);
  }
  await fechar();
});
