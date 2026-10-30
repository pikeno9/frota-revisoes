import { abrir } from '../src/db.js';
import { migrar } from '../src/migracoes/index.js';
import legado from '../src/migracoes/001-legado.js';

// Os códigos FIPE de referência por categoria (migração 006) ficam desligados: as contas de chamadas
// à FIPE dos testes são da frota. Quem testa as referências usa { referencias: true }.
export function bancoNovo({ referencias = false } = {}) {
  const db = abrir(':memory:');
  migrar(db);
  if (!referencias) db.exec('UPDATE fipe_referencias SET ativo = 0');
  return db;
}

// Banco no formato antigo, sem migrar: { veiculos: [[id, montadora, modelo, versao]], precos: [[veiculo_id, revisao, data, valor]] }
export function bancoLegado({ veiculos = [], precos = [] }) {
  const db = abrir(':memory:');
  legado.aplicar(db);
  const iv = db.prepare('INSERT INTO veiculos (id, montadora, modelo, versao, ano, apelido) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [id, mont, mod, ver] of veiculos) iv.run(id, mont, mod, ver ?? null, '26/26', mod);
  const ip = db.prepare('INSERT INTO precos (veiculo_id, revisao, data_coleta, valor, fonte) VALUES (?, ?, ?, ?, ?)');
  for (const [vid, rev, data, valor] of precos) ip.run(vid, rev, data, valor, 'scraper');
  return db;
}

// Imita a resposta do fetch.
export function resposta(corpo, { status = 200, cookies = [] } = {}) {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  return {
    ok: status < 400, status,
    headers: { getSetCookie: () => cookies, get: () => null },
    text: async () => texto,
    json: async () => JSON.parse(texto),
  };
}

export async function servidor(app) {
  const s = app.listen(0);
  await new Promise(r => s.once('listening', r));
  return { url: `http://127.0.0.1:${s.address().port}`, fechar: () => new Promise(r => s.close(r)) };
}
