// Módulo Revenda: tudo atrás do login. Só a projeção aceita também o token do KPIs.
import { Router } from 'express';
import { exigirLogin, logado, tokenConfere } from '../auth.js';
import { soJson } from './admin.js';
import { hojeSP } from '../datas.js';
import {
  ErroRevenda, modelosRevenda, modeloRevenda, projecao, premissasEModelos, salvarPremissas,
  salvarParametrosModelo, registrarVenda, listarVendas,
} from '../revenda/consultas.js';

export function rotasRevenda(db, env, { hoje = hojeSP } = {}) {
  const r = Router();
  const login = exigirLogin(env);
  const loginOuToken = (req, res, next) =>
    (logado(req, env) || tokenConfere(req.get('authorization'), env.REVENDA_TOKEN) ? next() : res.status(401).json({ erro: 'login necessário' }));
  // ErroRevenda leva o status; qualquer outro erro sobe para o tratador do app (500 em JSON).
  const responder = fn => (req, res, next) => {
    try { fn(req, res); } catch (e) { if (e instanceof ErroRevenda) res.status(e.status).json({ erro: e.message }); else next(e); }
  };

  r.use('/api/revenda', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // O token vale só aqui, e só para leitura.
  r.get('/api/revenda/projecao', loginOuToken, responder((req, res) => res.json(projecao(db, req.query))));
  r.get('/api/revenda/modelos', login, responder((req, res) => res.json(modelosRevenda(db))));
  r.get('/api/revenda/modelos/:slug', login, responder((req, res) => {
    const m = modeloRevenda(db, req.params.slug, hoje());
    return m ? res.json(m) : res.status(404).json({ erro: 'modelo não encontrado' });
  }));
  r.patch('/api/revenda/modelos/:id', login, soJson, responder((req, res) => res.json(salvarParametrosModelo(db, req.params.id, req.body))));
  r.get('/api/revenda/premissas', login, responder((req, res) => res.json(premissasEModelos(db))));
  r.put('/api/revenda/premissas', login, soJson, responder((req, res) => res.json({ premissas: salvarPremissas(db, req.body) })));
  r.get('/api/revenda/vendas', login, responder((req, res) => res.json(listarVendas(db))));
  r.post('/api/revenda/vendas', login, soJson, responder((req, res) => res.status(201).json({ id: registrarVenda(db, req.body, hoje()) })));
  return r;
}
