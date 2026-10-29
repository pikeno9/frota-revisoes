import { transacao } from '../db.js';
import legado from './001-legado.js';
import v2 from './002-v2.js';
import v3 from './003-revenda.js';
import v4 from './004-usuarios.js';

export const MIGRACOES = [legado, v2, v3, v4];

export function versaoAtual(db) {
  return db.prepare('SELECT COALESCE(MAX(versao), 0) AS v FROM schema_versao').get().v;
}

export function migrar(db, lista = MIGRACOES) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_versao (versao INTEGER NOT NULL, aplicada_em TEXT NOT NULL)');
  for (const m of lista) {
    if (m.versao <= versaoAtual(db)) continue;
    transacao(db, () => {
      if (versaoAtual(db) >= m.versao) return;
      m.aplicar(db);
      db.prepare("INSERT INTO schema_versao (versao, aplicada_em) VALUES (?, datetime('now'))").run(m.versao);
    });
  }
  return versaoAtual(db);
}
