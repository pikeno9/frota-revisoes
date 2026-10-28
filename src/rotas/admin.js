import { Router } from 'express';
import { COOKIE, criarSessao, exigirLogin, logado, senhaConfereAsync } from '../auth.js';
import { rodarColeta, emAndamento } from '../coleta.js';
import { enviarPendentes } from '../alertas.js';

const slugDe = (montadora, nome) => `${montadora} ${nome}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Escritas só aceitam JSON: um form HTML de outro site não consegue mandar esse Content-Type sem preflight.
export const soJson = (req, res, next) => (req.is('application/json') ? next() : res.status(415).json({ erro: 'use application/json' }));
const espera = ms => new Promise(r => setTimeout(r, ms));

export const TENTATIVAS_MAX = 5;
export const JANELA_MS = 15 * 60 * 1000;

export function rotasAdmin(db, env, deps) {
  const r = Router();
  const login = exigirLogin(env);
  const conhecido = c => Object.hasOwn(deps.coletores, c);
  // Falhas de login por IP, na memória deste app (zera ao reiniciar).
  const falhas = new Map();
  const bloqueado = (ip, agora) => {
    const f = (falhas.get(ip) ?? []).filter(t => agora - t < JANELA_MS);
    if (f.length) falhas.set(ip, f); else falhas.delete(ip);
    return f.length >= TENTATIVAS_MAX;
  };

  r.post('/api/entrar', soJson, async (req, res) => {
    if (!env.ADMIN_SENHA_HASH || !env.SESSION_SECRET) return res.status(503).json({ erro: 'login não configurado' });
    if (bloqueado(req.ip, Date.now())) return res.status(429).json({ erro: 'muitas tentativas' });
    // Conta a tentativa antes de conferir, para pedidos paralelos não furarem o limite.
    falhas.set(req.ip, [...(falhas.get(req.ip) ?? []), Date.now()]);
    if (!(await senhaConfereAsync(req.body?.senha, env.ADMIN_SENHA_HASH))) {
      await espera(500);
      return res.status(401).json({ erro: 'senha incorreta' });
    }
    falhas.delete(req.ip);
    const seguro = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${criarSessao(env.SESSION_SECRET)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}${seguro}`);
    res.json({ ok: true });
  });
  r.post('/api/sair', (req, res) => { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); res.json({ ok: true }); });
  r.get('/api/sessao', (req, res) => res.json({ logado: logado(req, env) }));

  r.post('/api/modelos', login, soJson, (req, res) => {
    const { montadora, nome, versao = null, ano_modelo = null, coletor, parametros } = req.body ?? {};
    if (!montadora || !nome || !conhecido(coletor) || !parametros || typeof parametros !== 'object') return res.status(400).json({ erro: 'montadora, nome, coletor e parametros são obrigatórios' });
    // BYD leva o prefixo (byd-king, byd-seal), as outras só o nome (onix-sedan-plus), como na migração.
    const slug = slugDe(montadora === 'BYD' ? 'BYD' : '', nome);
    if (db.prepare('SELECT 1 FROM modelos WHERE slug = ?').get(slug)) return res.status(409).json({ erro: 'já existe' });
    const r2 = db.prepare("INSERT INTO modelos (slug, montadora, nome, versao, ano_modelo, origem, coletor, parametros) VALUES (?, ?, ?, ?, ?, 'candidato', ?, ?)")
      .run(slug, montadora, nome, versao, ano_modelo, coletor, JSON.stringify(parametros));
    res.status(201).json({ id: Number(r2.lastInsertRowid), slug });
  });

  r.patch('/api/modelos/:id', login, soJson, (req, res) => {
    const m = db.prepare('SELECT * FROM modelos WHERE id = ?').get(req.params.id);
    if (!m) return res.status(404).json({ erro: 'modelo não encontrado' });
    const b = req.body ?? {};
    const novo = {
      nome: b.nome ?? m.nome, versao: b.versao ?? m.versao, ativo: b.ativo == null ? m.ativo : (b.ativo ? 1 : 0),
      parametros: b.parametros ? JSON.stringify(b.parametros) : m.parametros, chave_ativos: b.chave_ativos === undefined ? m.chave_ativos : (b.chave_ativos || null),
    };
    db.prepare('UPDATE modelos SET nome = ?, versao = ?, ativo = ?, parametros = ?, chave_ativos = ? WHERE id = ?').run(novo.nome, novo.versao, novo.ativo, novo.parametros, novo.chave_ativos, m.id);
    res.json({ ok: true });
  });

  r.post('/api/testar', login, soJson, async (req, res) => {
    const { coletor, parametros } = req.body ?? {};
    if (!conhecido(coletor)) return res.status(400).json({ erro: 'coletor desconhecido' });
    try { res.json({ itens: await deps.coletores[coletor].coletar(parametros ?? {}) }); }
    catch (e) { res.status(422).json({ erro: e.message }); }
  });

  r.get('/api/catalogo/:coletor', login, async (req, res) => {
    const c = deps.coletores[req.params.coletor];
    if (!c?.catalogo) return res.status(404).json({ erro: 'sem catálogo para esta fonte' });
    try { res.json(await c.catalogo()); } catch (e) { res.status(502).json({ erro: e.message }); }
  });

  r.post('/api/coletas', login, soJson, async (req, res) => {
    if (emAndamento()) return res.status(409).json({ erro: 'coleta em andamento' });
    try { res.json(await rodarColeta(db, { ...deps, revenda: null, origem: 'manual' })); }
    catch (e) { res.status(500).json({ erro: e.message }); }
  });

  r.post('/api/alertas/reenviar', login, soJson, async (req, res) => {
    try { res.json(await enviarPendentes(db, { env })); }
    catch (e) { res.status(500).json({ erro: e.message }); }
  });
  return r;
}
