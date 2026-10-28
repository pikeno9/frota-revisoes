import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, resposta } from './ajuda.js';
import { buscarFrota, aplicarFrota } from '../src/frota.js';

test('buscarFrota manda o Bearer e devolve a contagem', async () => {
  let pedido;
  const buscar = async (url, op) => { pedido = { url, auth: op.headers.Authorization }; return resposta({ atualizado: 'x', modelos: { polo: 76, argo: 69 } }); };
  const r = await buscarFrota({ url: 'https://veiculos.ocnbrasil.com.br/', token: 't1' }, buscar);
  assert.deepEqual(r, { polo: 76, argo: 69 });
  assert.deepEqual(pedido, { url: 'https://veiculos.ocnbrasil.com.br/api/precos/frota', auth: 'Bearer t1' });
});

test('buscarFrota lança com status de erro', async () => {
  await assert.rejects(buscarFrota({ url: 'http://x', token: 't' }, async () => resposta({ erro: 'token' }, { status: 401 })), /401/);
});

test('aplicarFrota atualiza quantidade, origem e avisa modelo sem cadastro', () => {
  const db = bancoNovo();
  const r = aplicarFrota(db, { polo: 76, argo: 69, tera: 0, kwid: 3 }, null);
  const q = slug => ({ ...db.prepare('SELECT qtd_frota, origem FROM modelos WHERE slug = ?').get(slug) });
  assert.deepEqual(q('polo-track'), { qtd_frota: 76, origem: 'frota' });
  assert.deepEqual(q('tera'), { qtd_frota: 0, origem: 'candidato' });
  assert.deepEqual(r.novas, ['kwid']);
  assert.equal(db.prepare("SELECT texto FROM alertas WHERE tipo = 'frota_sem_modelo'").get().texto, 'kwid: 3 carros');
});
