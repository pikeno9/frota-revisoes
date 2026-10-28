import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resposta } from './ajuda.js';
import * as byd from '../src/coletores/byd.js';
import * as gm from '../src/coletores/gm.js';
import * as fiat from '../src/coletores/fiat.js';

const fx = nome => readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), 'utf8');
const servir = corpo => async () => resposta(corpo);

test('BYD: lê os 21 modelos do HTML', () => {
  const lista = byd.lerHtml(fx('byd-2026-10-28.html'));
  assert.equal(lista.length, 21);
  assert.ok(lista.some(x => x.nome === 'BYD King'));
});

test('BYD: King com 10 revisões, km de 12 mil e meses de 12 em 12', async () => {
  const itens = await byd.coletar({ nome: 'BYD King' }, servir(fx('byd-2026-10-28.html')));
  assert.deepEqual(itens.map(i => i.valor), [926, 1290, 926, 2472, 926, 2375, 926, 2472, 926, 2496]);
  assert.deepEqual(itens[0], { ordem: 1, km: 12000, meses: 12, valor: 926 });
  assert.equal(itens[9].km, 120000);
});

test('BYD: modelo que não está na página lança erro claro', async () => {
  await assert.rejects(byd.coletar({ nome: 'BYD Inexistente' }, servir(fx('byd-2026-10-28.html'))), /não está na página/);
});

test('BYD: página sem tabela lança erro', async () => {
  await assert.rejects(byd.coletar({ nome: 'BYD King' }, servir('<html></html>')), /tabela de preços não encontrada/);
});

test('BYD: catálogo dá rótulo e parâmetros', async () => {
  const cat = await byd.catalogo(servir(fx('byd-2026-10-28.html')));
  assert.deepEqual(cat.find(c => c.rotulo === 'BYD King'), { rotulo: 'BYD King', parametros: { nome: 'BYD King' } });
});

test('GM: preço parcelado vira total', () => {
  assert.equal(gm.parsePreco('4 x R$ 139'), 556);
  assert.equal(gm.parsePreco('R$ 1.020,50'), 1020.5);
  assert.equal(gm.parsePreco('consulte'), null);
  assert.equal(gm.mesesDoTitulo('Revisão 10.000Km ou 1 Ano'), 12);
  assert.equal(gm.mesesDoTitulo('Revisão 20.000Km ou 2 Anos'), 24);
});

test('GM: Onix Plus Aspirado 2026 com 10 revisões', async () => {
  const itens = await gm.coletar({ model: 'Onix Plus', year: '2026', trim: 'Aspirado' }, servir(fx('gm-onix-2026-10-28.json')));
  assert.deepEqual(itens.map(i => i.valor), [556, 932, 844, 1028, 944, 932, 844, 1400, 812, 1096]);
  assert.deepEqual(itens[0], { ordem: 1, km: 10000, meses: 12, valor: 556 });
});

test('GM: trim com ponto do catálogo casa literal', async () => {
  const itens = await gm.coletar({ model: 'Onix Plus', year: '2026', trim: '1.0 Aspirado' }, servir(fx('gm-onix-2026-10-28.json')));
  assert.equal(itens.length, 10);
});

test('Fiat: 5 revisões reais, km em milhares vira km', async () => {
  const itens = await fiat.coletar({ mvsCode: '358ATS1', modelYear: 2026, dealer: '919654' }, servir(fx('fiat-358ATS1-2026-10-28.json')));
  assert.deepEqual(itens, [
    { ordem: 1, km: 10000, meses: 12, valor: 701 },
    { ordem: 2, km: 20000, meses: 24, valor: 931 },
    { ordem: 3, km: 30000, meses: 36, valor: 701 },
    { ordem: 4, km: 40000, meses: 48, valor: 1576 },
    { ordem: 5, km: 50000, meses: 60, valor: 721 },
  ]);
});

test('Fiat: resposta vazia lança erro', async () => {
  await assert.rejects(fiat.coletar({ mvsCode: 'X', modelYear: 2026, dealer: '1' }, servir([])), /nenhuma revisão/);
});
