import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, servidor, resposta } from './ajuda.js';
import { criarApp } from '../src/app.js';
import { gerarHash } from '../src/auth.js';
import { conferirIdToken, voltaSegura } from '../src/google.js';

const CLIENTE = 'cliente-teste.apps.googleusercontent.com';
const ENV = { ADMIN_SENHA_HASH: gerarHash('certa'), SESSION_SECRET: 'segredo-de-teste', GOOGLE_CLIENT_ID: CLIENTE, GOOGLE_CLIENT_SECRET: 'x' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = claims => `${b64({ alg: 'RS256' })}.${b64(claims)}.assinatura`;
const agoraS = () => Math.floor(Date.now() / 1000);
const claimsBoas = (nonce, extra = {}) => ({
  iss: 'https://accounts.google.com', aud: CLIENTE, azp: CLIENTE, exp: agoraS() + 600, nonce,
  email: 'lucas.gomes@onecarnow.com', email_verified: true, hd: 'onecarnow.com', ...extra,
});

// O Google de mentira devolve o id_token que o teste mandar, com o nonce do pedido.
async function subir({ env = ENV, claims = n => claimsBoas(n), token = { status: 200 } } = {}) {
  const db = bancoNovo();
  const pedidos = [];
  let nonce = null;
  const fetchGoogle = async (url, opcoes) => {
    pedidos.push({ url, corpo: new URLSearchParams(opcoes.body) });
    return resposta(token.status === 200 ? { id_token: idToken(claims(nonce)) } : { error: 'invalid_grant' }, { status: token.status });
  };
  const s = await servidor(criarApp({ db, estado: {}, env, deps: { coletores: {}, fetchGoogle } }));
  const pedir = (caminho, cookie) => fetch(s.url + caminho, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
  // Ida ao Google: guarda o cookie de ida e o state/nonce que foram no endereço.
  const ida = async (caminho = '/api/google/entrar') => {
    const r = await pedir(caminho);
    const destino = new URL(r.headers.get('location'), s.url);
    nonce = destino.searchParams.get('nonce');
    return { r, destino, cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  const volta = async ({ destino, cookie }, extra = '') => {
    const state = destino.searchParams.get('state');
    return pedir(`/api/google/retorno?code=codigo-1&state=${state}${extra}`, cookie);
  };
  const conta = (usuario, papel = 'leitura', ativo = 1) =>
    db.prepare('INSERT INTO usuarios (usuario, nome, papel, senha_hash, ativo) VALUES (?, ?, ?, ?, ?)').run(usuario, usuario, papel, gerarHash('qualquer'), ativo);
  return { db, ...s, pedir, ida, volta, conta, pedidos };
}

const cookieSessao = r => (r.headers.getSetCookie?.() ?? []).find(c => c.startsWith('precos_sessao=') && !c.startsWith('precos_sessao=;'))?.split(';')[0];

test('ida ao Google leva domínio, PKCE, state e nonce; o cookie de ida é HttpOnly e curto', async () => {
  const s = await subir();
  const { r, destino, cookie } = await s.ida('/api/google/entrar?volta=%2Frevenda');
  assert.equal(r.status, 302);
  assert.equal(destino.origin + destino.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = destino.searchParams;
  assert.equal(q.get('client_id'), CLIENTE);
  assert.equal(q.get('hd'), 'onecarnow.com');
  assert.equal(q.get('scope'), 'openid email profile');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.ok(q.get('state').length >= 20 && q.get('nonce').length >= 20 && q.get('code_challenge'));
  assert.match(q.get('redirect_uri'), /\/api\/google\/retorno$/);
  assert.ok(cookie.startsWith('precos_google='));
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.match(r.headers.get('set-cookie'), /Path=\/api\/google/);
  assert.match(r.headers.get('set-cookie'), /Max-Age=600/);
  await s.fechar();
});

test('conta @onecarnow.com que já existe entra com o papel dela e volta para onde estava', async () => {
  const s = await subir();
  s.conta('lucas.gomes@onecarnow.com', 'edicao');
  const ida = await s.ida('/api/google/entrar?volta=%2Frevenda');
  const r = await s.volta(ida);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/revenda');
  const sessao = await (await s.pedir('/api/sessao', cookieSessao(r))).json();
  assert.equal(sessao.logado, true);
  assert.deepEqual([sessao.usuario.usuario, sessao.usuario.papel], ['lucas.gomes@onecarnow.com', 'edicao']);
  // Troca de código levou o verificador PKCE e o segredo, pelo endpoint de token.
  assert.equal(s.pedidos[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(s.pedidos[0].corpo.get('code'), 'codigo-1');
  assert.ok(s.pedidos[0].corpo.get('code_verifier'));
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM usuarios').get().n, 2, 'não cria conta');
  assert.ok(s.db.prepare("SELECT ultimo_acesso FROM usuarios WHERE usuario = 'lucas.gomes@onecarnow.com'").get().ultimo_acesso);
  await s.fechar();
});

test('conta de nome curto casa com a parte antes do @', async () => {
  const s = await subir();
  s.conta('lucas.gomes', 'admin');
  const r = await s.volta(await s.ida());
  assert.equal(r.headers.get('location'), '/');
  const sessao = await (await s.pedir('/api/sessao', cookieSessao(r))).json();
  assert.deepEqual([sessao.usuario.usuario, sessao.usuario.papel], ['lucas.gomes', 'admin']);
  await s.fechar();
});

test('sem conta, conta desativada ou e-mail de fora: não entra e não cria nada', async () => {
  for (const [preparar, claims] of [
    [() => {}, n => claimsBoas(n)],
    [s => s.conta('lucas.gomes@onecarnow.com', 'admin', 0), n => claimsBoas(n)],
    [s => s.conta('lucas.gomes@gmail.com'), n => claimsBoas(n, { email: 'lucas.gomes@gmail.com', hd: undefined })],
  ]) {
    const s = await subir({ claims });
    preparar(s);
    const antes = s.db.prepare('SELECT COUNT(*) n FROM usuarios').get().n;
    const r = await s.volta(await s.ida());
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/entrar?google=sem-acesso');
    assert.equal(cookieSessao(r), undefined);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM usuarios').get().n, antes);
    await s.fechar();
  }
});

test('state trocado, sem cookie de ida ou erro do Google: não entra', async () => {
  const s = await subir();
  s.conta('lucas.gomes@onecarnow.com');
  const ida = await s.ida();
  const trocado = await s.pedir('/api/google/retorno?code=c&state=outro', ida.cookie);
  assert.equal(trocado.headers.get('location'), '/entrar?google=falhou');
  const semCookie = await s.volta({ destino: ida.destino, cookie: null });
  assert.equal(semCookie.headers.get('location'), '/entrar?google=falhou');
  assert.equal(s.pedidos.length, 0, 'nem chega a trocar o código');
  const s2 = await subir({ token: { status: 400 } });
  const r2 = await s2.volta(await s2.ida());
  assert.equal(r2.headers.get('location'), '/entrar?google=falhou');
  assert.equal(cookieSessao(r2), undefined);
  await s.fechar();
  await s2.fechar();
});

test('?entrar=google sem sessão começa o Google sozinho; falha volta à tela sem mensagem', async () => {
  const s = await subir();
  const r = await s.pedir('/revenda?entrar=google');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/api/google/entrar?auto=1&volta=%2Frevenda');
  const ida = await s.ida(r.headers.get('location'));
  const falha = await s.volta(ida);
  assert.equal(falha.headers.get('location'), '/entrar?volta=%2Frevenda');
  await s.fechar();
});

test('?entrar=google com sessão é ignorado', async () => {
  const s = await subir();
  s.conta('lucas.gomes@onecarnow.com');
  const c = cookieSessao(await s.volta(await s.ida()));
  const r = await s.pedir('/revenda?entrar=google', c);
  assert.equal(r.status, 200);
  await s.fechar();
});

test('sem as chaves do Google o botão some e as rotas voltam para Entrar', async () => {
  const s = await subir({ env: { ...ENV, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' } });
  assert.equal((await (await s.pedir('/api/sessao')).json()).google, false);
  assert.equal((await s.pedir('/api/google/entrar')).headers.get('location'), '/entrar');
  assert.equal((await s.pedir('/revenda?entrar=google')).status, 200);
  await s.fechar();
  const ligado = await subir();
  assert.equal((await (await ligado.pedir('/api/sessao')).json()).google, true);
  await ligado.fechar();
});

test('id_token: confere emissor, público, validade, nonce, e-mail verificado e domínio', () => {
  const ok = claimsBoas('n1');
  const conferir = c => conferirIdToken(idToken(c), CLIENTE, 'n1');
  assert.equal(conferir(ok), 'lucas.gomes@onecarnow.com');
  assert.equal(conferir({ ...ok, email: 'Lucas.Gomes@OneCarNow.com' }), 'lucas.gomes@onecarnow.com');
  for (const ruim of [
    { iss: 'https://outro.com' }, { aud: 'outro-cliente' }, { azp: 'outro-cliente' }, { exp: agoraS() - 1 },
    { nonce: 'n2' }, { email_verified: false }, { hd: 'gmail.com' }, { email: 'x@gmail.com' },
    { email: 'x@onecarnow.com.br' }, { email: 'x@sub.onecarnow.com' },
  ]) assert.equal(conferir({ ...ok, ...ruim }), null, JSON.stringify(ruim));
  assert.equal(conferirIdToken('lixo', CLIENTE, 'n1'), null);
});

test('volta só aceita caminho do próprio site e nunca Entrar', () => {
  assert.equal(voltaSegura('/revenda/estudo?x=1'), '/revenda/estudo?x=1');
  for (const v of ['//mal.com', 'https://mal.com', '/entrar', '/minha-senha', '/\\mal.com', '', null]) assert.equal(voltaSegura(v), '/', String(v));
});

test('com o Google ligado a senha sai; ENTRAR_COM_SENHA=sim traz de volta', async () => {
  const s = await subir();
  const corpo = JSON.stringify({ usuario: 'enrico', senha: 'certa' });
  const entrarSenha = srv => fetch(srv.url + '/api/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo });
  assert.equal((await entrarSenha(s)).status, 403);
  assert.equal((await (await s.pedir('/api/sessao')).json()).senha, false);
  await s.fechar();
  const emergencia = await subir({ env: { ...ENV, ENTRAR_COM_SENHA: 'sim' } });
  assert.equal((await entrarSenha(emergencia)).status, 200);
  assert.equal((await (await emergencia.pedir('/api/sessao')).json()).senha, true);
  await emergencia.fechar();
});
