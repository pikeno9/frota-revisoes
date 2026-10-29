import { Router } from 'express';
import { exigir } from '../auth.js';
import { rodarColeta, emAndamento } from '../coleta.js';
import { enviarPendentes } from '../alertas.js';

const slugDe = (montadora, nome) => `${montadora} ${nome}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Escritas só aceitam JSON: um form HTML de outro site não consegue mandar esse Content-Type sem preflight.
export const soJson = (req, res, next) => (req.is('application/json') ? next() : res.status(415).json({ erro: 'use application/json' }));

export function rotasAdmin(db, env, deps) {
  const r = Router();
  // Escritas e consultas que custam chamadas às montadoras: papel edição ou admin.
  const login = exigir('edicao');
  const conhecido = c => Object.hasOwn(deps.coletores, c);

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
