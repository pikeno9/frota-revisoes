import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bancoNovo } from './ajuda.js';
import { fipeSintetica, ipcaSintetico, anunciosSinteticos } from './sinteticos.js';
import { lerReferencias } from '../src/revenda/fipe.js';
import { rodarRevenda } from '../src/revenda/coleta.js';
import { rodarColeta } from '../src/coleta.js';
import { ultimoEstudo, anunciosRecentes } from '../src/revenda/dados.js';

const REFS = lerReferencias(JSON.parse(readFileSync(new URL('./fixtures/fipe-referencias-2026-10-28.json', import.meta.url), 'utf8')));
const HOJE = '2026-10-28';

// FIPE falsa: todos os códigos com 36 meses de histórico, menos o Tera (11467), que só existe desde 2026.
function fipeFalsa({ falhar = () => false } = {}) {
  const tabela = new Map();
  for (const modelo of [10176, 7965, 11617, 8950, 12122, 11078]) {
    for (const l of fipeSintetica({ modelo, de: '2023-07' })) tabela.set(`${l.fipe_modelo}|${l.ano_modelo}|${l.referencia}`, l.valor);
  }
  for (const l of fipeSintetica({ modelo: 11467, de: '2026-01' })) tabela.set(`${l.fipe_modelo}|${l.ano_modelo}|${l.referencia}`, l.valor);
  const mesDe = new Map(REFS.map(r => [r.codigo, r.mes]));
  const f = {
    chamadas: 0,
    referencias: async () => REFS,
    valor: async p => {
      f.chamadas++;
      if (falhar(p, f.chamadas)) throw new Error('FIPE respondeu 503');
      const v = tabela.get(`${p.modelo}|${p.ano}|${mesDe.get(p.codigoReferencia)}`);
      return v == null ? null : { valor: v, codigo_fipe: '000000-0' };
    },
  };
  return f;
}

const mobiautoFalsa = ({ falhaEm = null } = {}) => ({
  pedidos: [],
  async anuncios(p) {
    this.pedidos.push(p);
    if (p.caminho === falhaEm) throw new Error('Mobiauto respondeu 403');
    return p.caminho === 'volkswagen/polo' ? anunciosSinteticos() : [];
  },
});
const ipcaFalso = () => ({ desde: [], async serie(d) { this.desde.push(d); return [...ipcaSintetico()].map(([mes, variacao]) => ({ mes, variacao })); } });
const pausas = { pausaFipeMs: 0, pausaPaginaMs: 0 };

test('primeira rodada: 36 referências por código, anúncios, IPCA e um estudo por modelo', async () => {
  const db = bancoNovo();
  const fipe = fipeFalsa(), mobiauto = mobiautoFalsa(), ipca = ipcaFalso();
  const r = await rodarRevenda(db, { fipe, mobiauto, ipca, data: HOJE, ...pausas });
  assert.equal(r.fipe.status, 'ok');
  assert.equal(r.mobiauto.status, 'ok');
  assert.equal(r.ipca.status, 'ok');
  assert.equal(fipe.chamadas, 7 * 36 * 6, '7 códigos distintos (6 modelos + o 8950 do Onix), 36 referências, 6 anos');
  assert.equal(db.prepare('SELECT COUNT(DISTINCT referencia) n FROM fipe_precos WHERE fipe_modelo = 10176').get().n, 36);
  assert.equal(db.prepare('SELECT MIN(referencia) m FROM fipe_precos').get().m, '2023-11');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fipe_precos WHERE fipe_modelo = 11467').get().n, 10 * 5);
  assert.deepEqual(ipca.desde, ['2022-01']);
  assert.equal(mobiauto.pedidos.length, 6);
  assert.deepEqual({ ...mobiauto.pedidos[0], pausaMs: 0 }, { caminho: 'volkswagen/polo', versao: '^Track', anoMin: 2023, maxPaginas: 40, pausaMs: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM anuncios').get().n, 60);
  assert.equal(r.estudos, 6);
  const fontes = db.prepare("SELECT fonte, status FROM coletas WHERE fonte IN ('fipe','mobiauto','ipca') ORDER BY fonte").all().map(c => `${c.fonte}:${c.status}`);
  assert.deepEqual(fontes, ['fipe:ok', 'ipca:ok', 'mobiauto:ok']);

  const polo = db.prepare("SELECT id FROM modelos WHERE slug = 'polo-track'").get().id;
  const tera = db.prepare("SELECT id FROM modelos WHERE slug = 'tera'").get().id;
  const ep = ultimoEstudo(db, polo).dados;
  assert.ok(Math.abs(ep.r[12].p50 - 0.99 ** 12) < 1e-9);
  assert.equal(ep.km_emprestado, false);
  const et = ultimoEstudo(db, tera).dados;
  assert.equal(et.r[12].emprestado, 'ref', 'Tera usa o Polo Track (10176)');
  assert.equal(et.km_emprestado, true);
});

test('segunda rodada: nada novo na FIPE, anúncio conhecido só atualiza, IPCA pede desde o último mês', async () => {
  const db = bancoNovo();
  await rodarRevenda(db, { fipe: fipeFalsa(), mobiauto: mobiautoFalsa(), ipca: ipcaFalso(), data: HOJE, ...pausas });
  const fipe = fipeFalsa(), ipca = ipcaFalso();
  const r = await rodarRevenda(db, { fipe, mobiauto: mobiautoFalsa(), ipca, data: '2026-11-04', ...pausas });
  assert.equal(fipe.chamadas, 0);
  assert.equal(r.fipe.status, 'ok');
  assert.deepEqual(ipca.desde, ['2026-09'], 'o último salvo é set/2026, anterior a out/2026 (o mês passado)');
  const a = db.prepare("SELECT primeiro_visto, ultimo_visto FROM anuncios WHERE id_externo = 'mobiauto:1'").get();
  assert.deepEqual({ ...a }, { primeiro_visto: HOJE, ultimo_visto: '2026-11-04' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM estudos').get().n, 12);
});

test('IPCA em dia não é baixado de novo', async () => {
  const db = bancoNovo();
  db.prepare("INSERT INTO ipca (mes, variacao) VALUES ('2026-09', 0.82)").run();
  const ipca = ipcaFalso();
  const r = await rodarRevenda(db, { ipca, data: HOJE, ...pausas });
  assert.deepEqual(ipca.desde, []);
  assert.equal(r.ipca.itens, 0);
});

test('FIPE fora do ar vira falha com alerta e não impede anúncios nem estudos', async () => {
  const db = bancoNovo();
  const fipe = { referencias: async () => { throw new Error('FIPE respondeu 503'); }, valor: async () => null };
  const r = await rodarRevenda(db, { fipe, mobiauto: mobiautoFalsa(), ipca: ipcaFalso(), data: HOJE, ...pausas });
  assert.equal(r.fipe.status, 'falha');
  assert.equal(r.mobiauto.status, 'ok');
  assert.equal(r.estudos, 6);
  const al = db.prepare("SELECT texto FROM alertas WHERE tipo = 'falha'").all().map(a => a.texto);
  assert.deepEqual(al, ['FIPE: FIPE respondeu 503']);
});

test('um código da FIPE falhando duas vezes deixa a fonte parcial; uma falha só é tentada de novo', async () => {
  const db = bancoNovo();
  const fipe = fipeFalsa({ falhar: (p, n) => p.modelo === 12122 || n === 1 });
  const r = await rodarRevenda(db, { fipe, data: HOJE, ...pausas });
  assert.equal(r.fipe.status, 'parcial');
  assert.equal(r.fipe.modelos_ok, 6);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fipe_precos WHERE fipe_modelo = 12122').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(DISTINCT referencia) n FROM fipe_precos WHERE fipe_modelo = 10176').get().n, 36, 'a 1ª chamada falhou e a retentativa passou');
  assert.deepEqual(db.prepare("SELECT texto FROM alertas WHERE tipo = 'falha'").all().map(a => a.texto), ['FIPE 12122: FIPE respondeu 503']);
});

test('Mobiauto falhando num modelo: parcial, alerta com o modelo', async () => {
  const db = bancoNovo();
  const r = await rodarRevenda(db, { mobiauto: mobiautoFalsa({ falhaEm: 'byd/king' }), data: HOJE, ...pausas });
  assert.equal(r.mobiauto.status, 'parcial');
  assert.equal(r.mobiauto.modelos_ok, 5);
  const a = db.prepare("SELECT m.slug, a.texto FROM alertas a JOIN modelos m ON m.id = a.modelo_id WHERE a.tipo = 'falha'").get();
  assert.deepEqual({ ...a }, { slug: 'byd-king', texto: 'Mobiauto: Mobiauto respondeu 403' });
});

test('modelo sem código FIPE fica fora do estudo, sem erro', async () => {
  const db = bancoNovo();
  db.prepare("UPDATE modelos SET fipe_modelo = NULL WHERE slug = 'byd-king'").run();
  const r = await rodarRevenda(db, { data: HOJE, ...pausas });
  assert.equal(r.estudos, 5);
});

test('o estudo só usa anúncios vistos nos últimos 60 dias', async () => {
  const db = bancoNovo();
  await rodarRevenda(db, { mobiauto: mobiautoFalsa(), data: HOJE, ...pausas });
  const polo = db.prepare("SELECT id FROM modelos WHERE slug = 'polo-track'").get().id;
  assert.equal(anunciosRecentes(db, polo, HOJE).length, 60);
  assert.equal(anunciosRecentes(db, polo, '2026-12-27').length, 60, 'exatamente 60 dias depois ainda vale');
  assert.equal(anunciosRecentes(db, polo, '2026-12-28').length, 0, '61 dias depois sai do estudo');
  assert.equal(anunciosRecentes(db, polo, '2027-01-15').length, 0, 'anúncio que sumiu há mais de 60 dias sai do estudo');
  // Estudo de um modelo sem anúncio recente: sem regressão do km (emprestado) e sem quebrar.
  await rodarRevenda(db, { data: '2027-01-15', ...pausas });
  assert.equal(ultimoEstudo(db, polo).dados.km.n, 0);
});

test('falha na gravação dos estudos vira alerta e não derruba a rodada', async () => {
  const db = bancoNovo();
  db.exec('DROP TABLE estudos');
  const r = await rodarRevenda(db, { mobiauto: mobiautoFalsa(), data: HOJE, ...pausas });
  assert.equal(r.estudos, 0);
  assert.match(r.erro_estudo, /estudos/);
  assert.equal(r.mobiauto.status, 'ok');
  assert.match(db.prepare("SELECT texto FROM alertas WHERE tipo = 'falha' AND texto LIKE 'Estudo:%'").get().texto, /^Estudo: .*estudos/);
});

test('erro do banco ao abrir o registro de uma fonte fica isolado nela', async () => {
  const db = bancoNovo();
  db.exec("CREATE TRIGGER trava_ipca BEFORE INSERT ON coletas WHEN NEW.fonte = 'ipca' BEGIN SELECT RAISE(ABORT, 'banco travado'); END");
  const r = await rodarRevenda(db, { ipca: ipcaFalso(), mobiauto: mobiautoFalsa(), data: HOJE, ...pausas });
  assert.equal(r.ipca.status, 'falha');
  assert.match(r.ipca.erro, /banco travado/);
  assert.equal(r.mobiauto.status, 'ok');
  assert.equal(r.estudos, 6);
  assert.match(db.prepare("SELECT texto FROM alertas WHERE tipo = 'falha'").get().texto, /^IPCA: .*banco travado/);
});

// FIPE falsa em que o código 12122 nunca devolve preço (a FIPE responde "nadaencontrado").
function fipeComVazio(vazio = 12122) {
  const f = fipeFalsa();
  const normal = f.valor;
  f.pedidos = [];
  f.valor = async p => { if (p.modelo === vazio) { f.pedidos.push(p.codigoReferencia); return null; } return normal(p); };
  return f;
}

test('código da FIPE que não deu nenhum preço: registrado, e na semana seguinte só pede a referência mais nova', async () => {
  const db = bancoNovo();
  const f1 = fipeComVazio();
  const r1 = await rodarRevenda(db, { fipe: f1, data: HOJE, ...pausas });
  assert.equal(r1.fipe.status, 'ok');
  assert.deepEqual(r1.fipe.vazios, [12122]);
  assert.equal(f1.pedidos.length, 36 * 6, 'a primeira rodada tenta as 36 referências');
  assert.equal(db.prepare("SELECT erro FROM coletas WHERE fonte = 'fipe'").get().erro, 'sem dados: 12122');

  const f2 = fipeComVazio();
  const r2 = await rodarRevenda(db, { fipe: f2, data: '2026-11-04', ...pausas });
  assert.equal(f2.pedidos.length, 6, 'só a referência mais nova (6 anos)');
  assert.equal(new Set(f2.pedidos).size, 1);
  assert.equal(f2.chamadas, 0, 'os outros códigos já estão em dia');
  assert.deepEqual(r2.fipe.vazios, [12122]);

  const f3 = fipeComVazio();
  await rodarRevenda(db, { fipe: f3, data: '2026-11-11', ...pausas });
  assert.equal(f3.pedidos.length, 6, 'continua pedindo só a mais nova enquanto estiver vazio');
});

test('código vazio que passa a ter preço sai da lista e volta ao ritmo normal', async () => {
  const db = bancoNovo();
  await rodarRevenda(db, { fipe: fipeComVazio(), data: HOJE, ...pausas });
  const r2 = await rodarRevenda(db, { fipe: fipeFalsa(), data: '2026-11-04', ...pausas });
  assert.deepEqual(r2.fipe.vazios, []);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fipe_precos WHERE fipe_modelo = 12122').get().n, 5);
  assert.equal(db.prepare("SELECT erro FROM coletas WHERE fonte = 'fipe' ORDER BY id DESC").get().erro, null);
});

test('rodada semanal chama a Revenda depois das revisões', async () => {
  const db = bancoNovo();
  const itens = vals => vals.map((valor, i) => ({ ordem: i + 1, km: (i + 1) * 10000, meses: null, valor }));
  const coletores = { byd: { coletar: async () => itens([393]) }, vw: { coletar: async () => itens([864]) }, gm: { coletar: async () => itens([556]) }, fiat: { coletar: async () => itens([701]) } };
  const r = await rodarColeta(db, { coletores, revenda: { mobiauto: mobiautoFalsa(), ...pausas }, data: HOJE, pausaMs: 0 });
  assert.equal(r.fontes.vw.status, 'ok');
  assert.equal(r.revenda.mobiauto.status, 'ok');
  assert.equal(r.revenda.estudos, 6);
  const ordem = db.prepare("SELECT fonte FROM coletas WHERE fonte <> 'legado' ORDER BY id").all().map(c => c.fonte);
  assert.deepEqual(ordem.slice(-1), ['mobiauto']);
});
