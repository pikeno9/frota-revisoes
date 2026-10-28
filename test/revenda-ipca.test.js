import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resposta } from './ajuda.js';
import { lerSerie, serie } from '../src/revenda/ipca.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/bcb-ipca-2026-10-28.json', import.meta.url), 'utf8'));

test('série salva em 28/10: jan/2024 a set/2026', () => {
  const s = lerSerie(fixture);
  assert.equal(s.length, 33);
  assert.deepEqual(s[0], { mes: '2024-01', variacao: 0.42 });
  assert.deepEqual(s.at(-1), { mes: '2026-09', variacao: 0.82 });
  assert.deepEqual(s.find(x => x.mes === '2026-08'), { mes: '2026-08', variacao: -0.32 });
});

test('linha ilegível é erro, não zero', () => {
  assert.throws(() => lerSerie([{ data: '2026-09-01', valor: '0.82' }]), /linha ilegível/);
  assert.throws(() => lerSerie([{ data: '01/09/2026', valor: null }]), /linha ilegível/);
  assert.throws(() => lerSerie({}), /formato inesperado/);
});

test('serie() pede a partir do primeiro dia do mês', async () => {
  let url;
  const s = await serie('2026-08', async u => { url = u; return resposta(fixture.slice(-2)); });
  assert.equal(url, 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=01/08/2026');
  assert.equal(s.length, 2);
});

test('serie(): BCB 502 e depois 200 dá certo; 502 sempre falha com status; 4xx falha na hora', async () => {
  let n = 0;
  const s = await serie('2026-08', async () => (++n === 1 ? resposta('x', { status: 502 }) : resposta(fixture.slice(-2))), { esperaMs: 0 });
  assert.equal(n, 2);
  assert.equal(s.length, 2);
  n = 0;
  const erro = await serie('2026-08', async () => { n++; return resposta('x', { status: 502 }); }, { esperaMs: 0 }).catch(e => e);
  assert.equal(n, 4);
  assert.equal(erro.status, 502);
  assert.match(erro.message, /BCB respondeu 502/);
  n = 0;
  await assert.rejects(serie('2026-08', async () => { n++; return resposta('x', { status: 404 }); }, { esperaMs: 0 }), /BCB respondeu 404/);
  assert.equal(n, 1);
});
