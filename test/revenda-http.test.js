import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comEspera, deRede, repetivel } from '../src/revenda/http.js';

// Como o fetch do Node falha quando a conexão cai ou é recusada.
const semConexao = () => new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
const tempoEsgotado = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

test('deRede reconhece conexão recusada e tempo esgotado, não erro de programa nem HTTP', () => {
  assert.equal(deRede(semConexao()), true);
  assert.equal(deRede(tempoEsgotado()), true);
  assert.equal(deRede(new TypeError('x is not a function')), false);
  assert.equal(deRede(Object.assign(new Error('FIPE respondeu 429'), { status: 429 })), false);
  assert.equal(deRede(new SyntaxError('Unexpected token <')), false);
  assert.equal(repetivel(semConexao()), true);
  assert.equal(repetivel(Object.assign(new Error('x'), { status: 503 })), true);
  assert.equal(repetivel(Object.assign(new Error('x'), { status: 404 })), false);
});

test('comEspera: falha de rede espera e tenta de novo até passar', async () => {
  let n = 0;
  const r = await comEspera(async () => { if (++n < 3) throw semConexao(); return 'ok'; }, { esperaMs: 0 });
  assert.equal(r, 'ok');
  assert.equal(n, 3);
});

test('comEspera: tempo esgotado quatro vezes (1 pedido + 3) sobe o último erro', async () => {
  let n = 0;
  const erro = await comEspera(async () => { n++; throw tempoEsgotado(); }, { esperaMs: 0 }).catch(e => e);
  assert.equal(n, 4);
  assert.equal(erro.name, 'TimeoutError');
});

test('comEspera: erro de programa não repete', async () => {
  let n = 0;
  await assert.rejects(comEspera(async () => { n++; throw new TypeError('x is not a function'); }, { esperaMs: 0 }), /not a function/);
  assert.equal(n, 1);
});
