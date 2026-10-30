// Módulo Revenda: leitura para qualquer papel, escrita para edição. Só a projeção aceita também o token do KPIs.
import { Router } from 'express';
import { exigir, leituraOuToken } from '../auth.js';
import { soJson } from './admin.js';
import { hojeSP } from '../datas.js';
import {
  ErroRevenda, modelosRevenda, modeloRevenda, projecao, premissasEModelos, salvarPremissas,
  salvarParametrosModelo, salvarFontesModelo, registrarVenda, listarVendas,
} from '../revenda/consultas.js';
import { listarAnuncios, csvAnuncios } from '../revenda/anuncios.js';
import { importarAnuncios } from '../revenda/importacao.js';

export function rotasRevenda(db, env, { hoje = hojeSP } = {}) {
  const r = Router();
  const login = exigir('leitura');
  const editar = exigir('edicao');
  const loginOuToken = leituraOuToken(env.REVENDA_TOKEN);
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
  r.patch('/api/revenda/modelos/:id', editar, soJson, responder((req, res) => res.json(salvarParametrosModelo(db, req.params.id, req.body))));
  r.put('/api/revenda/modelos/:id/fontes', editar, soJson, responder((req, res) => res.json(salvarFontesModelo(db, req.params.id, req.body))));
  r.get('/api/revenda/anuncios', login, responder((req, res) => res.json(listarAnuncios(db, req.query))));
  r.get('/api/revenda/anuncios.csv', login, responder((req, res) => {
    const csv = csvAnuncios(db, req.query);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="anuncios-${hoje()}.csv"`);
    res.send(csv);
  }));
  r.post('/api/revenda/anuncios/importar', editar, soJson, responder((req, res) => res.status(201).json(importarAnuncios(db, req.body, { hoje: hoje() }))));
  r.get('/api/revenda/premissas', login, responder((req, res) => res.json(premissasEModelos(db))));
  r.put('/api/revenda/premissas', editar, soJson, responder((req, res) => res.json({ premissas: salvarPremissas(db, req.body, req.usuario.id) })));
  r.get('/api/revenda/vendas', login, responder((req, res) => res.json(listarVendas(db))));
  r.post('/api/revenda/vendas', editar, soJson, responder((req, res) => res.status(201).json({ id: registrarVenda(db, req.body, hoje(), req.usuario.id) })));
  return r;
}
