import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resposta } from './ajuda.js';
import { urlPagina, lerPagina, filtrar, anuncios } from '../src/revenda/mobiauto.js';

const texto = nome => readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), 'utf8');
const deals = p => JSON.parse(texto(`mobiauto-polo-p${p}-2026-10-28.json`));
// As páginas reais foram salvas só com o deals; aqui viram HTML de novo, como o site entrega.
const comoHtml = d => `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { deals: d } } })}</script></body></html>`;

test('urlPagina: a primeira sem sufixo, as outras com /pagina-N', () => {
  assert.equal(urlPagina('volkswagen/polo', 1), 'https://www.mobiauto.com.br/comprar/carros/sp/volkswagen/polo');
  assert.equal(urlPagina('volkswagen/polo', 2), 'https://www.mobiauto.com.br/comprar/carros/sp/volkswagen/polo/pagina-2');
});

test('lerPagina tira o deals do __NEXT_DATA__', () => {
  const d = lerPagina(texto('mobiauto-pagina-minima.html'));
  assert.equal(d.numResults, 4);
  assert.equal(d.results.length, 4);
  assert.throws(() => lerPagina('<html></html>'), /sem __NEXT_DATA__/);
});

test('filtrar deixa só usado, do ano mínimo em diante e da versão pedida', () => {
  const { results } = lerPagina(texto('mobiauto-pagina-minima.html'));
  assert.deepEqual(filtrar(results, { versao: '^Track', anoMin: 2023 }), [
    { id_externo: 'mobiauto:33144909', versao: 'Track 1.0 Flex 12V 5p', ano_modelo: 2025, ano_fabricacao: 2024, km: 51460, preco: 74870, loja: 'Loja A', tipo_vendedor: 'loja', cidade: 'São Paulo', url: null, leilao: null },
  ]);
  assert.equal(filtrar(results, { versao: null, anoMin: 2020 }).length, 3);
  assert.equal(filtrar(results, { versao: 'track', anoMin: 2020 }).length, 2, 'sem diferenciar maiúsculas');
});

test('páginas reais de 28/10: Polo Track de 2023 em diante', () => {
  const p1 = filtrar(deals(1).results, { versao: '^Track', anoMin: 2023 });
  const p2 = filtrar(deals(2).results, { versao: '^Track', anoMin: 2023 });
  assert.equal(deals(1).numResults, 3073);
  assert.equal(p1.length, 10);
  assert.equal(p2.length, 17);
  assert.ok(p1.every(a => /^Track/.test(a.versao) && a.ano_modelo >= 2023));
});

test('anuncios percorre as páginas, junta repetidos e para na página vazia', async () => {
  const pedidos = [];
  const buscar = async url => {
    pedidos.push(url);
    if (url.endsWith('/polo')) return resposta(comoHtml(deals(1)));
    if (url.endsWith('/pagina-2')) return resposta(comoHtml(deals(2)));
    return resposta(comoHtml({ numResults: 3073, results: [] }));
  };
  const lista = await anuncios({ caminho: 'volkswagen/polo', versao: '^Track', anoMin: 2023, pausaMs: 0 }, buscar);
  assert.deepEqual(pedidos.map(u => u.replace('https://www.mobiauto.com.br/comprar/carros/sp/volkswagen/polo', '')), ['', '/pagina-2', '/pagina-3']);
  assert.equal(lista.length, 26, '10 + 17 com 1 anúncio repetido entre as páginas');
  assert.equal(new Set(lista.map(a => a.id_externo)).size, 26);
});

test('anuncios respeita o limite de páginas e o total de resultados', async () => {
  let n = 0;
  const buscar = async () => { n++; return resposta(comoHtml(deals(1))); };
  await anuncios({ caminho: 'volkswagen/polo', versao: '^Track', anoMin: 2023, maxPaginas: 3, pausaMs: 0 }, buscar);
  assert.equal(n, 3);
  n = 0;
  await anuncios({ caminho: 'x/y', anoMin: 2023, pausaMs: 0 }, async () => { n++; return resposta(texto('mobiauto-pagina-minima.html')); });
  assert.equal(n, 1, 'numResults 4 cabe em uma página');
});

test('página com 429 espera e tenta de novo; sem sucesso depois de 3 retentativas, falha com status', async () => {
  let n = 0;
  const buscar = async () => (++n === 1 ? resposta('', { status: 429 }) : resposta(texto('mobiauto-pagina-minima.html')));
  const lista = await anuncios({ caminho: 'x/y', anoMin: 2023, pausaMs: 0, esperaMs: 0 }, buscar);
  assert.equal(n, 2);
  assert.ok(lista.length > 0);
  n = 0;
  const erro = await anuncios({ caminho: 'x/y', anoMin: 2023, pausaMs: 0, esperaMs: 0 }, async () => { n++; return resposta('', { status: 503 }); }).catch(e => e);
  assert.equal(n, 4);
  assert.equal(erro.status, 503);
  assert.match(erro.message, /Mobiauto respondeu 503/);
});

test('conexão recusada numa página espera e tenta de novo', async () => {
  let n = 0;
  const buscar = async () => {
    if (++n === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    return resposta(texto('mobiauto-pagina-minima.html'));
  };
  const lista = await anuncios({ caminho: 'x/y', anoMin: 2023, pausaMs: 0, esperaMs: 0 }, buscar);
  assert.equal(n, 2);
  assert.ok(lista.length > 0);
});

test('erro HTTP da Mobiauto vira exceção', async () => {
  await assert.rejects(anuncios({ caminho: 'x/y', anoMin: 2023, pausaMs: 0 }, async () => resposta('', { status: 403 })), /Mobiauto respondeu 403/);
});

test('filtrar recusa anúncio sem km, sem preço ou sem id', () => {
  const ok = { id: 1, km: 1000, price: 70000, trim: { name: 'Track', model: { year: 2025 } } };
  assert.equal(filtrar([ok], { anoMin: 2023 }).length, 1);
  assert.equal(filtrar([{ ...ok, km: null }], { anoMin: 2023 }).length, 0);
  assert.equal(filtrar([{ ...ok, km: undefined }], { anoMin: 2023 }).length, 0);
  assert.equal(filtrar([{ ...ok, price: null }], { anoMin: 2023 }).length, 0);
  assert.equal(filtrar([{ ...ok, id: null }], { anoMin: 2023 }).length, 0);
});
