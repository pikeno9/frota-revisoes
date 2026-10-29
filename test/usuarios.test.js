import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, servidor } from './ajuda.js';
import { criarApp } from '../src/app.js';
import { gerarHash } from '../src/auth.js';
import { garantirAdmin } from '../src/usuarios.js';

const ENV = { ADMIN_SENHA_HASH: gerarHash('certa'), SESSION_SECRET: 'segredo-de-teste' };
const deps = { coletores: {}, buscarFrota: null, enviar: null };
const JSON_ = { 'Content-Type': 'application/json' };

async function subir() {
  const db = bancoNovo();
  const s = await servidor(criarApp({ db, estado: {}, env: ENV, deps }));
  const pedir = (caminho, { cookie, metodo = 'GET', corpo } = {}) => fetch(s.url + caminho, {
    method: metodo, headers: { ...JSON_, ...(cookie ? { Cookie: cookie } : {}) }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const entrar = async (usuario, senha) => {
    const r = await pedir('/api/entrar', { metodo: 'POST', corpo: { usuario, senha } });
    return { status: r.status, corpo: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  return { db, ...s, pedir, entrar };
}

// Admin cria a pessoa; ela entra com a provisória e troca para `senha`.
async function pessoa(s, admin, usuario, papel, senha = 'senha-boa-123') {
  const c = await (await s.pedir('/api/usuarios', { cookie: admin, metodo: 'POST', corpo: { nome: usuario, usuario, papel } })).json();
  const e = await s.entrar(usuario, c.senha_provisoria);
  await s.pedir('/api/minha-senha', { cookie: e.cookie, metodo: 'POST', corpo: { atual: c.senha_provisoria, nova: senha } });
  return (await s.entrar(usuario, senha)).cookie;
}

test('primeiro admin entra com a senha de ADMIN_SENHA_HASH e só uma vez', () => {
  const db = bancoNovo();
  assert.equal(garantirAdmin(db, ENV), true);
  assert.equal(garantirAdmin(db, { ADMIN_SENHA_HASH: gerarHash('outra') }), false);
  assert.deepEqual(db.prepare('SELECT usuario, papel FROM usuarios').all().map(x => ({ ...x })), [{ usuario: 'enrico', papel: 'admin' }]);
});

test('login por usuário, sem diferenciar maiúsculas; sessão diz quem é', async () => {
  const s = await subir();
  assert.equal((await s.entrar('enrico', 'errada')).status, 401);
  assert.equal((await s.entrar('ninguem', 'certa')).status, 401);
  const e = await s.entrar('Enrico', 'certa');
  assert.equal(e.status, 200);
  const sessao = await (await s.pedir('/api/sessao', { cookie: e.cookie })).json();
  assert.equal(sessao.logado, true);
  assert.deepEqual([sessao.usuario.usuario, sessao.usuario.papel, sessao.usuario.trocar_senha], ['enrico', 'admin', false]);
  assert.ok(!('senha_hash' in sessao.usuario));
  await s.fechar();
});

test('admin cria usuário com senha provisória; até trocar, só sessão e minha senha respondem', async () => {
  const s = await subir();
  const admin = (await s.entrar('enrico', 'certa')).cookie;
  const r = await s.pedir('/api/usuarios', { cookie: admin, metodo: 'POST', corpo: { nome: 'Lívia', usuario: 'Livia', papel: 'leitura' } });
  assert.equal(r.status, 201);
  const { usuario, senha_provisoria } = await r.json();
  assert.equal(usuario.usuario, 'livia');
  assert.equal(usuario.trocar_senha, true);
  assert.equal((await s.pedir('/api/usuarios', { cookie: admin, metodo: 'POST', corpo: { nome: 'Outra', usuario: 'livia', papel: 'leitura' } })).status, 409);
  const e = await s.entrar('livia', senha_provisoria);
  assert.equal(e.corpo.trocar_senha, true);
  const bloqueada = await s.pedir('/api/modelos', { cookie: e.cookie });
  assert.equal(bloqueada.status, 403);
  assert.equal((await bloqueada.json()).codigo, 'TROCAR_SENHA');
  assert.equal((await s.pedir('/api/minha-senha', { cookie: e.cookie, metodo: 'POST', corpo: { atual: senha_provisoria, nova: 'curta' } })).status, 400);
  assert.equal((await s.pedir('/api/minha-senha', { cookie: e.cookie, metodo: 'POST', corpo: { atual: 'errada', nova: 'senha-boa-123' } })).status, 401);
  const troca = await s.pedir('/api/minha-senha', { cookie: e.cookie, metodo: 'POST', corpo: { atual: senha_provisoria, nova: 'senha-boa-123' } });
  assert.equal(troca.status, 200);
  const novo = troca.headers.get('set-cookie').split(';')[0];
  assert.equal((await s.pedir('/api/modelos', { cookie: novo })).status, 200);
  assert.equal((await s.pedir('/api/modelos', { cookie: e.cookie })).status, 401, 'o cookie antigo cai com a troca');
  assert.equal((await s.entrar('livia', senha_provisoria)).status, 401);
  await s.fechar();
});

test('leitura vê e não escreve; edição escreve e não administra; só admin vê usuários', async () => {
  const s = await subir();
  const admin = (await s.entrar('enrico', 'certa')).cookie;
  const leitura = await pessoa(s, admin, 'leitor', 'leitura');
  const edicao = await pessoa(s, admin, 'editor', 'edicao');
  assert.equal((await s.pedir('/api/revenda/modelos', { cookie: leitura })).status, 200);
  assert.equal((await s.pedir('/api/revenda/premissas', { cookie: leitura, metodo: 'PUT', corpo: { atacado_pct_base: 80 } })).status, 403);
  assert.equal((await s.pedir('/api/coletas', { cookie: leitura, metodo: 'POST', corpo: {} })).status, 403);
  const salvou = await s.pedir('/api/revenda/premissas', { cookie: edicao, metodo: 'PUT', corpo: { atacado_pct_base: 80, varejo_negociacao_pct: 5, motorista_pct_base: 100 } });
  assert.equal(salvou.status, 200);
  const atacado = (await salvou.json()).premissas.find(p => p.chave === 'atacado_pct_base');
  assert.deepEqual([atacado.valor, atacado.por], [80, 'editor']);
  assert.equal((await s.pedir('/api/usuarios', { cookie: edicao })).status, 403);
  assert.equal((await s.pedir('/api/usuarios', { cookie: leitura })).status, 403);
  assert.equal((await s.pedir('/api/usuarios', { cookie: admin })).status, 200);
  await s.fechar();
});

test('desativar ou trocar o papel derruba a sessão; nova senha provisória também', async () => {
  const s = await subir();
  const admin = (await s.entrar('enrico', 'certa')).cookie;
  const cookie = await pessoa(s, admin, 'motorista', 'edicao');
  const id = (await (await s.pedir('/api/usuarios', { cookie: admin })).json()).find(u => u.usuario === 'motorista').id;
  await s.pedir(`/api/usuarios/${id}`, { cookie: admin, metodo: 'PATCH', corpo: { papel: 'leitura' } });
  assert.equal((await s.pedir('/api/modelos', { cookie })).status, 401);
  const de_novo = (await s.entrar('motorista', 'senha-boa-123')).cookie;
  await s.pedir(`/api/usuarios/${id}`, { cookie: admin, metodo: 'PATCH', corpo: { ativo: false } });
  assert.equal((await s.pedir('/api/modelos', { cookie: de_novo })).status, 401);
  assert.equal((await s.entrar('motorista', 'senha-boa-123')).status, 401, 'desativado não entra');
  await s.pedir(`/api/usuarios/${id}`, { cookie: admin, metodo: 'PATCH', corpo: { ativo: true } });
  const { senha_provisoria } = await (await s.pedir(`/api/usuarios/${id}/senha`, { cookie: admin, metodo: 'POST', corpo: {} })).json();
  assert.equal((await s.entrar('motorista', 'senha-boa-123')).status, 401);
  assert.equal((await s.entrar('motorista', senha_provisoria)).corpo.trocar_senha, true);
  await s.fechar();
});

test('admin não tira o próprio acesso nem gera senha provisória para si', async () => {
  const s = await subir();
  const admin = (await s.entrar('enrico', 'certa')).cookie;
  const eu = (await (await s.pedir('/api/sessao', { cookie: admin })).json()).usuario.id;
  assert.equal((await s.pedir(`/api/usuarios/${eu}`, { cookie: admin, metodo: 'PATCH', corpo: { papel: 'leitura' } })).status, 400);
  assert.equal((await s.pedir(`/api/usuarios/${eu}`, { cookie: admin, metodo: 'PATCH', corpo: { ativo: false } })).status, 400);
  assert.equal((await s.pedir(`/api/usuarios/${eu}/senha`, { cookie: admin, metodo: 'POST', corpo: {} })).status, 400);
  assert.equal((await s.pedir('/api/usuarios', { cookie: admin, metodo: 'POST', corpo: { nome: 'X', usuario: 'a b', papel: 'leitura' } })).status, 400);
  assert.equal((await s.pedir('/api/usuarios', { cookie: admin, metodo: 'POST', corpo: { nome: 'X', usuario: 'xyz', papel: 'chefe' } })).status, 400);
  await s.fechar();
});

test('venda registrada guarda quem registrou', async () => {
  const s = await subir();
  const admin = (await s.entrar('enrico', 'certa')).cookie;
  const r = await s.pedir('/api/revenda/vendas', { cookie: admin, metodo: 'POST', corpo: { placa: 'ABC1D23', modelo: 'polo-track', data: '2026-10-01', km: 60000, preco: 70000, canal: 'atacado' } });
  assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
  const vendas = await (await s.pedir('/api/revenda/vendas', { cookie: admin })).json();
  assert.equal(vendas[0].por, 'Enrico');
  await s.fechar();
});

test('limite de tentativas também conta por usuário, mesmo vindo de IPs diferentes', async () => {
  const s = await subir();
  const tentar = ip => fetch(`${s.url}/api/entrar`, { method: 'POST', headers: { ...JSON_, 'X-Forwarded-For': ip }, body: JSON.stringify({ usuario: 'enrico', senha: 'errada' }) });
  for (let i = 1; i <= 5; i++) assert.equal((await tentar(`10.0.0.${i}`)).status, 401);
  assert.equal((await tentar('10.0.0.99')).status, 429);
  await s.fechar();
});
