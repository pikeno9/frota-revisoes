import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idade, calcularEstudo, emprestar, projetar, ZERO_KM } from '../src/revenda/estudo.js';
import { pesoKm, medianaPonderada, deduplicar, calcularConsenso, projetarConsenso, criterioFipe, tipoDe } from '../src/revenda/consenso.js';
import { fipeSintetica, ipcaSintetico, anunciosSinteticos } from './sinteticos.js';

const HOJE = '2026-10-28';
const PREMISSAS = { atacado_pct_base: 85, varejo_negociacao_pct: 5, motorista_pct_base: 100 };
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, msg ?? `${a} ≠ ${b}`);

// Duas fontes com o mesmo mercado; a NaPista pede 5% a mais. Desvios simétricos por (ano, km).
function mercado({ premioNapista = 0.05, kms = [40000, 55000, 70000, 85000, 100000] } = {}) {
  const base = anunciosSinteticos({ hoje: HOJE, anos: [2025, 2026], kms, desvios: [-0.04, -0.02, 0, 0.02, 0.04] })
    .map(a => ({ ...a, fonte: 'mobiauto', loja: 'Loja', tipo_vendedor: 'loja' }));
  // km 1 acima: o mesmo carro nas duas fontes seria repetido e contaria uma vez.
  const np = base.map((a, i) => ({ ...a, id_externo: `napista:${i}`, fonte: 'napista', km: a.km + 1, preco: a.preco * Math.exp(premioNapista) }));
  return [...base, ...np];
}
function legado(anuncios) {
  const fipe = fipeSintetica({ base: 100000 });
  const [e] = emprestar([calcularEstudo({ fipe, anuncios: anuncios.filter(a => a.fonte === 'mobiauto'), ipca: ipcaSintetico(), hoje: HOJE })]);
  const atual = new Map(fipe.filter(l => l.referencia === e.referencia).map(l => [l.ano_modelo, l.valor]));
  return { e, atual };
}

test('pesoKm e mediana ponderada', () => {
  assert.equal(pesoKm(70000), 1);
  perto(pesoKm(60000), 2 / 3, 1e-12);
  perto(pesoKm(90000), 1 / 3, 1e-12);
  assert.equal(pesoKm(40000), 0);
  assert.equal(pesoKm(101000), 0);
  assert.equal(medianaPonderada([[10, 1], [20, 1], [30, 5]]), 30);
  assert.equal(medianaPonderada([[10, 3], [20, 1], [30, 1]]), 10);
  assert.equal(medianaPonderada([[10, 0]]), null);
});

test('deduplicar: mesmo ano e km com preço até 1% acima conta uma vez e fica o que sabe do leilão', () => {
  const a = { id_externo: 'mobiauto:1', ano_modelo: 2025, km: 50000, preco: 70000, leilao: null };
  const b = { id_externo: 'napista:1', ano_modelo: 2025, km: 50000, preco: 70500, leilao: 0 };
  const c = { id_externo: 'napista:2', ano_modelo: 2025, km: 50000, preco: 72000, leilao: null };
  const d = { id_externo: 'napista:3', ano_modelo: 2025, km: 50001, preco: 70000, leilao: null };
  const r = deduplicar([a, b, c, d]);
  assert.equal(r.duplicados, 1);
  assert.deepEqual(r.lista.map(x => x.id_externo).sort(), ['napista:1', 'napista:2', 'napista:3']);
});

test('tipoDe: Mobiauto antiga sem tipo vira loja ou particular pelo nome', () => {
  assert.equal(tipoDe({ fonte: 'mobiauto', loja: 'X' }), 'loja');
  assert.equal(tipoDe({ fonte: 'mobiauto', loja: null }), 'particular');
  assert.equal(tipoDe({ fonte: 'napista', tipo_vendedor: 'locadora' }), 'locadora');
  assert.equal(tipoDe({ fonte: 'webmotors' }), 'sem');
});

test('consenso: regressão conjunta acha km, idade e o prêmio da fonte; critérios em base FIPE batem entre si', () => {
  const anuncios = mercado();
  const { e, atual } = legado(anuncios);
  const c = calcularConsenso({ anuncios, fipeAtual: atual, legado: e, hoje: HOJE });
  perto(c.regressao.c, -0.03, 1e-4, `c = ${c.regressao.c}`);
  perto(c.regressao.b, -0.1, 1e-4, `b = ${c.regressao.b}`);
  const premio = c.regressao.premios.find(p => p.campo === 'fonte' && p.valor === 'napista');
  perto(premio.efeito, Math.exp(0.05) - 1, 1e-4);
  assert.deepEqual(c.criterios.map(x => `${x.tipo}:${x.fonte}:${x.ok}`), ['fipe:fipe:true', 'reta:todas:true', 'comparaveis:mobiauto:true', 'comparaveis:napista:true']);
  // A reta e os comparáveis das duas fontes dizem o mesmo valor (o prêmio da NaPista sai na relação anúncio/FIPE dela).
  const [, reta, cm, cn] = c.criterios.map(x => x.valor);
  perto(cn / cm, 1, 0.02);
  perto(reta / cm, 1, 0.03);
  assert.equal(c.consenso, [c.criterios[0].valor, reta, cm, cn].sort((x, y) => x - y).slice(1, 3).reduce((s, v) => s + v / 2, 0));
  perto(c.ajuste, c.consenso / criterioFipe(e), 1e-12);
  assert.equal(c.contagem.mobiauto.lidos, 50);
  assert.equal(c.contagem.napista.usados + c.contagem.mobiauto.usados, c.n_usados);
});

test('leilão: marcado pela fonte sai sempre; sem informação e muito barato vira possível leilão', () => {
  const anuncios = mercado();
  const caro = anuncios[10];
  anuncios.push({ ...caro, id_externo: 'olx:1', fonte: 'olx', preco: caro.preco * 0.7, km: caro.km + 3, leilao: null });
  anuncios.push({ ...caro, id_externo: 'olx:2', fonte: 'olx', preco: caro.preco * 0.95, km: caro.km + 7, leilao: 1 });
  anuncios.push({ ...caro, id_externo: 'olx:3', fonte: 'olx', preco: caro.preco * 0.7, km: caro.km + 9, leilao: 0 });
  anuncios.push({ ...caro, id_externo: 'olx:4', fonte: 'olx', preco: caro.preco * 3, km: caro.km + 11, leilao: 0 });
  const { e, atual } = legado(anuncios);
  const c = calcularConsenso({ anuncios, fipeAtual: atual, legado: e, hoje: HOJE });
  assert.equal(c.status.get('olx:1'), 'possivel_leilao');
  assert.equal(c.status.get('olx:2'), 'leilao');
  assert.equal(c.status.get('olx:3'), 'fora', 'disse que não é de leilão: não vira possível leilão, mas está fora de propósito');
  assert.equal(c.status.get('olx:4'), 'fora');
  assert.deepEqual({ ...c.contagem.olx }, { lidos: 4, outro_ano: 0, duplicados: 0, leilao: 1, possivel_leilao: 1, fora: 2, usados: 0 });
});

test('poucos anúncios: só o critério FIPE, ajuste 1, e a projeção do consenso é a de antes', () => {
  const anuncios = mercado().slice(0, 20);
  const { e, atual } = legado(anuncios);
  const c = calcularConsenso({ anuncios, fipeAtual: atual, legado: e, hoje: HOJE });
  assert.equal(c.motivo, 'poucos anúncios');
  assert.equal(c.criterios.filter(x => x.ok).length, 1);
  assert.equal(c.ajuste, 1);
  const dados = { ...e, consenso: c };
  const novo = projetarConsenso(dados, { meses: 12, km: 70000, canal: 'motorista' }, PREMISSAS);
  const antes = projetar(e, { meses: 12, km: 70000, canal: 'motorista' }, PREMISSAS);
  assert.equal(novo.p50.nominal, antes.p50.nominal);
});

test('projetarConsenso: o valor vem do mercado (FIPE 0 km × ajuste); o preço de compra só muda o percentual', () => {
  const anuncios = mercado();
  const { e, atual } = legado(anuncios);
  const dados = { ...e, consenso: calcularConsenso({ anuncios, fipeAtual: atual, legado: e, hoje: HOJE }) };
  const semCompra = projetarConsenso(dados, { meses: 12, km: 70000, canal: 'atacado' }, PREMISSAS);
  const comCompra = projetarConsenso(dados, { meses: 12, km: 70000, canal: 'atacado', preco: 80000 }, PREMISSAS);
  assert.equal(semCompra.p50.nominal, comCompra.p50.nominal);
  perto(semCompra.p50.nominal, dados.consenso.consenso * 0.85, 1);
  perto(comCompra.p50.pct, comCompra.p50.nominal / 80000, 1e-4);
  assert.equal(comCompra.preco_informado, true);
  assert.equal(semCompra.fipe_0km, e.fipe_0km_atual);
  assert.ok(semCompra.p10.nominal < semCompra.p50.nominal && semCompra.p50.nominal < semCompra.p90.nominal);
  assert.equal(e.fipe_0km_atual, fipeSintetica({ base: 100000 }).find(l => l.referencia === e.referencia && l.ano_modelo === ZERO_KM).valor);
  assert.ok(idade(2026, HOJE) < 1);
});

test('ano-modelo da frota: só 2026 fabricado em 2025 ou 2026; o resto sai como outro ano e a idade sai da regressão', () => {
  const anuncios = mercado();
  const { e, atual } = legado(anuncios);
  const extra = { ...anuncios.find(a => a.ano_modelo === 2026), id_externo: 'napista:velho', fonte: 'napista', ano_fabricacao: 2024, km: 70001 };
  const c = calcularConsenso({ anuncios: [...anuncios, extra], fipeAtual: atual, legado: e, hoje: HOJE, anoModelo: 2026 });
  assert.equal(c.ano_modelo, 2026);
  assert.equal(c.status.get('napista:velho'), 'outro_ano', 'fabricado em 2024: fora');
  assert.equal(c.contagem.mobiauto.outro_ano, 25, 'os 25 de 2025');
  assert.ok([...c.status].filter(([, s]) => s === 'usado').every(([id]) => anuncios.find(a => a.id_externo === id).ano_modelo === 2026));
  assert.equal(c.regressao.fator_ano, null, 'um ano-modelo só: sem coeficiente de idade');
  perto(c.regressao.c, -0.03, 1e-4);
  assert.ok(c.criterios.find(x => x.tipo === 'comparaveis' && x.fonte === 'napista').ok);
});
