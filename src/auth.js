// Login de um usuário só (o Enrico): senha em ADMIN_SENHA_HASH (scrypt) e
// sessão num cookie assinado com SESSION_SECRET, válida por 7 dias.
import { scrypt, scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

export const COOKIE = 'precos_sessao';
const DURACAO = 7 * 864e5;
const iguais = (a, b) => a.length === b.length && timingSafeEqual(a, b);

export function gerarHash(senha) {
  const sal = randomBytes(16).toString('hex');
  return `scrypt:${sal}:${scryptSync(String(senha), sal, 32).toString('hex')}`;
}

const scryptAsync = promisify(scrypt);
const partes = hash => {
  const [tipo, sal, h] = String(hash || '').split(':');
  return tipo === 'scrypt' && sal && h ? { sal, esperado: Buffer.from(h, 'hex') } : null;
};

export function senhaConfere(senha, hash) {
  const p = partes(hash);
  return p ? iguais(scryptSync(String(senha ?? ''), p.sal, 32), p.esperado) : false;
}

// Mesma conta, sem travar o servidor enquanto o scrypt roda.
export async function senhaConfereAsync(senha, hash) {
  const p = partes(hash);
  return p ? iguais(await scryptAsync(String(senha ?? ''), p.sal, 32), p.esperado) : false;
}

const assinar = (corpo, segredo) => createHmac('sha256', segredo).update(corpo).digest('hex');

export function criarSessao(segredo, agora = Date.now()) {
  const corpo = String(agora + DURACAO);
  return `${corpo}.${assinar(corpo, segredo)}`;
}

export function sessaoValida(valor, segredo, agora = Date.now()) {
  if (!valor || !segredo) return false;
  const [corpo, ass] = String(valor).split('.');
  if (!corpo || !ass || !iguais(Buffer.from(ass), Buffer.from(assinar(corpo, segredo)))) return false;
  return Number(corpo) > agora;
}

export function lerCookie(req, nome) {
  for (const parte of String(req.get('cookie') || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) {
      try { return decodeURIComponent(parte.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export const logado = (req, env) => sessaoValida(lerCookie(req, COOKIE), env.SESSION_SECRET);

export const exigirLogin = env => (req, res, next) => (logado(req, env) ? next() : res.status(401).json({ erro: 'login necessário' }));
