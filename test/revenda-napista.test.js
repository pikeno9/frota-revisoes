import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resposta } from './ajuda.js';
import { urlBusca, lerPagina, filtrar, anuncios } from '../src/revenda/napista.js';
import { tipoVendedor } from '../src/revenda/vendedor.js';

// Página real de 29/10 (Argo 2025 em SP), salva só com os campos que o leitor usa.
const real = JSON.parse(readFileSync(new URL('./fixtures/napista-argo-2025-2026-10-29.json', import.meta.url), 'utf8'));
const comoHtml = r => `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { searchResult: r } } })}</script></body></html>`;
const oferta = (id, o = {}) => ({ id, versionName: 'Volkswagen Polo 1.0 Track', modelYear: 2025, manufacturedYear: 2024, mileage: 40000, price: 75000, seller: 'Loja X', location: { city: 'SAO PAULO' }, newVehicle: false, ...o });

test('urlBusca: o ano no caminho e a página em ?pn', () => {
  assert.equal(urlBusca('sp/fiat/argo', 2025), 'https://napista.com.br/busca/sp/fiat/argo/2025');
  assert.equal(urlBusca('sp/fiat/argo', 2025, 3), 'https://napista.com.br/busca/sp/fiat/argo/2025?pn=3');
});

test('lerPagina tira offers e offersTotal do __NEXT_DATA__', () => {
  const p = lerPagina(comoHtml(real));
  assert.equal(p.total, 794);
  assert.equal(p.offers.length, 48);
  assert.throws(() => lerPagina('<html></html>'), /sem __NEXT_DATA__/);
  assert.throws(() => lerPagina(comoHtml(null)), /sem a lista/);
});

test('filtrar: só a versão pedida (a busca do Argo traz Trekking, 1.3 e Mobi), com link e vendedor', () => {
  const lista = filtrar(real.offers, { versao: 'Argo (Drive 1\\.0|1\\.0 Drive)', anoMin: 2023 });
  assert.equal(lista.length, 37);
  assert.ok(lista.every(a => /Drive/.test(a.versao) && !/1\.3/.test(a.versao) && a.ano_modelo === 2025));
  const a = lista[0];
  assert.match(a.id_externo, /^napista:[0-9a-f-]{36}$/);
  assert.equal(a.url, `https://napista.com.br/anuncios/${a.id_externo.slice(8)}`);
  assert.equal(a.leilao, null, 'a lista da NaPista não diz se é de leilão');
});

test('filtrar descarta zero km, ano antigo, preço zerado e km faltando', () => {
  const lista = filtrar([
    oferta('a'), oferta('b', { newVehicle: true }), oferta('c', { modelYear: 2021 }),
    oferta('d', { price: 0 }), oferta('e', { mileage: null }), oferta('f', { versionName: 'Volkswagen Polo 1.0 170 Tsi' }),
    oferta('g', { seller: 'Localiza Nações Unidas' }),
  ], { versao: 'Polo.*Track', anoMin: 2023 });
  assert.deepEqual(lista.map(a => a.id_externo), ['napista:a', 'napista:g']);
  assert.deepEqual(lista.map(a => a.tipo_vendedor), ['loja', 'locadora']);
  assert.equal(lista[0].cidade, 'SAO PAULO');
});

test('anuncios percorre os anos e as páginas e para no total', async () => {
  const pedidos = [];
  const buscar = async url => {
    pedidos.push(url.replace('https://napista.com.br/busca/sp/volkswagen/polo-track/', ''));
    if (url.includes('/2025')) {
      const pn = Number(new URL(url).searchParams.get('pn') ?? 1);
      return resposta(comoHtml({ offersTotal: 60, offers: pn === 1 ? Array.from({ length: 48 }, (_, i) => oferta(`p1-${i}`)) : [oferta('p2-0'), oferta('p1-0')] }));
    }
    return resposta(comoHtml({ offersTotal: 0, offers: [] }));
  };
  const lista = await anuncios({ caminho: 'sp/volkswagen/polo-track', versao: 'Track', anoMin: 2024, anoMax: 2026, pausaMs: 0 }, buscar);
  assert.deepEqual(pedidos, ['2024', '2025', '2025?pn=2', '2026']);
  assert.equal(lista.length, 49, 'o anúncio repetido entre páginas conta uma vez');
});

test('tipoVendedor', () => {
  assert.equal(tipoVendedor('MOVIDA SEMINOVOS', true), 'locadora');
  assert.equal(tipoVendedor('Loja X', true), 'loja');
  assert.equal(tipoVendedor(null, false), 'particular');
  assert.equal(tipoVendedor(null, null), null);
});
