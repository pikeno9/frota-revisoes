// Login por usuário (tabela usuarios, senha em scrypt) e sessão num cookie assinado com
// SESSION_SECRET, válida por 7 dias. O cookie leva id e versão da sessão; o usuário é relido a cada pedido.
import { scrypt, scryptSync, randomBytes, timingSafeEqual, createHmac, createHash } from 'node:crypto';
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

export function criarSessao(usuario, segredo, agora = Date.now()) {
  const corpo = `${usuario.id}.${usuario.sessao_versao}.${agora + DURACAO}`;
  return `${corpo}.${assinar(corpo, segredo)}`;
}

// { id, versao } de um cookie íntegro e dentro da validade; senão null.
export function lerSessao(valor, segredo, agora = Date.now()) {
  if (!valor || !segredo) return null;
  const partes = String(valor).split('.');
  if (partes.length !== 4) return null;
  const corpo = partes.slice(0, 3).join('.');
  if (!iguais(Buffer.from(partes[3]), Buffer.from(assinar(corpo, segredo)))) return null;
  const [id, versao, validade] = partes.slice(0, 3).map(Number);
  return Number.isInteger(id) && Number.isInteger(versao) && validade > agora ? { id, versao } : null;
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

// Desativado, papel trocado ou senha trocada sobem sessao_versao: o cookie antigo deixa de valer.
export function usuarioDaSessao(req, db, env) {
  const s = lerSessao(lerCookie(req, COOKIE), env.SESSION_SECRET);
  if (!s) return null;
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(s.id);
  return u && u.ativo === 1 && u.sessao_versao === s.versao ? u : null;
}

// Põe req.usuario (ou null) uma vez por pedido. Sem a tabela (banco com erro de migração), ninguém está logado.
export const carregarUsuario = (db, env) => (req, res, next) => {
  try { req.usuario = usuarioDaSessao(req, db, env); } catch { req.usuario = null; }
  next();
};

export const NIVEL = { leitura: 1, edicao: 2, admin: 3 };
export const pode = (u, papel) => !!u && NIVEL[u.papel] >= NIVEL[papel];

export const exigir = papel => (req, res, next) => {
  const u = req.usuario;
  if (!u) return res.status(401).json({ erro: 'login necessário' });
  if (NIVEL[u.papel] < NIVEL[papel]) return res.status(403).json({ erro: 'sem permissão' });
  next();
};

// Leitura entre sistemas: usuário logado ou o token do KPIs.
export const leituraOuToken = token => (req, res, next) =>
  (pode(req.usuario, 'leitura') || tokenConfere(req.get('authorization'), token) ? next() : res.status(401).json({ erro: 'login necessário' }));

export const cookieSessao = (req, usuario, env) =>
  `${COOKIE}=${criarSessao(usuario, env.SESSION_SECRET)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}${req.secure ? '; Secure' : ''}`;

// Token fixo para leitura entre sistemas (o KPIs lê revisões e a projeção da Revenda com REVENDA_TOKEN).
// Compara os hashes, em tempo constante e sem vazar o tamanho. Sem token configurado, nunca confere.
export function tokenConfere(cabecalho, token) {
  if (!token) return false;
  const m = String(cabecalho || '').match(/^Bearer\s+(\S+)\s*$/i);
  if (!m) return false;
  const h = s => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(h(m[1]), h(token));
}
