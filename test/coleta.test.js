import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, resposta } from './ajuda.js';
import { montarMensagem, enviarPendentes } from '../src/alertas.js';
import { rodarColeta } from '../src/coleta.js';

const itens = (vals, passo = 10000) => vals.map((valor, i) => ({ ordem: i + 1, km: (i + 1) * passo, meses: null, valor }));

function falsos({ king = [926, 1290], vwErro = false } = {}) {
  return {
    byd: { coletar: async p => (p.nome === 'BYD King' ? itens(king, 12000) : itens([393, 1292], 20000)) },
    vw: { coletar: async () => { if (vwErro) throw new Error('VW respondeu 500'); return itens([864.46, 966.47]); } },
    gm: { coletar: async () => itens([556, 932]) },
    fiat: { coletar: async () => itens([701, 931]) },
  };
}

test('montarMensagem junta mudanças, novas, falhas e conferir', () => {
  const texto = montarMensagem([
    { tipo: 'mudanca', nome: 'King', modelo_id: 6, ordem: 4, de: 2795, para: 2472 },
    { tipo: 'conferir', nome: 'King', modelo_id: 6, ordem: 4, de: 2795, para: 2472 },
    { tipo: 'nova_revisao', nome: 'Onix Sedan Plus', modelo_id: 4, ordem: 1, para: 556 },
    { tipo: 'falha', nome: 'Tera', modelo_id: 2, texto: 'VW respondeu 500' },
    { tipo: 'frota_sem_modelo', texto: 'kwid: 3 carros' },
  ], '2026-11-02');
  assert.equal(texto, [
    'Preços de revisão 02/11',
    'King 4ª 2.795 → 2.472 (−11,6%) conferir',
    'Onix Sedan Plus 1ª nova: 556',
    'Falha Tera: VW respondeu 500',
    'Frota sem modelo cadastrado: kwid: 3 carros',
  ].join('\n'));
  assert.equal(montarMensagem([], '2026-11-02'), null);
});

test('rodada grava todos os modelos e registra uma coleta por fonte', async () => {
  const db = bancoNovo();
  const r = await rodarColeta(db, { coletores: falsos(), data: '2026-11-02' });
  assert.deepEqual(Object.keys(r.fontes).sort(), ['byd', 'fiat', 'gm', 'vw']);
  assert.ok(Object.values(r.fontes).every(f => f.status === 'ok'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM vigencias WHERE vigente_ate IS NULL').get().n, 12);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM coletas WHERE fonte <> 'legado'").get().n, 4);
});

test('falha de um modelo deixa a fonte parcial e as outras seguem', async () => {
  const db = bancoNovo();
  const r = await rodarColeta(db, { coletores: falsos({ vwErro: true }), data: '2026-11-02' });
  assert.equal(r.fontes.vw.status, 'falha');
  assert.equal(r.fontes.byd.status, 'ok');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM alertas WHERE tipo = 'falha'").get().n, 2);
});

test('frota é aplicada antes e falha do Ativos não derruba a rodada', async () => {
  const db = bancoNovo();
  const r = await rodarColeta(db, { coletores: falsos(), buscarFrota: async () => { throw new Error('Ativos respondeu 503'); }, data: '2026-11-02' });
  assert.equal(r.frota.status, 'falha');
  assert.equal(r.fontes.byd.status, 'ok');
});

test('enviarPendentes manda uma mensagem e marca como enviados', async () => {
  const db = bancoNovo();
  await rodarColeta(db, { coletores: falsos(), data: '2026-11-02' });
  await rodarColeta(db, { coletores: falsos({ king: [926, 1300] }), data: '2026-11-09' });
  db.exec("UPDATE alertas SET enviado_em = datetime('now') WHERE tipo = 'nova_revisao'");
  let corpo;
  const buscar = async (url, op) => { corpo = { url, apikey: op.headers.apikey, ...JSON.parse(op.body) }; return resposta({ key: { id: '1' } }); };
  const env = { EVOLUTION_URL: 'http://evolution-api:8080', EVOLUTION_API_KEY: 'k', EVOLUTION_INSTANCIA: 'ocn', ALERTA_WHATSAPP: '5511999999999' };
  const r = await enviarPendentes(db, { env, buscar, data: '2026-11-09' });
  assert.equal(r.enviados, 1);
  assert.equal(corpo.url, 'http://evolution-api:8080/message/sendText/ocn');
  assert.equal(corpo.number, '5511999999999');
  assert.equal(corpo.text, 'Preços de revisão 09/11\nKing 2ª 1.290 → 1.300 (+0,8%)');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM alertas WHERE enviado_em IS NULL').get().n, 0);
});

test('sem configuração do Evolution os alertas ficam pendentes', async () => {
  const db = bancoNovo();
  await rodarColeta(db, { coletores: falsos(), data: '2026-11-02' });
  const r = await enviarPendentes(db, { env: {}, buscar: async () => { throw new Error('não deveria chamar'); } });
  assert.deepEqual(r, { enviados: 0, motivo: 'sem configuração' });
});
