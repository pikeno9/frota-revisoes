// Entrar com Google: só conta @onecarnow.com que já existe no site; o papel continua o da conta.
// Desenho em docs/superpowers/specs/2026-10-30-entrar-com-google-design.md.
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { porLogin } from './usuarios.js';

export const DOMINIO = 'onecarnow.com';
export const COOKIE_GOOGLE = 'precos_google';
export const AUTORIZAR = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN = 'https://oauth2.googleapis.com/token';
const VALIDADE_IDA = 10 * 60 * 1000;
const EMISSORES = ['accounts.google.com', 'https://accounts.google.com'];

export const googleLigado = env => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);
export const enderecoRetorno = (req, env) => env.GOOGLE_RETORNO_URL || `${req.protocol}://${req.get('host')}/api/google/retorno`;

// Mesma regra da tela Entrar: caminho do próprio site, fora Entrar e Minha senha; senão o Início.
export function voltaSegura(v) {
  const s = String(v ?? '');
  return /^\/(?!\/)[\w/-]*(\?[\w=&%.-]*)?$/.test(s) && !/^\/(entrar|minha-senha)/.test(s) ? s : '/';
}

const aleatorio = () => randomBytes(32).toString('base64url');
const assinar = (corpo, segredo) => createHmac('sha256', segredo).update(corpo).digest('base64url');
const iguais = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// A ida guarda state, nonce e o verificador PKCE num cookie assinado; a volta confere tudo.
export function novaIda({ volta, auto }, segredo, agora = Date.now()) {
  const ida = { state: aleatorio(), nonce: aleatorio(), verificador: aleatorio(), volta: voltaSegura(volta), auto: !!auto, ate: agora + VALIDADE_IDA };
  const corpo = Buffer.from(JSON.stringify(ida)).toString('base64url');
  return { ida, cookie: `${corpo}.${assinar(corpo, segredo)}` };
}

export function lerIda(valor, segredo, agora = Date.now()) {
  const [corpo, assinatura, sobra] = String(valor ?? '').split('.');
  if (!corpo || !assinatura || sobra !== undefined || !iguais(assinatura, assinar(corpo, segredo))) return null;
  try {
    const ida = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return ida.ate > agora ? ida : null;
  } catch { return null; }
}

export const desafioPkce = verificador => createHash('sha256').update(verificador).digest('base64url');

export function urlDoGoogle(ida, env, retorno) {
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: retorno, response_type: 'code', scope: 'openid email profile',
    state: ida.state, nonce: ida.nonce, code_challenge: desafioPkce(ida.verificador), code_challenge_method: 'S256', hd: DOMINIO,
  });
  return `${AUTORIZAR}?${q}`;
}

// O id_token chega direto do endpoint de token do Google, por TLS, então a assinatura não precisa
// ser conferida (OpenID Connect Core 3.1.3.7); as alegações sim. Devolve o e-mail ou null.
export function conferirIdToken(idToken, clienteId, nonce, agora = Date.now()) {
  let c;
  try { c = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString()); } catch { return null; }
  const email = String(c?.email ?? '').trim().toLowerCase();
  const publico = Array.isArray(c.aud) ? c.aud : [c.aud];
  const ok = EMISSORES.includes(c.iss) && publico.includes(clienteId) && (c.azp == null || c.azp === clienteId)
    && Number(c.exp) * 1000 > agora && c.nonce === nonce && c.email_verified === true
    && c.hd === DOMINIO && email.endsWith(`@${DOMINIO}`) && email.indexOf('@') === email.lastIndexOf('@');
  return ok ? email : null;
}

export async function trocarCodigo(fetchGoogle, { code, verificador, retorno, env }) {
  const r = await fetchGoogle(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, code_verifier: verificador, redirect_uri: retorno, grant_type: 'authorization_code',
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return null;
  return (await r.json())?.id_token ?? null;
}

// O e-mail inteiro ou, para contas de nome curto, a parte antes do @. Só conta ativa.
export function contaDoGoogle(db, email) {
  const u = porLogin(db, email) ?? porLogin(db, email.slice(0, email.indexOf('@')));
  return u && u.ativo === 1 ? u : null;
}
