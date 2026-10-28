import { transacao } from '../db.js';
import legado from './001-legado.js';

export const MIGRACOES = [legado];

export function versaoAtual(db) {
  return db.prepare('SELECT COALESCE(MAX(versao), 0) AS v FROM schema_versao').get().v;
}

export function migrar(db, lista = MIGRACOES) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_versao (versao INTEGER NOT NULL, aplicada_em TEXT NOT NULL)');
  for (const m of lista) {
    if (m.versao <= versaoAtual(db)) continue;
    transacao(db, () => {
      m.aplicar(db);
      db.prepare("INSERT INTO schema_versao (versao, aplicada_em) VALUES (?, datetime('now'))").run(m.versao);
    });
  }
  return versaoAtual(db);
}
