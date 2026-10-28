import { Router } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { modelosResumo, modeloDetalhe, comparar, mudancas, estadoColetas } from '../consultas.js';
import { logado } from '../auth.js';

export function rotasPublicas(db, { publicDir, env }) {
  const r = Router();
  const imagemDe = slug => {
    for (const ext of ['webp', 'png', 'jpg']) if (existsSync(join(publicDir, 'img', `${slug}.${ext}`))) return `/img/${slug}.${ext}`;
    return null;
  };
  const comImagem = m => ({ ...m, imagem: imagemDe(m.slug) });

  r.get('/api/modelos', (req, res) => {
    const todos = req.query.todos === '1' && logado(req, env);
    res.json(modelosResumo(db, { todos }).map(comImagem));
  });
  r.get('/api/modelos/:slug', (req, res) => {
    const m = modeloDetalhe(db, req.params.slug);
    return m && (m.ativo || logado(req, env)) ? res.json(comImagem(m)) : res.status(404).json({ erro: 'modelo não encontrado' });
  });
  r.get('/api/comparar', (req, res) => res.json(comparar(db)));
  r.get('/api/mudancas', (req, res) => res.json(mudancas(db, req.query.limite)));
  r.get('/api/coletas/estado', (req, res) => res.json(estadoColetas(db)));
  return r;
}
