import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, servidor } from './ajuda.js';
import { fipeSintetica, semearRevenda } from './sinteticos.js';
import { estudoCategorias } from '../src/revenda/categorias.js';
import { recalcularEstudos } from '../src/revenda/dados.js';
import { criarApp } from '../src/app.js';
import { gerarHash } from '../src/auth.js';

const HOJE = '2026-10-28';
const perto = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

function banco() {
  const db = bancoNovo({ referencias: true });
  semearRevenda(db, HOJE);
  // Dois elétricos de referência com quedas diferentes; o terceiro sem histórico não entra na mediana.
  const ins = db.prepare('INSERT INTO fipe_precos (fipe_marca, fipe_modelo, ano_modelo, referencia, valor) VALUES (?, ?, ?, ?, ?)');
  for (const [modelo, q] of [[10878, 0.98], [10833, 0.97]]) {
    for (const l of fipeSintetica({ modelo, marca: 238, q })) ins.run(l.fipe_marca, l.fipe_modelo, l.ano_modelo, l.referencia, l.valor);
  }
  recalcularEstudos(db, HOJE);
  return db;
}

test('estudo por categoria: curva de cada código só com os dados dele e a mediana da categoria', () => {
  const e = estudoCategorias(banco());
  const polo = e.codigos.find(c => c.slug === 'polo-track');
  perto(polo.r[12].p50, 0.99 ** 12);
  assert.equal(polo.origem, 'frota');
  assert.ok(polo.anuncios.usados > 0);
  const tera = e.codigos.find(c => c.slug === 'tera');
  assert.equal(tera.r[12], null, 'sem FIPE própria: nada emprestado no estudo por categoria');
  const plus = e.codigos.find(c => c.codigo === 10878);
  assert.equal(plus.origem, 'referencia');
  perto(plus.r[12].p50, 0.98 ** 12);
  const eletrico = e.categorias.find(c => c.categoria === 'eletrico');
  perto(eletrico.r[12].p50, (0.98 ** 12 + 0.97 ** 12) / 2);
  assert.equal(eletrico.r[12].n, 2);
  assert.equal(eletrico.modelos, 7, 'Dolphin da frota e 6 de referência');
  assert.equal(e.codigos.filter(c => c.codigo === 11079).length, 1, 'King GS de referência aparece uma vez');
  const combustao = e.categorias.find(c => c.categoria === 'combustao');
  perto(combustao.r[12].p50, 0.99 ** 12);
  assert.ok(combustao.fator_10mil < 0);
});

test('rota do estudo pede login', async () => {
  const db = banco();
  const s = await servidor(criarApp({ db, env: { ADMIN_SENHA_HASH: gerarHash('certa'), SESSION_SECRET: 'x' }, deps: { coletores: {}, buscarFrota: null, enviar: null, hoje: () => HOJE } }));
  assert.equal((await fetch(`${s.url}/api/revenda/estudo`)).status, 401);
  const r = await fetch(`${s.url}/api/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'enrico', senha: 'certa' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const e = await (await fetch(`${s.url}/api/revenda/estudo`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(e.categorias.map(c => c.categoria), ['combustao', 'eletrico', 'hibrido']);
  await s.fechar();
});
