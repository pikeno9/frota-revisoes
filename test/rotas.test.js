import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, servidor } from './ajuda.js';
import { criarApp } from '../src/app.js';
import { gerarHash, criarSessao, lerSessao } from '../src/auth.js';

const ENV = { ADMIN_SENHA_HASH: gerarHash('certa'), SESSION_SECRET: 'segredo-de-teste', REVENDA_TOKEN: 'token-do-kpis' };
const deps = { coletores: { byd: { coletar: async () => [{ ordem: 1, km: 12000, meses: 12, valor: 926 }], catalogo: async () => [{ rotulo: 'BYD King', parametros: { nome: 'BYD King' } }] } }, buscarFrota: null, enviar: null };
const JSON_ = { 'Content-Type': 'application/json' };

async function subir(estado = {}) {
  const db = bancoNovo();
  const s = await servidor(criarApp({ db, estado, env: ENV, deps }));
  return { db, ...s };
}
async function entrar(url, usuario = 'enrico', senha = 'certa') {
  const r = await fetch(`${url}/api/entrar`, { method: 'POST', headers: JSON_, body: JSON.stringify({ usuario, senha }) });
  return r.headers.get('set-cookie').split(';')[0];
}

test('sessão assinada leva id e versão, expira e não aceita adulteração', () => {
  const v = criarSessao({ id: 7, sessao_versao: 2 }, 's', 1000);
  assert.deepEqual(lerSessao(v, 's', 2000), { id: 7, versao: 2 });
  assert.equal(lerSessao(v, 'outro', 2000), null);
  assert.equal(lerSessao(`1${v.slice(1)}`, 's', 2000), null);
  assert.equal(lerSessao(v, 's', 1000 + 8 * 864e5), null);
});

test('sem login, as leituras do site dão 401', async () => {
  const { url, fechar } = await subir();
  for (const c of ['/api/modelos', '/api/modelos/byd-king', '/api/comparar', '/api/mudancas', '/api/coletas/estado', '/api/veiculos', '/api/precos']) {
    assert.equal((await fetch(url + c)).status, 401, c);
  }
  await fechar();
});

test('logado, as leituras respondem', async () => {
  const { url, fechar } = await subir();
  const cookie = await entrar(url);
  const r = await fetch(`${url}/api/modelos`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).length, 6);
  assert.equal((await fetch(`${url}/api/modelos/nada`, { headers: { Cookie: cookie } })).status, 404);
  await fechar();
});

test('o KPIs lê veículos e preços com o token; token errado dá 401', async () => {
  const { url, fechar } = await subir();
  const com = t => ({ headers: { Authorization: `Bearer ${t}` } });
  assert.equal((await fetch(`${url}/api/veiculos`, com('token-do-kpis'))).status, 200);
  assert.equal((await fetch(`${url}/api/precos`, com('token-do-kpis'))).status, 200);
  assert.equal((await fetch(`${url}/api/precos`, com('outro'))).status, 401);
  assert.equal((await fetch(`${url}/api/modelos`, com('token-do-kpis'))).status, 401, 'o token só vale para o KPIs');
  await fechar();
});

test('escrita sem login dá 401; rotas antigas de escrita sumiram', async () => {
  const { url, fechar } = await subir();
  for (const [m, c] of [['POST', '/api/modelos'], ['PATCH', '/api/modelos/1'], ['POST', '/api/coletas'], ['POST', '/api/testar'], ['GET', '/api/catalogo/byd']]) {
    assert.equal((await fetch(url + c, { method: m, headers: JSON_, body: m === 'GET' ? undefined : '{}' })).status, 401, `${m} ${c}`);
  }
  for (const [m, c] of [['POST', '/api/veiculos'], ['DELETE', '/api/veiculos/1'], ['POST', '/api/precos'], ['DELETE', '/api/precos/1'], ['POST', '/api/ingest']]) {
    assert.equal((await fetch(url + c, { method: m })).status, 404, `${m} ${c}`);
  }
  await fechar();
});

test('senha errada não entra; certa entra e cadastra candidato', async () => {
  const { url, db, fechar } = await subir();
  const errada = await fetch(`${url}/api/entrar`, { method: 'POST', headers: JSON_, body: JSON.stringify({ usuario: 'enrico', senha: 'x' }) });
  assert.equal(errada.status, 401);
  const cookie = await entrar(url);
  const r = await fetch(`${url}/api/modelos`, { method: 'POST', headers: { ...JSON_, Cookie: cookie }, body: JSON.stringify({ montadora: 'BYD', nome: 'Seal', coletor: 'byd', parametros: { nome: 'BYD Seal' } }) });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).slug, 'byd-seal');
  assert.equal(db.prepare("SELECT origem FROM modelos WHERE slug = 'byd-seal'").get().origem, 'candidato');
  const t = await fetch(`${url}/api/testar`, { method: 'POST', headers: { ...JSON_, Cookie: cookie }, body: JSON.stringify({ coletor: 'byd', parametros: { nome: 'BYD King' } }) });
  assert.equal((await t.json()).itens.length, 1);
  await fechar();
});

test('reenviar alertas sem login dá 401', async () => {
  const { url, fechar } = await subir();
  assert.equal((await fetch(`${url}/api/alertas/reenviar`, { method: 'POST' })).status, 401);
  await fechar();
});

test('entrada malformada devolve JSON, nunca HTML', async () => {
  const { url, fechar } = await subir();
  const r = await fetch(`${url}/api/entrar`, { method: 'POST', headers: JSON_, body: '{x' });
  assert.equal(r.status, 400);
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.equal((await r.json()).erro, 'requisição inválida');
  await fechar();
});

test('cookie com escape inválido vale como deslogado', async () => {
  const { url, fechar } = await subir();
  const r = await fetch(`${url}/api/modelos?todos=1`, { headers: { Cookie: 'precos_sessao=%E0%A4%A' } });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('content-type'), /application\/json/);
  await fechar();
});

test('seis senhas erradas seguidas travam o login, até a certa', async () => {
  const { url, fechar } = await subir();
  const tentar = senha => fetch(`${url}/api/entrar`, { method: 'POST', headers: JSON_, body: JSON.stringify({ usuario: 'enrico', senha }) });
  for (let i = 1; i <= 5; i++) assert.equal((await tentar('errada')).status, 401, `tentativa ${i}`);
  const sexta = await tentar('errada');
  assert.equal(sexta.status, 429);
  assert.equal((await sexta.json()).erro, 'muitas tentativas');
  assert.equal((await tentar('certa')).status, 429);
  await fechar();
});

test('tentativas em paralelo contam na hora', async () => {
  const { url, fechar } = await subir();
  const tentar = () => fetch(`${url}/api/entrar`, { method: 'POST', headers: JSON_, body: JSON.stringify({ usuario: 'enrico', senha: 'errada' }) });
  const status = (await Promise.all(Array.from({ length: 8 }, tentar))).map(r => r.status);
  status.push((await tentar()).status);
  assert.ok(status.filter(s => s === 429).length >= 3, status.join(','));
  await fechar();
});

test('corpo grande demais responde 413 em JSON', async () => {
  const { url, fechar } = await subir();
  const r = await fetch(`${url}/api/entrar`, { method: 'POST', headers: JSON_, body: JSON.stringify({ senha: 'x'.repeat(200000) }) });
  assert.equal(r.status, 413);
  assert.equal((await r.json()).erro, 'requisição grande demais');
  await fechar();
});

test('modelo inativo aparece no detalhe para quem está logado', async () => {
  const { url, db, fechar } = await subir();
  db.prepare("UPDATE modelos SET ativo = 0 WHERE slug = 'byd-king'").run();
  const cookie = await entrar(url);
  assert.equal((await fetch(`${url}/api/modelos/byd-king`, { headers: { Cookie: cookie } })).status, 200);
  await fechar();
});

test('falha de migração deixa só /api/saude respondendo', async () => {
  const { url, fechar } = await subir({ erroMigracao: 'conferência falhou' });
  assert.equal((await fetch(`${url}/api/modelos`)).status, 503);
  const s = await fetch(`${url}/api/saude`);
  assert.equal(s.status, 503);
  assert.equal((await s.json()).erro, 'conferência falhou');
  await fechar();
});

test('telas abrem a casca do front', async () => {
  const { url, fechar } = await subir();
  for (const c of ['/', '/comparar', '/coletores', '/entrar', '/minha-senha', '/usuarios', '/modelo/byd-king']) {
    const r = await fetch(url + c);
    assert.equal(r.status, 200, c);
    assert.match(await r.text(), /<main id="tela"/);
  }
  await fechar();
});

test('cookie de sessão leva Secure só quando o proxy diz que é https', async () => {
  const { url, fechar } = await subir();
  const pedir = extra => fetch(`${url}/api/entrar`, { method: 'POST', headers: { ...JSON_, ...extra }, body: JSON.stringify({ usuario: 'enrico', senha: 'certa' }) });
  assert.match((await pedir({ 'X-Forwarded-Proto': 'https' })).headers.get('set-cookie'), /; Secure/);
  assert.doesNotMatch((await pedir({})).headers.get('set-cookie'), /Secure/);
  await fechar();
});

test('escritas só aceitam JSON: 415 para text/plain', async () => {
  const { url, db, fechar } = await subir();
  const cookie = await entrar(url);
  const antes = db.prepare('SELECT COUNT(*) n FROM coletas').get().n;
  const r = await fetch(`${url}/api/coletas`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: cookie }, body: '{}' });
  assert.equal(r.status, 415);
  assert.deepEqual(await r.json(), { erro: 'use application/json' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM coletas').get().n, antes);
  const e = await fetch(`${url}/api/entrar`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ usuario: 'enrico', senha: 'certa' }) });
  assert.equal(e.status, 415);
  await fechar();
});

test('Coletar agora roda só as Revisões: nada de FIPE, Mobiauto ou IPCA', async () => {
  const db = bancoNovo();
  const chamado = [];
  const revenda = { fipe: { referencias: async () => { chamado.push('fipe'); return []; } }, mobiauto: { anuncios: async () => { chamado.push('mobiauto'); return []; } }, ipca: { serie: async () => { chamado.push('ipca'); return []; } } };
  const s = await servidor(criarApp({ db, estado: {}, env: ENV, deps: { ...deps, revenda } }));
  const cookie = await entrar(s.url);
  const r = await fetch(`${s.url}/api/coletas`, { method: 'POST', headers: { ...JSON_, Cookie: cookie }, body: '{}' });
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.equal(corpo.revenda, null);
  assert.deepEqual(chamado, []);
  assert.deepEqual(db.prepare("SELECT fonte FROM coletas WHERE fonte IN ('fipe','mobiauto','ipca')").all(), []);
  assert.ok(db.prepare("SELECT 1 FROM coletas WHERE fonte = 'byd' AND origem = 'manual'").get());
  await s.fechar();
});
