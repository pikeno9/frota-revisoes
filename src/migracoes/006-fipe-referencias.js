// v6: códigos FIPE de referência, sem anúncios, só para comparar a queda de valor por categoria
// (combustão, elétrico, híbrido) com mais de um modelo em cada. Conferidos na FIPE em 30/10/2026:
// todos com preço de zero km na referência de outubro.
export const REFERENCIAS = [
  { fipe_marca: 238, fipe_modelo: 10878, combustivel: 4, nome: 'BYD Dolphin Plus', categoria: 'eletrico' },
  { fipe_marca: 238, fipe_modelo: 12124, combustivel: 4, nome: 'BYD Dolphin Mini GS', categoria: 'eletrico' },
  { fipe_marca: 238, fipe_modelo: 10833, combustivel: 4, nome: 'BYD Seal', categoria: 'eletrico' },
  { fipe_marca: 238, fipe_modelo: 10184, combustivel: 4, nome: 'BYD Yuan Plus', categoria: 'eletrico' },
  { fipe_marca: 238, fipe_modelo: 11199, combustivel: 4, nome: 'BYD Yuan Pro', categoria: 'eletrico' },
  { fipe_marca: 240, fipe_modelo: 10886, combustivel: 4, nome: 'GWM Ora 03 Skin', categoria: 'eletrico' },
  { fipe_marca: 238, fipe_modelo: 11079, combustivel: 6, nome: 'BYD King GS', categoria: 'hibrido' },
  { fipe_marca: 238, fipe_modelo: 11084, combustivel: 6, nome: 'BYD Song Plus', categoria: 'hibrido' },
  { fipe_marca: 238, fipe_modelo: 11106, combustivel: 6, nome: 'BYD Song Pro GL', categoria: 'hibrido' },
  { fipe_marca: 56, fipe_modelo: 9987, combustivel: 6, nome: 'Toyota Corolla Cross XRX Híbrido', categoria: 'hibrido' },
  { fipe_marca: 48, fipe_modelo: 8023, combustivel: 5, nome: 'Renault Kwid Zen 1.0', categoria: 'combustao' },
  { fipe_marca: 21, fipe_modelo: 7540, combustivel: 5, nome: 'Fiat Mobi Like 1.0', categoria: 'combustao' },
];

const SQL = `
  CREATE TABLE fipe_referencias (
    fipe_modelo INTEGER PRIMARY KEY,
    fipe_marca INTEGER NOT NULL,
    combustivel INTEGER NOT NULL,
    nome TEXT NOT NULL,
    categoria TEXT NOT NULL CHECK (categoria IN ('combustao','eletrico','hibrido')),
    ativo INTEGER NOT NULL DEFAULT 1
  );
`;

export default {
  versao: 6,
  aplicar(db) {
    db.exec(SQL);
    const ins = db.prepare('INSERT INTO fipe_referencias (fipe_modelo, fipe_marca, combustivel, nome, categoria) VALUES (?, ?, ?, ?, ?)');
    for (const r of REFERENCIAS) ins.run(r.fipe_modelo, r.fipe_marca, r.combustivel, r.nome, r.categoria);
  },
};
