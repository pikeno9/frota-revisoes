import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versaoAtual } from './migracoes/index.js';
import { emAndamento } from './coleta.js';
import { rotasPublicas } from './rotas/publicas.js';
import { rotasAdmin } from './rotas/admin.js';
import { rotasCompat } from './rotas/compat.js';
import { rotasRevenda } from './rotas/revenda.js';
import { rotasUsuarios } from './rotas/usuarios.js';
import { rotasGoogle } from './rotas/google.js';
import { googleLigado, voltaSegura } from './google.js';
import { carregarUsuario } from './auth.js';
import { garantirAdmin } from './usuarios.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TELAS = ['/', '/comparar', '/coletores', '/entrar', '/minha-senha', '/usuarios', '/metodo', '/modelo/:slug', '/revenda', '/revenda/:pagina'];

export function criarApp({ db, estado = {}, env = process.env, deps }) {
  if (!estado.erroMigracao) garantirAdmin(db, env);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // atrás do proxy do Coolify, req.ip vem do X-Forwarded-For
  // O site mudou para precos.ocnbrasil.com.br; o endereço antigo do Railway só manda para lá.
  app.use((req, res, next) => (req.hostname === 'frota-revisoes-production.up.railway.app'
    ? res.redirect(307, 'https://precos.ocnbrasil.com.br' + req.originalUrl) : next()));
  // A importação de anúncios manda milhares de linhas de uma vez; o resto da API fica no limite pequeno.
  const jsonPadrao = express.json({ limit: '100kb' }), jsonGrande = express.json({ limit: '8mb' });
  app.use((req, res, next) => (req.path === '/api/revenda/anuncios/importar' ? jsonGrande : jsonPadrao)(req, res, next));

  app.get('/api/saude', (req, res) => {
    if (estado.erroMigracao) return res.status(503).json({ ok: false, erro: estado.erroMigracao });
    const ultima = db.prepare("SELECT fonte, fim, status FROM coletas WHERE fonte <> 'legado' ORDER BY id DESC LIMIT 1").get() ?? null;
    res.json({ ok: true, schema: versaoAtual(db), ultima_coleta: ultima, coleta_em_andamento: emAndamento() });
  });
  app.use('/api', (req, res, next) => (estado.erroMigracao ? res.status(503).json({ erro: 'banco indisponível' }) : next()));

  app.use(carregarUsuario(db, env));
  app.use(rotasUsuarios(db, env));
  app.use(rotasGoogle(db, env, { fetchGoogle: deps?.fetchGoogle }));
  app.use(rotasCompat(db, env));
  app.use(rotasPublicas(db, { publicDir: PUBLIC }));
  app.use(rotasAdmin(db, env, deps));
  app.use(rotasRevenda(db, env, { hoje: deps?.hoje }));
  app.use('/api', (req, res) => res.status(404).json({ erro: 'rota não encontrada' }));

  app.use(express.static(PUBLIC, { index: false }));
  // ?entrar=google (o Hub abre assim) sem sessão: o login Google começa sozinho. Com sessão, é ignorado.
  app.get(TELAS, (req, res, next) => {
    if (req.query.entrar !== 'google' || req.usuario || !googleLigado(env)) return next();
    const q = new URLSearchParams(req.query);
    q.delete('entrar');
    const volta = req.path === '/entrar' ? voltaSegura(req.query.volta) : voltaSegura(req.path + (q.size ? `?${q}` : ''));
    res.redirect(302, `/api/google/entrar?auto=1&volta=${encodeURIComponent(volta)}`);
  });
  app.get(TELAS, (req, res) => res.sendFile(join(PUBLIC, 'index.html')));

  // Nunca devolve HTML nem stack trace, mesmo com corpo malformado.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const erro = status === 413 ? 'requisição grande demais' : status < 500 ? 'requisição inválida' : 'erro interno';
    res.status(status).json({ erro });
  });
  return app;
}
