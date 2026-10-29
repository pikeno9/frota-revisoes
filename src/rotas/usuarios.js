// Entrar, sair, sessão, minha senha e o cadastro de usuários (só admin).
import { Router } from 'express';
import { COOKIE, cookieSessao, exigir, senhaConfereAsync } from '../auth.js';
import { soJson } from './admin.js';
import {
  ErroUsuario, SENHA_MIN, porLogin, usuarioPublico, listar, criar, atualizar, gerarNovaSenha, trocarSenha, registrarAcesso,
} from '../usuarios.js';
import { gerarHash } from '../auth.js';

export const TENTATIVAS_MAX = 5;
export const JANELA_MS = 15 * 60 * 1000;
const espera = ms => new Promise(r => setTimeout(r, ms));
// Hash de uma senha qualquer: usuário inexistente também paga o scrypt, e a resposta não revela se ele existe.
const HASH_FALSO = gerarHash('senha-que-nao-existe');

export function rotasUsuarios(db, env) {
  const r = Router();
  // Falhas de login na memória deste app (zera ao reiniciar), por IP e por usuário.
  const falhas = new Map();
  const recentes = (chave, agora) => {
    const f = (falhas.get(chave) ?? []).filter(t => agora - t < JANELA_MS);
    if (f.length) falhas.set(chave, f); else falhas.delete(chave);
    return f;
  };
  const responder = fn => async (req, res, next) => {
    try { await fn(req, res); } catch (e) { if (e instanceof ErroUsuario) res.status(e.status).json({ erro: e.message }); else next(e); }
  };

  r.post('/api/entrar', soJson, async (req, res) => {
    if (!env.SESSION_SECRET) return res.status(503).json({ erro: 'login não configurado' });
    const login = String(req.body?.usuario ?? '').trim().toLowerCase().slice(0, 64);
    const chaves = [`ip:${req.ip}`, `u:${login}`];
    const agora = Date.now();
    if (chaves.some(c => recentes(c, agora).length >= TENTATIVAS_MAX)) return res.status(429).json({ erro: 'muitas tentativas' });
    // Conta a tentativa antes de conferir, para pedidos paralelos não furarem o limite.
    for (const c of chaves) falhas.set(c, [...recentes(c, agora), agora]);
    const u = login ? porLogin(db, login) : null;
    const confere = await senhaConfereAsync(req.body?.senha, u?.senha_hash ?? HASH_FALSO);
    if (!u || !u.ativo || !confere) {
      await espera(500);
      return res.status(401).json({ erro: 'usuário ou senha incorretos' });
    }
    for (const c of chaves) falhas.delete(c);
    registrarAcesso(db, u);
    res.setHeader('Set-Cookie', cookieSessao(req, u, env));
    res.json({ ok: true });
  });

  r.post('/api/sair', (req, res) => { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); res.json({ ok: true }); });
  r.get('/api/sessao', (req, res) => res.json(req.usuario ? { logado: true, usuario: usuarioPublico(req.usuario) } : { logado: false }));

  r.post('/api/minha-senha', soJson, responder(async (req, res) => {
    const u = req.usuario;
    if (!u) return res.status(401).json({ erro: 'login necessário' });
    const { atual, nova } = req.body ?? {};
    if (typeof nova !== 'string' || nova.length < SENHA_MIN || nova.length > 200) throw new ErroUsuario(400, `a senha nova precisa de ${SENHA_MIN} caracteres ou mais`);
    if (!(await senhaConfereAsync(atual, u.senha_hash))) { await espera(500); throw new ErroUsuario(401, 'senha atual incorreta'); }
    if (nova === atual) throw new ErroUsuario(400, 'a senha nova é igual à atual');
    const novo = trocarSenha(db, u, nova);
    res.setHeader('Set-Cookie', cookieSessao(req, novo, env));
    res.json({ ok: true });
  }));

  const admin = exigir('admin');
  r.use('/api/usuarios', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  r.get('/api/usuarios', admin, (req, res) => res.json(listar(db)));
  r.post('/api/usuarios', admin, soJson, responder((req, res) => res.status(201).json(criar(db, req.body))));
  r.patch('/api/usuarios/:id', admin, soJson, responder((req, res) => res.json(atualizar(db, req.params.id, req.body, req.usuario))));
  r.post('/api/usuarios/:id/senha', admin, soJson, responder((req, res) => res.json(gerarNovaSenha(db, req.params.id, req.usuario))));
  return r;
}
