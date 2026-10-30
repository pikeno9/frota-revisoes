// v5: mais fontes de anúncios e a base de anúncios por coleta. Só acrescenta: as colunas
// mobiauto_* de modelos ficam paradas e os anúncios atuais ganham fonte e a primeira leitura.

// Onde buscar cada modelo na NaPista (conferido em 29/10/2026). O caminho vai sem o ano: o
// coletor acrescenta /<ano>. O Onix Plus só responde na busca da cidade de São Paulo.
export const NAPISTA = {
  'polo-track': { caminho: 'sp/volkswagen/polo-track', versao: 'Polo.*Track' },
  'argo-drive': { caminho: 'sp/fiat/argo', versao: 'Argo (Drive 1\\.0|1\\.0 Drive)' },
  tera: { caminho: 'sp/volkswagen/tera', versao: 'Tera.*Mpi' },
  'onix-sedan-plus': { caminho: 'sp/sao-paulo/chevrolet/onix-plus', versao: 'Onix (Sedan |Sed\\. )?Plus (?!.*\\b(Turbo|Tb)\\b)' },
  'byd-dolphin': { caminho: 'sp/byd/dolphin', versao: 'Dolphin (?!Mini).*Gs' },
  'byd-king': { caminho: 'sp/byd/king', versao: 'King.*Gl' },
};

const SQL = `
  ALTER TABLE anuncios ADD COLUMN fonte TEXT;
  ALTER TABLE anuncios ADD COLUMN url TEXT;
  ALTER TABLE anuncios ADD COLUMN tipo_vendedor TEXT;
  ALTER TABLE anuncios ADD COLUMN leilao INTEGER;
  ALTER TABLE anuncios ADD COLUMN leilao_por TEXT;
  ALTER TABLE anuncios ADD COLUMN cidade TEXT;
  UPDATE anuncios SET fonte = substr(id_externo, 1, instr(id_externo, ':') - 1);
  CREATE INDEX anuncios_fonte ON anuncios(modelo_id, fonte, ultimo_visto);
  CREATE TABLE anuncio_leituras (
    id_externo TEXT NOT NULL REFERENCES anuncios(id_externo),
    data TEXT NOT NULL,
    preco REAL NOT NULL,
    km INTEGER NOT NULL,
    PRIMARY KEY (id_externo, data)
  );
  CREATE INDEX anuncio_leituras_data ON anuncio_leituras(data);
  INSERT INTO anuncio_leituras (id_externo, data, preco, km) SELECT id_externo, ultimo_visto, preco, km FROM anuncios;
  CREATE TABLE fontes_modelo (
    modelo_id INTEGER NOT NULL REFERENCES modelos(id),
    fonte TEXT NOT NULL,
    caminho TEXT NOT NULL,
    versao TEXT,
    PRIMARY KEY (modelo_id, fonte)
  );
  INSERT INTO fontes_modelo (modelo_id, fonte, caminho, versao)
    SELECT id, 'mobiauto', mobiauto_caminho, mobiauto_versao FROM modelos WHERE mobiauto_caminho IS NOT NULL;
  ALTER TABLE modelos ADD COLUMN preco_compra REAL;
  ALTER TABLE modelos ADD COLUMN preco_compra_em TEXT;
  ALTER TABLE modelos ADD COLUMN preco_compra_por INTEGER REFERENCES usuarios(id);
`;

export default {
  versao: 5,
  aplicar(db) {
    db.exec(SQL);
    const ins = db.prepare("INSERT INTO fontes_modelo (modelo_id, fonte, caminho, versao) SELECT id, 'napista', ?, ? FROM modelos WHERE slug = ?");
    for (const [slug, f] of Object.entries(NAPISTA)) ins.run(f.caminho, f.versao, slug);
  },
};
