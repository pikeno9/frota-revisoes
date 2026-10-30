import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, bancoLegado } from './ajuda.js';
import { migrar, versaoAtual } from '../src/migracoes/index.js';
import legado from '../src/migracoes/001-legado.js';
import v2 from '../src/migracoes/002-v2.js';

test('v3 cria as tabelas, preenche os parâmetros e as premissas', () => {
  const db = bancoNovo();
  assert.equal(versaoAtual(db), 5);
  const polo = db.prepare("SELECT fipe_marca, fipe_modelo, fipe_combustivel, fipe_modelo_ref, mobiauto_caminho, mobiauto_versao FROM modelos WHERE slug = 'polo-track'").get();
  assert.deepEqual({ ...polo }, { fipe_marca: 59, fipe_modelo: 10176, fipe_combustivel: 5, fipe_modelo_ref: null, mobiauto_caminho: 'volkswagen/polo', mobiauto_versao: '^Track' });
  assert.equal(db.prepare("SELECT fipe_modelo_ref FROM modelos WHERE slug = 'onix-sedan-plus'").get().fipe_modelo_ref, 8950);
  assert.equal(db.prepare("SELECT mobiauto_versao FROM modelos WHERE slug = 'argo-drive'").get().mobiauto_versao, '^Drive 1\\.0');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM modelos WHERE fipe_modelo IS NULL').get().n, 0);
  const premissas = Object.fromEntries(db.prepare('SELECT chave, valor FROM premissas').all().map(p => [p.chave, p.valor]));
  assert.deepEqual(premissas, { atacado_pct_base: 85, varejo_negociacao_pct: 5, motorista_pct_base: 100 });
  for (const t of ['fipe_precos', 'anuncios', 'ipca', 'vendas', 'estudos']) {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, t);
  }
});

test('v3 não mexe no histórico: veículos, preços e vigências ficam iguais', () => {
  const db = bancoLegado({
    veiculos: [[1, 'Volkswagen', 'Polo Track', '1.0']],
    precos: [[1, '1ª revisão (10.000 km)', '2026-08-01', 846.64], [1, '1ª revisão (10.000 km)', '2026-09-01', 864.46]],
  });
  migrar(db, [legado, v2]);
  const foto = () => JSON.stringify([
    db.prepare('SELECT * FROM veiculos ORDER BY id').all(),
    db.prepare('SELECT * FROM precos ORDER BY id').all(),
    db.prepare('SELECT * FROM vigencias ORDER BY id').all(),
    db.prepare('SELECT * FROM alertas ORDER BY id').all(),
  ]);
  const antes = foto();
  assert.equal(migrar(db), 5);
  assert.equal(foto(), antes);
});

test('venda com canal fora da lista é recusada pelo banco', () => {
  const db = bancoNovo();
  assert.throws(() => db.prepare("INSERT INTO vendas (placa, modelo_id, data, km, preco, canal) VALUES ('ABC1D23', 1, '2026-10-01', 50000, 60000, 'leilao')").run(), /CHECK/);
});

test('v5: anúncios antigos ganham fonte e a primeira leitura; fontes por modelo com Mobiauto e NaPista', async () => {
  const { abrir } = await import('../src/db.js');
  const { MIGRACOES } = await import('../src/migracoes/index.js');
  const db = abrir(':memory:');
  migrar(db, MIGRACOES.filter(m => m.versao <= 4));
  const polo = db.prepare("SELECT id FROM modelos WHERE slug = 'polo-track'").get().id;
  db.prepare("INSERT INTO anuncios (id_externo, modelo_id, versao, ano_modelo, km, preco, loja, primeiro_visto, ultimo_visto) VALUES ('mobiauto:7', ?, 'Track', 2025, 40000, 75000, 'Loja', '2026-10-28', '2026-10-28')").run(polo);
  assert.equal(migrar(db), 5);
  assert.equal(db.prepare("SELECT fonte FROM anuncios WHERE id_externo = 'mobiauto:7'").get().fonte, 'mobiauto');
  assert.deepEqual({ ...db.prepare('SELECT * FROM anuncio_leituras').get() }, { id_externo: 'mobiauto:7', data: '2026-10-28', preco: 75000, km: 40000 });
  const fontes = db.prepare("SELECT f.fonte, f.caminho, f.versao FROM fontes_modelo f JOIN modelos m ON m.id = f.modelo_id WHERE m.slug = 'polo-track' ORDER BY f.fonte").all().map(f => ({ ...f }));
  assert.deepEqual(fontes, [
    { fonte: 'mobiauto', caminho: 'volkswagen/polo', versao: '^Track' },
    { fonte: 'napista', caminho: 'sp/volkswagen/polo-track', versao: 'Polo.*Track' },
  ]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fontes_modelo WHERE fonte = 'napista'").get().n, 6);
  assert.equal(db.prepare('SELECT preco_compra FROM modelos WHERE id = ?').get(polo).preco_compra, null);
});
