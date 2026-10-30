import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, servidor } from './ajuda.js';
import { criarApp } from '../src/app.js';
import { gerarHash } from '../src/auth.js';
import { criar } from '../src/usuarios.js';
import { gravarAnuncios } from '../src/revenda/dados.js';
import { numeroBr, lerLinha } from '../src/revenda/importacao.js';
import { leilaoNaDescricao, leilaoNaColuna } from '../src/revenda/leilao.js';

const HOJE = '2026-10-29';
const ENV = { ADMIN_SENHA_HASH: gerarHash('certa'), SESSION_SECRET: 'segredo-de-teste', REVENDA_TOKEN: 'token-do-kpis' };
const JSON_ = { 'Content-Type': 'application/json' };

async function entrar(url, usuario, senha) {
  const r = await fetch(`${url}/api/entrar`, { method: 'POST', headers: JSON_, body: JSON.stringify({ usuario, senha }) });
  return r.headers.get('set-cookie')?.split(';')[0];
}
async function subir() {
  const db = bancoNovo();
  const s = await servidor(criarApp({ db, env: ENV, deps: { coletores: {}, buscarFrota: null, enviar: null, hoje: () => HOJE } }));
  const admin = await entrar(s.url, 'enrico', 'certa');
  return { db, ...s, admin };
}
const idDe = (db, slug) => db.prepare('SELECT id FROM modelos WHERE slug = ?').get(slug).id;

test('numeroBr entende R$, milhar com ponto e decimal com vírgula', () => {
  assert.equal(numeroBr('R$ 75.900'), 75900);
  assert.equal(numeroBr('R$ 75.900,50'), 75900.5);
  assert.equal(numeroBr('45.000 km'), 45000);
  assert.equal(numeroBr('45000'), 45000);
  assert.equal(numeroBr(81990), 81990);
  assert.equal(numeroBr(''), null);
});

test('leilão pela descrição e pela coluna', () => {
  assert.equal(leilaoNaDescricao('Carro de leilão, documentação ok'), 1);
  assert.equal(leilaoNaDescricao('Veículo NÃO é de leilão, único dono'), 0);
  assert.equal(leilaoNaDescricao('sem passagem por leilao nem sinistro'), 0);
  assert.equal(leilaoNaDescricao('Nunca foi a leilão. Obs: comprado em leilão de financeira'), 1);
  assert.equal(leilaoNaDescricao('Revisado na concessionária'), null);
  assert.equal(leilaoNaColuna('Sim'), 1);
  assert.equal(leilaoNaColuna('não'), 0);
  assert.equal(leilaoNaColuna(''), null);
});

test('lerLinha: modelo pelo nome ou slug, id estável sem id na planilha, motivo da recusa', () => {
  const db = bancoNovo();
  const modelos = db.prepare('SELECT id, slug, nome FROM modelos').all();
  const base = { modelo: 'Polo Track', versao: 'Track 1.0', ano: '2025', km: '45.000', preco: 'R$ 76.000', descricao: 'carro de leilão' };
  const a = lerLinha(base, { fonte: 'webmotors', modelos, hoje: HOJE });
  const b = lerLinha({ ...base, modelo: 'polo-track' }, { fonte: 'webmotors', modelos, hoje: HOJE });
  assert.equal(a.anuncio.id_externo, b.anuncio.id_externo);
  assert.match(a.anuncio.id_externo, /^webmotors:[0-9a-f]{16}$/);
  assert.deepEqual([a.anuncio.km, a.anuncio.preco, a.anuncio.leilao, a.anuncio.leilao_por, a.data], [45000, 76000, 1, 'descricao', HOJE]);
  assert.equal(lerLinha({ ...base, modelo: 'Gol' }, { fonte: 'webmotors', modelos, hoje: HOJE }).erro, 'modelo não encontrado');
  assert.equal(lerLinha({ ...base, preco: '900' }, { fonte: 'webmotors', modelos, hoje: HOJE }).erro, 'preço inválido');
  assert.equal(lerLinha({ ...base, data: '2026-11-30' }, { fonte: 'webmotors', modelos, hoje: HOJE }).erro, 'data inválida (use AAAA-MM-DD)');
  assert.equal(lerLinha({ ...base, link: 'javascript:alert(1)' }, { fonte: 'webmotors', modelos, hoje: HOJE }).erro, 'link inválido');
});

test('importar: só edição; linhas boas entram com leitura e coleta registrada, as ruins voltam com o número', async () => {
  const { db, url, admin, fechar } = await subir();
  const { senha_provisoria } = criar(db, { usuario: 'leitor', nome: 'Leitor', papel: 'leitura' });
  const leitor = await entrar(url, 'leitor', senha_provisoria);
  const corpo = {
    fonte: 'webmotors',
    anuncios: [
      { modelo: 'Polo Track', versao: 'Track', ano: 2025, km: 52000, preco: 74900, vendedor: 'Loja Y', leilao: 'não', data: '2026-10-27', link: 'https://www.webmotors.com.br/x' },
      { modelo: 'Argo Drive', ano: 2025, km: 70000, preco: 69900, descricao: 'veículo de leilão' },
      { modelo: 'Fusca', ano: 2025, km: 1, preco: 50000 },
    ],
  };
  const negado = await fetch(`${url}/api/revenda/anuncios/importar`, { method: 'POST', headers: { ...JSON_, Cookie: leitor }, body: JSON.stringify(corpo) });
  assert.equal(negado.status, 403);
  const r = await fetch(`${url}/api/revenda/anuncios/importar`, { method: 'POST', headers: { ...JSON_, Cookie: admin }, body: JSON.stringify(corpo) });
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { fonte: 'webmotors', importados: 2, recusados: 1, erros: [{ linha: 3, erro: 'modelo não encontrado' }] });
  assert.deepEqual(db.prepare("SELECT leilao, leilao_por FROM anuncios WHERE fonte = 'webmotors' ORDER BY preco").all().map(a => [a.leilao, a.leilao_por]), [[1, 'descricao'], [0, 'fonte']]);
  assert.deepEqual(db.prepare("SELECT data FROM anuncio_leituras ORDER BY data").all().map(l => l.data), ['2026-10-27', HOJE]);
  assert.deepEqual({ ...db.prepare("SELECT origem, status, itens FROM coletas WHERE fonte = 'webmotors'").get() }, { origem: 'importacao', status: 'parcial', itens: 2 });
  const ruim = await fetch(`${url}/api/revenda/anuncios/importar`, { method: 'POST', headers: { ...JSON_, Cookie: admin }, body: JSON.stringify({ fonte: 'Web Motors', anuncios: [{}] }) });
  assert.equal(ruim.status, 400);
  await fechar();
});

test('importar aceita envio grande (acima do limite comum de 100 kB)', async () => {
  const { db, url, admin, fechar } = await subir();
  const anuncios = Array.from({ length: 3000 }, (_, i) => ({ modelo: 'polo-track', versao: 'Track 1.0 Flex 12V 5p completo', ano: 2025, km: 30000 + i, preco: 70000 + i, cidade: 'São Paulo', vendedor: 'Loja de teste com nome comprido' }));
  const r = await fetch(`${url}/api/revenda/anuncios/importar`, { method: 'POST', headers: { ...JSON_, Cookie: admin }, body: JSON.stringify({ fonte: 'planilha', anuncios }) });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).importados, 3000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM anuncios WHERE fonte = 'planilha'").get().n, 3000);
  await fechar();
});

test('lista com filtros, página e CSV que o Excel abre', async () => {
  const { db, url, admin, fechar } = await subir();
  gravarAnuncios(db, idDe(db, 'polo-track'), [
    { id_externo: 'napista:a', versao: 'Polo Track; 1.0', ano_modelo: 2025, km: 45000, preco: 76000.5, loja: 'Localiza', tipo_vendedor: 'locadora', url: 'https://napista.com.br/anuncios/a' },
    { id_externo: 'mobiauto:b', versao: 'Track', ano_modelo: 2024, km: 80000, preco: 65000, leilao: 1 },
  ], '2026-10-22');
  gravarAnuncios(db, idDe(db, 'byd-dolphin'), [{ id_externo: 'napista:c', versao: 'Dolphin GS', ano_modelo: 2025, km: 20000, preco: 120000 }], HOJE);
  const get = async c => (await fetch(url + c, { headers: { Cookie: admin } }));
  const tudo = await (await get('/api/revenda/anuncios')).json();
  assert.equal(tudo.total, 3);
  assert.deepEqual(tudo.fontes, ['mobiauto', 'napista']);
  assert.equal(tudo.linhas[0].data, HOJE, 'mais recente primeiro');
  assert.equal(tudo.linhas[0].categoria, 'eletrico');
  assert.equal((await (await get('/api/revenda/anuncios?categoria=combustao&fonte=napista')).json()).total, 1);
  assert.equal((await (await get('/api/revenda/anuncios?leilao=sim')).json()).linhas[0].id, 'mobiauto:b');
  assert.equal((await (await get('/api/revenda/anuncios?de=2026-10-25')).json()).total, 1);
  assert.equal((await get('/api/revenda/anuncios?categoria=diesel')).status, 400);
  const csv = await get('/api/revenda/anuncios.csv?modelo=polo-track');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /anuncios-2026-10-29\.csv/);
  const bytes = new Uint8Array(await csv.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM: o Excel lê os acentos certos');
  const linhas = new TextDecoder().decode(bytes).trim().split('\r\n');
  assert.equal(linhas[0], 'Data da coleta;Fonte;Modelo;Categoria;Versão;Ano;Km;Preço;Vendedor;Tipo de vendedor;Leilão;Cidade;Link;Id');
  assert.equal(linhas.length, 3);
  assert.ok(linhas.includes('2026-10-22;napista;Polo Track;Combustão;"Polo Track; 1.0";2025;45000;76000,5;Localiza;locadora;;;https://napista.com.br/anuncios/a;napista:a'));
  assert.equal((await fetch(url + '/api/revenda/anuncios.csv')).status, 401);
  await fechar();
});

test('fontes por modelo: valida o caminho, tira a fonte com null e mantém a Mobiauto nas colunas antigas', async () => {
  const { db, url, admin, fechar } = await subir();
  const id = idDe(db, 'tera');
  const put = corpo => fetch(`${url}/api/revenda/modelos/${id}/fontes`, { method: 'PUT', headers: { ...JSON_, Cookie: admin }, body: JSON.stringify(corpo) });
  assert.equal((await put({ napista: { caminho: 'busca/../x', versao: null } })).status, 400);
  assert.equal((await put({ napista: { caminho: 'sp/volkswagen/tera', versao: '(' } })).status, 400);
  assert.equal((await put({ olx: { caminho: 'x/y' } })).status, 400);
  const r = await put({ mobiauto: { caminho: 'volkswagen/tera', versao: 'MPI 1\\.0' }, napista: null });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { mobiauto: { caminho: 'volkswagen/tera', versao: 'MPI 1\\.0' }, napista: null });
  assert.equal(db.prepare('SELECT mobiauto_versao FROM modelos WHERE id = ?').get(id).mobiauto_versao, 'MPI 1\\.0');
  const p = await (await fetch(`${url}/api/revenda/premissas`, { headers: { Cookie: admin } })).json();
  assert.deepEqual(p.modelos.find(m => m.slug === 'tera').fontes.napista, null);
  await fechar();
});

test('importar guarda o ano de fabricação e recusa fabricação fora de ano-modelo − 1 e ano-modelo', () => {
  const db = bancoNovo();
  const modelos = db.prepare('SELECT id, slug, nome FROM modelos').all();
  const base = { modelo: 'polo-track', ano_modelo: '2026', km: '40000', preco: '80000' };
  assert.equal(lerLinha({ ...base, ano_fabricacao: '2025' }, { fonte: 'webmotors', modelos, hoje: HOJE }).anuncio.ano_fabricacao, 2025);
  assert.equal(lerLinha(base, { fonte: 'webmotors', modelos, hoje: HOJE }).anuncio.ano_fabricacao, null);
  assert.equal(lerLinha({ ...base, ano_fabricacao: '2023' }, { fonte: 'webmotors', modelos, hoje: HOJE }).erro, 'ano de fabricação inválido');
});
