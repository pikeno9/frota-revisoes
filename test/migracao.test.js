import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { bancoLegado } from './ajuda.js';
import { abrir } from '../src/db.js';
import { migrar } from '../src/migracoes/index.js';
import { lerRevisaoLegada } from '../src/migracoes/002-v2.js';

const VEICULOS = [[1, 'Volkswagen', 'Polo Track', '1.0'], [2, 'Fiat', 'Argo Drive', '1.0'], [4, 'BYD', 'Dolphin', 'GS']];
const rev = (n, km) => `${n}ª revisão (${km.toLocaleString('pt-BR')} km)`;
function precos() {
  const p = [];
  for (const [mes, v1] of [['2026-06-01', 846.64], ['2026-07-01', 846.64], ['2026-08-01', 846.64], ['2026-09-01', 864.46]]) {
    p.push([1, rev(1, 10000), mes, v1]);
    p.push([1, rev(2, 20000), mes, 948.65]);
  }
  for (const mes of ['2026-06-01', '2026-07-01']) {
    for (let n = 1; n <= 10; n++) p.push([2, rev(n, n * 10000), mes, [659, 925, 679, 1833, 719][(n - 1) % 5]]);
  }
  p.push([4, rev(1, 20000), '2026-09-01', 393]);
  return p;
}

test('lerRevisaoLegada tira ordem e km do texto', () => {
  assert.deepEqual(lerRevisaoLegada('10ª revisão (100.000 km)'), { ordem: 10, km: 100000 });
  assert.equal(lerRevisaoLegada('sem número'), null);
});

test('converte meses iguais seguidos em uma faixa e fecha na mudança', () => {
  const db = bancoLegado({ veiculos: VEICULOS, precos: precos() });
  migrar(db);
  const polo = db.prepare("SELECT id FROM modelos WHERE slug = 'polo-track'").get().id;
  const faixas = db.prepare('SELECT valor, vigente_de, vigente_ate, visto_em FROM vigencias WHERE modelo_id = ? AND ordem = 1 ORDER BY vigente_de').all(polo);
  assert.deepEqual(faixas.map(f => ({ ...f })), [
    { valor: 846.64, vigente_de: '2026-06-01', vigente_ate: '2026-08-31', visto_em: '2026-08-01' },
    { valor: 864.46, vigente_de: '2026-09-01', vigente_ate: null, visto_em: '2026-09-01' },
  ]);
  const mud = db.prepare("SELECT de, para, enviado_em FROM alertas WHERE tipo = 'mudanca' AND modelo_id = ?").all(polo);
  assert.equal(mud.length, 1);
  assert.equal(mud[0].de, 846.64);
  assert.ok(mud[0].enviado_em, 'alerta do legado nasce como enviado');
});

test('Fiat: ignora a 6ª a 10ª projetadas e marca projetar_ciclo', () => {
  const db = bancoLegado({ veiculos: VEICULOS, precos: precos() });
  migrar(db);
  const argo = db.prepare("SELECT id, projetar_ciclo, origem, chave_ativos FROM modelos WHERE slug = 'argo-drive'").get();
  assert.equal(argo.projetar_ciclo, 1);
  assert.equal(argo.origem, 'frota');
  assert.equal(argo.chave_ativos, 'argo');
  assert.equal(db.prepare('SELECT MAX(ordem) m FROM vigencias WHERE modelo_id = ?').get(argo.id).m, 5);
});

test('cria o Onix como candidato e guarda o id legado', () => {
  const db = bancoLegado({ veiculos: VEICULOS, precos: precos() });
  migrar(db);
  const onix = db.prepare("SELECT origem, coletor, legado_veiculo_id FROM modelos WHERE slug = 'onix-sedan-plus'").get();
  assert.deepEqual({ ...onix }, { origem: 'candidato', coletor: 'gm', legado_veiculo_id: null });
  assert.equal(db.prepare("SELECT legado_veiculo_id v FROM modelos WHERE slug = 'byd-dolphin'").get().v, 4);
});

test('não toca nas tabelas antigas', () => {
  const db = bancoLegado({ veiculos: VEICULOS, precos: precos() });
  const antes = db.prepare('SELECT COUNT(*) n FROM precos').get().n;
  migrar(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM precos').get().n, antes);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM veiculos').get().n, 3);
});

test('veículo legado desconhecido aborta sem gravar nada', () => {
  const db = bancoLegado({ veiculos: [[9, 'GAC', 'Aion', null]], precos: [] });
  assert.throws(() => migrar(db), /sem mapeamento/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'modelos'").get().n, 0);
});

test('banco vazio nasce com os 6 modelos conhecidos', () => {
  const db = bancoLegado({});
  migrar(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM modelos').get().n, 6);
});

const POLO = [[1, 'Volkswagen', 'Polo Track', '1.0']];
const faixasDe = db => db.prepare('SELECT valor, vigente_de, vigente_ate FROM vigencias WHERE ordem = 1 ORDER BY vigente_de').all().map(f => ({ ...f }));

test('mesmo mês duas vezes com valores diferentes aborta sem gravar nada', () => {
  const db = bancoLegado({ veiculos: POLO, precos: [[1, rev(1, 10000), '2026-06-01', 100], [1, rev(1, 10000), '2026-06-01', 110]] });
  assert.throws(() => migrar(db), /duplicado/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'modelos'").get().n, 0);
});

test('mesmo mês duas vezes com o mesmo valor migra normalmente', () => {
  const db = bancoLegado({ veiculos: POLO, precos: [[1, rev(1, 10000), '2026-06-01', 100], [1, rev(1, 10000), '2026-06-01', 100]] });
  migrar(db);
  assert.deepEqual(faixasDe(db), [{ valor: 100, vigente_de: '2026-06-01', vigente_ate: null }]);
});

test('km diferente para a mesma revisão aborta', () => {
  const db = bancoLegado({ veiculos: POLO, precos: [[1, rev(1, 10000), '2026-06-01', 100], [1, rev(1, 15000), '2026-07-01', 100]] });
  assert.throws(() => migrar(db), /km diferente/);
});

test('mês faltando com o mesmo valor continua sendo uma faixa só', () => {
  const db = bancoLegado({ veiculos: POLO, precos: [[1, rev(1, 10000), '2026-06-01', 100], [1, rev(1, 10000), '2026-08-01', 100]] });
  migrar(db);
  assert.deepEqual(faixasDe(db), [{ valor: 100, vigente_de: '2026-06-01', vigente_ate: null }]);
});

test('mês faltando com valor diferente fecha a faixa antes do novo valor', () => {
  const db = bancoLegado({ veiculos: POLO, precos: [[1, rev(1, 10000), '2026-06-01', 100], [1, rev(1, 10000), '2026-08-01', 120]] });
  migrar(db);
  assert.deepEqual(faixasDe(db), [
    { valor: 100, vigente_de: '2026-06-01', vigente_ate: '2026-07-31' },
    { valor: 120, vigente_de: '2026-08-01', vigente_ate: null },
  ]);
});

// Outro processo termina a mesma migração depois da checagem de fora e antes do nosso BEGIN IMMEDIATE.
test('migrar relê a versão dentro da transação e não reaplica', () => {
  const caminho = join(tmpdir(), `migracao-${process.pid}-${Date.now()}.db`);
  const a = abrir(caminho);
  const b = abrir(caminho);
  try {
    migrar(a);
    let aplicacoes = 0;
    const falsa = { versao: 7, aplicar() { aplicacoes++; } };
    let outro = false;
    const comCorrida = {
      prepare: sql => a.prepare(sql),
      exec(sql) {
        if (sql === 'BEGIN IMMEDIATE' && !outro) {
          outro = true;
          b.exec("INSERT INTO schema_versao (versao, aplicada_em) VALUES (7, datetime('now'))");
        }
        return a.exec(sql);
      },
    };
    assert.equal(migrar(comCorrida, [falsa]), 7);
    assert.equal(outro, true, 'a corrida simulada aconteceu');
    assert.equal(aplicacoes, 0);
    assert.equal(a.prepare('SELECT COUNT(*) n FROM schema_versao WHERE versao = 7').get().n, 1);
  } finally {
    a.close();
    b.close();
    for (const s of ['', '-wal', '-shm', '-journal']) rmSync(caminho + s, { force: true });
  }
});
