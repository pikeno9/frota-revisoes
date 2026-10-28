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

const PORT = env.PORT || 3000;
criarApp({ db, estado, env, deps: dependencias(env) }).listen(PORT, () => console.log(`Preços OCN em http://localhost:${PORT}`));
