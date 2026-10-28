// Preços OCN: sobe o banco, migra e serve a API e as telas.
import { abrir } from './src/db.js';
import { migrar } from './src/migracoes/index.js';
import { criarApp } from './src/app.js';
import { dependencias } from './src/dependencias.js';

const env = process.env;
const db = abrir(env.DB_PATH || 'revisoes.db');
const estado = { erroMigracao: null };
try {
  console.log('schema', migrar(db));
} catch (e) {
  estado.erroMigracao = e.message;
  console.error('MIGRAÇÃO FALHOU, rotas de dados em 503:', e.message);
}

try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { console.error('checkpoint falhou:', e.message); }

const PORT = env.PORT || 3000;
const servidor = criarApp({ db, estado, env, deps: dependencias(env) }).listen(PORT, () => console.log(`Preços OCN em http://localhost:${PORT}`));

// Fecha o HTTP e o banco antes de sair, para o WAL não ficar para trás num deploy.
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    servidor.close(() => { try { db.close(); } catch { /* já fechado */ } process.exit(0); });
    servidor.closeAllConnections?.();
  });
}
