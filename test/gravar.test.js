import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo } from './ajuda.js';
import { gravarModelo, validar } from '../src/gravar.js';

function preparar() {
  const db = bancoNovo();
  const modeloId = db.prepare("SELECT id FROM modelos WHERE slug = 'byd-king'").get().id;
  const coleta = () => Number(db.prepare("INSERT INTO coletas (fonte, inicio) VALUES ('byd', datetime('now'))").run().lastInsertRowid);
  const atuais = () => db.prepare('SELECT ordem, valor, vigente_de, vigente_ate, visto_em, conferir FROM vigencias WHERE modelo_id = ? ORDER BY ordem, vigente_de').all(modeloId).map(r => ({ ...r }));
  const alertas = () => db.prepare('SELECT tipo, ordem, de, para FROM alertas WHERE modelo_id = ? ORDER BY id').all(modeloId).map(r => ({ ...r }));
  return { db, modeloId, coleta, atuais, alertas };
}
const it = (ordem, valor) => ({ ordem, km: ordem * 12000, meses: ordem * 12, valor });

test('primeira coleta abre vigências e avisa revisões novas', () => {
  const { db, modeloId, coleta, atuais, alertas } = preparar();
  const r = gravarModelo(db, { modeloId, itens: [it(1, 926), it(2, 1290)], coletaId: coleta(), data: '2026-11-02' });
  assert.deepEqual(r, { erro: null, mudancas: 2, itens: 2 });
  assert.equal(atuais().length, 2);
  assert.deepEqual(alertas().map(a => a.tipo), ['nova_revisao', 'nova_revisao']);
});

test('mesmo valor só atualiza visto_em', () => {
  const { db, modeloId, coleta, atuais, alertas } = preparar();
  gravarModelo(db, { modeloId, itens: [it(1, 926)], coletaId: coleta(), data: '2026-11-02' });
  const r = gravarModelo(db, { modeloId, itens: [it(1, 926)], coletaId: coleta(), data: '2026-11-09' });
  assert.equal(r.mudancas, 0);
  assert.deepEqual(atuais(), [{ ordem: 1, valor: 926, vigente_de: '2026-11-02', vigente_ate: null, visto_em: '2026-11-09', conferir: 0 }]);
  assert.equal(alertas().length, 1);
});

test('valor novo fecha a faixa no dia anterior e abre outra', () => {
  const { db, modeloId, coleta, atuais, alertas } = preparar();
  gravarModelo(db, { modeloId, itens: [it(1, 926)], coletaId: coleta(), data: '2026-11-02' });
  gravarModelo(db, { modeloId, itens: [it(1, 950)], coletaId: coleta(), data: '2026-11-09' });
  assert.deepEqual(atuais().map(a => [a.valor, a.vigente_de, a.vigente_ate]), [[926, '2026-11-02', '2026-11-08'], [950, '2026-11-09', null]]);
  assert.deepEqual(alertas().at(-1), { tipo: 'mudanca', ordem: 1, de: 926, para: 950 });
});

test('duas coletas no mesmo dia corrigem a faixa em vez de criar faixa vazia', () => {
  const { db, modeloId, coleta, atuais } = preparar();
  gravarModelo(db, { modeloId, itens: [it(1, 926)], coletaId: coleta(), data: '2026-11-02' });
  gravarModelo(db, { modeloId, itens: [it(1, 930)], coletaId: coleta(), data: '2026-11-02' });
  assert.deepEqual(atuais().map(a => [a.valor, a.vigente_de, a.vigente_ate]), [[930, '2026-11-02', null]]);
});

test('salto acima de 40% grava marcado para conferir', () => {
  const { db, modeloId, coleta, atuais, alertas } = preparar();
  gravarModelo(db, { modeloId, itens: [it(1, 926)], coletaId: coleta(), data: '2026-11-02' });
  gravarModelo(db, { modeloId, itens: [it(1, 2000)], coletaId: coleta(), data: '2026-11-09' });
  assert.equal(atuais().at(-1).conferir, 1);
  assert.deepEqual(alertas().slice(-2).map(a => a.tipo), ['mudanca', 'conferir']);
});

test('menos revisões que antes: não grava nada e alerta falha', () => {
  const { db, modeloId, coleta, atuais, alertas } = preparar();
  gravarModelo(db, { modeloId, itens: [it(1, 926), it(2, 1290)], coletaId: coleta(), data: '2026-11-02' });
  const r = gravarModelo(db, { modeloId, itens: [it(1, 999)], coletaId: coleta(), data: '2026-11-09' });
  assert.match(r.erro, /vieram 1 revisões, havia 2/);
  assert.equal(atuais().length, 2);
  assert.equal(alertas().at(-1).tipo, 'falha');
});

test('ordem que existia e não veio vira alerta sumiu_revisao', () => {
  const { db, modeloId, coleta, alertas } = preparar();
  gravarModelo(db, { modeloId, itens: [it(1, 926), it(2, 1290)], coletaId: coleta(), data: '2026-11-02' });
  gravarModelo(db, { modeloId, itens: [it(1, 926), it(3, 926)], coletaId: coleta(), data: '2026-11-09' });
  assert.ok(alertas().some(a => a.tipo === 'sumiu_revisao' && a.ordem === 2));
});

test('validar recusa vazio, repetido, km e valor fora da faixa', () => {
  assert.match(validar([], 0), /nenhuma/);
  assert.match(validar([it(1, 900), it(1, 900)], 0), /repetida/);
  assert.match(validar([{ ordem: 1, km: 0, valor: 900 }], 0), /km/);
  assert.match(validar([it(1, 10)], 0), /faixa/);
  assert.match(validar([it(1, 40000)], 0), /faixa/);
  assert.equal(validar([it(1, 900)], 1), null);
});
