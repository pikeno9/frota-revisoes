import { Router } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { modelosResumo, modeloDetalhe, comparar, mudancas, estadoColetas } from '../consultas.js';
import { fontes } from '../fontes.js';
import { exigir } from '../auth.js';

// Telas de Revisões: só com login (qualquer papel).
export function rotasPublicas(db, { publicDir }) {
  const r = Router();
  const ler = exigir('leitura');
  const imagemDe = slug => {
    for (const ext of ['webp', 'png', 'jpg']) if (existsSync(join(publicDir, 'img', `${slug}.${ext}`))) return `/img/${slug}.${ext}`;
    return null;
  };
  const comImagem = m => ({ ...m, imagem: imagemDe(m.slug) });

  r.get('/api/modelos', ler, (req, res) => res.json(modelosResumo(db, { todos: req.query.todos === '1' }).map(comImagem)));
  r.get('/api/modelos/:slug', ler, (req, res) => {
    const m = modeloDetalhe(db, req.params.slug);
    return m ? res.json(comImagem(m)) : res.status(404).json({ erro: 'modelo não encontrado' });
  });
  r.get('/api/comparar', ler, (req, res) => res.json(comparar(db)));
  r.get('/api/mudancas', ler, (req, res) => res.json(mudancas(db, req.query.limite)));
  r.get('/api/coletas/estado', ler, (req, res) => res.json(estadoColetas(db)));
  r.get('/api/fontes', ler, (req, res) => res.json(fontes(db)));
  return r;
}
