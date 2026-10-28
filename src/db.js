// Banco SQLite nativo do Node. WAL + busy_timeout porque o servidor e a tarefa
// agendada de coleta escrevem no mesmo arquivo.
import { DatabaseSync } from 'node:sqlite';

export function abrir(caminho) {
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  return db;
}

// fn precisa ser síncrona (node:sqlite é síncrono).
export function transacao(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
