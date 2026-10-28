import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hojeSP, diaAnterior } from '../src/datas.js';
import { abrir, transacao } from '../src/db.js';
import { migrar, versaoAtual } from '../src/migracoes/index.js';

test('hojeSP usa o fuso de São Paulo', () => {
  assert.equal(hojeSP(new Date('2026-11-02T02:30:00Z')), '2026-11-01');
});

test('diaAnterior atravessa mês e ano', () => {
  assert.equal(diaAnterior('2026-10-01'), '2026-09-30');
  assert.equal(diaAnterior('2027-01-01'), '2026-12-31');
});

test('transacao desfaz tudo quando a função lança', () => {
  const db = abrir(':memory:');
  db.exec('CREATE TABLE t (x INTEGER)');
  assert.throws(() => transacao(db, () => { db.exec('INSERT INTO t VALUES (1)'); throw new Error('x'); }));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM t').get().n, 0);
});

test('migrar aplica cada versão uma vez só', () => {
  const db = abrir(':memory:');
  const lista = [{ versao: 1, aplicar: d => d.exec('CREATE TABLE a (x)') }];
  assert.equal(migrar(db, lista), 1);
  assert.equal(migrar(db, lista), 1);
  assert.equal(versaoAtual(db), 1);
});

test('transacao relança o erro original mesmo se o ROLLBACK falhar', () => {
  const db = abrir(':memory:');
  assert.throws(() => transacao(db, () => { db.exec('ROLLBACK'); throw new Error('original'); }), /original/);
});
