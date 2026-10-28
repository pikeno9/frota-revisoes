import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versaoAtual } from './migracoes/index.js';
import { emAndamento } from './coleta.js';
import { rotasPublicas } from './rotas/publicas.js';
import { rotasAdmin } from './rotas/admin.js';
import { rotasCompat } from './rotas/compat.js';
import { rotasRevenda } from './rotas/revenda.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TELAS = ['/', '/comparar', '/coletores', '/entrar', '/modelo/:slug', '/revenda', '/revenda/:pagina'];

export function criarApp({ db, estado = {}, env = process.env, deps }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // atrás do proxy do Coolify, req.ip vem do X-Forwarded-For
  // O site mudou para precos.ocnbrasil.com.br; o endereço antigo do Railway só manda para lá.
  app.use((req, res, next) => (req.hostname === 'frota-revisoes-production.up.railway.app'
    ? res.redirect(307, 'https://precos.ocnbrasil.com.br' + req.originalUrl) : next()));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/saude', (req, res) => {
    if (estado.erroMigracao) return res.status(503).json({ ok: false, erro: estado.erroMigracao });
    const ultima = db.prepare("SELECT fonte, fim, status FROM coletas WHERE fonte <> 'legado' ORDER BY id DESC LIMIT 1").get() ?? null;
    res.json({ ok: true, schema: versaoAtual(db), ultima_coleta: ultima, coleta_em_andamento: emAndamento() });
  });
  app.use('/api', (req, res, next) => (estado.erroMigracao ? res.status(503).json({ erro: 'banco indisponível' }) : next()));

  app.use(rotasCompat(db));
  app.use(rotasPublicas(db, { publicDir: PUBLIC, env }));
  app.use(rotasAdmin(db, env, deps));
  app.use(rotasRevenda(db, env, { hoje: deps?.hoje }));
  app.use('/api', (req, res) => res.status(404).json({ erro: 'rota não encontrada' }));

  app.use(express.static(PUBLIC, { index: false }));
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
