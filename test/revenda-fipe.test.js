import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resposta } from './ajuda.js';
import { mesDeTexto, valorEmReais, lerReferencias, lerValor, referencias, valor } from '../src/revenda/fipe.js';

const fixture = nome => JSON.parse(readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), 'utf8'));

test('mesDeTexto entende os dois formatos da FIPE', () => {
  assert.equal(mesDeTexto('outubro/2026 '), '2026-10');
  assert.equal(mesDeTexto('outubro de 2025 '), '2025-10');
  assert.equal(mesDeTexto('março/2024'), '2024-03');
  assert.equal(mesDeTexto('13/2024'), null);
});

test('valorEmReais tira pontos e vírgula', () => {
  assert.equal(valorEmReais('R$ 77.170,00'), 77170);
  assert.equal(valorEmReais('R$ 186.990,50'), 186990.5);
  assert.equal(valorEmReais('sem valor'), null);
});

test('referências salvas em 28/10: 338 é out/2026 e 326 é out/2025', () => {
  const refs = lerReferencias(fixture('fipe-referencias-2026-10-28.json'));
  assert.equal(refs.length, 40);
  assert.deepEqual(refs[0], { codigo: 338, mes: '2026-10' });
  assert.deepEqual(refs.find(r => r.codigo === 326), { codigo: 326, mes: '2025-10' });
});

test('valor do Polo Track 2025 em out/2025 e out/2026, zero km e nada encontrado', () => {
  assert.deepEqual(lerValor(fixture('fipe-polo-2025-ref326.json')), { valor: 77170, codigo_fipe: '005540-9', ano_modelo: 2025, referencia: '2025-10' });
  assert.deepEqual(lerValor(fixture('fipe-polo-2025-ref338.json')), { valor: 73674, codigo_fipe: '005540-9', ano_modelo: 2025, referencia: '2026-10' });
  assert.deepEqual(lerValor(fixture('fipe-polo-0km-ref326.json')), { valor: 86668, codigo_fipe: '005540-9', ano_modelo: 32000, referencia: '2025-10' });
  assert.equal(lerValor(fixture('fipe-nada.json')), null);
  assert.throws(() => lerValor({ Valor: '???' }), /resposta inesperada/);
});

test('consulta manda o formulário e os cabeçalhos que a FIPE exige', async () => {
  const pedidos = [];
  const buscar = async (url, op) => { pedidos.push({ url, op }); return resposta(fixture('fipe-polo-2025-ref338.json')); };
  const v = await valor({ codigoReferencia: 338, marca: 59, modelo: 10176, ano: 2025, combustivel: 5 }, buscar);
  assert.equal(v.valor, 73674);
  const { url, op } = pedidos[0];
  assert.equal(url, 'https://veiculos.fipe.org.br/api/veiculos/ConsultarValorComTodosParametros');
  assert.equal(op.method, 'POST');
  assert.equal(op.headers.Referer, 'https://veiculos.fipe.org.br/');
  assert.equal(op.headers['X-Requested-With'], 'XMLHttpRequest');
  const form = Object.fromEntries(new URLSearchParams(op.body));
  assert.deepEqual(form, {
    codigoTabelaReferencia: '338', codigoMarca: '59', codigoModelo: '10176', codigoTipoVeiculo: '1', anoModelo: '2025',
    codigoTipoCombustivel: '5', tipoVeiculo: 'carro', modeloCodigoExterno: '', tipoConsulta: 'tradicional',
  });
});

test('referencias() lê a lista e erro HTTP vira exceção com o status', async () => {
  const refs = await referencias(async () => resposta(fixture('fipe-referencias-2026-10-28.json')));
  assert.equal(refs[1].mes, '2026-09');
  await assert.rejects(referencias(async () => resposta('x', { status: 429 })), /FIPE respondeu 429/);
});

test('lerValor recusa resposta sem mês de referência ou sem ano-modelo', () => {
  const base = fixture('fipe-polo-2025-ref338.json');
  assert.throws(() => lerValor({ ...base, MesReferencia: 'lixo' }), /FIPE: resposta inesperada/);
  assert.throws(() => lerValor({ ...base, AnoModelo: undefined }), /FIPE: resposta inesperada/);
  assert.throws(() => lerValor({ ...base, AnoModelo: 'abc' }), /FIPE: resposta inesperada/);
});
