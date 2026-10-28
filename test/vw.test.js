import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resposta } from './ajuda.js';
import * as vw from '../src/coletores/vw.js';
import { COLETORES } from '../src/coletores/index.js';

function siteFalso() {
  const pedidos = [];
  const buscar = async (url, op = {}) => {
    pedidos.push({ url, cookie: op.headers?.Cookie ?? null, method: op.method ?? 'GET' });
    if (url.endsWith('/Revisao/')) return resposta('', { cookies: ['ASP.NET_SessionId=abc; path=/; HttpOnly'] });
    if (url.includes('getversao')) return resposta([{ Versao: '1.0 MPI', ShowPlanoNovo: false }]);
    if (url.includes('getar')) return resposta({ VersaoComAr: true });
    if (url.includes('getcidades')) return resposta([{ idCidade: 7107, nome: 'São Paulo' }]);
    if (url.includes('getregiao')) return resposta([{ localizacao: { regiao: 1 } }]);
    const n = url.match(/getrevisao\/(\d+)/);
    if (n) return resposta({ Data: { total_ItensSubstituidos: 500 + Number(n[1]), total_MaoDeObra: 300.1 } });
    return resposta('');
  };
  return { buscar, pedidos };
}

test('VW: 10 revisões de 10 em 10 mil km, preço = peças + mão de obra', async () => {
  const { buscar } = siteFalso();
  const itens = await vw.coletar({ modelo: 'Polo Track', versao: '1.0 MPI', ano: 2026 }, buscar);
  assert.equal(itens.length, 10);
  assert.deepEqual(itens[0], { ordem: 1, km: 10000, meses: null, valor: 801.1 });
  assert.equal(itens[9].km, 100000);
});

test('VW: manda o cookie da sessão nas chamadas seguintes', async () => {
  const { buscar, pedidos } = siteFalso();
  await vw.coletar({ modelo: 'Tera', versao: '1.0 MPI', ano: 2026 }, buscar);
  assert.equal(pedidos[0].cookie, null);
  assert.ok(pedidos.slice(1).every(p => p.cookie === 'ASP.NET_SessionId=abc'));
});

test('registro tem os quatro coletores', () => {
  assert.deepEqual(Object.keys(COLETORES).sort(), ['byd', 'fiat', 'gm', 'vw']);
});
