import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quantil, mediana, somarMeses, idade, observacoesR, resumirR, minimosQuadrados, ajustarKm,
  calcularEstudo, emprestar, interpolarR, projetar,
} from '../src/revenda/estudo.js';
import { fipeSintetica, ipcaSintetico, anunciosSinteticos } from './sinteticos.js';

const perto = (a, b, tol = 1e-9, msg) => assert.ok(Math.abs(a - b) <= tol, msg ?? `${a} ≠ ${b}`);
const HOJE = '2026-10-28';
const PREMISSAS = { atacado_pct_base: 85, varejo_negociacao_pct: 5, motorista_pct_base: 100 };

test('quantil interpola entre vizinhos e ignora vazios', () => {
  assert.equal(quantil([4, 1, 3, 2], 0.25), 1.75);
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([1, null, 3]), 2);
  assert.equal(quantil([], 0.5), null);
});

test('somarMeses atravessa o ano e idade usa o mês corrente', () => {
  assert.equal(somarMeses('2026-10', 3), '2027-01');
  assert.equal(somarMeses('2026-01', -1), '2025-12');
  perto(idade(2025, '2026-10-28'), 1 + 10 / 12);
});

test('r_m montado à mão: ano do zero km em t, preço em t+m, real pelo IPCA', () => {
  const l = (referencia, ano_modelo, valor) => ({ referencia, ano_modelo, valor });
  const fipe = [
    l('2026-01', 32000, 100000), l('2026-01', 2026, 100000), l('2026-01', 2025, 95000),
    l('2026-07', 32000, 100500), l('2026-07', 2027, 99000), l('2026-07', 2026, 90000), l('2026-07', 2025, 86000),
  ];
  const ipca = new Map(['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'].map(m => [m, 1]));
  const obs = observacoesR(fipe, 6, ipca);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].t, '2026-01');
  perto(obs[0].r, 0.9);
  perto(obs[0].real, 0.9 / 1.01 ** 6);
  ipca.delete('2026-07');
  assert.equal(observacoesR(fipe, 6, ipca)[0].real, null, 'mês do IPCA faltando: real fica vazio');
});

test('janela de 24 meses pela referência final', () => {
  const fipe = fipeSintetica();
  const ipca = ipcaSintetico();
  assert.equal(observacoesR(fipe, 6, ipca).length, 24);
  assert.equal(observacoesR(fipe, 12, ipca).length, 24);
  assert.equal(observacoesR(fipe, 24, ipca).length, 12);
  for (const o of observacoesR(fipe, 12, ipca)) perto(o.r, 0.99 ** 12, 1e-12);
});

test('resumirR: quartis e mediana', () => {
  const r = resumirR([0.8, 0.85, 0.9, 0.95].map(r => ({ r, real: null })));
  perto(r.p25, 0.8375); perto(r.p50, 0.875); perto(r.p75, 0.9125);
  assert.equal(r.real_p50, null);
  assert.equal(r.n, 4);
  assert.equal(r.emprestado, null);
});

test('regressão devolve a, b e c dentro de 1e-6', () => {
  const an = anunciosSinteticos();
  const { a, b, c, residuos } = ajustarKm(an, HOJE);
  perto(a, 11.5, 1e-6); perto(b, -0.1, 1e-6); perto(c, -0.03, 1e-6);
  perto(quantil(residuos, 0.1), -0.1, 1e-6);
  perto(quantil(residuos, 0.9), 0.1, 1e-6);
  const [x0, x1] = minimosQuadrados([[1, 0], [1, 1], [1, 2]], [1, 3, 5]);
  perto(x0, 1); perto(x1, 2);
});

test('estudo completo com dados próprios', () => {
  const e = calcularEstudo({ fipe: fipeSintetica(), anuncios: anunciosSinteticos(), ipca: ipcaSintetico(), hoje: HOJE });
  for (const m of [6, 12, 18, 24]) {
    perto(e.r[m].p50, 0.99 ** m, 1e-12);
    perto(e.r[m].real_p50, 0.99 ** m / 1.005 ** m, 1e-12);
    assert.equal(e.r[m].emprestado, null);
  }
  assert.equal(e.r[12].n, 24);
  perto(e.km.c, -0.03, 1e-6);
  perto(e.km.fator_10mil, Math.exp(-0.03) - 1, 1e-6);
  assert.equal(e.km.km_tipico, 40000);
  assert.equal(e.km.n, 60);
  assert.equal(e.km.emprestado, false);
  perto(e.residuos.q10, -0.1, 1e-6);
  perto(e.residuos.q90, 0.1, 1e-6);
  const esperado = Math.exp(11.5 - 0.1 * (10 / 12)) * (Math.exp(-0.13) + Math.exp(-0.11)) / 2 / (100000 * 0.99 ** 10);
  perto(e.anuncio_sobre_fipe, esperado, 1e-9);
  perto(e.fipe_0km_atual, 100000 * 0.99 ** 10, 1e-6);
  assert.equal(e.referencia, '2026-10');
  assert.equal(e.n_fipe, 24);
});

test('sem histórico próprio usa o código de referência e marca ref', () => {
  const curta = fipeSintetica({ de: '2026-08', modelo: 11467 });
  const ref = fipeSintetica({ q: 0.98 });
  const e = calcularEstudo({ fipe: curta, fipeRef: ref, anuncios: [], ipca: ipcaSintetico(), hoje: HOJE });
  perto(e.r[12].p50, 0.98 ** 12, 1e-12);
  assert.equal(e.r[12].emprestado, 'ref');
  assert.equal(e.km.emprestado, true);
  assert.equal(e.residuos, null);
  const sem = calcularEstudo({ fipe: curta, anuncios: [], ipca: ipcaSintetico(), hoje: HOJE });
  assert.equal(sem.r[12], null);
});

test('emprestar completa com a mediana e a média dos outros modelos', () => {
  const ipca = ipcaSintetico();
  const cheio = q => calcularEstudo({ fipe: fipeSintetica({ q }), anuncios: anunciosSinteticos(), ipca, hoje: HOJE });
  const vazio = calcularEstudo({ fipe: fipeSintetica({ de: '2026-08' }), anuncios: anunciosSinteticos().slice(0, 10), ipca, hoje: HOJE });
  const [a, b, v] = emprestar([cheio(0.99), cheio(0.97), vazio]);
  assert.equal(a.r_emprestado, false);
  assert.equal(a.km_emprestado, false);
  perto(v.r[12].p50, (0.99 ** 12 + 0.97 ** 12) / 2, 1e-12);
  assert.equal(v.r[12].emprestado, 'outros');
  assert.equal(v.r_emprestado, true);
  assert.equal(v.km_emprestado, true);
  perto(v.km.c, -0.03, 1e-6);
  perto(v.residuos.q90, 0.1, 1e-6);
  assert.equal(v.km.km_tipico, 40000, 'os 10 anúncios são de 2024, fora de 0,5 a 1,5 ano: o km típico vem da média dos outros');
  assert.equal(b.r[12].emprestado, null);
});

test('emprestar sem nenhum doador: c zero, sem dispersão e razão 1', () => {
  const vazio = calcularEstudo({ fipe: [], anuncios: [], ipca: new Map(), hoje: HOJE });
  const [v] = emprestar([vazio]);
  assert.equal(v.r[12], null);
  assert.equal(v.km.c, 0);
  assert.deepEqual(v.residuos, { q10: 0, q90: 0 });
  assert.equal(v.anuncio_sobre_fipe, 1);
});

test('interpolação de meses entre os vizinhos', () => {
  const r = { 6: { p25: 0.85, p50: 0.9, p75: 0.95, real_p50: 0.88 }, 12: { p25: 0.75, p50: 0.8, p75: 0.85, real_p50: null }, 18: null, 24: null };
  assert.equal(interpolarR(r, 12), r[12]);
  perto(interpolarR(r, 9).p50, 0.85);
  assert.equal(interpolarR(r, 9).real_p50, null);
  perto(interpolarR(r, 3).p50, 0.95);
  perto(interpolarR(r, 3).real_p50, 0.94);
  assert.equal(interpolarR(r, 20), null);
  assert.throws(() => interpolarR(r, 30), /entre 1 e 24/);
  assert.throws(() => interpolarR(r, 7.5), /entre 1 e 24/);
});

test('projeção por canal: base, faixa, real e % do preço', () => {
  const dados = {
    r: { 6: null, 12: { p25: 0.75, p50: 0.8, p75: 0.85, real_p50: 0.76 }, 18: null, 24: null },
    km: { c: -0.03, km_tipico: 40000 }, residuos: { q10: -0.1, q90: 0.1 }, anuncio_sobre_fipe: 1.1, fipe_0km_atual: 100000,
  };
  const base = 0.8 * Math.exp(-0.03 * 3);
  const at = projetar(dados, { meses: 12, km: 70000, canal: 'atacado' }, PREMISSAS);
  perto(at.p50.pct, base * 0.85);
  assert.equal(at.p50.nominal, Math.round(100000 * base * 0.85));
  perto(at.p10.pct, base * 0.85 * Math.exp(-0.1));
  perto(at.p90.pct, base * 0.85 * Math.exp(0.1));
  perto(at.p50.pct_real, 0.76 * Math.exp(-0.09) * 0.85);
  assert.equal(at.preco, 100000);
  assert.equal(at.preco_informado, false);
  const va = projetar(dados, { meses: 12, km: 40000, canal: 'varejo', preco: 90000 }, PREMISSAS);
  assert.equal(va.p50.nominal, Math.round(90000 * 0.8 * 1.1 * 0.95));
  assert.equal(va.fator_km, 1);
  const mo = projetar(dados, { meses: 12, km: 40000, canal: 'motorista' }, PREMISSAS);
  perto(mo.p50.pct, 0.8);
  assert.throws(() => projetar(dados, { meses: 12, km: 1, canal: 'leilao' }, PREMISSAS), /canal/);
  assert.throws(() => projetar({ ...dados, fipe_0km_atual: null }, { meses: 12, km: 1, canal: 'atacado' }, PREMISSAS), /preço de compra/);
  assert.throws(() => projetar(dados, { meses: 24, km: 1, canal: 'atacado' }, PREMISSAS), /sem desvalorização/);
});
