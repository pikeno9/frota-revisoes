# Preços v2, módulo Revisões: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruir o site de preços de revisão (coleta, dados e telas) sobre faixas de vigência, coleta semanal dentro da VPS, alertas por WhatsApp e quatro telas novas, sem perder o histórico de produção.

**Architecture:** Mesmo repo `pikeno9/frota-revisoes` e mesma base (Express + `node:sqlite`). O código sai do `server.js` único para `src/` (banco e migrações, regra de gravação, coletores por fonte, coleta, alertas, rotas) e o front vira módulos ES em `public/js/`, sem etapa de build. As tabelas antigas ficam congeladas; uma rota de compatibilidade mantém o KPIs funcionando.

**Tech Stack:** Node 22 (produção) / 24 (notebook), Express 4, `node:sqlite` com `--experimental-sqlite`, `node:test`, Chart.js 4.4.7 guardado em `public/vendor/`, Coolify (tarefa agendada), Evolution API (WhatsApp).

Spec: `docs/superpowers/specs/2026-10-28-precos-v2-revisoes-design.md`.

## Global Constraints

- Histórico de produção (`/data/revisoes.db`) não pode ser perdido: tabelas `veiculos` e `precos` nunca são alteradas nem apagadas; cópia do arquivo antes do deploy.
- Nada de dado de teste em produção. Nada de push na `main` sem OK do Enrico (Task 0 e Task 15 pedem OK explícito).
- Leitura pública; escrita só com login (`ADMIN_SENHA_HASH`, `SESSION_SECRET`).
- Telas: viewport 1280×585 sem rolar a página no conteúdo principal; sem texto explicativo; sem travessão (—) em nenhum texto de tela.
- Identidade OCN: Plus Jakarta Sans, roxo `#5800F7`, escuro `#0A0118`, tema claro.
- Todas as revisões publicadas pela montadora (BYD 10, VW 10, GM 10, Fiat 5); nenhuma revisão inventada na tela.
- `/api/veiculos` e `/api/precos` (GET) mantêm o formato atual para o `ocn-kpis-site/lib/revisoes.js`.
- Comentários e nomes em português, sem acento em identificadores, no estilo do código atual.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Rodar testes: `npm test` (= `node --experimental-sqlite --test "test/**/*.test.js"`).

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `server.js` | abre o banco, migra, sobe o app |
| `src/datas.js` | `hojeSP()`, `diaAnterior()` |
| `src/db.js` | `abrir()`, `transacao()` |
| `src/migracoes/index.js` | `migrar()`, `versaoAtual()` |
| `src/migracoes/001-legado.js` | esquema antigo (no-op em produção) |
| `src/migracoes/002-v2.js` | tabelas novas + conversão + conferência |
| `src/gravar.js` | `validar()`, `gravarModelo()` |
| `src/coletores/{http,byd,gm,fiat,vw,index}.js` | leitura de cada fonte |
| `src/frota.js` | `buscarFrota()`, `aplicarFrota()` |
| `src/alertas.js` | `montarMensagem()`, `enviarPendentes()` |
| `src/coleta.js` | `rodarColeta()`, `emAndamento()` |
| `src/dependencias.js` | liga coletores, frota e alertas a partir do `env` |
| `src/consultas.js` | leituras para as telas |
| `src/auth.js` | hash de senha, sessão por cookie |
| `src/app.js` | `criarApp()` |
| `src/rotas/{publicas,admin,compat}.js` | rotas HTTP |
| `scripts/coletar.js`, `scripts/gerar-hash.js` | linha de comando |
| `public/index.html`, `public/css/{base,telas}.css`, `public/js/*.js`, `public/vendor/chart.umd.js`, `public/img/*` | telas |
| `test/*.test.js`, `test/ajuda.js`, `test/fixtures/*` | testes (fixtures BYD, GM, Fiat já salvas em 28/10) |
| `ocn-ativos/server.js` (outro repo) | rota `GET /api/precos/frota` |

Arquivos que saem: `db.js`, `seed.js`, `scraper/` inteiro, `.github/workflows/coleta-mensal.yml` (este só na Task 15).

---

### Task 0: Conserto imediato na versão atual (precisa de OK para push)

Outubro não foi coletado. Antes da reconstrução, a versão atual volta a coletar.

**Files:**
- Modify: `scraper/scrape-byd.js` (trocar leitura de PDF por leitura do HTML)

**Interfaces:**
- Produces: nada usado depois (a Task 5 reescreve o coletor).

- [ ] **Step 1: Trocar a coleta da BYD**: em `scraper/scrape-byd.js`, substituir `descobrirPdfs` e `coletar` por:

```js
// A página passou a trazer os preços no próprio HTML (out/2026), como objetos
// {"n":"BYD King","img":..,"km":[..],"p":[..]}. Não há mais PDF.
const ALVOS_HTML = [
  { modelo: 'Dolphin', nome: 'BYD Dolphin / Dolphin Plus' },
  { modelo: 'King',    nome: 'BYD King' },
];
const RE_BYD = /\{"n":"([^"]+)"[^{}]*?"km":\[([^\]]*)\],"p":\[([^\]]*)\]/g;

async function coletar() {
  const html = await baixar(PAGINA);
  const lista = [...html.matchAll(RE_BYD)].map(m => ({ nome: m[1], km: m[2].split(',').map(Number), p: m[3].split(',').map(Number) }));
  if (!lista.length) throw new Error('tabela de preços não encontrada na página');
  const itens = [];
  for (const alvo of ALVOS_HTML) {
    const t = lista.find(x => x.nome === alvo.nome);
    if (!t) { console.warn(`✗ ${alvo.modelo} não está na página`); continue; }
    console.log(`✓ ${alvo.modelo}: ${t.p.length} revisões`);
    t.p.forEach((valor, i) => itens.push({ montadora: 'BYD', modelo: alvo.modelo, revisao: `${i + 1}ª revisão (${t.km[i].toLocaleString('pt-BR')} km)`, valor }));
  }
  return itens;
}
```

Remover o import de `pdfjs-dist`, a função `parsePdf`, `descobrirPdfs`, `ALVOS` e o ramo `--file` de `main()`.

- [ ] **Step 2: Conferir sem enviar**

Run: `cd scraper && env -u API_URL -u INGEST_TOKEN node scrape-byd.js --dry | head -5`
Expected: `✓ Dolphin: 10 revisões`, `✓ King: 10 revisões`, `Total: 20 preços coletados.`

- [ ] **Step 3: Commit local**

```bash
git switch main && git add scraper/scrape-byd.js && git commit -m "Coletor BYD le os precos do HTML (site tirou os PDFs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: PARAR e pedir OK ao Enrico** para: push na `main`, cadastrar o Onix em produção, religar a Action e rodar a coleta de outubro.

- [ ] **Step 5: Com o OK, executar**

```bash
git push origin main
curl -s -X POST https://precos.ocnbrasil.com.br/api/veiculos -H 'Content-Type: application/json' -d '{"montadora":"Chevrolet","modelo":"Onix Sedan Plus","versao":"1.0 12V Mec.","ano":"26/26","apelido":"Onix Sedan Plus"}'
gh workflow enable coleta-mensal.yml -R pikeno9/frota-revisoes
gh workflow run coleta-mensal.yml -R pikeno9/frota-revisoes
```

Esperar o deploy do Coolify terminar antes do `gh workflow run` (`curl -s https://precos.ocnbrasil.com.br/api/veiculos` mostra o Onix).

- [ ] **Step 6: Conferir**: `gh run watch -R pikeno9/frota-revisoes` termina `success`; no log os 4 `API:` com `naoEncontrados: []`; `curl -s https://precos.ocnbrasil.com.br/api/resumo` tem linhas `2026-10-01` para os 6 veículos. Voltar para a branch: `git switch reconstrucao-v2 && git merge main`.

---

### Task 1: Base nova (banco, migrações, datas, testes)

**Files:**
- Create: `src/datas.js`, `src/db.js`, `src/migracoes/index.js`, `src/migracoes/001-legado.js`, `test/ajuda.js`, `test/base.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `hojeSP(agora?: Date): string` · `diaAnterior(iso: string): string` · `abrir(caminho: string): DatabaseSync` · `transacao(db, fn: () => T): T` · `migrar(db, lista?): number` · `versaoAtual(db): number` · `MIGRACOES` · em `test/ajuda.js`: `bancoNovo()`, `bancoLegado({veiculos, precos})`, `resposta(corpo, {status, cookies})`, `servidor(app)`.

- [ ] **Step 1: `package.json`**: scripts e engines:

```json
{
  "name": "frota-revisoes",
  "version": "2.0.0",
  "description": "Preços de revisão da frota OCN",
  "type": "module",
  "scripts": {
    "start": "node --experimental-sqlite server.js",
    "coletar": "node --experimental-sqlite scripts/coletar.js",
    "hash": "node scripts/gerar-hash.js",
    "test": "node --experimental-sqlite --test \"test/**/*.test.js\""
  },
  "dependencies": { "express": "^4.19.2" },
  "engines": { "node": ">=22.5.0" }
}
```

- [ ] **Step 2: Teste que falha**: `test/base.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hojeSP, diaAnterior } from '../src/datas.js';
import { abrir, transacao } from '../src/db.js';
import { migrar, versaoAtual } from '../src/migracoes/index.js';

test('hojeSP usa o fuso de São Paulo', () => {
  assert.equal(hojeSP(new Date('2026-11-02T02:30:00Z')), '2026-11-01');
});

test('diaAnterior atravessa mês e ano', () => {
  assert.equal(diaAnterior('2026-10-01'), '2026-09-30');
  assert.equal(diaAnterior('2027-01-01'), '2026-12-31');
});

test('transacao desfaz tudo quando a função lança', () => {
  const db = abrir(':memory:');
  db.exec('CREATE TABLE t (x INTEGER)');
  assert.throws(() => transacao(db, () => { db.exec('INSERT INTO t VALUES (1)'); throw new Error('x'); }));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM t').get().n, 0);
});

test('migrar aplica cada versão uma vez só', () => {
  const db = abrir(':memory:');
  const lista = [{ versao: 1, aplicar: d => d.exec('CREATE TABLE a (x)') }];
  assert.equal(migrar(db, lista), 1);
  assert.equal(migrar(db, lista), 1);
  assert.equal(versaoAtual(db), 1);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../src/datas.js'`

- [ ] **Step 4: Implementar**: `src/datas.js`:

```js
// Datas como texto YYYY-MM-DD, sempre no fuso de São Paulo.
export function hojeSP(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

export function diaAnterior(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
```

`src/db.js`:

```js
// Banco SQLite nativo do Node. WAL + busy_timeout porque o servidor e a tarefa
// agendada de coleta escrevem no mesmo arquivo.
import { DatabaseSync } from 'node:sqlite';

export function abrir(caminho) {
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  return db;
}

// fn precisa ser síncrona (node:sqlite é síncrono).
export function transacao(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
```

`src/migracoes/001-legado.js` (esquema antigo, idêntico ao `db.js` atual; em produção não faz nada):

```js
export default {
  versao: 1,
  aplicar(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS veiculos (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        montadora TEXT NOT NULL,
        modelo    TEXT NOT NULL,
        versao    TEXT,
        ano       TEXT,
        apelido   TEXT,
        criado_em TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS precos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        veiculo_id  INTEGER NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
        revisao     TEXT NOT NULL,
        data_coleta TEXT NOT NULL,
        valor       REAL NOT NULL,
        fonte       TEXT DEFAULT 'manual',
        obs         TEXT,
        criado_em   TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_precos_veiculo ON precos(veiculo_id);
    `);
  },
};
```

`src/migracoes/index.js` (a v2 entra na Task 2; por ora só a legada):

```js
import { transacao } from '../db.js';
import legado from './001-legado.js';

export const MIGRACOES = [legado];

export function versaoAtual(db) {
  return db.prepare('SELECT COALESCE(MAX(versao), 0) AS v FROM schema_versao').get().v;
}

export function migrar(db, lista = MIGRACOES) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_versao (versao INTEGER NOT NULL, aplicada_em TEXT NOT NULL)');
  for (const m of lista) {
    if (m.versao <= versaoAtual(db)) continue;
    transacao(db, () => {
      m.aplicar(db);
      db.prepare("INSERT INTO schema_versao (versao, aplicada_em) VALUES (?, datetime('now'))").run(m.versao);
    });
  }
  return versaoAtual(db);
}
```

`test/ajuda.js`:

```js
import { abrir } from '../src/db.js';
import { migrar } from '../src/migracoes/index.js';
import legado from '../src/migracoes/001-legado.js';

export function bancoNovo() {
  const db = abrir(':memory:');
  migrar(db);
  return db;
}

// Banco no formato antigo, sem migrar: { veiculos: [[id, montadora, modelo, versao]], precos: [[veiculo_id, revisao, data, valor]] }
export function bancoLegado({ veiculos = [], precos = [] }) {
  const db = abrir(':memory:');
  legado.aplicar(db);
  const iv = db.prepare('INSERT INTO veiculos (id, montadora, modelo, versao, ano, apelido) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [id, mont, mod, ver] of veiculos) iv.run(id, mont, mod, ver ?? null, '26/26', mod);
  const ip = db.prepare('INSERT INTO precos (veiculo_id, revisao, data_coleta, valor, fonte) VALUES (?, ?, ?, ?, ?)');
  for (const [vid, rev, data, valor] of precos) ip.run(vid, rev, data, valor, 'scraper');
  return db;
}

// Imita a resposta do fetch.
export function resposta(corpo, { status = 200, cookies = [] } = {}) {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  return {
    ok: status < 400, status,
    headers: { getSetCookie: () => cookies, get: () => null },
    text: async () => texto,
    json: async () => JSON.parse(texto),
  };
}

export async function servidor(app) {
  const s = app.listen(0);
  await new Promise(r => s.once('listening', r));
  return { url: `http://127.0.0.1:${s.address().port}`, fechar: () => new Promise(r => s.close(r)) };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: 4 testes PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json src test/ajuda.js test/base.test.js
git commit -m "Base da v2: banco com WAL, migracoes versionadas, datas em SP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migração v2 (tabelas novas, conversão do legado, conferência)

**Files:**
- Create: `src/migracoes/002-v2.js`, `test/migracao.test.js`
- Modify: `src/migracoes/index.js` (incluir a v2)

**Interfaces:**
- Consumes: `diaAnterior`, `transacao`, `migrar`, `bancoLegado`.
- Produces: tabelas `modelos`, `coletas`, `vigencias`, `alertas` (SQL da spec, seção 3) · `CONHECIDOS` (mapa `"montadora|modelo"` minúsculo → dados do modelo) · `lerRevisaoLegada(texto): {ordem, km} | null` · `FIAT_PUBLICADAS = 5`.

- [ ] **Step 1: Teste que falha**: `test/migracao.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoLegado } from './ajuda.js';
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../002-v2.js'`

- [ ] **Step 3: Implementar**: `src/migracoes/002-v2.js`:

```js
// v2: modelos parametrizados, preços em faixas de vigência, coletas e alertas.
// As tabelas antigas (veiculos, precos) ficam intactas e congeladas.
import { diaAnterior } from '../datas.js';

// A Fiat publica 5 revisões; no legado a 6ª a 10ª eram cópia do ciclo.
export const FIAT_PUBLICADAS = 5;

// Chave = "montadora|modelo" do legado, em minúsculas.
export const CONHECIDOS = {
  'volkswagen|polo track': { slug: 'polo-track', montadora: 'Volkswagen', nome: 'Polo Track', versao: '1.0', ano_modelo: 2026, origem: 'frota', chave_ativos: 'polo', coletor: 'vw', parametros: { modelo: 'Polo Track', versao: '1.0 MPI', ano: 2026 } },
  'volkswagen|tera': { slug: 'tera', montadora: 'Volkswagen', nome: 'Tera', versao: '1.0 MPI', ano_modelo: 2026, origem: 'frota', chave_ativos: 'tera', coletor: 'vw', parametros: { modelo: 'Tera', versao: '1.0 MPI', ano: 2026 } },
  'fiat|argo drive': { slug: 'argo-drive', montadora: 'Fiat', nome: 'Argo Drive', versao: '1.0', ano_modelo: 2026, origem: 'frota', chave_ativos: 'argo', coletor: 'fiat', parametros: { mvsCode: '358ATS1', modelYear: 2026, dealer: '919654' }, projetar_ciclo: 1 },
  'chevrolet|onix sedan plus': { slug: 'onix-sedan-plus', montadora: 'Chevrolet', nome: 'Onix Sedan Plus', versao: '1.0 12V Mec.', ano_modelo: 2026, origem: 'candidato', coletor: 'gm', parametros: { model: 'Onix Plus', year: '2026', trim: 'Aspirado' } },
  'byd|dolphin': { slug: 'byd-dolphin', montadora: 'BYD', nome: 'Dolphin', versao: 'GS', ano_modelo: 2026, origem: 'candidato', coletor: 'byd', parametros: { nome: 'BYD Dolphin / Dolphin Plus' } },
  'byd|king': { slug: 'byd-king', montadora: 'BYD', nome: 'King', versao: 'GL 1.5 DM-i', ano_modelo: 2026, origem: 'candidato', coletor: 'byd', parametros: { nome: 'BYD King' } },
};

const SQL = `
  CREATE TABLE modelos (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    montadora TEXT NOT NULL,
    nome TEXT NOT NULL,
    versao TEXT, ano_modelo INTEGER,
    origem TEXT NOT NULL CHECK (origem IN ('frota','candidato')),
    chave_ativos TEXT UNIQUE,
    qtd_frota INTEGER NOT NULL DEFAULT 0,
    coletor TEXT NOT NULL CHECK (coletor IN ('byd','vw','gm','fiat')),
    parametros TEXT NOT NULL,
    legado_veiculo_id INTEGER,
    projetar_ciclo INTEGER NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE coletas (
    id INTEGER PRIMARY KEY,
    fonte TEXT NOT NULL,
    inicio TEXT NOT NULL, fim TEXT,
    status TEXT CHECK (status IN ('ok','parcial','falha')),
    modelos_ok INTEGER DEFAULT 0, itens INTEGER DEFAULT 0, mudancas INTEGER DEFAULT 0,
    erro TEXT, origem TEXT NOT NULL DEFAULT 'agenda'
  );
  CREATE TABLE vigencias (
    id INTEGER PRIMARY KEY,
    modelo_id INTEGER NOT NULL REFERENCES modelos(id),
    ordem INTEGER NOT NULL,
    km INTEGER NOT NULL,
    meses INTEGER,
    valor REAL NOT NULL,
    vigente_de TEXT NOT NULL,
    vigente_ate TEXT,
    visto_em TEXT NOT NULL,
    coleta_id INTEGER REFERENCES coletas(id),
    conferir INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX vig_atual ON vigencias(modelo_id, ordem) WHERE vigente_ate IS NULL;
  CREATE INDEX vig_modelo ON vigencias(modelo_id);
  CREATE TABLE alertas (
    id INTEGER PRIMARY KEY,
    coleta_id INTEGER REFERENCES coletas(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('mudanca','nova_revisao','sumiu_revisao','falha','conferir','frota_sem_modelo')),
    modelo_id INTEGER, ordem INTEGER, de REAL, para REAL, texto TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    enviado_em TEXT
  );
`;

export function lerRevisaoLegada(texto) {
  const n = String(texto).match(/^\s*(\d+)/);
  const k = String(texto).match(/\(([\d.]+)\s*km/i);
  return n ? { ordem: +n[1], km: k ? +k[1].replace(/\./g, '') : null } : null;
}

function inserirModelo(db, d, legadoId) {
  const r = db.prepare(`INSERT INTO modelos (slug, montadora, nome, versao, ano_modelo, origem, chave_ativos, coletor, parametros, legado_veiculo_id, projetar_ciclo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.slug, d.montadora, d.nome, d.versao ?? null, d.ano_modelo ?? null, d.origem,
    d.chave_ativos ?? null, d.coletor, JSON.stringify(d.parametros), legadoId ?? null, d.projetar_ciclo ?? 0);
  return Number(r.lastInsertRowid);
}

// Cada (modelo, ordem, mês) do legado tem que dar o mesmo valor na vigência.
function conferir(db, grupos) {
  const q = db.prepare('SELECT valor FROM vigencias WHERE modelo_id = ? AND ordem = ? AND vigente_de <= ? AND (vigente_ate IS NULL OR vigente_ate >= ?)');
  for (const g of grupos) {
    for (const [mes, valor] of g.meses) {
      const d = `${mes}-01`;
      const r = q.all(g.modeloId, g.ordem, d, d);
      if (r.length !== 1 || r[0].valor !== valor) throw new Error(`conferência falhou: modelo ${g.modeloId}, ${g.ordem}ª, ${mes}`);
    }
  }
}

export default {
  versao: 2,
  aplicar(db) {
    db.exec(SQL);

    // 1) veículos antigos → modelos
    const idPorLegado = new Map();
    const ciclo = new Set();
    for (const v of db.prepare('SELECT * FROM veiculos ORDER BY id').all()) {
      const c = CONHECIDOS[`${v.montadora}|${v.modelo}`.toLowerCase()];
      if (!c) throw new Error(`veículo legado sem mapeamento: ${v.montadora} ${v.modelo}`);
      const id = inserirModelo(db, c, v.id);
      idPorLegado.set(v.id, id);
      if (c.projetar_ciclo) ciclo.add(id);
    }
    for (const c of Object.values(CONHECIDOS)) {
      if (!db.prepare('SELECT 1 FROM modelos WHERE slug = ?').get(c.slug)) inserirModelo(db, c, null);
    }

    // 2) preços antigos agrupados por (modelo, ordem), um valor por mês
    const coletaId = Number(db.prepare("INSERT INTO coletas (fonte, inicio, fim, status, origem) VALUES ('legado', datetime('now'), datetime('now'), 'ok', 'migracao')").run().lastInsertRowid);
    const grupos = new Map();
    for (const p of db.prepare('SELECT veiculo_id, revisao, data_coleta, valor FROM precos ORDER BY data_coleta, id').all()) {
      const modeloId = idPorLegado.get(p.veiculo_id);
      const rev = lerRevisaoLegada(p.revisao);
      if (!modeloId || !rev || !rev.km) throw new Error(`preço legado ilegível: veículo ${p.veiculo_id}, "${p.revisao}"`);
      if (ciclo.has(modeloId) && rev.ordem > FIAT_PUBLICADAS) continue;
      const k = `${modeloId}|${rev.ordem}`;
      if (!grupos.has(k)) grupos.set(k, { modeloId, ordem: rev.ordem, km: rev.km, meses: new Map() });
      grupos.get(k).meses.set(String(p.data_coleta).slice(0, 7), Number(p.valor));
    }

    // 3) meses seguidos de mesmo valor viram uma faixa
    const ins = db.prepare('INSERT INTO vigencias (modelo_id, ordem, km, valor, vigente_de, vigente_ate, visto_em, coleta_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const alerta = db.prepare("INSERT INTO alertas (coleta_id, tipo, modelo_id, ordem, de, para, criado_em, enviado_em) VALUES (?, 'mudanca', ?, ?, ?, ?, ?, datetime('now'))");
    let itens = 0;
    for (const g of grupos.values()) {
      const faixas = [];
      for (const mes of [...g.meses.keys()].sort()) {
        const valor = g.meses.get(mes);
        const ult = faixas.at(-1);
        if (ult && ult.valor === valor) ult.ate = mes;
        else faixas.push({ valor, de: mes, ate: mes });
      }
      faixas.forEach((f, i) => {
        const prox = faixas[i + 1];
        ins.run(g.modeloId, g.ordem, g.km, f.valor, `${f.de}-01`, prox ? diaAnterior(`${prox.de}-01`) : null, `${f.ate}-01`, coletaId);
        if (i > 0) alerta.run(coletaId, g.modeloId, g.ordem, faixas[i - 1].valor, f.valor, `${f.de}-01 12:00:00`);
        itens++;
      });
    }
    db.prepare('UPDATE coletas SET itens = ? WHERE id = ?').run(itens, coletaId);

    conferir(db, grupos.values());
  },
};
```

Em `src/migracoes/index.js`, trocar a lista:

```js
import v2 from './002-v2.js';

export const MIGRACOES = [legado, v2];
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: todos PASS (11 testes).

- [ ] **Step 5: Ensaio com o banco local antigo** (o `revisoes.db` do notebook, de junho):

Run: `cp revisoes.db /tmp/ensaio.db && node --experimental-sqlite -e "import('./src/db.js').then(async ({abrir})=>{const {migrar}=await import('./src/migracoes/index.js');const db=abrir('/tmp/ensaio.db');console.log('versao',migrar(db));console.log(db.prepare('SELECT slug, origem FROM modelos').all())})"`
Expected: `versao 2` e a lista de modelos; se lançar `sem mapeamento`, acrescentar o veículo a `CONHECIDOS` (nunca apagar do legado).

- [ ] **Step 6: Commit**

```bash
git add src/migracoes test/migracao.test.js
git commit -m "Migracao v2: modelos, vigencias, coletas e alertas a partir do legado, com conferencia

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Regra de gravação

**Files:**
- Create: `src/gravar.js`, `test/gravar.test.js`

**Interfaces:**
- Consumes: `diaAnterior`, `bancoNovo`.
- Produces: `validar(itens, qtdAtual): string | null` · `gravarModelo(db, { modeloId, itens, coletaId, data }): { erro: string|null, mudancas: number, itens: number }` (síncrona; quem chama envolve em `transacao`) · `SALTO_CONFERIR = 0.4`. Item = `{ ordem: int, km: int, meses: int|null, valor: number }`.

- [ ] **Step 1: Teste que falha**: `test/gravar.test.js`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../src/gravar.js'`

- [ ] **Step 3: Implementar**: `src/gravar.js`:

```js
// Grava o resultado de um coletor para um modelo: faixas de vigência + alertas.
// Síncrona: quem chama envolve em transacao().
import { diaAnterior } from './datas.js';

export const VALOR_MIN = 50;
export const VALOR_MAX = 30000;
export const SALTO_CONFERIR = 0.4;

const centavos = v => Math.round(Number(v) * 100) / 100;

export function validar(itens, qtdAtual) {
  if (!Array.isArray(itens) || itens.length === 0) return 'nenhuma revisão coletada';
  const ordens = new Set();
  for (const it of itens) {
    if (!Number.isInteger(it.ordem) || it.ordem < 1) return `ordem inválida: ${it.ordem}`;
    if (ordens.has(it.ordem)) return `ordem repetida: ${it.ordem}`;
    ordens.add(it.ordem);
    if (!Number.isInteger(it.km) || it.km <= 0) return `km inválido na ${it.ordem}ª`;
    if (!(it.valor >= VALOR_MIN && it.valor <= VALOR_MAX)) return `valor fora da faixa na ${it.ordem}ª: ${it.valor}`;
  }
  if (itens.length < qtdAtual) return `vieram ${itens.length} revisões, havia ${qtdAtual}`;
  return null;
}

export function gravarModelo(db, { modeloId, itens, coletaId, data }) {
  const atuais = db.prepare('SELECT * FROM vigencias WHERE modelo_id = ? AND vigente_ate IS NULL').all(modeloId);
  const alerta = db.prepare('INSERT INTO alertas (coleta_id, tipo, modelo_id, ordem, de, para, texto) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const erro = validar(itens, atuais.length);
  if (erro) {
    alerta.run(coletaId, 'falha', modeloId, null, null, null, erro);
    return { erro, mudancas: 0, itens: 0 };
  }

  const porOrdem = new Map(atuais.map(v => [v.ordem, v]));
  const abrir = db.prepare('INSERT INTO vigencias (modelo_id, ordem, km, meses, valor, vigente_de, visto_em, coleta_id, conferir) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const fechar = db.prepare('UPDATE vigencias SET vigente_ate = ? WHERE id = ?');
  const confirmar = db.prepare('UPDATE vigencias SET visto_em = ?, km = ?, meses = COALESCE(?, meses) WHERE id = ?');
  const corrigir = db.prepare('UPDATE vigencias SET valor = ?, conferir = ?, visto_em = ?, coleta_id = ? WHERE id = ?');

  let mudancas = 0;
  for (const it of itens) {
    const valor = centavos(it.valor);
    const meses = it.meses ?? null;
    const at = porOrdem.get(it.ordem);
    if (!at) {
      abrir.run(modeloId, it.ordem, it.km, meses, valor, data, data, coletaId, 0);
      alerta.run(coletaId, 'nova_revisao', modeloId, it.ordem, null, valor, null);
      mudancas++;
      continue;
    }
    if (centavos(at.valor) === valor) { confirmar.run(data, it.km, meses, at.id); continue; }

    const salto = Math.abs(valor - at.valor) / at.valor > SALTO_CONFERIR ? 1 : 0;
    if (at.vigente_de === data) corrigir.run(valor, salto, data, coletaId, at.id);
    else {
      fechar.run(diaAnterior(data), at.id);
      abrir.run(modeloId, it.ordem, it.km, meses, valor, data, data, coletaId, salto);
    }
    alerta.run(coletaId, 'mudanca', modeloId, it.ordem, at.valor, valor, null);
    if (salto) alerta.run(coletaId, 'conferir', modeloId, it.ordem, at.valor, valor, null);
    mudancas++;
  }

  const vieram = new Set(itens.map(i => i.ordem));
  for (const at of atuais) {
    if (!vieram.has(at.ordem)) alerta.run(coletaId, 'sumiu_revisao', modeloId, at.ordem, at.valor, null, null);
  }
  return { erro: null, mudancas, itens: itens.length };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gravar.js test/gravar.test.js
git commit -m "Regra de gravacao: faixas de vigencia, validacao e alertas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Coletores BYD, GM e Fiat

**Files:**
- Create: `src/coletores/http.js`, `src/coletores/byd.js`, `src/coletores/gm.js`, `src/coletores/fiat.js`, `test/coletores.test.js`
- Fixtures já salvas: `test/fixtures/byd-2026-10-28.html`, `test/fixtures/gm-onix-2026-10-28.json`, `test/fixtures/fiat-358ATS1-2026-10-28.json`

**Interfaces:**
- Consumes: `resposta()` de `test/ajuda.js`.
- Produces: cada módulo exporta `coletar(parametros, buscar = fetch): Promise<Item[]>` e, BYD e GM, `catalogo(buscar = fetch): Promise<{rotulo, parametros}[]>`. Também `lerHtml(html)` (BYD), `parsePreco(s)`, `mesesDoTitulo(t)` (GM), `ler(arr)` (Fiat). `UA` em `http.js`.

- [ ] **Step 1: Teste que falha**: `test/coletores.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resposta } from './ajuda.js';
import * as byd from '../src/coletores/byd.js';
import * as gm from '../src/coletores/gm.js';
import * as fiat from '../src/coletores/fiat.js';

const fx = nome => readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), 'utf8');
const servir = corpo => async () => resposta(corpo);

test('BYD: lê os 21 modelos do HTML', () => {
  const lista = byd.lerHtml(fx('byd-2026-10-28.html'));
  assert.equal(lista.length, 21);
  assert.ok(lista.some(x => x.nome === 'BYD King'));
});

test('BYD: King com 10 revisões, km de 12 mil e meses de 12 em 12', async () => {
  const itens = await byd.coletar({ nome: 'BYD King' }, servir(fx('byd-2026-10-28.html')));
  assert.deepEqual(itens.map(i => i.valor), [926, 1290, 926, 2472, 926, 2375, 926, 2472, 926, 2496]);
  assert.deepEqual(itens[0], { ordem: 1, km: 12000, meses: 12, valor: 926 });
  assert.equal(itens[9].km, 120000);
});

test('BYD: modelo que não está na página lança erro claro', async () => {
  await assert.rejects(byd.coletar({ nome: 'BYD Inexistente' }, servir(fx('byd-2026-10-28.html'))), /não está na página/);
});

test('BYD: página sem tabela lança erro', async () => {
  await assert.rejects(byd.coletar({ nome: 'BYD King' }, servir('<html></html>')), /tabela de preços não encontrada/);
});

test('BYD: catálogo dá rótulo e parâmetros', async () => {
  const cat = await byd.catalogo(servir(fx('byd-2026-10-28.html')));
  assert.deepEqual(cat.find(c => c.rotulo === 'BYD King'), { rotulo: 'BYD King', parametros: { nome: 'BYD King' } });
});

test('GM: preço parcelado vira total', () => {
  assert.equal(gm.parsePreco('4 x R$ 139'), 556);
  assert.equal(gm.parsePreco('R$ 1.020,50'), 1020.5);
  assert.equal(gm.parsePreco('consulte'), null);
  assert.equal(gm.mesesDoTitulo('Revisão 10.000Km ou 1 Ano'), 12);
  assert.equal(gm.mesesDoTitulo('Revisão 20.000Km ou 2 Anos'), 24);
});

test('GM: Onix Plus Aspirado 2026 com 10 revisões', async () => {
  const itens = await gm.coletar({ model: 'Onix Plus', year: '2026', trim: 'Aspirado' }, servir(fx('gm-onix-2026-10-28.json')));
  assert.deepEqual(itens.map(i => i.valor), [556, 932, 844, 1028, 944, 932, 844, 1400, 812, 1096]);
  assert.deepEqual(itens[0], { ordem: 1, km: 10000, meses: 12, valor: 556 });
});

test('GM: trim com ponto do catálogo casa literal', async () => {
  const itens = await gm.coletar({ model: 'Onix Plus', year: '2026', trim: '1.0 Aspirado' }, servir(fx('gm-onix-2026-10-28.json')));
  assert.equal(itens.length, 10);
});

test('Fiat: 5 revisões reais, km em milhares vira km', async () => {
  const itens = await fiat.coletar({ mvsCode: '358ATS1', modelYear: 2026, dealer: '919654' }, servir(fx('fiat-358ATS1-2026-10-28.json')));
  assert.deepEqual(itens, [
    { ordem: 1, km: 10000, meses: 12, valor: 701 },
    { ordem: 2, km: 20000, meses: 24, valor: 931 },
    { ordem: 3, km: 30000, meses: 36, valor: 701 },
    { ordem: 4, km: 40000, meses: 48, valor: 1576 },
    { ordem: 5, km: 50000, meses: 60, valor: 721 },
  ]);
});

test('Fiat: resposta vazia lança erro', async () => {
  await assert.rejects(fiat.coletar({ mvsCode: 'X', modelYear: 2026, dealer: '1' }, servir([])), /nenhuma revisão/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../src/coletores/byd.js'`

- [ ] **Step 3: Implementar**: `src/coletores/http.js`:

```js
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

export async function pegar(buscar, url, rotulo, tipo = 'json') {
  const r = await buscar(url, { headers: { 'User-Agent': UA, Accept: tipo === 'json' ? 'application/json' : 'text/html' } });
  if (!r.ok) throw new Error(`${rotulo} respondeu ${r.status}`);
  return tipo === 'json' ? r.json() : r.text();
}
```

`src/coletores/byd.js`:

```js
// BYD: a página do plano de manutenção traz no HTML um objeto por modelo,
// {"n":"BYD King","img":..,"km":[..],"p":[..]}. Meses: (i+1)*12, como no rótulo do site.
import { pegar } from './http.js';

export const PAGINA = 'https://www.byd.com/br/plano-de-manutencao';
const RE = /\{"n":"([^"]+)"[^{}]*?"km":\[([^\]]*)\],"p":\[([^\]]*)\]/g;

export function lerHtml(html) {
  return [...html.matchAll(RE)].map(m => ({ nome: m[1], km: m[2].split(',').map(Number), p: m[3].split(',').map(Number) }));
}

async function lista(buscar) {
  const l = lerHtml(await pegar(buscar, PAGINA, 'BYD', 'html'));
  if (!l.length) throw new Error('BYD: tabela de preços não encontrada na página');
  return l;
}

export async function coletar(parametros, buscar = fetch) {
  const alvo = (await lista(buscar)).find(x => x.nome === parametros.nome);
  if (!alvo) throw new Error(`BYD: "${parametros.nome}" não está na página`);
  return alvo.p.map((valor, i) => ({ ordem: i + 1, km: alvo.km[i], meses: (i + 1) * 12, valor }));
}

export async function catalogo(buscar = fetch) {
  return (await lista(buscar)).map(x => ({ rotulo: x.nome, parametros: { nome: x.nome } }));
}
```

`src/coletores/gm.js`:

```js
// Chevrolet: o simulador da GM carrega toda a base de um JSON estático
// {make, model, trim, year, mileDisplay, title, price}; price = "4 x R$ 139".
import { pegar } from './http.js';

export const DADOS = 'https://novoservico.gm.com/json/data_pt-br.json';
const literal = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parsePreco(s) {
  const num = t => Number(t.replace(/\./g, '').replace(',', '.'));
  const parc = String(s).match(/(\d+)\s*x\s*R\$\s*([\d.,]+)/i);
  if (parc) return +(Number(parc[1]) * num(parc[2])).toFixed(2);
  const avista = String(s).match(/R\$\s*([\d.,]+)/);
  return avista ? +num(avista[1]).toFixed(2) : null;
}

export function mesesDoTitulo(t) {
  const m = String(t).match(/(\d+)\s*Ano/i);
  return m ? +m[1] * 12 : null;
}

export async function coletar(p, buscar = fetch) {
  const re = new RegExp(literal(p.trim), 'i');
  const recs = (await pegar(buscar, DADOS, 'GM'))
    .filter(x => x.model === p.model && String(x.year) === String(p.year) && re.test(x.trim))
    .sort((a, b) => a.mileDisplay - b.mileDisplay);
  if (!recs.length) throw new Error(`GM: nenhum registro para ${p.model} ${p.year} ${p.trim}`);
  return recs.map((x, i) => {
    const valor = parsePreco(x.price);
    if (valor == null) throw new Error(`GM: preço ilegível "${x.price}"`);
    return { ordem: i + 1, km: x.mileDisplay, meses: mesesDoTitulo(x.title), valor };
  });
}

export async function catalogo(buscar = fetch) {
  const vistos = new Map();
  for (const x of await pegar(buscar, DADOS, 'GM')) {
    const k = `${x.model}|${x.year}|${x.trim}`;
    if (!vistos.has(k)) vistos.set(k, { rotulo: `${x.make} ${x.model} ${x.trim} ${x.year}`, parametros: { model: x.model, year: String(x.year), trim: x.trim } });
  }
  return [...vistos.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}
```

`src/coletores/fiat.js`:

```js
// Fiat: microserviço de manutenção, preço por concessionária (dealer fixo de SP).
// Devolve só as revisões publicadas (hoje 5); km vem em milhares.
import { pegar } from './http.js';

export const BASE = 'https://maintenance-service.k8s.fcalatam.com.br/v3/maintenance';

export function ler(arr) {
  return arr
    .filter(it => it.totalPrice != null)
    .sort((a, b) => a.km - b.km)
    .map((it, i) => ({ ordem: i + 1, km: Math.round(it.km * 1000), meses: it.timeUseInMonths ?? null, valor: Number(it.totalPrice) }));
}

export async function coletar(p, buscar = fetch) {
  const url = `${BASE}?brand=FIAT&market=pt-BR&modelYear=${p.modelYear}&mvsCode=${encodeURIComponent(p.mvsCode)}&dealer=${encodeURIComponent(p.dealer)}`;
  const itens = ler(await pegar(buscar, url, 'Fiat'));
  if (!itens.length) throw new Error(`Fiat: nenhuma revisão para ${p.mvsCode}`);
  return itens;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add src/coletores test/coletores.test.js test/fixtures
git commit -m "Coletores BYD (HTML), GM e Fiat parametrizados, com arquivos salvos de 28/10

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Coletor VW e registro dos coletores

**Files:**
- Create: `src/coletores/vw.js`, `src/coletores/index.js`, `test/vw.test.js`

**Interfaces:**
- Consumes: `UA` de `http.js`, `resposta()`.
- Produces: `vw.coletar(parametros, buscar = fetch)` com `parametros = { modelo, versao, ano, estado?='SP', cidade?='São Paulo', revisoes?=10 }` · `COLETORES = { byd, vw, gm, fiat }`.

- [ ] **Step 1: Teste que falha**: `test/vw.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resposta } from './ajuda.js';
import * as vw from '../src/coletores/vw.js';
import { COLETORES } from '../src/coletores/index.js';

function siteFalso() {
  const pedidos = [];
  const buscar = async (url, op = {}) => {
    pedidos.push({ url, cookie: op.headers?.Cookie ?? null, method: op.method ?? 'GET' });
    if (url.endsWith('/Revisao/')) return resposta('', { cookies: ['ASP.NET_SessionId=abc; path=/; HttpOnly'] });
    if (url.includes('getversao')) return resposta([{ Versao: '1.0 MPI', ShowPlanoNovo: false }]);
    if (url.includes('getar')) return resposta({ VersaoComAr: true });
    if (url.includes('getcidades')) return resposta([{ idCidade: 7107, nome: 'São Paulo' }]);
    if (url.includes('getregiao')) return resposta([{ localizacao: { regiao: 1 } }]);
    const n = url.match(/getrevisao\/(\d+)/);
    if (n) return resposta({ Data: { total_ItensSubstituidos: 500 + Number(n[1]), total_MaoDeObra: 300.1 } });
    return resposta('');
  };
  return { buscar, pedidos };
}

test('VW: 10 revisões de 10 em 10 mil km, preço = peças + mão de obra', async () => {
  const { buscar } = siteFalso();
  const itens = await vw.coletar({ modelo: 'Polo Track', versao: '1.0 MPI', ano: 2026 }, buscar);
  assert.equal(itens.length, 10);
  assert.deepEqual(itens[0], { ordem: 1, km: 10000, meses: null, valor: 801.1 });
  assert.equal(itens[9].km, 100000);
});

test('VW: manda o cookie da sessão nas chamadas seguintes', async () => {
  const { buscar, pedidos } = siteFalso();
  await vw.coletar({ modelo: 'Tera', versao: '1.0 MPI', ano: 2026 }, buscar);
  assert.equal(pedidos[0].cookie, null);
  assert.ok(pedidos.slice(1).every(p => p.cookie === 'ASP.NET_SessionId=abc'));
});

test('registro tem os quatro coletores', () => {
  assert.deepEqual(Object.keys(COLETORES).sort(), ['byd', 'fiat', 'gm', 'vw']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../src/coletores/vw.js'`

- [ ] **Step 3: Implementar**: `src/coletores/vw.js`:

```js
// Volkswagen: wizard jQuery com sessão no servidor e sem token anti-CSRF,
// replicado com um cookie jar sobre o fetch. A VW publica 10 revisões: do 11
// em diante o site devolve de novo a 1ª (conferido em 28/10/2026).
import { UA } from './http.js';

const BASE = 'https://www.vwbr.com.br/revisao';
const PAGINA = 'https://www.vwbr.com.br/Revisao/';
const enc = encodeURIComponent;
const form = obj => Object.entries(obj).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');

function sessao(buscar) {
  const jar = {};
  return async function req(url, { method = 'GET', body, json } = {}) {
    const headers = { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' };
    const ck = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (ck) headers.Cookie = ck;
    if (body != null) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const res = await buscar(url, { method, headers, body });
    for (const linha of res.headers.getSetCookie?.() || []) {
      const par = linha.split(';')[0];
      const i = par.indexOf('=');
      if (i > 0) jar[par.slice(0, i).trim()] = par.slice(i + 1).trim();
    }
    if (!res.ok) throw new Error(`VW respondeu ${res.status} em ${url.replace(BASE, '')}`);
    return json ? res.json() : res.text();
  };
}

export async function coletar(p, buscar = fetch) {
  const { modelo, versao, ano, estado = 'SP', cidade = 'São Paulo', revisoes = 10 } = p;
  const req = sessao(buscar);

  await req(PAGINA);
  await req(`${BASE}/default/index`, { method: 'POST', body: form({ Mes: 1, Ano: ano }) });

  const versoes = await req(`${BASE}/default/getversao?Veiculo=${enc(modelo)}&Ano=${ano}`, { json: true });
  const v = versoes.find(x => x.Versao === versao);
  if (!v) throw new Error(`VW: versão "${versao}" não existe para ${modelo} ${ano}`);
  const ar = await req(`${BASE}/default/getar?Veiculo=${enc(modelo)}&Ano=${ano}&Versao=${enc(versao)}`, { json: true });

  const cidades = await req(`${BASE}/default/getcidades?estadoUF=${estado}`, { json: true });
  const cid = cidades.find(c => c.nome.toLowerCase() === cidade.toLowerCase());
  if (!cid) throw new Error(`VW: cidade ${cidade} não encontrada em ${estado}`);
  const reg = await req(`${BASE}/default/getregiao?cidadeID=${cid.idCidade}`, { json: true });

  const campos = {
    'data-mes': 1, 'data-ano': ano, AC: ar.VersaoComAr ? 'true' : 'false', Regiao: reg[0].localizacao.regiao,
    Veiculo: modelo, Ano: ano, Versao: `${v.Versao}|${v.ShowPlanoNovo}`, Estado: estado, Cidade: cid.nome,
  };
  await req(`${BASE}/default/regiao`, { method: 'POST', body: form(campos) });
  await req(`${BASE}/default/veiculo`, { method: 'POST', body: form(campos) });

  const itens = [];
  for (let n = 1; n <= revisoes; n++) {
    const r = await req(`${BASE}/default/getrevisao/${n}`, { method: 'POST', body: '', json: true });
    if (!r?.Data) throw new Error(`VW: ${n}ª revisão sem dados`);
    itens.push({ ordem: n, km: n * 10000, meses: null, valor: +(r.Data.total_ItensSubstituidos + r.Data.total_MaoDeObra).toFixed(2) });
  }
  return itens;
}
```

`src/coletores/index.js`:

```js
import * as byd from './byd.js';
import * as vw from './vw.js';
import * as gm from './gm.js';
import * as fiat from './fiat.js';

export const COLETORES = { byd, vw, gm, fiat };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: todos PASS.

- [ ] **Step 5: Conferência ao vivo, sem gravar** (só leitura nas montadoras):

Run: `node -e "import('./src/coletores/index.js').then(async ({COLETORES:C})=>{for (const [c,p] of [['byd',{nome:'BYD King'}],['vw',{modelo:'Polo Track',versao:'1.0 MPI',ano:2026}],['gm',{model:'Onix Plus',year:'2026',trim:'Aspirado'}],['fiat',{mvsCode:'358ATS1',modelYear:2026,dealer:'919654'}]]) { const i = await C[c].coletar(p); console.log(c, i.length, i[0].valor, i[3]?.valor); }})"`
Expected: `byd 10 926 2472`, `vw 10 864.46 1279.53` (ou o valor do dia), `gm 10 556 1028`, `fiat 5 701 1576`.

- [ ] **Step 6: Commit**

```bash
git add src/coletores test/vw.test.js
git commit -m "Coletor VW parametrizado e registro dos coletores

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Frota pelo Ativos (rota nova no ocn-ativos + leitura aqui)

**Files:**
- Modify (outro repo): `C:\Users\enric_zg4u5vi\OneDrive\Desktop\CLAUDE_1\ocn-ativos\server.js` (depois da rota `/api/situacao`)
- Create: `src/frota.js`, `test/frota.test.js`

**Interfaces:**
- Consumes: `bancoNovo`, `resposta`.
- Produces: `buscarFrota({ url, token }, buscar = fetch): Promise<Record<string, number>>` · `aplicarFrota(db, contagem, coletaId): { modelos: number, novas: string[] }` (síncrona).

- [ ] **Step 1: Rota no Ativos**: em `ocn-ativos/server.js`, logo depois do bloco `app.get("/api/situacao", ...)`:

```js
// ============================================================ frota para o site de precos

// O site de precos (precos.ocnbrasil.com.br) conta os carros por modelo para
// saber quais modelos sao da frota. Token proprio, PRECOS_TOKEN; sem a
// variavel, a rota fica fechada. Perda e vendido nao contam.
function precosConfere(req) {
  const esperado = credencial("PRECOS_TOKEN");
  const veio = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!esperado || !veio) return false;
  const a = Buffer.from(esperado), b = Buffer.from(veio);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
app.get("/api/precos/frota", async (req, res) => {
  if (!precosConfere(req)) return res.status(401).json({ erro: "token" });
  try {
    const d = JSON.parse(await dados.frotaJSON());
    const modelos = {};
    for (const c of d.carros) {
      if (/perda|vend/i.test(c.sv || "")) continue;
      modelos[c.mo] = (modelos[c.mo] || 0) + 1;
    }
    res.json({ atualizado: d.atualizado, modelos });
  } catch (e) {
    res.status(503).json({ erro: "indisponivel" });
  }
});
```

Conferir local: subir o Ativos com `PRECOS_TOKEN=teste node server.js --sem-login --porta=3101` e
Run: `curl -s -H "Authorization: Bearer teste" http://localhost:3101/api/precos/frota` → `{"atualizado":"...","modelos":{"polo":..,"argo":..,"tera":..}}`; sem o cabeçalho → `401`.
Commit no `ocn-ativos` (branch `main`, **sem push**: o push vai junto com a Task 15, com OK):

```bash
git -C ../ocn-ativos add server.js && git -C ../ocn-ativos commit -m "Rota /api/precos/frota: carros por modelo para o site de precos (token PRECOS_TOKEN)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Teste que falha**: `test/frota.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, resposta } from './ajuda.js';
import { buscarFrota, aplicarFrota } from '../src/frota.js';

test('buscarFrota manda o Bearer e devolve a contagem', async () => {
  let pedido;
  const buscar = async (url, op) => { pedido = { url, auth: op.headers.Authorization }; return resposta({ atualizado: 'x', modelos: { polo: 76, argo: 69 } }); };
  const r = await buscarFrota({ url: 'https://veiculos.ocnbrasil.com.br/', token: 't1' }, buscar);
  assert.deepEqual(r, { polo: 76, argo: 69 });
  assert.deepEqual(pedido, { url: 'https://veiculos.ocnbrasil.com.br/api/precos/frota', auth: 'Bearer t1' });
});

test('buscarFrota lança com status de erro', async () => {
  await assert.rejects(buscarFrota({ url: 'http://x', token: 't' }, async () => resposta({ erro: 'token' }, { status: 401 })), /401/);
});

test('aplicarFrota atualiza quantidade, origem e avisa modelo sem cadastro', () => {
  const db = bancoNovo();
  const r = aplicarFrota(db, { polo: 76, argo: 69, tera: 0, kwid: 3 }, null);
  const q = slug => ({ ...db.prepare('SELECT qtd_frota, origem FROM modelos WHERE slug = ?').get(slug) });
  assert.deepEqual(q('polo-track'), { qtd_frota: 76, origem: 'frota' });
  assert.deepEqual(q('tera'), { qtd_frota: 0, origem: 'candidato' });
  assert.deepEqual(r.novas, ['kwid']);
  assert.equal(db.prepare("SELECT texto FROM alertas WHERE tipo = 'frota_sem_modelo'").get().texto, 'kwid: 3 carros');
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../src/frota.js'`

- [ ] **Step 4: Implementar**: `src/frota.js`:

```js
// Frota real vem do Ativos (veiculos.ocnbrasil.com.br): carros por modelo,
// pela chave `mo` da planilha (polo, argo, tera...).

export async function buscarFrota({ url, token }, buscar = fetch) {
  const r = await buscar(`${url.replace(/\/$/, '')}/api/precos/frota`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Ativos respondeu ${r.status}`);
  const j = await r.json();
  if (!j || typeof j.modelos !== 'object') throw new Error('Ativos: resposta sem modelos');
  return j.modelos;
}

export function aplicarFrota(db, contagem, coletaId) {
  const modelos = db.prepare('SELECT id, chave_ativos FROM modelos WHERE chave_ativos IS NOT NULL').all();
  const upd = db.prepare("UPDATE modelos SET qtd_frota = ?, origem = CASE WHEN ? > 0 THEN 'frota' ELSE 'candidato' END WHERE id = ?");
  for (const m of modelos) {
    const n = Number(contagem[m.chave_ativos] ?? 0);
    upd.run(n, n, m.id);
  }
  const conhecidas = new Set(modelos.map(m => m.chave_ativos));
  const novas = Object.keys(contagem).filter(k => !conhecidas.has(k) && Number(contagem[k]) > 0);
  const al = db.prepare("INSERT INTO alertas (coleta_id, tipo, texto) VALUES (?, 'frota_sem_modelo', ?)");
  for (const k of novas) al.run(coletaId, `${k}: ${contagem[k]} carros`);
  return { modelos: modelos.length, novas };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: todos PASS.

- [ ] **Step 6: Commit**

```bash
git add src/frota.js test/frota.test.js
git commit -m "Frota lida do Ativos: quantidade por modelo e aviso de modelo sem cadastro

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Alertas, rodada de coleta e linha de comando

**Files:**
- Create: `src/alertas.js`, `src/coleta.js`, `src/dependencias.js`, `scripts/coletar.js`, `test/coleta.test.js`

**Interfaces:**
- Consumes: `transacao`, `gravarModelo`, `aplicarFrota`, `buscarFrota`, `COLETORES`, `hojeSP`.
- Produces: `montarMensagem(alertas, data): string | null` · `pendentes(db)` · `enviarPendentes(db, { env, buscar, data }): Promise<{ enviados, motivo }>` · `rodarColeta(db, { coletores, buscarFrota?, enviar?, data?, origem? }): Promise<Resumo>` com `Resumo = { data, frota, fontes: { [fonte]: { status, modelos_ok, itens, mudancas, erros } }, alertas }` · `emAndamento(): boolean` · `dependencias(env): { coletores, buscarFrota, enviar }`.

- [ ] **Step 1: Teste que falha**: `test/coleta.test.js`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../src/alertas.js'`

- [ ] **Step 3: Implementar**: `src/alertas.js`:

```js
// Uma mensagem de WhatsApp por rodada, pelo Evolution que roda na VPS com o Central.
import { hojeSP } from './datas.js';

const n = v => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const diaMes = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function linha(a) {
  switch (a.tipo) {
    case 'mudanca': {
      const p = (a.para - a.de) / a.de * 100;
      const sinal = p > 0 ? '+' : p < 0 ? '−' : '';
      return `${a.nome} ${a.ordem}ª ${n(a.de)} → ${n(a.para)} (${sinal}${Math.abs(p).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)`;
    }
    case 'nova_revisao': return `${a.nome} ${a.ordem}ª nova: ${n(a.para)}`;
    case 'sumiu_revisao': return `${a.nome} ${a.ordem}ª não veio na coleta`;
    case 'falha': return `Falha ${a.nome ?? ''}: ${a.texto}`.replace('Falha : ', 'Falha: ');
    case 'frota_sem_modelo': return `Frota sem modelo cadastrado: ${a.texto}`;
    default: return null;
  }
}

export function montarMensagem(alertas, data = hojeSP()) {
  const conferir = new Set(alertas.filter(a => a.tipo === 'conferir').map(a => `${a.modelo_id}|${a.ordem}`));
  const linhas = alertas.filter(a => a.tipo !== 'conferir').map(a => {
    const l = linha(a);
    return a.tipo === 'mudanca' && conferir.has(`${a.modelo_id}|${a.ordem}`) ? `${l} conferir` : l;
  }).filter(Boolean);
  return linhas.length ? [`Preços de revisão ${diaMes(data)}`, ...linhas].join('\n') : null;
}

export function pendentes(db) {
  return db.prepare('SELECT a.*, m.nome FROM alertas a LEFT JOIN modelos m ON m.id = a.modelo_id WHERE a.enviado_em IS NULL ORDER BY a.id').all();
}

export async function enviarPendentes(db, { env = process.env, buscar = fetch, data = hojeSP() } = {}) {
  const lista = pendentes(db);
  const texto = montarMensagem(lista, data);
  if (!texto) return { enviados: 0, motivo: 'nada' };
  const { EVOLUTION_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCIA, ALERTA_WHATSAPP } = env;
  if (!EVOLUTION_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCIA || !ALERTA_WHATSAPP) return { enviados: 0, motivo: 'sem configuração' };
  try {
    const r = await buscar(`${EVOLUTION_URL.replace(/\/$/, '')}/message/sendText/${EVOLUTION_INSTANCIA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ number: ALERTA_WHATSAPP, text: texto }),
    });
    if (!r.ok) return { enviados: 0, motivo: `Evolution respondeu ${r.status}` };
  } catch (e) {
    return { enviados: 0, motivo: e.message };
  }
  const ids = lista.map(a => a.id);
  db.prepare(`UPDATE alertas SET enviado_em = datetime('now') WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  return { enviados: ids.length, motivo: null };
}
```

`src/coleta.js`:

```js
// Uma rodada: frota do Ativos, depois cada fonte com os seus modelos ativos,
// depois os alertas. Uma fonte que falha não impede as outras.
import { transacao } from './db.js';
import { gravarModelo } from './gravar.js';
import { aplicarFrota } from './frota.js';
import { hojeSP } from './datas.js';

let rodando = false;
export const emAndamento = () => rodando;

const novaColeta = (db, fonte, origem) =>
  Number(db.prepare("INSERT INTO coletas (fonte, inicio, origem) VALUES (?, datetime('now'), ?)").run(fonte, origem).lastInsertRowid);

function fecharColeta(db, id, c) {
  db.prepare("UPDATE coletas SET fim = datetime('now'), status = ?, modelos_ok = ?, itens = ?, mudancas = ?, erro = ? WHERE id = ?")
    .run(c.status, c.modelos_ok ?? 0, c.itens ?? 0, c.mudancas ?? 0, c.erro ?? null, id);
}

async function rodarFrota(db, buscarFrota, origem) {
  const id = novaColeta(db, 'ativos', origem);
  try {
    const contagem = await buscarFrota();
    const r = transacao(db, () => aplicarFrota(db, contagem, id));
    fecharColeta(db, id, { status: 'ok', modelos_ok: r.modelos, itens: Object.keys(contagem).length });
    return { status: 'ok', ...r };
  } catch (e) {
    db.prepare("INSERT INTO alertas (coleta_id, tipo, texto) VALUES (?, 'falha', ?)").run(id, `Ativos: ${e.message}`);
    fecharColeta(db, id, { status: 'falha', erro: e.message });
    return { status: 'falha', erro: e.message };
  }
}

async function rodarFonte(db, fonte, modelos, coletor, data, origem) {
  const id = novaColeta(db, fonte, origem);
  let ok = 0, itens = 0, mudancas = 0;
  const erros = [];
  for (const m of modelos) {
    try {
      if (!coletor) throw new Error(`coletor desconhecido: ${fonte}`);
      const lista = await coletor.coletar(JSON.parse(m.parametros));
      const r = transacao(db, () => gravarModelo(db, { modeloId: m.id, itens: lista, coletaId: id, data }));
      if (r.erro) { erros.push(`${m.nome}: ${r.erro}`); continue; }
      ok++; itens += r.itens; mudancas += r.mudancas;
    } catch (e) {
      erros.push(`${m.nome}: ${e.message}`);
      db.prepare("INSERT INTO alertas (coleta_id, tipo, modelo_id, texto) VALUES (?, 'falha', ?, ?)").run(id, m.id, e.message);
    }
  }
  const status = ok === modelos.length ? 'ok' : ok > 0 ? 'parcial' : 'falha';
  fecharColeta(db, id, { status, modelos_ok: ok, itens, mudancas, erro: erros.join(' | ') || null });
  return { status, modelos_ok: ok, itens, mudancas, erros };
}

export async function rodarColeta(db, { coletores, buscarFrota = null, enviar = null, data = hojeSP(), origem = 'agenda' }) {
  if (rodando) throw new Error('já existe uma coleta em andamento');
  rodando = true;
  try {
    const resumo = { data, frota: null, fontes: {}, alertas: null };
    if (buscarFrota) resumo.frota = await rodarFrota(db, buscarFrota, origem);
    const modelos = db.prepare('SELECT * FROM modelos WHERE ativo = 1 ORDER BY id').all();
    for (const [fonte, lista] of Map.groupBy(modelos, m => m.coletor)) {
      resumo.fontes[fonte] = await rodarFonte(db, fonte, lista, coletores[fonte], data, origem);
    }
    if (enviar) resumo.alertas = await enviar(db, { data });
    return resumo;
  } finally {
    rodando = false;
  }
}
```

`src/dependencias.js`:

```js
import { COLETORES } from './coletores/index.js';
import { buscarFrota } from './frota.js';
import { enviarPendentes } from './alertas.js';

export function dependencias(env) {
  return {
    coletores: COLETORES,
    buscarFrota: env.ATIVOS_URL && env.ATIVOS_TOKEN ? () => buscarFrota({ url: env.ATIVOS_URL, token: env.ATIVOS_TOKEN }) : null,
    enviar: (db, opcoes) => enviarPendentes(db, { env, ...opcoes }),
  };
}
```

`scripts/coletar.js`:

```js
// Rodada de coleta pela linha de comando. No Coolify: tarefa agendada "0 12 * * 1"
// com o comando "npm run coletar". --sem-alerta não manda WhatsApp.
import { abrir } from '../src/db.js';
import { migrar } from '../src/migracoes/index.js';
import { rodarColeta } from '../src/coleta.js';
import { dependencias } from '../src/dependencias.js';

const env = process.env;
const db = abrir(env.DB_PATH || 'revisoes.db');
migrar(db);
const deps = dependencias(env);
if (process.argv.includes('--sem-alerta')) deps.enviar = null;
const r = await rodarColeta(db, { ...deps, origem: process.argv.includes('--manual') ? 'manual' : 'agenda' });
console.log(JSON.stringify(r, null, 2));
process.exitCode = Object.values(r.fontes).every(f => f.status === 'falha') ? 1 : 0;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: todos PASS. Se o texto de `montarMensagem` divergir só em espaço ou sinal, ajustar o código (não o teste): o formato é o da spec, seção 5.

- [ ] **Step 5: Rodada real num banco de ensaio, sem WhatsApp**

Run: `DB_PATH=/tmp/ensaio.db npm run coletar -- --sem-alerta`
Expected: JSON com as 4 fontes `ok`; `frota: null` (sem `ATIVOS_URL`).

- [ ] **Step 6: Commit**

```bash
git add src/alertas.js src/coleta.js src/dependencias.js scripts/coletar.js test/coleta.test.js
git commit -m "Rodada de coleta com frota, coleta por fonte e alerta por WhatsApp

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Consultas para as telas

**Files:**
- Create: `src/consultas.js`, `test/consultas.test.js`

**Interfaces:**
- Consumes: `bancoNovo`, `rodarColeta`.
- Produces (todas síncronas):
  - `modelosResumo(db, { todos = false }): Resumo[]` com `Resumo = { id, slug, montadora, nome, versao, origem, qtd_frota, ativo, coletor, parametros, cor, total, revisoes, km_max, variacao: {de, para, pct, em} | null, serie: [{data, total}], conferir: boolean }`
  - `modeloDetalhe(db, slug): Resumo & { revisoes_lista: [{ ordem, km, meses, valor, desde, anterior, conferir, historico: [{de, ate, valor}] }] } | null`
  - `comparar(db): { kms: number[], referencias: [30000, 70000], modelos: [{ id, slug, nome, origem, cor, valores: (number|null)[], ate: (number|null)[], total, km_max }] }`
  - `mudancas(db, limite): [{ id, tipo, ordem, de, para, criado_em, slug, nome }]`
  - `estadoColetas(db): { fontes: Coleta[], recentes: Coleta[], pendentes: Alerta[] }`
  - `REFERENCIAS_KM = [30000, 70000]`

- [ ] **Step 1: Teste que falha**: `test/consultas.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo } from './ajuda.js';
import { rodarColeta } from '../src/coleta.js';
import { modelosResumo, modeloDetalhe, comparar, mudancas, estadoColetas } from '../src/consultas.js';

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
  assert.deepEqual(c.referencias, [30000, 70000]);
  assert.equal(c.kms[0], 0);
  const argo = c.modelos.find(m => m.slug === 'argo-drive');
  const i30 = c.kms.indexOf(30000);
  assert.equal(argo.valores[i30], 701 + 931 + 701);
  assert.equal(argo.valores[c.kms.indexOf(50000)], 4630);
  assert.deepEqual(argo.ate, [2333, null]);
  const vw = c.modelos.find(m => m.slug === 'polo-track');
  assert.equal(vw.valores[c.kms.indexOf(30000)], null);
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../src/consultas.js'`

- [ ] **Step 3: Implementar**: `src/consultas.js`:

```js
// Leituras para as telas. Tudo calculado a partir das faixas de vigência.

export const REFERENCIAS_KM = [30000, 70000];

const soma = l => Math.round(l.reduce((s, v) => s + v.valor, 0) * 100) / 100;
const vigentesEm = (vigs, d) => vigs.filter(v => v.vigente_de <= d && (!v.vigente_ate || v.vigente_ate >= d));
const datasDe = vigs => [...new Set(vigs.map(v => v.vigente_de))].sort();

export function seriePlano(vigs) {
  return datasDe(vigs).map(d => ({ data: d, total: soma(vigentesEm(vigs, d)) }));
}

// Variação do plano na última mudança, só com as revisões que existiam nas duas datas.
export function variacao(vigs) {
  const datas = datasDe(vigs);
  if (datas.length < 2) return null;
  const d1 = datas.at(-1), d0 = datas.at(-2);
  const antes = new Map(vigentesEm(vigs, d0).map(v => [v.ordem, v.valor]));
  let de = 0, para = 0;
  for (const v of vigentesEm(vigs, d1)) if (antes.has(v.ordem)) { de += antes.get(v.ordem); para += v.valor; }
  if (!de || de === para) return null;
  return { de, para, pct: (para - de) / de, em: d1 };
}

function cores(db) {
  return new Map(db.prepare('SELECT id FROM modelos ORDER BY id').all().map((m, i) => [m.id, i]));
}

function resumir(db, m, cor) {
  const vigs = db.prepare('SELECT * FROM vigencias WHERE modelo_id = ? ORDER BY ordem, vigente_de').all(m.id);
  const atuais = vigs.filter(v => !v.vigente_ate);
  return {
    id: m.id, slug: m.slug, montadora: m.montadora, nome: m.nome, versao: m.versao, origem: m.origem,
    qtd_frota: m.qtd_frota, ativo: m.ativo, coletor: m.coletor, parametros: JSON.parse(m.parametros),
    cor: cor.get(m.id), total: soma(atuais), revisoes: atuais.length,
    km_max: atuais.reduce((x, v) => Math.max(x, v.km), 0),
    variacao: variacao(vigs), serie: seriePlano(vigs), conferir: atuais.some(v => v.conferir === 1),
    _vigs: vigs,
  };
}

const limpar = ({ _vigs, ...r }) => r;

export function modelosResumo(db, { todos = false } = {}) {
  const cor = cores(db);
  const sql = `SELECT * FROM modelos ${todos ? '' : 'WHERE ativo = 1'} ORDER BY origem = 'frota' DESC, qtd_frota DESC, nome`;
  return db.prepare(sql).all().map(m => limpar(resumir(db, m, cor)));
}

export function modeloDetalhe(db, slug) {
  const m = db.prepare('SELECT * FROM modelos WHERE slug = ?').get(slug);
  if (!m) return null;
  const r = resumir(db, m, cores(db));
  const porOrdem = Map.groupBy(r._vigs, v => v.ordem);
  r.revisoes_lista = [...porOrdem.values()].map(faixas => {
    const atual = faixas.find(v => !v.vigente_ate) ?? faixas.at(-1);
    const idx = faixas.indexOf(atual);
    return {
      ordem: atual.ordem, km: atual.km, meses: atual.meses, valor: atual.valor, desde: atual.vigente_de,
      anterior: idx > 0 ? faixas[idx - 1].valor : null, conferir: atual.conferir === 1, atual: !atual.vigente_ate,
      historico: faixas.map(v => ({ de: v.vigente_de, ate: v.vigente_ate, valor: v.valor })),
    };
  }).sort((a, b) => a.ordem - b.ordem);
  return limpar(r);
}

export function comparar(db) {
  const cor = cores(db);
  const modelos = db.prepare("SELECT * FROM modelos WHERE ativo = 1 ORDER BY origem = 'frota' DESC, qtd_frota DESC, nome").all().map(m => resumir(db, m, cor));
  const atuaisDe = m => m._vigs.filter(v => !v.vigente_ate).sort((a, b) => a.km - b.km);
  const kms = [...new Set([0, ...REFERENCIAS_KM, ...modelos.flatMap(m => atuaisDe(m).map(v => v.km))])].sort((a, b) => a - b);
  const acumulado = (atuais, km) => soma(atuais.filter(v => v.km <= km));
  return {
    kms, referencias: REFERENCIAS_KM,
    modelos: modelos.map(m => {
      const atuais = atuaisDe(m);
      return {
        id: m.id, slug: m.slug, nome: m.nome, origem: m.origem, cor: m.cor, total: m.total, km_max: m.km_max,
        valores: kms.map(k => (k <= m.km_max ? acumulado(atuais, k) : null)),
        ate: REFERENCIAS_KM.map(k => (k <= m.km_max ? acumulado(atuais, k) : null)),
      };
    }),
  };
}

export function mudancas(db, limite = 30) {
  return db.prepare(`SELECT a.id, a.tipo, a.ordem, a.de, a.para, a.criado_em, m.slug, m.nome
    FROM alertas a JOIN modelos m ON m.id = a.modelo_id
    WHERE a.tipo IN ('mudanca', 'nova_revisao') ORDER BY a.criado_em DESC, a.id DESC LIMIT ?`).all(Math.min(Number(limite) || 30, 200));
}

export function estadoColetas(db) {
  return {
    fontes: db.prepare("SELECT * FROM coletas c WHERE c.fonte <> 'legado' AND c.id = (SELECT MAX(id) FROM coletas c2 WHERE c2.fonte = c.fonte) ORDER BY c.fonte").all(),
    recentes: db.prepare('SELECT * FROM coletas ORDER BY id DESC LIMIT 20').all(),
    pendentes: db.prepare('SELECT a.id, a.tipo, a.ordem, a.de, a.para, a.texto, a.criado_em, m.nome FROM alertas a LEFT JOIN modelos m ON m.id = a.modelo_id WHERE a.enviado_em IS NULL ORDER BY a.id DESC LIMIT 50').all(),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add src/consultas.js test/consultas.test.js
git commit -m "Consultas das telas: resumo, detalhe, comparacao por km, mudancas e coletas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Login, app e rotas (públicas, admin, compatibilidade)

**Files:**
- Create: `src/auth.js`, `src/app.js`, `src/rotas/publicas.js`, `src/rotas/admin.js`, `src/rotas/compat.js`, `scripts/gerar-hash.js`, `test/rotas.test.js`, `test/compat.test.js`
- Modify: `server.js` (substituir inteiro)
- Delete: `db.js`, `seed.js`

**Interfaces:**
- Consumes: tudo das Tasks 1 a 8.
- Produces: `criarApp({ db, estado, env, deps }): express.Application` · `gerarHash(senha)`, `senhaConfere(senha, hash)`, `criarSessao(segredo, agora?)`, `sessaoValida(valor, segredo, agora?)`, `logado(req, env)`, `exigirLogin(env)` · `veiculosCompat(db)`, `precosCompat(db, veiculoId?)`.
- Rotas: as da spec, seção 6, com `POST /api/entrar`, `POST /api/sair`, `GET /api/sessao`, `GET /api/coletas/estado`, `POST /api/testar`.

- [ ] **Step 1: Teste que falha**: `test/rotas.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, servidor } from './ajuda.js';
import { criarApp } from '../src/app.js';
import { gerarHash, criarSessao, sessaoValida } from '../src/auth.js';

const ENV = { ADMIN_SENHA_HASH: gerarHash('certa'), SESSION_SECRET: 'segredo-de-teste' };
const deps = { coletores: { byd: { coletar: async () => [{ ordem: 1, km: 12000, meses: 12, valor: 926 }], catalogo: async () => [{ rotulo: 'BYD King', parametros: { nome: 'BYD King' } }] } }, buscarFrota: null, enviar: null };

async function subir(estado = {}) {
  const db = bancoNovo();
  const s = await servidor(criarApp({ db, estado, env: ENV, deps }));
  return { db, ...s };
}
async function entrar(url) {
  const r = await fetch(`${url}/api/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: 'certa' }) });
  return r.headers.get('set-cookie').split(';')[0];
}

test('sessão assinada expira e não aceita adulteração', () => {
  const v = criarSessao('s', 1000);
  assert.ok(sessaoValida(v, 's', 2000));
  assert.ok(!sessaoValida(v, 'outro', 2000));
  assert.ok(!sessaoValida(v.replace(/^\d+/, '999999999999999'), 's', 2000));
  assert.ok(!sessaoValida(v, 's', 1000 + 8 * 864e5));
});

test('leitura pública funciona sem login', async () => {
  const { url, fechar } = await subir();
  const r = await fetch(`${url}/api/modelos`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).length, 6);
  assert.equal((await fetch(`${url}/api/modelos/byd-king`)).status, 200);
  assert.equal((await fetch(`${url}/api/modelos/nada`)).status, 404);
  await fechar();
});

test('escrita sem login dá 401; rotas antigas de escrita sumiram', async () => {
  const { url, fechar } = await subir();
  for (const [m, c] of [['POST', '/api/modelos'], ['PATCH', '/api/modelos/1'], ['POST', '/api/coletas'], ['POST', '/api/testar'], ['GET', '/api/catalogo/byd']]) {
    assert.equal((await fetch(url + c, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : '{}' })).status, 401, `${m} ${c}`);
  }
  for (const [m, c] of [['POST', '/api/veiculos'], ['DELETE', '/api/veiculos/1'], ['POST', '/api/precos'], ['DELETE', '/api/precos/1'], ['POST', '/api/ingest']]) {
    assert.equal((await fetch(url + c, { method: m })).status, 404, `${m} ${c}`);
  }
  await fechar();
});

test('senha errada não entra; certa entra e cadastra candidato', async () => {
  const { url, db, fechar } = await subir();
  const errada = await fetch(`${url}/api/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: 'x' }) });
  assert.equal(errada.status, 401);
  const cookie = await entrar(url);
  const r = await fetch(`${url}/api/modelos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ montadora: 'BYD', nome: 'Seal', coletor: 'byd', parametros: { nome: 'BYD Seal' } }) });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).slug, 'byd-seal');
  assert.equal(db.prepare("SELECT origem FROM modelos WHERE slug = 'byd-seal'").get().origem, 'candidato');
  const t = await fetch(`${url}/api/testar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ coletor: 'byd', parametros: { nome: 'BYD King' } }) });
  assert.equal((await t.json()).itens.length, 1);
  await fechar();
});

test('falha de migração deixa só /api/saude respondendo', async () => {
  const { url, fechar } = await subir({ erroMigracao: 'conferência falhou' });
  assert.equal((await fetch(`${url}/api/modelos`)).status, 503);
  const s = await fetch(`${url}/api/saude`);
  assert.equal(s.status, 503);
  assert.equal((await s.json()).erro, 'conferência falhou');
  await fechar();
});

test('telas abrem a casca do front', async () => {
  const { url, fechar } = await subir();
  for (const c of ['/', '/comparar', '/coletores', '/entrar', '/modelo/byd-king']) {
    const r = await fetch(url + c);
    assert.equal(r.status, 200, c);
    assert.match(await r.text(), /<main id="tela"/);
  }
  await fechar();
});
```

`test/compat.test.js` (a função `doKpis` é cópia do laço de `ocn-kpis-site/lib/revisoes.js`, para garantir que o KPIs lê igual):

```js
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

test('filtro por veiculo_id e formato do texto da revisão', () => {
  const db = legado();
  migrar(db);
  const p = precosCompat(db, 1);
  assert.ok(p.every(x => x.veiculo_id === 1));
  assert.match(p[0].revisao, /^\d+ª revisão \([\d.]+ km\)$/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../src/app.js'`

- [ ] **Step 3: Implementar**: `src/auth.js`:

```js
// Login de um usuário só (o Enrico): senha em ADMIN_SENHA_HASH (scrypt) e
// sessão num cookie assinado com SESSION_SECRET, válida por 7 dias.
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

export const COOKIE = 'precos_sessao';
const DURACAO = 7 * 864e5;
const iguais = (a, b) => a.length === b.length && timingSafeEqual(a, b);

export function gerarHash(senha) {
  const sal = randomBytes(16).toString('hex');
  return `scrypt:${sal}:${scryptSync(String(senha), sal, 32).toString('hex')}`;
}

export function senhaConfere(senha, hash) {
  const [tipo, sal, h] = String(hash || '').split(':');
  if (tipo !== 'scrypt' || !sal || !h) return false;
  return iguais(scryptSync(String(senha ?? ''), sal, 32), Buffer.from(h, 'hex'));
}

const assinar = (corpo, segredo) => createHmac('sha256', segredo).update(corpo).digest('hex');

export function criarSessao(segredo, agora = Date.now()) {
  const corpo = String(agora + DURACAO);
  return `${corpo}.${assinar(corpo, segredo)}`;
}

export function sessaoValida(valor, segredo, agora = Date.now()) {
  if (!valor || !segredo) return false;
  const [corpo, ass] = String(valor).split('.');
  if (!corpo || !ass || !iguais(Buffer.from(ass), Buffer.from(assinar(corpo, segredo)))) return false;
  return Number(corpo) > agora;
}

export function lerCookie(req, nome) {
  for (const parte of String(req.get('cookie') || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

export const logado = (req, env) => sessaoValida(lerCookie(req, COOKIE), env.SESSION_SECRET);

export const exigirLogin = env => (req, res, next) => (logado(req, env) ? next() : res.status(401).json({ erro: 'login necessário' }));
```

`scripts/gerar-hash.js`:

```js
// Uso: npm run hash -- "senha"  →  valor para ADMIN_SENHA_HASH no Coolify.
import { gerarHash } from '../src/auth.js';

const senha = process.argv[2];
if (!senha) { console.error('uso: npm run hash -- "senha"'); process.exit(1); }
console.log(gerarHash(senha));
```

`src/rotas/compat.js`:

```js
// Rotas antigas, só leitura, no formato que o KPIs (ocn-kpis-site/lib/revisoes.js) lê.
// A projeção em ciclo da Fiat (6ª a 10ª) existe só aqui, para o UE não mudar.
import { Router } from 'express';

const idCompat = m => m.legado_veiculo_id ?? 1000 + m.id;

export function veiculosCompat(db) {
  return db.prepare('SELECT * FROM modelos WHERE ativo = 1 ORDER BY montadora, nome').all().map(m => ({
    id: idCompat(m), montadora: m.montadora, modelo: m.nome, versao: m.versao, ano: null, apelido: m.nome, criado_em: m.criado_em,
  }));
}

const texto = (ordem, km) => `${ordem}ª revisão (${km.toLocaleString('pt-BR')} km)`;

export function precosCompat(db, veiculoId = null) {
  const linhas = [];
  for (const m of db.prepare('SELECT * FROM modelos WHERE ativo = 1').all()) {
    const vid = idCompat(m);
    if (veiculoId != null && vid !== Number(veiculoId)) continue;
    const vigs = db.prepare('SELECT * FROM vigencias WHERE modelo_id = ? ORDER BY ordem, vigente_de').all(m.id);
    for (const v of vigs) linhas.push({ id: v.id, veiculo_id: vid, revisao: texto(v.ordem, v.km), data_coleta: v.vigente_de, valor: v.valor, fonte: 'scraper', obs: null });
    if (m.projetar_ciclo) {
      const atuais = vigs.filter(v => !v.vigente_ate).sort((a, b) => a.ordem - b.ordem);
      const n = atuais.length;
      const ultima = atuais.reduce((d, v) => (v.vigente_de > d ? v.vigente_de : d), '');
      for (let o = n + 1; n > 0 && o <= 10; o++) {
        const base = atuais[(o - 1) % n];
        linhas.push({ id: -(m.id * 100 + o), veiculo_id: vid, revisao: texto(o, o * atuais[0].km), data_coleta: ultima, valor: base.valor, fonte: 'projecao', obs: null });
      }
    }
  }
  return linhas.sort((a, b) => b.data_coleta.localeCompare(a.data_coleta) || b.id - a.id);
}

export function rotasCompat(db) {
  const r = Router();
  r.get('/api/veiculos', (req, res) => res.json(veiculosCompat(db)));
  r.get('/api/precos', (req, res) => res.json(precosCompat(db, req.query.veiculo_id ?? null)));
  return r;
}
```

`src/rotas/publicas.js`:

```js
import { Router } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { modelosResumo, modeloDetalhe, comparar, mudancas, estadoColetas } from '../consultas.js';
import { logado } from '../auth.js';

export function rotasPublicas(db, { publicDir, env }) {
  const r = Router();
  const imagemDe = slug => {
    for (const ext of ['webp', 'png', 'jpg']) if (existsSync(join(publicDir, 'img', `${slug}.${ext}`))) return `/img/${slug}.${ext}`;
    return null;
  };
  const comImagem = m => ({ ...m, imagem: imagemDe(m.slug) });

  r.get('/api/modelos', (req, res) => {
    const todos = req.query.todos === '1' && logado(req, env);
    res.json(modelosResumo(db, { todos }).map(comImagem));
  });
  r.get('/api/modelos/:slug', (req, res) => {
    const m = modeloDetalhe(db, req.params.slug);
    return m ? res.json(comImagem(m)) : res.status(404).json({ erro: 'modelo não encontrado' });
  });
  r.get('/api/comparar', (req, res) => res.json(comparar(db)));
  r.get('/api/mudancas', (req, res) => res.json(mudancas(db, req.query.limite)));
  r.get('/api/coletas/estado', (req, res) => res.json(estadoColetas(db)));
  return r;
}
```

`src/rotas/admin.js`:

```js
import { Router } from 'express';
import { COOKIE, criarSessao, exigirLogin, logado, senhaConfere } from '../auth.js';
import { rodarColeta, emAndamento } from '../coleta.js';
import { enviarPendentes } from '../alertas.js';

const slugDe = (montadora, nome) => `${montadora} ${nome}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const espera = ms => new Promise(r => setTimeout(r, ms));

export function rotasAdmin(db, env, deps) {
  const r = Router();
  const login = exigirLogin(env);
  const conhecido = c => Object.hasOwn(deps.coletores, c);

  r.post('/api/entrar', async (req, res) => {
    if (!env.ADMIN_SENHA_HASH || !env.SESSION_SECRET) return res.status(503).json({ erro: 'login não configurado' });
    if (!senhaConfere(req.body?.senha, env.ADMIN_SENHA_HASH)) { await espera(500); return res.status(401).json({ erro: 'senha incorreta' }); }
    const seguro = env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${criarSessao(env.SESSION_SECRET)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}${seguro}`);
    res.json({ ok: true });
  });
  r.post('/api/sair', (req, res) => { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); res.json({ ok: true }); });
  r.get('/api/sessao', (req, res) => res.json({ logado: logado(req, env) }));

  r.post('/api/modelos', login, (req, res) => {
    const { montadora, nome, versao = null, ano_modelo = null, coletor, parametros } = req.body ?? {};
    if (!montadora || !nome || !conhecido(coletor) || !parametros || typeof parametros !== 'object') return res.status(400).json({ erro: 'montadora, nome, coletor e parametros são obrigatórios' });
    // BYD leva o prefixo (byd-king, byd-seal), as outras só o nome (onix-sedan-plus), como na migração.
    const slug = slugDe(montadora === 'BYD' ? 'BYD' : '', nome);
    if (db.prepare('SELECT 1 FROM modelos WHERE slug = ?').get(slug)) return res.status(409).json({ erro: 'já existe' });
    const r2 = db.prepare("INSERT INTO modelos (slug, montadora, nome, versao, ano_modelo, origem, coletor, parametros) VALUES (?, ?, ?, ?, ?, 'candidato', ?, ?)")
      .run(slug, montadora, nome, versao, ano_modelo, coletor, JSON.stringify(parametros));
    res.status(201).json({ id: Number(r2.lastInsertRowid), slug });
  });

  r.patch('/api/modelos/:id', login, (req, res) => {
    const m = db.prepare('SELECT * FROM modelos WHERE id = ?').get(req.params.id);
    if (!m) return res.status(404).json({ erro: 'modelo não encontrado' });
    const b = req.body ?? {};
    const novo = {
      nome: b.nome ?? m.nome, versao: b.versao ?? m.versao, ativo: b.ativo == null ? m.ativo : (b.ativo ? 1 : 0),
      parametros: b.parametros ? JSON.stringify(b.parametros) : m.parametros, chave_ativos: b.chave_ativos === undefined ? m.chave_ativos : (b.chave_ativos || null),
    };
    db.prepare('UPDATE modelos SET nome = ?, versao = ?, ativo = ?, parametros = ?, chave_ativos = ? WHERE id = ?').run(novo.nome, novo.versao, novo.ativo, novo.parametros, novo.chave_ativos, m.id);
    res.json({ ok: true });
  });

  r.post('/api/testar', login, async (req, res) => {
    const { coletor, parametros } = req.body ?? {};
    if (!conhecido(coletor)) return res.status(400).json({ erro: 'coletor desconhecido' });
    try { res.json({ itens: await deps.coletores[coletor].coletar(parametros ?? {}) }); }
    catch (e) { res.status(422).json({ erro: e.message }); }
  });

  r.get('/api/catalogo/:coletor', login, async (req, res) => {
    const c = deps.coletores[req.params.coletor];
    if (!c?.catalogo) return res.status(404).json({ erro: 'sem catálogo para esta fonte' });
    try { res.json(await c.catalogo()); } catch (e) { res.status(502).json({ erro: e.message }); }
  });

  r.post('/api/coletas', login, async (req, res) => {
    if (emAndamento()) return res.status(409).json({ erro: 'coleta em andamento' });
    try { res.json(await rodarColeta(db, { ...deps, origem: 'manual' })); }
    catch (e) { res.status(500).json({ erro: e.message }); }
  });

  r.post('/api/alertas/reenviar', login, async (req, res) => res.json(await enviarPendentes(db, { env })));
  return r;
}
```

`src/app.js`:

```js
import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versaoAtual } from './migracoes/index.js';
import { emAndamento } from './coleta.js';
import { rotasPublicas } from './rotas/publicas.js';
import { rotasAdmin } from './rotas/admin.js';
import { rotasCompat } from './rotas/compat.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TELAS = ['/', '/comparar', '/coletores', '/entrar', '/modelo/:slug'];

export function criarApp({ db, estado = {}, env = process.env, deps }) {
  const app = express();
  app.disable('x-powered-by');
  // O site mudou para precos.ocnbrasil.com.br; o endereço antigo do Railway só manda para lá.
  app.use((req, res, next) => (req.hostname === 'frota-revisoes-production.up.railway.app'
    ? res.redirect(307, 'https://precos.ocnbrasil.com.br' + req.originalUrl) : next()));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/saude', (req, res) => {
    if (estado.erroMigracao) return res.status(503).json({ ok: false, erro: estado.erroMigracao });
    const ultima = db.prepare("SELECT fonte, fim, status FROM coletas WHERE fonte <> 'legado' ORDER BY id DESC LIMIT 1").get() ?? null;
    res.json({ ok: true, schema: versaoAtual(db), ultima_coleta: ultima, coleta_em_andamento: emAndamento() });
  });
  app.use('/api', (req, res, next) => (estado.erroMigracao ? res.status(503).json({ erro: 'banco indisponível' }) : next()));

  app.use(rotasCompat(db));
  app.use(rotasPublicas(db, { publicDir: PUBLIC, env }));
  app.use(rotasAdmin(db, env, deps));
  app.use('/api', (req, res) => res.status(404).json({ erro: 'rota não encontrada' }));

  app.use(express.static(PUBLIC, { index: false }));
  app.get(TELAS, (req, res) => res.sendFile(join(PUBLIC, 'index.html')));
  return app;
}
```

`server.js` (substitui o arquivo inteiro):

```js
// Preços OCN: sobe o banco, migra e serve a API e as telas.
import { abrir } from './src/db.js';
import { migrar } from './src/migracoes/index.js';
import { criarApp } from './src/app.js';
import { dependencias } from './src/dependencias.js';

const env = process.env;
const db = abrir(env.DB_PATH || 'revisoes.db');
const estado = { erroMigracao: null };
try {
  console.log('schema', migrar(db));
} catch (e) {
  estado.erroMigracao = e.message;
  console.error('MIGRAÇÃO FALHOU, rotas de dados em 503:', e.message);
}

const PORT = env.PORT || 3000;
criarApp({ db, estado, env, deps: dependencias(env) }).listen(PORT, () => console.log(`Preços OCN em http://localhost:${PORT}`));
```

Apagar `db.js` e `seed.js` da raiz: `git rm -q db.js seed.js`. Criar uma casca mínima em `public/index.html` só para o teste de telas passar (a Task 10 a substitui):

```html
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Preços OCN</title></head><body><main id="tela"></main></body></html>
```

O `index.html` antigo é substituído aqui; ele continua no histórico do git.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src scripts server.js public/index.html test package.json
git commit -m "API v2: leitura publica, escrita com login, rotas antigas do KPIs so leitura

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Casca do front, estilos, Chart.js guardado e tela Início

**Files:**
- Create: `public/index.html` (substitui a casca da Task 9), `public/css/base.css`, `public/css/telas.css`, `public/js/app.js`, `public/js/api.js`, `public/js/formato.js`, `public/js/graficos.js`, `public/js/inicio.js`, `public/vendor/chart.umd.js`, `public/img/placeholder.svg`
- Rename: `public/img/polo.png → polo-track.png`, `argo.webp → argo-drive.webp`, `onix.png → onix-sedan-plus.png`, `dolphin.png → byd-dolphin.png`, `king.png → byd-king.png` (`tera.png` fica)

**Interfaces:**
- Consumes: `GET /api/modelos`, `/api/mudancas`, `/api/sessao`.
- Produces: `ir(caminho)`, `atualizarSessao()` (app.js) · `get`, `post`, `patch` (api.js) · `brl`, `num`, `kmMil`, `pct`, `mesAno`, `dia`, `esc`, `seta` (formato.js) · `CATEG`, `ROXO`, `corDe(i)`, `linhaPlano(canvas, serie, {mini})`, `graficoComparar(canvas, kms, modelos, refs)` (graficos.js) · `listaMudancas(lista)` (inicio.js). Cada tela é `async (tela: HTMLElement, ...params) => (() => void) | void` (devolve a limpeza).

- [ ] **Step 1: Chart.js com versão exata, guardado no repo**

```bash
mkdir -p public/vendor && curl -sL https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.js -o public/vendor/chart.umd.js && head -c 120 public/vendor/chart.umd.js
```
Expected: começa com `/*!\n * Chart.js v4.4.7`.

- [ ] **Step 2: Imagens com o nome do slug**

```bash
cd public/img && git mv polo.png polo-track.png && git mv argo.webp argo-drive.webp && git mv onix.png onix-sedan-plus.png && git mv dolphin.png byd-dolphin.png && git mv king.png byd-king.png && cd ../..
```

`public/img/placeholder.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 80"><rect width="160" height="80" rx="12" fill="#F1ECFE"/><path d="M30 52h100l-8-14c-2-4-6-6-10-6H58c-5 0-9 2-12 6l-8 14z" fill="#D9CCFD"/><circle cx="52" cy="54" r="7" fill="#5800F7"/><circle cx="108" cy="54" r="7" fill="#5800F7"/></svg>
```

- [ ] **Step 3: Validar a paleta (skill `dataviz`)**

Run: `node "C:/Users/ENRIC_~1/AppData/Local/Temp/claude/bundled-skills/2.1.309/4eddf24cd7ba0c7544e7a9b13be53eb9/dataviz/scripts/validate_palette.js" "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#6250d6,#e34948" --mode light`
(se o caminho da skill mudou, carregar a skill `dataviz` e usar o `scripts/validate_palette.js` dela)
Expected: sem FAIL; WARN de contraste em magenta/amarelo/água obriga rótulo visível ou tabela, e as duas telas com várias séries (Comparar) têm os dois.
Run também: `... "#5800F7" --mode light` → contraste do roxo no fundo branco passa.

- [ ] **Step 4: Casca**: `public/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Preços OCN</title>
  <link rel="icon" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/base.css">
  <link rel="stylesheet" href="/css/telas.css">
  <script src="/vendor/chart.umd.js"></script>
  <script type="module" src="/js/app.js"></script>
</head>
<body>
  <header class="topo">
    <a class="marca" href="/" data-link><span class="selo">OCN</span>Preços</a>
    <nav class="abas" aria-label="Revisões">
      <span class="modulo">Revisões</span>
      <a href="/" data-link>Início</a>
      <a href="/comparar" data-link>Comparar</a>
      <a href="/coletores" data-link>Coletores</a>
    </nav>
    <div class="sessao" id="sessao"></div>
  </header>
  <main id="tela" tabindex="-1"></main>
</body>
</html>
```

- [ ] **Step 5: Estilos**: `public/css/base.css`:

```css
:root {
  --roxo: #5800F7; --roxo-claro: #F1ECFE; --escuro: #0A0118; --escuro-2: #15003A;
  --fundo: #F7F6FB; --cartao: #FFFFFF; --linha: #E7E4F0;
  --tinta: #0A0118; --tinta-2: #52514e; --tinta-3: #8A8794;
  --sobe: #B42318; --desce: #067647; --aviso: #B54708;
  --raio: 14px; --topo: 52px;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: var(--tinta); background: var(--fundo);
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { display: flex; flex-direction: column; min-height: 100vh; }
a { color: inherit; text-decoration: none; }
button, input, select { font: inherit; }
h1, h2 { margin: 0; letter-spacing: -0.01em; }
h1 { font-size: 1.25rem; font-weight: 800; }
h2 { font-size: .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--tinta-2); }
.num { text-align: right; font-variant-numeric: tabular-nums; }

.topo { height: var(--topo); flex: none; display: flex; align-items: center; gap: 28px; padding: 0 24px; background: var(--escuro); color: #fff; }
.marca { display: flex; align-items: center; gap: 8px; font-weight: 800; }
.selo { background: var(--roxo); border-radius: 999px; padding: 3px 9px; font-size: .75rem; letter-spacing: .04em; }
.abas { display: flex; align-items: center; gap: 4px; }
.modulo { font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; color: #B9A6FF; margin-right: 10px; }
.abas a { padding: 7px 12px; border-radius: 999px; font-weight: 600; font-size: .9rem; color: #D8D2EA; }
.abas a:hover { color: #fff; background: rgba(255, 255, 255, .08); }
.abas a[aria-current="page"] { color: #fff; background: var(--escuro-2); box-shadow: inset 0 0 0 1px rgba(185, 166, 255, .35); }
.sessao { margin-left: auto; font-size: .85rem; }
.sessao button, .sessao a { background: none; border: 0; color: #D8D2EA; cursor: pointer; }

main { flex: 1; min-height: 0; padding: 16px 24px; outline: none; }
.btn { height: 36px; padding: 0 16px; border-radius: 999px; border: 0; background: var(--roxo); color: #fff; font-weight: 700; cursor: pointer; }
.btn.sec { background: var(--roxo-claro); color: var(--roxo); }
.btn:disabled { opacity: .5; cursor: default; }
.vazio, .erro { color: var(--tinta-3); font-size: .9rem; }
.erro { color: var(--sobe); }
.var { font-size: .8rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.var.sobe { color: var(--sobe); } .var.desce { color: var(--desce); } .var.igual { color: var(--tinta-2); }
.var-quando { font-weight: 500; color: var(--tinta-3); }
.conferir { font-size: .7rem; font-weight: 700; color: var(--aviso); background: #FEF0C7; border-radius: 999px; padding: 2px 8px; }
.tabela { width: 100%; border-collapse: collapse; font-size: .85rem; }
.tabela th { text-align: left; font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--tinta-3); font-weight: 700; padding: 6px 10px; border-bottom: 1px solid var(--linha); position: sticky; top: 0; background: var(--cartao); }
.tabela td { padding: 6px 10px; border-bottom: 1px solid var(--linha); }
.tabela th.num, .tabela td.num { text-align: right; }
.tabela-rolagem { overflow: auto; background: var(--cartao); border-radius: var(--raio); }
.ponto { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; vertical-align: -1px; }
```

`public/css/telas.css`:

```css
/* Início: 1280×585 = topo 52 + 16 + conteúdo ≤ 501 + 16 */
.inicio { display: grid; grid-template-columns: 1fr 300px; gap: 16px; height: 100%; }
.inicio-cartoes { overflow: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 4px; }
.grupo h2 { margin-bottom: 8px; }
.cartoes { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: 12px; }
.cartao { position: relative; display: grid; grid-template-rows: 64px auto auto auto auto 34px; gap: 2px; padding: 12px 14px 10px; background: var(--cartao); border-radius: var(--raio); box-shadow: 0 0 0 1px var(--linha); transition: box-shadow .15s ease, transform .15s ease; }
.cartao:hover { box-shadow: 0 0 0 2px var(--roxo); }
.cartao img { height: 64px; width: 100%; object-fit: contain; }
.cartao-topo { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.cartao-topo strong { font-size: .95rem; }
.qtd { font-size: .72rem; font-weight: 700; color: var(--roxo); background: var(--roxo-claro); border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
.cartao-total { font-size: 1.35rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.cartao-meta { font-size: .78rem; color: var(--tinta-2); }
.cartao .conferir { position: absolute; top: 10px; right: 10px; }
.spark { position: relative; height: 34px; }
.mudancas { background: var(--cartao); border-radius: var(--raio); box-shadow: 0 0 0 1px var(--linha); padding: 12px 0 0; display: flex; flex-direction: column; min-height: 0; }
.mudancas h2 { padding: 0 14px 8px; }
.lista-mud { list-style: none; margin: 0; padding: 0; overflow: auto; }
.lista-mud a { display: grid; grid-template-columns: 46px 1fr; grid-template-areas: "q n" "q v"; padding: 7px 14px; border-top: 1px solid var(--linha); font-size: .82rem; }
.lista-mud a:hover { background: var(--fundo); }
.mud-quando { grid-area: q; color: var(--tinta-3); font-size: .75rem; padding-top: 1px; }
.mud-nome { grid-area: n; font-weight: 700; }
.mud-valor { grid-area: v; color: var(--tinta-2); font-variant-numeric: tabular-nums; }

/* Detalhe */
.detalhe { display: grid; grid-template-rows: auto 1fr; gap: 12px; height: 100%; }
.detalhe-topo { display: flex; align-items: center; gap: 16px; }
.detalhe-topo img { height: 56px; width: 112px; object-fit: contain; }
.meta { margin: 2px 0 0; color: var(--tinta-2); font-size: .85rem; }
.detalhe-total { margin-left: auto; text-align: right; display: grid; gap: 2px; }
.detalhe-total > span:first-child { font-size: 1.6rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.detalhe-corpo { display: grid; grid-template-columns: 560px 1fr; gap: 16px; min-height: 0; }
.tabela td.mini { width: 110px; padding: 2px 10px; }
.tabela td.mini div { position: relative; height: 26px; }
.a-conferir td { background: #FFFAEB; }
.grafico-plano, .grafico-comparar { margin: 0; background: var(--cartao); border-radius: var(--raio); box-shadow: 0 0 0 1px var(--linha); padding: 12px 14px; display: flex; flex-direction: column; min-height: 0; }
.grafico-plano figcaption { font-size: .8rem; font-weight: 700; color: var(--tinta-2); margin-bottom: 6px; }
.area { position: relative; flex: 1; min-height: 0; }

/* Comparar */
.comparar { display: grid; grid-template-rows: auto 1fr; gap: 12px; height: 100%; }
.filtros { display: flex; gap: 6px; }
.filtros button { height: 32px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--linha); background: var(--cartao); color: var(--tinta-2); font-weight: 600; cursor: pointer; }
.filtros button[aria-pressed="true"] { background: var(--escuro); border-color: var(--escuro); color: #fff; }
.comparar-corpo { display: grid; grid-template-columns: 1fr 420px; gap: 16px; min-height: 0; }
.legenda { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: .8rem; color: var(--tinta-2); margin-bottom: 6px; }
.legenda i { display: inline-block; width: 12px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }

/* Coletores */
.coletores { display: grid; grid-template-columns: 1fr 380px; gap: 16px; height: 100%; }
.coletores > section { background: var(--cartao); border-radius: var(--raio); box-shadow: 0 0 0 1px var(--linha); padding: 12px 14px; overflow: auto; min-height: 0; }
.status { font-weight: 700; white-space: nowrap; }
.status.ok { color: var(--desce); } .status.parcial { color: var(--aviso); } .status.falha { color: var(--sobe); }
.erro-curto { color: var(--tinta-3); font-size: .78rem; max-width: 360px; }
.acoes { display: flex; gap: 8px; align-items: center; margin: 10px 0; }
.form { display: grid; gap: 8px; margin-top: 8px; }
.form label { display: grid; gap: 3px; font-size: .78rem; font-weight: 600; color: var(--tinta-2); }
.form input, .form select { height: 34px; border: 1px solid var(--linha); border-radius: 10px; padding: 0 10px; background: #fff; }
.teste { font-size: .8rem; color: var(--tinta-2); font-variant-numeric: tabular-nums; }
.entrar { max-width: 320px; margin: 60px auto; display: grid; gap: 10px; }
.entrar input { height: 40px; border: 1px solid var(--linha); border-radius: 12px; padding: 0 12px; }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
```

- [ ] **Step 6: Módulos base**: `public/js/api.js`:

```js
async function pedir(metodo, caminho, corpo) {
  const r = await fetch(caminho, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
    credentials: 'same-origin',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.erro || `Erro ${r.status}`), { status: r.status });
  return j;
}
export const get = c => pedir('GET', c);
export const post = (c, b = {}) => pedir('POST', c, b);
export const patch = (c, b) => pedir('PATCH', c, b);
```

`public/js/formato.js`:

```js
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const brl = v => (v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }));
export const num = v => Number(v).toLocaleString('pt-BR');
export const kmMil = km => `${num(km / 1000)} mil km`;
export const pct = p => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const mesAno = iso => `${MESES[+iso.slice(5, 7) - 1]}/${iso.slice(2, 4)}`;
export const dia = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function seta(v) {
  if (!v) return '';
  const [cls, s] = v.pct > 0 ? ['sobe', '▲'] : v.pct < 0 ? ['desce', '▼'] : ['igual', '='];
  return `<span class="var ${cls}"><span aria-hidden="true">${s}</span> ${pct(v.pct)} <span class="var-quando">${mesAno(v.em)}</span></span>`;
}
```

`public/js/graficos.js`:

```js
// Gráficos (skill dataviz): paleta categórica em ordem fixa presa ao modelo,
// série única no roxo OCN, linhas de 2px em degraus, dica sempre ligada.
import { brl, num, mesAno, dia } from './formato.js';

export const CATEG = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const ROXO = '#5800F7';
export const corDe = i => CATEG[i % CATEG.length];
const TINTA = { forte: '#0A0118', media: '#52514e', grade: 'rgba(10,1,24,.08)' };
const FONTE = '600 11px "Plus Jakarta Sans", system-ui';
const semMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ts = iso => Date.parse(`${iso}T12:00:00Z`);
const isoDe = ms => new Date(ms).toISOString().slice(0, 10);
const hoje = () => new Date().toISOString().slice(0, 10);
const DICA = { backgroundColor: TINTA.forte, padding: 10, boxPadding: 4, titleFont: { family: 'Plus Jakarta Sans', weight: '700' }, bodyFont: { family: 'Plus Jakarta Sans' } };

Chart.defaults.font.family = 'Plus Jakarta Sans, system-ui';
Chart.defaults.color = TINTA.media;

export function pontosDegrau(serie) {
  const p = serie.map(s => ({ x: ts(s.data), y: s.total }));
  if (p.length) p.push({ x: ts(hoje()), y: p.at(-1).y });
  return p;
}

export function linhaPlano(canvas, serie, { mini = false } = {}) {
  const dados = pontosDegrau(serie);
  const ultimo = dados.length - 1;
  const opcoes = {
    responsive: true, maintainAspectRatio: false, animation: semMovimento() ? false : { duration: 350 },
    layout: { padding: mini ? 2 : 4 },
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { type: 'linear', display: !mini, ticks: { callback: v => mesAno(isoDe(v)), maxTicksLimit: 6 }, grid: { display: false } },
      y: { display: !mini, grace: '10%', ticks: { callback: v => brl(v), maxTicksLimit: 5 }, grid: { color: TINTA.grade }, border: { display: false } },
    },
    plugins: {
      legend: { display: false },
      tooltip: mini ? { enabled: false } : { ...DICA, displayColors: false, callbacks: { title: it => dia(isoDe(it[0].parsed.x)), label: it => brl(it.parsed.y) } },
    },
  };
  if (mini) opcoes.events = [];
  return new Chart(canvas, {
    type: 'line',
    data: { datasets: [{ data: dados, stepped: 'after', borderColor: ROXO, backgroundColor: ROXO, borderWidth: 2,
      pointRadius: c => (mini || c.dataIndex === ultimo ? 0 : 3), pointHoverRadius: mini ? 0 : 5,
      pointBorderColor: '#fff', pointBorderWidth: 2 }] },
    options: opcoes,
  });
}

const referencias = refs => ({
  id: 'referencias',
  afterDatasetsDraw(c) {
    const { ctx, chartArea: a, scales: { x } } = c;
    ctx.save();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = TINTA.media; ctx.fillStyle = TINTA.media; ctx.font = FONTE;
    for (const r of refs) {
      const px = x.getPixelForValue(r);
      if (px < a.left || px > a.right) continue;
      ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
      ctx.fillText(`${num(r / 1000)} mil km`, px + 4, a.top + 10);
    }
    ctx.restore();
  },
});

// Nome no fim de cada linha, em tinta de texto (não na cor da série), sem sobrepor.
const rotuloFinal = {
  id: 'rotuloFinal',
  afterDatasetsDraw(c) {
    const { ctx } = c;
    ctx.save(); ctx.font = FONTE; ctx.fillStyle = TINTA.forte; ctx.textBaseline = 'middle';
    const usados = [];
    c.data.datasets.forEach((d, i) => {
      const meta = c.getDatasetMeta(i);
      let j = d.data.length - 1;
      while (j >= 0 && d.data[j].y == null) j--;
      if (j < 0 || meta.hidden) return;
      const p = meta.data[j];
      let y = p.y;
      while (usados.some(u => Math.abs(u - y) < 13)) y -= 13;
      usados.push(y);
      ctx.fillText(d.label, p.x + 6, y);
    });
    ctx.restore();
  },
};

export function graficoComparar(canvas, kms, modelos, refs) {
  return new Chart(canvas, {
    type: 'line',
    data: { datasets: modelos.map(m => ({
      label: m.nome, data: kms.map((k, i) => ({ x: k, y: m.valores[i] })), stepped: 'after', spanGaps: false,
      borderColor: corDe(m.cor), backgroundColor: corDe(m.cor), borderWidth: 2, pointRadius: 0,
      pointHoverRadius: 5, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
    })) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: semMovimento() ? false : { duration: 350 },
      layout: { padding: { right: 110, top: 6 } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'linear', min: 0, max: kms.at(-1), ticks: { callback: v => `${num(v / 1000)} mil`, maxTicksLimit: 11 }, grid: { color: TINTA.grade } },
        y: { beginAtZero: true, ticks: { callback: v => brl(v), maxTicksLimit: 6 }, grid: { color: TINTA.grade }, border: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...DICA, filter: it => it.parsed.y != null, itemSort: (a, b) => b.parsed.y - a.parsed.y,
          callbacks: { title: it => `${num(it[0].parsed.x)} km`, label: it => ` ${it.dataset.label}  ${brl(it.parsed.y)}` } },
      },
    },
    plugins: [referencias(refs), rotuloFinal],
  });
}
```

`public/js/app.js`:

```js
import { inicio } from './inicio.js';
import { modelo } from './modelo.js';
import { comparar } from './comparar.js';
import { coletores } from './coletores.js';
import { entrar } from './entrar.js';
import { get, post } from './api.js';

const ROTAS = [
  [/^\/$/, inicio],
  [/^\/modelo\/([\w-]+)$/, modelo],
  [/^\/comparar$/, comparar],
  [/^\/coletores$/, coletores],
  [/^\/entrar$/, entrar],
];
let limpar = null;

export async function ir(caminho, empilhar = true) {
  if (empilhar) history.pushState(null, '', caminho);
  const tela = document.getElementById('tela');
  limpar?.(); limpar = null;
  for (const a of document.querySelectorAll('.abas a')) {
    const alvo = a.getAttribute('href');
    a.setAttribute('aria-current', alvo === location.pathname || (alvo === '/' && location.pathname.startsWith('/modelo/')) ? 'page' : 'false');
  }
  const rota = ROTAS.find(([re]) => re.test(location.pathname));
  if (!rota) { tela.innerHTML = '<p class="vazio">Página não encontrada</p>'; return; }
  try {
    limpar = (await rota[1](tela, ...location.pathname.match(rota[0]).slice(1))) ?? null;
  } catch (e) {
    tela.innerHTML = `<p class="erro">${e.message}</p>`;
  }
}

export async function atualizarSessao() {
  const { logado } = await get('/api/sessao').catch(() => ({ logado: false }));
  const el = document.getElementById('sessao');
  el.innerHTML = logado ? '<button type="button" id="sair">Sair</button>' : '<a href="/entrar" data-link>Entrar</a>';
  el.querySelector('#sair')?.addEventListener('click', async () => { await post('/api/sair'); await atualizarSessao(); ir(location.pathname, false); });
  return logado;
}

document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  ir(a.getAttribute('href'));
});
addEventListener('popstate', () => ir(location.pathname, false));
atualizarSessao();
ir(location.pathname, false);
```

- [ ] **Step 7: Tela Início**: `public/js/inicio.js`:

```js
import { get } from './api.js';
import { brl, kmMil, seta, esc, mesAno } from './formato.js';
import { linhaPlano } from './graficos.js';

export async function inicio(tela) {
  const [modelos, mud] = await Promise.all([get('/api/modelos'), get('/api/mudancas?limite=40')]);
  const grupo = (titulo, lista) => (lista.length ? `<section class="grupo"><h2>${titulo}</h2><div class="cartoes">${lista.map(cartao).join('')}</div></section>` : '');
  tela.innerHTML = `<div class="inicio">
    <div class="inicio-cartoes">${grupo('Frota', modelos.filter(m => m.origem === 'frota'))}${grupo('Candidatos', modelos.filter(m => m.origem === 'candidato'))}</div>
    <aside class="mudancas"><h2>Mudanças</h2>${listaMudancas(mud)}</aside>
  </div>`;
  const graficos = modelos.map(m => linhaPlano(tela.querySelector(`[data-spark="${m.slug}"]`), m.serie, { mini: true }));
  return () => graficos.forEach(g => g.destroy());
}

function cartao(m) {
  return `<a class="cartao" href="/modelo/${m.slug}" data-link>
    <img src="${m.imagem ?? '/img/placeholder.svg'}" alt="" loading="lazy">
    <div class="cartao-topo"><strong>${esc(m.nome)}</strong>${m.qtd_frota ? `<span class="qtd">${m.qtd_frota} carros</span>` : ''}</div>
    <div class="cartao-total">${brl(m.total)}</div>
    <div class="cartao-meta">${m.revisoes} revisões · até ${kmMil(m.km_max)}</div>
    <div>${seta(m.variacao)}</div>
    ${m.conferir ? '<span class="conferir">conferir</span>' : ''}
    <div class="spark"><canvas data-spark="${m.slug}" aria-hidden="true"></canvas></div>
  </a>`;
}

export function listaMudancas(lista) {
  if (!lista.length) return '<p class="vazio" style="padding:0 14px">Sem mudanças</p>';
  return `<ol class="lista-mud">${lista.map(a => `<li><a href="/modelo/${a.slug}" data-link>
    <span class="mud-quando">${mesAno(a.criado_em.slice(0, 10))}</span>
    <span class="mud-nome">${esc(a.nome)} ${a.ordem}ª</span>
    <span class="mud-valor">${a.tipo === 'nova_revisao' ? `nova ${brl(a.para)}` : `${brl(a.de)} → ${brl(a.para)}`}</span>
  </a></li>`).join('')}</ol>`;
}
```

Criar também os módulos das outras telas como esqueleto, para o `app.js` carregar (as Tasks 11 e 12 os preenchem): `public/js/modelo.js`, `public/js/comparar.js`, `public/js/coletores.js`, `public/js/entrar.js`, cada um com:

```js
export async function modelo(tela) { tela.innerHTML = ''; }
```

(trocando o nome da função por `comparar`, `coletores`, `entrar`).

- [ ] **Step 8: Conferir no navegador**: criar `.claude/launch.json` na pasta do repo (fora do git: acrescentar `.claude/` ao `.gitignore`):

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "precos-v2", "runtimeExecutable": "node", "runtimeArgs": ["--experimental-sqlite", "server.js"], "port": 3020, "env": { "PORT": "3020", "DB_PATH": "teste-ensaio.db" } }
  ]
}
```

Preparar o banco de ensaio: `cp revisoes.db teste-ensaio.db && DB_PATH=teste-ensaio.db npm run coletar -- --sem-alerta` (o `.gitignore` já ignora `teste-*.db`). Abrir com `preview_start {name:"precos-v2"}`, `resize_window` 1280×585, e conferir com `read_page` e `javascript_tool` (`document.documentElement.scrollHeight <= innerHeight`): cartões da frota e candidatos, linha em degraus em cada cartão, lista de mudanças rolando por dentro, sem rolagem da página, nenhum "—" na tela (`document.body.innerText.includes('—')` = false), console sem erro.

- [ ] **Step 9: Commit**

```bash
printf '.claude/
' >> .gitignore
git add public .gitignore
git commit -m "Front v2: casca com rotas, estilos OCN, Chart.js 4.4.7 local e tela Inicio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Telas Detalhe e Comparar

**Files:**
- Modify: `public/js/modelo.js`, `public/js/comparar.js` (substituir o esqueleto)

**Interfaces:**
- Consumes: `GET /api/modelos/:slug` (`revisoes_lista`), `GET /api/comparar`; `linhaPlano`, `graficoComparar`, `corDe`; formatos.

- [ ] **Step 1: Detalhe**: `public/js/modelo.js`:

```js
import { get } from './api.js';
import { brl, num, dia, esc, seta } from './formato.js';
import { linhaPlano } from './graficos.js';

export async function modelo(tela, slug) {
  const m = await get(`/api/modelos/${slug}`);
  const revisoes = m.revisoes_lista.filter(r => r.atual);
  tela.innerHTML = `<div class="detalhe">
    <header class="detalhe-topo">
      <img src="${m.imagem ?? '/img/placeholder.svg'}" alt="">
      <div><h1>${esc(m.montadora)} ${esc(m.nome)}</h1><p class="meta">${esc(m.versao ?? '')}${m.qtd_frota ? ` · ${m.qtd_frota} carros na frota` : ' · candidato'}</p></div>
      <div class="detalhe-total"><span>${brl(m.total)}</span>${seta(m.variacao)}</div>
    </header>
    <div class="detalhe-corpo">
      <div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>Revisão</th><th class="num">km</th><th class="num">Meses</th><th class="num">Preço</th><th>Desde</th><th class="num">Antes</th><th></th></tr></thead>
        <tbody>${revisoes.map(linha).join('')}</tbody>
      </table></div>
      <figure class="grafico-plano"><figcaption>Plano completo</figcaption><div class="area"><canvas id="g-plano" role="img" aria-label="Total do plano no tempo"></canvas></div></figure>
    </div>
  </div>`;
  const g = [linhaPlano(tela.querySelector('#g-plano'), m.serie)];
  for (const r of revisoes) g.push(linhaPlano(tela.querySelector(`[data-rev="${r.ordem}"]`), r.historico.map(h => ({ data: h.de, total: h.valor })), { mini: true }));
  return () => g.forEach(x => x.destroy());
}

function linha(r) {
  return `<tr${r.conferir ? ' class="a-conferir"' : ''}>
    <td>${r.ordem}ª${r.conferir ? ' <span class="conferir">conferir</span>' : ''}</td><td class="num">${num(r.km)}</td><td class="num">${r.meses ?? ''}</td>
    <td class="num"><strong>${brl(r.valor)}</strong></td><td>${dia(r.desde)}</td><td class="num">${r.anterior == null ? '' : brl(r.anterior)}</td>
    <td class="mini"><div><canvas data-rev="${r.ordem}" aria-hidden="true"></canvas></div></td>
  </tr>`;
}
```

- [ ] **Step 2: Comparar**: `public/js/comparar.js`:

```js
import { get } from './api.js';
import { brl, kmMil, esc } from './formato.js';
import { graficoComparar, corDe } from './graficos.js';

export async function comparar(tela) {
  const dados = await get('/api/comparar');
  let filtro = 'todos';
  tela.innerHTML = `<div class="comparar">
    <div class="filtros" role="group" aria-label="Modelos">
      <button type="button" data-f="frota" aria-pressed="false">Frota</button>
      <button type="button" data-f="candidato" aria-pressed="false">Candidatos</button>
      <button type="button" data-f="todos" aria-pressed="true">Todos</button>
    </div>
    <div class="comparar-corpo">
      <figure class="grafico-comparar"><div class="legenda" id="legenda"></div><div class="area"><canvas id="g-comp" role="img" aria-label="Custo acumulado de revisão por km"></canvas></div></figure>
      <div class="tabela-rolagem"><table class="tabela" id="t-comp"></table></div>
    </div>
  </div>`;
  let grafico = null;
  const desenhar = () => {
    const lista = dados.modelos.filter(m => filtro === 'todos' || m.origem === filtro);
    grafico?.destroy();
    grafico = graficoComparar(tela.querySelector('#g-comp'), dados.kms, lista, dados.referencias);
    tela.querySelector('#legenda').innerHTML = lista.map(m => `<span><i style="background:${corDe(m.cor)}"></i>${esc(m.nome)}</span>`).join('');
    tela.querySelector('#t-comp').innerHTML = tabela(lista, dados.referencias);
  };
  tela.querySelector('.filtros').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    filtro = b.dataset.f;
    tela.querySelectorAll('.filtros button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    desenhar();
  });
  desenhar();
  return () => grafico?.destroy();
}

function tabela(lista, refs) {
  return `<thead><tr><th>Modelo</th>${refs.map(r => `<th class="num">${kmMil(r)}</th>`).join('')}<th class="num">Plano</th></tr></thead>
  <tbody>${lista.map(m => `<tr>
    <td><i class="ponto" style="background:${corDe(m.cor)}"></i>${esc(m.nome)}</td>
    ${m.ate.map(v => `<td class="num">${v == null ? '' : brl(v)}</td>`).join('')}
    <td class="num">${brl(m.total)}<br><small>${kmMil(m.km_max)}</small></td>
  </tr>`).join('')}</tbody>`;
}
```

- [ ] **Step 3: Conferir no navegador** (servidor `precos-v2`, 1280×585):
  - `/modelo/byd-king`: tabela com as 10 revisões e degrau por linha, gráfico do plano com dica ao passar o mouse (`computer hover` sobre o gráfico e `screenshot`), sem rolar a página.
  - `/modelo/argo-drive`: 5 revisões, nada projetado.
  - `/comparar`: uma linha por modelo, nome no fim de cada linha sem sobrepor (Polo Track e Tera coincidem: os dois nomes empilhados), linhas tracejadas em 30 e 70 mil km, dica lista os modelos daquele km; filtro Frota redesenha sem trocar a cor dos que ficam; tabela com 30 mil, 70 mil e plano (Argo vazio em 70 mil).
  - Conferir com a lista de `anti-patterns.md` da skill `dataviz` (eixo duplo, cor pela posição, número em todo ponto): nenhum se aplica.

- [ ] **Step 4: Commit**

```bash
git add public/js/modelo.js public/js/comparar.js
git commit -m "Telas Detalhe do modelo e Comparar (custo acumulado por km)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Telas Coletores e Entrar

**Files:**
- Modify: `public/js/coletores.js`, `public/js/entrar.js` (substituir o esqueleto)

**Interfaces:**
- Consumes: `GET /api/coletas/estado`, `GET /api/modelos?todos=1`, `GET /api/catalogo/:coletor`, `POST /api/testar`, `POST /api/modelos`, `PATCH /api/modelos/:id`, `POST /api/coletas`, `POST /api/entrar`; `ir`, `atualizarSessao` de `app.js`.

- [ ] **Step 1: Entrar**: `public/js/entrar.js`:

```js
import { post } from './api.js';
import { ir, atualizarSessao } from './app.js';

export async function entrar(tela) {
  tela.innerHTML = `<form class="entrar" id="f-entrar">
    <h1>Entrar</h1>
    <input type="password" name="senha" autocomplete="current-password" placeholder="Senha" required autofocus>
    <button class="btn" type="submit">Entrar</button>
    <p class="erro" id="e-entrar" hidden></p>
  </form>`;
  tela.querySelector('#f-entrar').addEventListener('submit', async e => {
    e.preventDefault();
    const erro = tela.querySelector('#e-entrar');
    try {
      await post('/api/entrar', { senha: e.target.senha.value });
      await atualizarSessao();
      ir('/coletores');
    } catch (x) {
      erro.textContent = x.message; erro.hidden = false;
    }
  });
}
```

- [ ] **Step 2: Coletores**: `public/js/coletores.js`:

```js
import { get, post, patch } from './api.js';
import { brl, esc, dia, num } from './formato.js';
import { atualizarSessao } from './app.js';

const ROTULO = { ok: '✓ ok', parcial: '! parcial', falha: '✕ falha' };
const FONTES = { byd: 'BYD', vw: 'Volkswagen', gm: 'Chevrolet', fiat: 'Fiat', ativos: 'Frota (Ativos)' };
const CAMPOS = {
  vw: [['modelo', 'Modelo no site da VW'], ['versao', 'Versão'], ['ano', 'Ano']],
  fiat: [['mvsCode', 'mvsCode'], ['modelYear', 'Ano modelo'], ['dealer', 'Concessionária']],
};

export async function coletores(tela) {
  const [estado, logado] = await Promise.all([get('/api/coletas/estado'), atualizarSessao()]);
  const modelos = logado ? await get('/api/modelos?todos=1') : [];
  tela.innerHTML = `<div class="coletores">
    <section>
      <h2>Última coleta</h2>
      <table class="tabela"><thead><tr><th>Fonte</th><th>Quando</th><th>Status</th><th class="num">Modelos</th><th class="num">Mudanças</th><th>Erro</th></tr></thead>
      <tbody>${estado.fontes.map(f => `<tr><td>${FONTES[f.fonte] ?? esc(f.fonte)}</td><td>${f.fim ? dia(f.fim.slice(0, 10)) : 'rodando'}</td>
        <td class="status ${f.status ?? ''}">${ROTULO[f.status] ?? ''}</td><td class="num">${f.modelos_ok}</td><td class="num">${f.mudancas}</td>
        <td class="erro-curto">${esc(f.erro ?? '')}</td></tr>`).join('')}</tbody></table>
      ${logado ? `<div class="acoes"><button class="btn" id="coletar">Coletar agora</button><span class="teste" id="r-coletar"></span></div>` : ''}
      <h2 style="margin-top:14px">Alertas pendentes</h2>
      ${estado.pendentes.length ? `<table class="tabela"><tbody>${estado.pendentes.map(a => `<tr><td>${esc(a.nome ?? '')} ${a.ordem ? `${a.ordem}ª` : ''}</td><td>${esc(a.tipo)}</td>
        <td class="num">${a.de != null ? brl(a.de) : ''}${a.para != null ? ` → ${brl(a.para)}` : ''}</td><td class="erro-curto">${esc(a.texto ?? '')}</td></tr>`).join('')}</tbody></table>` : '<p class="vazio">Nenhum</p>'}
    </section>
    ${logado ? painel(modelos) : ''}
  </div>`;
  if (logado) ligar(tela);
}

function painel(modelos) {
  return `<section>
    <h2>Modelos</h2>
    <table class="tabela"><tbody>${modelos.map(m => `<tr><td>${esc(m.nome)}</td><td>${m.origem === 'frota' ? `${m.qtd_frota} carros` : 'candidato'}</td>
      <td class="num"><label><input type="checkbox" data-ativo="${m.id}" ${m.ativo ? 'checked' : ''}> ativo</label></td></tr>`).join('')}</tbody></table>
    <h2 style="margin-top:14px">Novo candidato</h2>
    <form class="form" id="f-novo">
      <label>Fonte<select name="coletor"><option value="byd">BYD</option><option value="gm">Chevrolet</option><option value="vw">Volkswagen</option><option value="fiat">Fiat</option></select></label>
      <div id="campos"></div>
      <label>Montadora<input name="montadora" required></label>
      <label>Nome<input name="nome" required></label>
      <div class="acoes"><button class="btn sec" type="button" id="testar">Testar</button><button class="btn" type="submit">Salvar</button></div>
      <div class="teste" id="r-teste"></div>
    </form>
  </section>`;
}

function ligar(tela) {
  const form = tela.querySelector('#f-novo');
  const campos = tela.querySelector('#campos');
  const resultado = tela.querySelector('#r-teste');
  let catalogo = [];

  async function trocarFonte() {
    const c = form.coletor.value;
    form.montadora.value = { byd: 'BYD', gm: 'Chevrolet', vw: 'Volkswagen', fiat: 'Fiat' }[c];
    if (CAMPOS[c]) { campos.innerHTML = CAMPOS[c].map(([k, r]) => `<label>${r}<input name="p_${k}" required></label>`).join(''); return; }
    campos.innerHTML = '<label>Modelo<select name="p_catalogo" disabled><option>carregando</option></select></label>';
    catalogo = await get(`/api/catalogo/${c}`);
    const sel = campos.querySelector('select');
    sel.innerHTML = catalogo.map((x, i) => `<option value="${i}">${esc(x.rotulo)}</option>`).join('');
    sel.disabled = false;
    sel.onchange = () => { form.nome.value = catalogo[sel.value].rotulo.replace(/^BYD |^Chevrolet /, ''); };
    sel.onchange();
  }

  function parametros() {
    const c = form.coletor.value;
    if (!CAMPOS[c]) return catalogo[form.p_catalogo.value].parametros;
    const p = Object.fromEntries(CAMPOS[c].map(([k]) => [k, form[`p_${k}`].value.trim()]));
    for (const k of ['ano', 'modelYear']) if (p[k]) p[k] = Number(p[k]);
    return p;
  }

  form.coletor.addEventListener('change', trocarFonte);
  tela.querySelector('#testar').addEventListener('click', async () => {
    resultado.textContent = 'testando';
    try {
      const { itens } = await post('/api/testar', { coletor: form.coletor.value, parametros: parametros() });
      resultado.innerHTML = itens.map(i => `${i.ordem}ª ${num(i.km)} km ${brl(i.valor)}`).join('<br>');
    } catch (e) { resultado.textContent = e.message; }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await post('/api/modelos', { coletor: form.coletor.value, montadora: form.montadora.value.trim(), nome: form.nome.value.trim(), parametros: parametros() });
      coletores(tela);
    } catch (x) { resultado.textContent = x.message; }
  });
  tela.querySelectorAll('[data-ativo]').forEach(cb => cb.addEventListener('change', () => patch(`/api/modelos/${cb.dataset.ativo}`, { ativo: cb.checked })));
  tela.querySelector('#coletar').addEventListener('click', async e => {
    e.target.disabled = true;
    tela.querySelector('#r-coletar').textContent = 'coletando';
    try { await post('/api/coletas'); coletores(tela); }
    catch (x) { tela.querySelector('#r-coletar').textContent = x.message; e.target.disabled = false; }
  });
  trocarFonte();
}
```

- [ ] **Step 3: Conferir no navegador** (servidor `precos-v2` com `ADMIN_SENHA_HASH` e `SESSION_SECRET` de teste no `launch.json`: gerar com `npm run hash -- "<senha aleatória>"`, senha guardada só em `teste-senha.txt`, que entra no `.gitignore`; testar o login por `curl` e, no navegador, usar o cookie já criado por `javascript_tool` em `fetch('/api/entrar', ...)` em vez de digitar a senha):
  - deslogado: só a tabela de coletas e os alertas; nenhum botão de escrita.
  - logado: Coletar agora roda e atualiza a tabela; Novo candidato BYD lista os 21 modelos, Testar mostra as 10 revisões do BYD Seal, Salvar cria e o cartão aparece no Início (no banco de ensaio, nunca na produção).
  - 1280×585 sem rolar a página.

- [ ] **Step 4: Commit**

```bash
printf 'teste-senha.txt\n' >> .gitignore
git add public/js/coletores.js public/js/entrar.js .gitignore
git commit -m "Telas Coletores (estado, alertas, cadastro de candidato) e Entrar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Animações

**Files:**
- Modify: `public/css/telas.css`, e os `public/js/*.js` que as propostas aceitas tocarem

- [ ] **Step 1:** Carregar a skill `find-animation-opportunities` e rodar sobre `public/` (telas Início, Detalhe, Comparar, Coletores). Ela só propõe, com valores exatos, e descarta o que não deve animar.
- [ ] **Step 2:** Para cada proposta aceita, implementar com a skill `animate` (propriedades só de composição: `transform` e `opacity`; ≤ 250 ms em interface; saída mais curta que entrada), sempre com o bloco `prefers-reduced-motion` que já existe em `telas.css`. Candidatos prováveis: entrada escalonada dos cartões no Início, troca de tela, realce da linha ao passar o mouse na legenda do Comparar, retorno do botão Coletar agora.
- [ ] **Step 3:** Conferir no navegador que nada pula de lugar nem atrasa clique, e que com `prefers-reduced-motion` tudo aparece direto.
- [ ] **Step 4: Commit**

```bash
git add public
git commit -m "Animacoes das telas (find-animation-opportunities + animate), respeitando reduced motion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Ensaio com cópia do banco de produção e limpeza do código antigo

**Files:**
- Delete: `scraper/` (pasta inteira)
- Modify: `.gitignore` (acrescentar `copia-producao*.db`)

- [ ] **Step 1: Cópia de produção, só leitura** (SSH root na VPS a partir do notebook; nada é escrito lá):

```bash
VOL=$(ssh root@200.141.23.108 "docker volume ls -q | grep -i d8qy3lvsre5k21jqttnk5baj | head -1")
ssh root@200.141.23.108 "sqlite3 /var/lib/docker/volumes/$VOL/_data/revisoes.db '.backup /tmp/copia.db' && base64 -w0 /tmp/copia.db && rm /tmp/copia.db" | base64 -d > copia-producao.db
node --experimental-sqlite -e "import('node:sqlite').then(({DatabaseSync})=>{const d=new DatabaseSync('copia-producao.db');console.log(d.prepare('PRAGMA integrity_check').get(), d.prepare('SELECT COUNT(*) n FROM precos').get())})"
```

Se o `sqlite3` não existir na VPS, usar `docker exec` no container do app com `node -e` fazendo `db.exec("VACUUM INTO '/tmp/copia.db'")`. Expected: `integrity_check: ok` e o total de linhas igual ao do levantamento (200 + as de outubro da Task 0).

- [ ] **Step 2: Migrar a cópia e conferir**

```bash
cp copia-producao.db copia-producao-v2.db
DB_PATH=copia-producao-v2.db node --experimental-sqlite -e "import('./src/db.js').then(async({abrir})=>{const {migrar}=await import('./src/migracoes/index.js');const db=abrir('copia-producao-v2.db');console.log('schema',migrar(db));console.log(db.prepare('SELECT m.slug, COUNT(v.id) faixas, SUM(v.vigente_ate IS NULL) atuais FROM modelos m LEFT JOIN vigencias v ON v.modelo_id=m.id GROUP BY m.id').all())})"
```

Expected: `schema 2`; Polo e Tera com 10 atuais, Argo 5, Dolphin e King 10, Onix 10 (se a Task 0 gravou outubro). A conferência interna da migração passou (senão teria lançado).

- [ ] **Step 3: KPIs contra a cópia**: subir o servidor com `DB_PATH=copia-producao-v2.db` e comparar com o site atual:

```bash
node --experimental-sqlite -e "
const go=async u=>{const [v,p]=await Promise.all([fetch(u+'/api/veiculos').then(r=>r.json()),fetch(u+'/api/precos').then(r=>r.json())]);const out={},seen={};const id={};v.forEach(x=>{const m=/polo/i.test(x.modelo)?'Polo':/argo/i.test(x.modelo)?'Argo':/tera/i.test(x.modelo)?'Tera':null;if(m)id[x.id]=m});p.forEach(x=>{const m=id[x.veiculo_id];if(!m)return;const n=+x.revisao.match(/^(\d+)/)[1];const k=m+'|'+n;if(seen[k])return;seen[k]=1;(out[m]??=[]).push(n+':'+x.valor)});return JSON.stringify(out)};
Promise.all([go('https://precos.ocnbrasil.com.br'),go('http://localhost:3020')]).then(([a,b])=>console.log(a===b?'IGUAL':'DIFERENTE\n'+a+'\n'+b))"
```

Expected: `IGUAL`.

- [ ] **Step 4: Telas com a cópia**: no navegador, 1280×585, as quatro telas com os dados reais; captura de tela de cada uma para mostrar ao Enrico.

- [ ] **Step 5: Apagar o código antigo e commitar**

```bash
printf 'copia-producao*.db\n' >> .gitignore
git rm -rq scraper
git add .gitignore
git commit -m "Remove os coletores antigos (scraper/); a coleta agora roda dentro do app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
npm test
```

Expected: `npm test` todo PASS.

- [ ] **Step 6: PARAR.** Mostrar ao Enrico as capturas, o resultado do Step 3 e o `git log --oneline main..reconstrucao-v2`. Pedir OK para a Task 15.

---

### Task 15: Implantação (só com OK do Enrico)

- [ ] **Step 1: Variáveis no Coolify** (app `d8qy3lvsre5k21jqttnk5baj`, pela API com `.coolify-token`, `PATCH /applications/{uuid}/envs/bulk`):
  - `ADMIN_SENHA_HASH` (o Enrico escolhe a senha e roda `npm run hash -- "..."` ele mesmo, ou eu gero uma aleatória e mostro uma vez)
  - `SESSION_SECRET` (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
  - `ATIVOS_URL=https://veiculos.ocnbrasil.com.br`, `ATIVOS_TOKEN` (mesmo valor gerado para `PRECOS_TOKEN` no app do Ativos `w5jjxc7ijj3sxc3d0viamgas`)
  - `EVOLUTION_URL=http://evolution-api:8080`, `EVOLUTION_API_KEY` (= `AUTHENTICATION_API_KEY` do app evolution-api `m9fbuimdu1g6iruszl9a86us`), `EVOLUTION_INSTANCIA` (= `EVOLUTION_INSTANCE` do Central, padrão `ocn`), `ALERTA_WHATSAPP` (número do Enrico, ele informa)
  - Conferir que o container do Preços enxerga `evolution-api` (`docker exec <container> node -e "fetch('http://evolution-api:8080').then(r=>console.log(r.status))"`); se não, ligar "Connect to Predefined Network" no app do Preços, como no Central.
- [ ] **Step 2: Ativos**: `PRECOS_TOKEN` no app do Ativos e `git -C ../ocn-ativos push origin main` (commit da Task 6). Conferir: `curl -s -H "Authorization: Bearer $TOKEN" https://veiculos.ocnbrasil.com.br/api/precos/frota`.
- [ ] **Step 3: Cópia de segurança em produção**: parar o app pelo Coolify, `cp revisoes.db revisoes-antes-v2-AAAAMMDD.db` no volume, baixar a cópia para o notebook (como na Task 14, Step 1), `PRAGMA integrity_check` nas duas.
- [ ] **Step 4: Desligar a coleta antiga**: `gh workflow disable coleta-mensal.yml -R pikeno9/frota-revisoes`; `git rm .github/workflows/coleta-mensal.yml` e commit na branch.
- [ ] **Step 5: Publicar**: `git switch main && git merge --no-ff reconstrucao-v2 && git push origin main`. O Coolify publica sozinho. Conferir: `curl -s https://precos.ocnbrasil.com.br/api/saude` → `{"ok":true,"schema":2,...}`; as quatro telas; o KPIs (aba UE) mostra as mesmas revisões de antes.
- [ ] **Step 6: Tarefa agendada**: no Coolify, tarefa do app: nome `coleta-semanal`, comando `npm run coletar`, frequência `0 12 * * 1`. Rodar uma vez agora pelo botão Coletar agora (logado) e conferir a mensagem no WhatsApp do Enrico e a tela Coletores.
- [ ] **Step 7: Limpeza**: apagar os secrets `API_URL` e `INGEST_TOKEN` do GitHub (`gh secret delete ... -R pikeno9/frota-revisoes`) e a variável `INGEST_TOKEN` do Coolify. Atualizar a memória `projeto-frota-revisoes.md`.
- [ ] **Step 7b (se algo der errado):** voltar ao commit anterior no Coolify (`rollback_application`); as tabelas antigas estão intactas e o código antigo volta a funcionar sobre elas.
