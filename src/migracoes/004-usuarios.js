// Login por usuário: tabela de usuários e autoria de vendas e premissas.
// O primeiro admin não entra aqui (a migração não lê o ambiente): ver garantirAdmin em usuarios.js.
const SQL = `
  CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY,
    usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nome TEXT NOT NULL,
    papel TEXT NOT NULL CHECK (papel IN ('leitura','edicao','admin')),
    senha_hash TEXT NOT NULL,
    trocar_senha INTEGER NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1,
    sessao_versao INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    ultimo_acesso TEXT
  );
  ALTER TABLE vendas ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id);
  ALTER TABLE premissas ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id);
`;

export default {
  versao: 4,
  aplicar(db) { db.exec(SQL); },
};
