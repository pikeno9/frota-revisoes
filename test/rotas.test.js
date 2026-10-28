import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, servidor } from './ajuda.js';
import { criarApp } from '../src/app.js';
import { gerarHash, criarSessao, sessaoValida } from '../src/auth.js';

const ENV = { ADMIN_SENHA_HASH: gerarHash('certa'), SESSION_SECRET: 'segredo-de-teste' };
const deps = { coletores: { byd: { coletar: async () => [{ ordem: 1, km: 12000, meses: 12, valor: 926 }], catalogo: async () => [{ rotulo: 'BYD King', parametros: { nome: 'BYD King' } }] } }, buscarFrota: null, enviar: null };

async function subir(estado = {}) {
  const db = bancoNovo();
  const s = await servidor(criarApp({ db, estado, env: ENV, deps }));
  return { db, ...s };
}
async function entrar(url) {
  const r = await fetch(`${url}/api/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: 'certa' }) });
  return r.headers.get('set-cookie').split(';')[0];
}

test('sessão assinada expira e não aceita adulteração', () => {
  const v = criarSessao('s', 1000);
  assert.ok(sessaoValida(v, 's', 2000));
  assert.ok(!sessaoValida(v, 'outro', 2000));
  assert.ok(!sessaoValida(v.replace(/^\d+/, '999999999999999'), 's', 2000));
  assert.ok(!sessaoValida(v, 's', 1000 + 8 * 864e5));
});

test('leitura pública funciona sem login', async () => {
  const { url, fechar } = await subir();
  const r = await fetch(`${url}/api/modelos`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).length, 6);
  assert.equal((await fetch(`${url}/api/modelos/byd-king`)).status, 200);
  assert.equal((await fetch(`${url}/api/modelos/nada`)).status, 404);
  await fechar();
});

test('escrita sem login dá 401; rotas antigas de escrita sumiram', async () => {
  const { url, fechar } = await subir();
  for (const [m, c] of [['POST', '/api/modelos'], ['PATCH', '/api/modelos/1'], ['POST', '/api/coletas'], ['POST', '/api/testar'], ['GET', '/api/catalogo/byd']]) {
    assert.equal((await fetch(url + c, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : '{}' })).status, 401, `${m} ${c}`);
  }
  for (const [m, c] of [['POST', '/api/veiculos'], ['DELETE', '/api/veiculos/1'], ['POST', '/api/precos'], ['DELETE', '/api/precos/1'], ['POST', '/api/ingest']]) {
    assert.equal((await fetch(url + c, { method: m })).status, 404, `${m} ${c}`);
  }
  await fechar();
});

test('senha errada não entra; certa entra e cadastra candidato', async () => {
  const { url, db, fechar } = await subir();
  const errada = await fetch(`${url}/api/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: 'x' }) });
  assert.equal(errada.status, 401);
  const cookie = await entrar(url);
  const r = await fetch(`${url}/api/modelos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ montadora: 'BYD', nome: 'Seal', coletor: 'byd', parametros: { nome: 'BYD Seal' } }) });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).slug, 'byd-seal');
  assert.equal(db.prepare("SELECT origem FROM modelos WHERE slug = 'byd-seal'").get().origem, 'candidato');
  const t = await fetch(`${url}/api/testar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ coletor: 'byd', parametros: { nome: 'BYD King' } }) });
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
  const r = await fetch(`${url}/api/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{x' });
  assert.equal(r.status, 400);
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.equal((await r.json()).erro, 'requisição inválida');
  await fechar();
});

test('cookie com escape inválido vale como deslogado', async () => {
  const { url, fechar } = await subir();
  const r = await fetch(`${url}/api/modelos?todos=1`, { headers: { Cookie: 'precos_sessao=%E0%A4%A' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.equal((await r.json()).length, 6);
  await fechar();
});

test('seis senhas erradas seguidas travam o login, até a certa', async () => {
  const { url, fechar } = await subir();
  const tentar = senha => fetch(`${url}/api/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha }) });
  for (let i = 1; i <= 5; i++) assert.equal((await tentar('errada')).status, 401, `tentativa ${i}`);
  const sexta = await tentar('errada');
  assert.equal(sexta.status, 429);
  assert.equal((await sexta.json()).erro, 'muitas tentativas');
  assert.equal((await tentar('certa')).status, 429);
  await fechar();
});

test('modelo inativo some do detalhe público, mas aparece logado', async () => {
  const { url, db, fechar } = await subir();
  db.prepare("UPDATE modelos SET ativo = 0 WHERE slug = 'byd-king'").run();
  assert.equal((await fetch(`${url}/api/modelos/byd-king`)).status, 404);
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
  for (const c of ['/', '/comparar', '/coletores', '/entrar', '/modelo/byd-king']) {
    const r = await fetch(url + c);
    assert.equal(r.status, 200, c);
    assert.match(await r.text(), /<main id="tela"/);
  }
  await fechar();
});
