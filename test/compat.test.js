import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoLegado } from './ajuda.js';
import { migrar } from '../src/migracoes/index.js';
import { veiculosCompat, precosCompat } from '../src/rotas/compat.js';

// Igual a ocn-kpis-site/lib/revisoes.js (mapModelo simplificado por nome).
function doKpis(veic, precos) {
  const mapModelo = s => (/polo/i.test(s) ? 'Polo' : /argo/i.test(s) ? 'Argo' : /tera/i.test(s) ? 'Tera' : null);
  const idToModel = {};
  veic.forEach(v => { const m = mapModelo(`${v.apelido || ''} ${v.modelo || ''}`); if (m) idToModel[v.id] = m; });
  const out = {}; const seen = {};
  precos.forEach(p => {
    const model = idToModel[p.veiculo_id]; if (!model) return;
    const nM = String(p.revisao || '').match(/^\s*(\d+)/); const kmM = String(p.revisao || '').match(/\(([\d.]+)/);
    const n = nM ? +nM[1] : null; const km = kmM ? +kmM[1].replace(/\./g, '') : (n ? n * 10000 : null);
    const valor = Number(p.valor); if (!n || !km || !isFinite(valor)) return;
    const key = model + '|' + n; if (seen[key]) return; seen[key] = true;
    (out[model] ||= []).push({ n, km, valor });
  });
  Object.values(out).forEach(a => a.sort((x, y) => x.n - y.n));
  return out;
}

const rev = (n, km) => `${n}ª revisão (${km.toLocaleString('pt-BR')} km)`;
function legado() {
  const precos = [];
  for (const [mes, v] of [['2026-08-01', 846.64], ['2026-09-01', 864.46]]) for (let n = 1; n <= 10; n++) precos.push([1, rev(n, n * 10000), mes, n === 1 ? v : 900 + n]);
  for (const mes of ['2026-08-01', '2026-09-01']) for (let n = 1; n <= 10; n++) precos.push([2, rev(n, n * 10000), mes, [659, 925, 679, 1833, 719][(n - 1) % 5]]);
  return bancoLegado({ veiculos: [[1, 'Volkswagen', 'Polo Track', '1.0'], [2, 'Fiat', 'Argo Drive', '1.0'], [3, 'Volkswagen', 'Tera', '1.0 MPI']], precos });
}

test('o KPIs lê da rota nova exatamente o que lia do legado', () => {
  const db = legado();
  const antes = doKpis(db.prepare('SELECT * FROM veiculos').all(), db.prepare('SELECT * FROM precos ORDER BY data_coleta DESC').all());
  migrar(db);
  const depois = doKpis(veiculosCompat(db), precosCompat(db));
  assert.deepEqual(depois, antes);
  assert.equal(depois.Argo.length, 10);
  assert.equal(depois.Polo[0].valor, 864.46);
});

test('candidato com nome parecido não entra na leitura do KPIs', () => {
  const db = legado();
  migrar(db);
  const antes = doKpis(veiculosCompat(db), precosCompat(db));
  const id = Number(db.prepare("INSERT INTO modelos (slug, montadora, nome, origem, coletor, parametros) VALUES ('tera-highline', 'Volkswagen', 'Tera Highline', 'candidato', 'vw', '{}')").run().lastInsertRowid);
  for (let n = 1; n <= 10; n++) db.prepare("INSERT INTO vigencias (modelo_id, ordem, km, valor, vigente_de, visto_em) VALUES (?, ?, ?, 99999, '2026-10-01', '2026-10-01')").run(id, n, n * 10000);
  assert.ok(!veiculosCompat(db).some(v => /highline/i.test(v.modelo)));
  assert.ok(!precosCompat(db).some(p => p.valor === 99999));
  assert.deepEqual(doKpis(veiculosCompat(db), precosCompat(db)), antes);
});

test('filtro por veiculo_id e formato do texto da revisão', () => {
  const db = legado();
  migrar(db);
  const p = precosCompat(db, 1);
  assert.ok(p.every(x => x.veiculo_id === 1));
  assert.match(p[0].revisao, /^\d+ª revisão \([\d.]+ km\)$/);
});
