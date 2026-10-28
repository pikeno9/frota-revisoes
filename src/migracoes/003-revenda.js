// v3: módulo Revenda. Só acrescenta: colunas novas em modelos, tabelas novas e
// as premissas iniciais. Nada do que já existe é alterado ou apagado.

// Conferidos na FIPE e na Mobiauto em 28/10/2026 (spec, seção 4).
export const PARAMETROS_REVENDA = {
  'polo-track': { fipe_marca: 59, fipe_modelo: 10176, fipe_combustivel: 5, fipe_modelo_ref: null, mobiauto_caminho: 'volkswagen/polo', mobiauto_versao: '^Track' },
  tera: { fipe_marca: 59, fipe_modelo: 11467, fipe_combustivel: 5, fipe_modelo_ref: 10176, mobiauto_caminho: 'volkswagen/tera', mobiauto_versao: 'MPI' },
  'argo-drive': { fipe_marca: 21, fipe_modelo: 7965, fipe_combustivel: 5, fipe_modelo_ref: null, mobiauto_caminho: 'fiat/argo', mobiauto_versao: '^Drive 1\\.0' },
  'onix-sedan-plus': { fipe_marca: 23, fipe_modelo: 11617, fipe_combustivel: 5, fipe_modelo_ref: 8950, mobiauto_caminho: 'chevrolet/onix-plus', mobiauto_versao: '^(?!.*Turbo).*1\\.0' },
  'byd-dolphin': { fipe_marca: 238, fipe_modelo: 12122, fipe_combustivel: 4, fipe_modelo_ref: null, mobiauto_caminho: 'byd/dolphin', mobiauto_versao: '^GS' },
  'byd-king': { fipe_marca: 238, fipe_modelo: 11078, fipe_combustivel: 6, fipe_modelo_ref: null, mobiauto_caminho: 'byd/king', mobiauto_versao: 'GL' },
};

export const PREMISSAS_INICIAIS = { atacado_pct_base: 85, varejo_negociacao_pct: 5, motorista_pct_base: 100 };

const SQL = `
  ALTER TABLE modelos ADD COLUMN fipe_marca INTEGER;
  ALTER TABLE modelos ADD COLUMN fipe_modelo INTEGER;
  ALTER TABLE modelos ADD COLUMN fipe_combustivel INTEGER;
  ALTER TABLE modelos ADD COLUMN fipe_modelo_ref INTEGER;
  ALTER TABLE modelos ADD COLUMN mobiauto_caminho TEXT;
  ALTER TABLE modelos ADD COLUMN mobiauto_versao TEXT;
  CREATE TABLE fipe_precos (
    fipe_marca INTEGER NOT NULL,
    fipe_modelo INTEGER NOT NULL,
    ano_modelo INTEGER NOT NULL,
    referencia TEXT NOT NULL,
    valor REAL NOT NULL,
    codigo_fipe TEXT,
    PRIMARY KEY (fipe_modelo, ano_modelo, referencia)
  );
  CREATE TABLE anuncios (
    id_externo TEXT PRIMARY KEY,
    modelo_id INTEGER NOT NULL REFERENCES modelos(id),
    versao TEXT, ano_modelo INTEGER, ano_fabricacao INTEGER,
    km INTEGER NOT NULL, preco REAL NOT NULL, loja TEXT,
    primeiro_visto TEXT NOT NULL, ultimo_visto TEXT NOT NULL
  );
  CREATE INDEX anuncios_modelo ON anuncios(modelo_id, ultimo_visto);
  CREATE TABLE ipca (mes TEXT PRIMARY KEY, variacao REAL NOT NULL);
  CREATE TABLE premissas (chave TEXT PRIMARY KEY, valor REAL NOT NULL, atualizado_em TEXT NOT NULL);
  CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, placa TEXT NOT NULL, modelo_id INTEGER NOT NULL REFERENCES modelos(id),
    data TEXT NOT NULL, km INTEGER NOT NULL, preco REAL NOT NULL,
    canal TEXT NOT NULL CHECK (canal IN ('atacado','varejo','motorista')), obs TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE estudos (
    id INTEGER PRIMARY KEY, modelo_id INTEGER NOT NULL REFERENCES modelos(id),
    calculado_em TEXT NOT NULL, dados TEXT NOT NULL
  );
  CREATE INDEX estudos_modelo ON estudos(modelo_id, id);
`;

export default {
  versao: 3,
  aplicar(db) {
    db.exec(SQL);
    const upd = db.prepare(`UPDATE modelos SET fipe_marca = ?, fipe_modelo = ?, fipe_combustivel = ?, fipe_modelo_ref = ?,
      mobiauto_caminho = ?, mobiauto_versao = ? WHERE slug = ?`);
    for (const [slug, p] of Object.entries(PARAMETROS_REVENDA)) {
      upd.run(p.fipe_marca, p.fipe_modelo, p.fipe_combustivel, p.fipe_modelo_ref, p.mobiauto_caminho, p.mobiauto_versao, slug);
    }
    const ins = db.prepare("INSERT INTO premissas (chave, valor, atualizado_em) VALUES (?, ?, datetime('now'))");
    for (const [chave, valor] of Object.entries(PREMISSAS_INICIAIS)) ins.run(chave, valor);
  },
};
