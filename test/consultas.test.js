import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo } from './ajuda.js';
import { rodarColeta } from '../src/coleta.js';
import { modelosResumo, modeloDetalhe, comparar, mudancas, estadoColetas, projetar } from '../src/consultas.js';

const itens = (vals, passo) => vals.map((valor, i) => ({ ordem: i + 1, km: (i + 1) * passo, meses: null, valor }));
const fontes = king => ({
  byd: { coletar: async p => (p.nome === 'BYD King' ? itens(king, 12000) : itens([400, 1300], 20000)) },
  vw: { coletar: async () => itens([800, 900], 10000) },
  gm: { coletar: async () => itens([556, 932], 10000) },
  fiat: { coletar: async () => itens([701, 931, 701, 1576, 721], 10000) },
});

async function preparado() {
  const db = bancoNovo();
  await rodarColeta(db, { coletores: fontes([900, 1300]), data: '2026-11-02' });
  await rodarColeta(db, { coletores: fontes([900, 1400, 2000]), data: '2026-11-09' });
  return db;
}

test('resumo: total do plano, série e variação só das revisões em comum', async () => {
  const db = await preparado();
  const king = modelosResumo(db).find(m => m.slug === 'byd-king');
  assert.equal(king.total, 4300);
  assert.equal(king.revisoes, 3);
  assert.equal(king.km_max, 36000);
  assert.deepEqual(king.serie, [{ data: '2026-11-02', total: 2200 }, { data: '2026-11-09', total: 4300 }]);
  assert.deepEqual(king.variacao, { de: 2200, para: 2300, pct: 100 / 2200, em: '2026-11-09' });
});

test('resumo: modelo sem mudança não tem variação; cor segue o id', async () => {
  const db = await preparado();
  const lista = modelosResumo(db);
  const polo = lista.find(m => m.slug === 'polo-track');
  assert.equal(polo.variacao, null);
  const porId = [...lista].sort((a, b) => a.id - b.id);
  porId.forEach((m, i) => assert.equal(m.cor, i));
});

test('detalhe: revisão com histórico, preço anterior e data de início', async () => {
  const db = await preparado();
  const d = modeloDetalhe(db, 'byd-king');
  const r2 = d.revisoes_lista.find(r => r.ordem === 2);
  assert.deepEqual({ valor: r2.valor, desde: r2.desde, anterior: r2.anterior }, { valor: 1400, desde: '2026-11-09', anterior: 1300 });
  assert.deepEqual(r2.historico, [{ de: '2026-11-02', ate: '2026-11-08', valor: 1300 }, { de: '2026-11-09', ate: null, valor: 1400 }]);
  assert.equal(modeloDetalhe(db, 'nao-existe'), null);
});

test('comparar: custo acumulado na grade de km de todos, nulo depois do fim de cada plano', async () => {
  const db = await preparado();
  const c = comparar(db);
  assert.deepEqual(c.referencias, [30000, 70000, 100000]);
  assert.equal(c.kms[0], 0);
  const argo = c.modelos.find(m => m.slug === 'argo-drive');
  const i30 = c.kms.indexOf(30000);
  assert.equal(argo.valores[i30], 701 + 931 + 701);
  assert.equal(argo.valores[c.kms.indexOf(50000)], 4630);
  const vw = c.modelos.find(m => m.slug === 'polo-track');
  assert.equal(vw.valores[c.kms.indexOf(30000)], null);
});

test('projeção Fiat: ciclo de 40 mil km, 60 mil copia a de 20 mil e 80 mil copia a de 40 mil', () => {
  const pub = itens([701, 931, 701, 1576, 721], 10000);
  const p = projetar(pub);
  assert.deepEqual(p.map(r => [r.ordem, r.km, r.valor, r.base]), [
    [6, 60000, 931, 2], [7, 70000, 701, 3], [8, 80000, 1576, 4], [9, 90000, 721, 5], [10, 100000, 931, 2],
  ]);
  assert.ok(p.every(r => r.projetada));
  assert.deepEqual(projetar(itens([701, 931], 10000)), [], 'menos revisões que o ciclo: não projeta');
});

test('100 mil km: Argo projetado até 100 mil; King só conta até 100 mil; série no tempo do total até 100 mil', async () => {
  const db = await preparado();
  const lista = modelosResumo(db);
  const argo = lista.find(m => m.slug === 'argo-drive');
  assert.equal(argo.total_100, 4630 + 931 + 701 + 1576 + 721 + 931);
  assert.deepEqual([argo.revisoes_100, argo.projetadas_100], [5, 5]);
  assert.deepEqual(argo.serie_100, [{ data: '2026-11-02', total: argo.total_100 }]);
  const king = lista.find(m => m.slug === 'byd-king');
  assert.equal(king.total_100, 4300);
  assert.equal(king.projetadas_100, 0);
  const c = comparar(db);
  const ca = c.modelos.find(m => m.slug === 'argo-drive');
  assert.equal(ca.projetado_de, 50000);
  assert.equal(ca.valores[c.kms.indexOf(100000)], argo.total_100);
  assert.deepEqual(ca.ate, [2333, 4630 + 931 + 701, argo.total_100]);
  assert.deepEqual(ca.serie_100, argo.serie_100);
  const d = modeloDetalhe(db, 'argo-drive');
  assert.deepEqual(d.projecao.map(r => r.ordem), [6, 7, 8, 9, 10]);
});

test('mudanças e estado das coletas', async () => {
  const db = await preparado();
  const m = mudancas(db, 5);
  assert.equal(m[0].slug, 'byd-king');
  assert.ok(m.length <= 5);
  const e = estadoColetas(db);
  assert.deepEqual(e.fontes.map(f => f.fonte).sort(), ['byd', 'fiat', 'gm', 'vw']);
  assert.ok(e.pendentes.length > 0);
});

const comVw = vw => ({ ...fontes([900, 1300]), vw: { coletar: async () => vw } });
const poloDe = db => modelosResumo(db).find(m => m.slug === 'polo-track');

test('variação: data que só acrescenta revisão não esconde a mudança de preço anterior', async () => {
  const db = bancoNovo();
  await rodarColeta(db, { coletores: comVw(itens([800, 900], 10000)), data: '2026-06-03' });
  await rodarColeta(db, { coletores: comVw(itens([850, 900], 10000)), data: '2026-06-10' });
  await rodarColeta(db, { coletores: comVw(itens([850, 900, 1000], 10000)), data: '2026-06-17' });
  assert.deepEqual(poloDe(db).variacao, { de: 1700, para: 1750, pct: 50 / 1700, em: '2026-06-10' });
});

test('variação: sem mudança de preço em nenhum par de datas, é nula', async () => {
  const db = bancoNovo();
  await rodarColeta(db, { coletores: comVw(itens([800, 900], 10000)), data: '2026-06-03' });
  await rodarColeta(db, { coletores: comVw(itens([800, 900, 1000], 10000)), data: '2026-06-10' });
  assert.equal(poloDe(db).variacao, null);
});

test('variação: de e para são arredondados ao centavo', async () => {
  const db = bancoNovo();
  await rodarColeta(db, { coletores: comVw(itens([278.4, 278.4], 10000)), data: '2026-06-03' });
  await rodarColeta(db, { coletores: comVw(itens([300.1, 278.4], 10000)), data: '2026-06-10' });
  assert.deepEqual(poloDe(db).variacao, { de: 556.8, para: 578.5, pct: (578.5 - 556.8) / 556.8, em: '2026-06-10' });
  const db2 = bancoNovo();
  await rodarColeta(db2, { coletores: comVw(itens([100.1, 200.2], 10000)), data: '2026-06-03' });
  await rodarColeta(db2, { coletores: comVw(itens([100.1, 200.3], 10000)), data: '2026-06-10' });
  assert.deepEqual(poloDe(db2).variacao, { de: 300.3, para: 300.4, pct: (300.4 - 300.3) / 300.3, em: '2026-06-10' });
});
