export default {
  versao: 1,
  aplicar(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS veiculos (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        montadora TEXT NOT NULL,
        modelo    TEXT NOT NULL,
        versao    TEXT,
        ano       TEXT,
        apelido   TEXT,
        criado_em TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS precos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        veiculo_id  INTEGER NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
        revisao     TEXT NOT NULL,
        data_coleta TEXT NOT NULL,
        valor       REAL NOT NULL,
        fonte       TEXT DEFAULT 'manual',
        obs         TEXT,
        criado_em   TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_precos_veiculo ON precos(veiculo_id);
    `);
  },
};
