# Preços v2, módulo Revenda: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estimar por quanto a OCN revende cada carro no fim do contrato (P10, P50, P90 por canal, nominal e real) a partir da FIPE, dos anúncios da Mobiauto e do IPCA, com telas atrás do login e uma leitura por token para o Sandbox de UE do KPIs.

**Architecture:** Mesmo repo e mesmo banco do Preços (`node:sqlite`). A migração v3 só acrescenta colunas em `modelos` e tabelas novas. Três leitores (`src/revenda/{fipe,mobiauto,ipca}.js`) entram na rodada semanal que já existe, depois das Revisões; o método da spec vira funções puras em `src/revenda/estudo.js`, e cada rodada grava um estudo por modelo. Rotas em `src/rotas/revenda.js` (sessão; a projeção aceita também `REVENDA_TOKEN`) e cinco telas em `public/js/revenda/`. No KPIs, `lib/revenda.js` lê a projeção com cache de 1 h e o Sandbox ganha o seletor Digitado / Do estudo.

**Tech Stack:** Node 22 (produção) / 24 (notebook), Express 4, `node:sqlite` com `--experimental-sqlite`, `node:test`, Chart.js 4.4.7 já guardado em `public/vendor/`, Coolify (tarefa agendada `coleta-semanal`). KPIs: Node + Express em CommonJS, `node --test`.

Spec: `docs/superpowers/specs/2026-10-28-precos-v2-revenda-design.md`. Modelo de formato: `docs/superpowers/plans/2026-10-28-precos-v2-revisoes.md`.

## Global Constraints

- Leitura de Revenda só com login.
- KPIs lê por token `REVENDA_TOKEN`.
- Telas 1280×585 sem rolar a página.
- Sem texto explicativo.
- Sem travessão.
- Identidade OCN (Plus Jakarta Sans, roxo #5800F7, escuro #0A0118, tema claro).
- Histórico de produção nunca alterado (migração só adiciona).
- Nada de dado de teste em produção.
- Nada de push sem OK.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm test` = `node --experimental-sqlite --test "test/**/*.test.js"`.
- Branch `revenda` no repo `revisoes` (já criada, com a spec); nunca mexer na `main` antes da Task 13. No KPIs, branch `experimentos`, só commit local até a Task 13.
- Nada de `python3` (o do Windows é um atalho quebrado). Arquivos se escrevem com as ferramentas Write/Edit, não com heredoc no Bash (heredoc come barra invertida, e as expressões regulares daqui têm muitas).
- Comentários e nomes em português, sem acento em identificadores, no estilo do código atual.

## Fatos conferidos (spec, seção 3, e testes de 28/10)

- FIPE: combustível 5 Flex, 4 Elétrico, 6 Híbrido; `anoModelo=32000` é zero km; referência 338 = out/2026, 326 = out/2025. Sem resultado: `{"codigo":"0","erro":"nadaencontrado"}`.
- Mobiauto: `props.pageProps.deals = { numResults, results: [{ id, price, km, deal0km, dealer, trim: { name, productionYear, model: { name, year } } }] }`, 24 por página. **A página N é o caminho `/pagina-N`** (`.../sp/volkswagen/polo/pagina-2`). O `?page=N` da spec é ignorado pelo site: em 28/10, `?page=2` devolveu 22 dos 24 anúncios da página 1; `/pagina-2` devolveu 23 novos.
- BCB SGS 433: `[{"data":"01/09/2026","valor":"0.82"}]`.
- Arquivos salvos em `test/fixtures/` (commitados junto com este plano): `fipe-referencias-2026-10-28.json` (40 primeiras, 338 a 299), `fipe-polo-2025-ref326.json` (R$ 77.170), `fipe-polo-2025-ref338.json` (R$ 73.674), `fipe-polo-0km-ref326.json` (R$ 86.668), `fipe-nada.json`, `mobiauto-polo-p1-2026-10-28.json` e `mobiauto-polo-p2-2026-10-28.json` (só o `deals`, enxuto: 3.073 resultados, 24 por página, 1 anúncio repetido entre as duas), `mobiauto-pagina-minima.html` (4 anúncios num `__NEXT_DATA__`), `bcb-ipca-2026-10-28.json` (jan/2024 a set/2026, 33 meses).

## Decisões tomadas onde a spec não fecha

1. Paginação da Mobiauto por `/pagina-N` (acima). Para quando a página vem vazia, quando `N × 24 ≥ numResults` ou em 40 páginas.
2. Janela de 24 meses de `r_m`: entram as observações cuja referência final `t+m` está nos 24 meses mais recentes salvos.
3. `real_p50` usa só as observações com todos os meses de IPCA de `t+1` a `t+m`; sem nenhuma, fica nulo e a projeção real sai vazia.
4. Com menos de 30 anúncios, além de `c`, a dispersão (`q10`, `q90`), o km típico (se não houver anúncio de 0,5 a 1,5 ano) e a razão anúncio/FIPE vêm da média dos modelos com dados; sem nenhum doador: `c = 0`, dispersão 0, razão 1. Mesmo sinal `km_emprestado`.
5. `r_m` emprestado fica marcado por prazo (`emprestado: 'ref' | 'outros' | null`) e no total (`r_emprestado`).
6. Projeção aceita `meses` inteiro de 1 a 24 (abaixo de 6, reta entre 0 meses = 1 e 6); acima de 24 é 400. No KPIs, cenário com prazo maior que 24 mostra o erro e não muda a revenda.
7. `estudos.calculado_em` guarda a data da rodada (`YYYY-MM-DD`). A venda é comparada com o estudo mais recente até a data dela (ou o primeiro, se a venda for anterior a todos), com P50, 12 meses e o FIPE do zero km do estudo como preço de compra (a tabela `vendas` da spec não guarda prazo nem preço de compra).
8. FIPE por referência e não por "só a mais recente": cada código baixa as referências mais novas que a última salva (na primeira vez, as 36 últimas), da mais antiga para a mais nova, uma transação por referência; assim uma falha no meio da carga recomeça de onde parou.
9. A trava entre processos da coleta passa de 30 para 120 minutos (a carga inicial da FIPE leva uns 25).
10. O botão "Coletar agora" da tela Coletores continua rodando só as Revisões; a Revenda roda na tarefa semanal e no `npm run coletar`.
11. `PUT /api/revenda/premissas` aceita só números (JSON), de 0 a 200, das três chaves conhecidas; só a premissa que mudou ganha data nova. `GET /api/revenda/premissas` devolve também os parâmetros FIPE/Mobiauto de cada modelo, editados por `PATCH /api/revenda/modelos/:id`.
12. No KPIs, a % "do estudo" é a P50 nominal do canal sobre o preço de compra do cenário (preço do carro; no subrental, a recompra), gravada em `revenda_pct`, com `revenda_estudo: { canal, km, data_estudo }` ao lado. Mexer na venda à mão volta para Digitado. A disponibilidade vai na resposta de `GET /api/sandbox/bases` (`revenda: { modelos: [...] }` ou `null`).

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/migracoes/003-revenda.js` | colunas novas em `modelos`, tabelas da Revenda, parâmetros dos 6 modelos e premissas iniciais |
| `src/revenda/fipe.js` | `referencias()`, `valor()`, leitura das respostas da FIPE |
| `src/revenda/mobiauto.js` | `anuncios()`, `lerPagina()`, `filtrar()`, `urlPagina()` |
| `src/revenda/ipca.js` | `serie()`, `lerSerie()` |
| `src/revenda/estudo.js` | método da spec em funções puras: quantis, `r_m`, regressão, empréstimo, interpolação, projeção |
| `src/revenda/dados.js` | leituras e escritas da Revenda no banco; `recalcularEstudos()`, `ultimoEstudo()` |
| `src/revenda/coleta.js` | `rodarRevenda()`: IPCA, FIPE, anúncios e estudos dentro da rodada |
| `src/revenda/consultas.js` | o que as rotas devolvem e as validações (`ErroRevenda`) |
| `src/coletas.js` | `novaColeta()`, `fecharColeta()`, `alertaFalha()` (saem de `coleta.js`, usados pelas duas rodadas) |
| `src/coleta.js` | chama `rodarRevenda()` depois das Revisões; trava de 120 minutos |
| `src/dependencias.js` | liga os três leitores reais |
| `src/auth.js` | `tokenConfere()` |
| `src/rotas/revenda.js` | rotas `/api/revenda/*` |
| `src/rotas/admin.js` | exporta `soJson`; botão Coletar agora sem Revenda |
| `src/app.js` | monta as rotas e as telas `/revenda*` |
| `public/index.html`, `public/js/app.js` | navegação do módulo (só logado) e rotas do front |
| `public/js/revenda/{graficos,modelos,modelo,simulador,premissas,vendas}.js` | telas |
| `public/css/revenda.css` | estilos das telas |
| `public/js/{api,formato,graficos,entrar,coletores}.js` | `put`, `pctSimples`, exports dos gráficos, volta depois do login, nomes das fontes novas |
| `test/sinteticos.js` | dados sintéticos com coeficientes conhecidos |
| `test/revenda-*.test.js` | testes da Revenda |
| `ocn-kpis-site/lib/revenda.js`, `config/static.js`, `server.js`, `public/sandbox-engine.js`, `public/sandbox.js`, `public/styles.css`, `tests/revenda.test.js` | integração com o Sandbox |

Contagem de testes esperada: 86 hoje; 89 depois da Task 1; 95, 102, 105, 117, 125 e 137 depois das Tasks 2 a 7.

---

### Task 1: Migração v3

**Files:**
- Create: `src/migracoes/003-revenda.js`, `test/revenda-migracao.test.js`
- Modify: `src/migracoes/index.js`, `test/migracao.test.js:120-146` (o teste de corrida usava a versão 3 como falsa)

**Interfaces:**
- Consumes: `migrar(db, lista?)`, `versaoAtual(db)` (`src/migracoes/index.js`); `bancoNovo()`, `bancoLegado()` (`test/ajuda.js`).
- Produces: `PARAMETROS_REVENDA` (por slug), `PREMISSAS_INICIAIS = { atacado_pct_base: 85, varejo_negociacao_pct: 5, motorista_pct_base: 100 }`, migração `{ versao: 3, aplicar(db) }`. Colunas `modelos.fipe_marca, fipe_modelo, fipe_combustivel, fipe_modelo_ref, mobiauto_caminho, mobiauto_versao`; tabelas `fipe_precos`, `anuncios`, `ipca`, `premissas`, `vendas`, `estudos` exatamente como na spec, seção 4, mais os índices `anuncios_modelo` e `estudos_modelo`.

- [ ] **Step 1: Teste que falha**: `test/revenda-migracao.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, bancoLegado } from './ajuda.js';
import { migrar, versaoAtual } from '../src/migracoes/index.js';
import legado from '../src/migracoes/001-legado.js';
import v2 from '../src/migracoes/002-v2.js';

test('v3 cria as tabelas, preenche os parâmetros e as premissas', () => {
  const db = bancoNovo();
  assert.equal(versaoAtual(db), 3);
  const polo = db.prepare("SELECT fipe_marca, fipe_modelo, fipe_combustivel, fipe_modelo_ref, mobiauto_caminho, mobiauto_versao FROM modelos WHERE slug = 'polo-track'").get();
  assert.deepEqual({ ...polo }, { fipe_marca: 59, fipe_modelo: 10176, fipe_combustivel: 5, fipe_modelo_ref: null, mobiauto_caminho: 'volkswagen/polo', mobiauto_versao: '^Track' });
  assert.equal(db.prepare("SELECT fipe_modelo_ref FROM modelos WHERE slug = 'onix-sedan-plus'").get().fipe_modelo_ref, 8950);
  assert.equal(db.prepare("SELECT mobiauto_versao FROM modelos WHERE slug = 'argo-drive'").get().mobiauto_versao, '^Drive 1\\.0');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM modelos WHERE fipe_modelo IS NULL').get().n, 0);
  const premissas = Object.fromEntries(db.prepare('SELECT chave, valor FROM premissas').all().map(p => [p.chave, p.valor]));
  assert.deepEqual(premissas, { atacado_pct_base: 85, varejo_negociacao_pct: 5, motorista_pct_base: 100 });
  for (const t of ['fipe_precos', 'anuncios', 'ipca', 'vendas', 'estudos']) {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, t);
  }
});

test('v3 não mexe no histórico: veículos, preços e vigências ficam iguais', () => {
  const db = bancoLegado({
    veiculos: [[1, 'Volkswagen', 'Polo Track', '1.0']],
    precos: [[1, '1ª revisão (10.000 km)', '2026-08-01', 846.64], [1, '1ª revisão (10.000 km)', '2026-09-01', 864.46]],
  });
  migrar(db, [legado, v2]);
  const foto = () => JSON.stringify([
    db.prepare('SELECT * FROM veiculos ORDER BY id').all(),
    db.prepare('SELECT * FROM precos ORDER BY id').all(),
    db.prepare('SELECT * FROM vigencias ORDER BY id').all(),
    db.prepare('SELECT * FROM alertas ORDER BY id').all(),
  ]);
  const antes = foto();
  assert.equal(migrar(db), 3);
  assert.equal(foto(), antes);
});

test('venda com canal fora da lista é recusada pelo banco', () => {
  const db = bancoNovo();
  assert.throws(() => db.prepare("INSERT INTO vendas (placa, modelo_id, data, km, preco, canal) VALUES ('ABC1D23', 1, '2026-10-01', 50000, 60000, 'leilao')").run(), /CHECK/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL nos 3 testes novos (`versaoAtual` dá 2, `no such column: fipe_marca`).

- [ ] **Step 3: Implementar**: `src/migracoes/003-revenda.js`:

```js
// v3: módulo Revenda. Só acrescenta: colunas novas em modelos, tabelas novas e
// as premissas iniciais. Nada do que já existe é alterado ou apagado.

// Conferidos na FIPE e na Mobiauto em 28/10/2026 (spec, seção 4).
export const PARAMETROS_REVENDA = {
  'polo-track': { fipe_marca: 59, fipe_modelo: 10176, fipe_combustivel: 5, fipe_modelo_ref: null, mobiauto_caminho: 'volkswagen/polo', mobiauto_versao: '^Track' },
  tera: { fipe_marca: 59, fipe_modelo: 11467, fipe_combustivel: 5, fipe_modelo_ref: 10176, mobiauto_caminho: 'volkswagen/tera', mobiauto_versao: 'MPI' },
  'argo-drive': { fipe_marca: 21, fipe_modelo: 7965, fipe_combustivel: 5, fipe_modelo_ref: null, mobiauto_caminho: 'fiat/argo', mobiauto_versao: '^Drive 1\\.0' },
  'onix-sedan-plus': { fipe_marca: 23, fipe_modelo: 11617, fipe_combustivel: 5, fipe_modelo_ref: 8950, mobiauto_caminho: 'chevrolet/onix-plus', mobiauto_versao: '^(?!.*Turbo).*1\\.0' },
  'byd-dolphin': { fipe_marca: 238, fipe_modelo: 12122, fipe_combustivel: 4, fipe_modelo_ref: null, mobiauto_caminho: 'byd/dolphin', mobiauto_versao: '^GS' },
  'byd-king': { fipe_marca: 238, fipe_modelo: 11078, fipe_combustivel: 6, fipe_modelo_ref: null, mobiauto_caminho: 'byd/king', mobiauto_versao: 'GL' },
};

export const PREMISSAS_INICIAIS = { atacado_pct_base: 85, varejo_negociacao_pct: 5, motorista_pct_base: 100 };

const SQL = `
  ALTER TABLE modelos ADD COLUMN fipe_marca INTEGER;
  ALTER TABLE modelos ADD COLUMN fipe_modelo INTEGER;
  ALTER TABLE modelos ADD COLUMN fipe_combustivel INTEGER;
  ALTER TABLE modelos ADD COLUMN fipe_modelo_ref INTEGER;
  ALTER TABLE modelos ADD COLUMN mobiauto_caminho TEXT;
  ALTER TABLE modelos ADD COLUMN mobiauto_versao TEXT;
  CREATE TABLE fipe_precos (
    fipe_marca INTEGER NOT NULL,
    fipe_modelo INTEGER NOT NULL,
    ano_modelo INTEGER NOT NULL,
    referencia TEXT NOT NULL,
    valor REAL NOT NULL,
    codigo_fipe TEXT,
    PRIMARY KEY (fipe_modelo, ano_modelo, referencia)
  );
  CREATE TABLE anuncios (
    id_externo TEXT PRIMARY KEY,
    modelo_id INTEGER NOT NULL REFERENCES modelos(id),
    versao TEXT, ano_modelo INTEGER, ano_fabricacao INTEGER,
    km INTEGER NOT NULL, preco REAL NOT NULL, loja TEXT,
    primeiro_visto TEXT NOT NULL, ultimo_visto TEXT NOT NULL
  );
  CREATE INDEX anuncios_modelo ON anuncios(modelo_id, ultimo_visto);
  CREATE TABLE ipca (mes TEXT PRIMARY KEY, variacao REAL NOT NULL);
  CREATE TABLE premissas (chave TEXT PRIMARY KEY, valor REAL NOT NULL, atualizado_em TEXT NOT NULL);
  CREATE TABLE vendas (
    id INTEGER PRIMARY KEY, placa TEXT NOT NULL, modelo_id INTEGER NOT NULL REFERENCES modelos(id),
    data TEXT NOT NULL, km INTEGER NOT NULL, preco REAL NOT NULL,
    canal TEXT NOT NULL CHECK (canal IN ('atacado','varejo','motorista')), obs TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE estudos (
    id INTEGER PRIMARY KEY, modelo_id INTEGER NOT NULL REFERENCES modelos(id),
    calculado_em TEXT NOT NULL, dados TEXT NOT NULL
  );
  CREATE INDEX estudos_modelo ON estudos(modelo_id, id);
`;

export default {
  versao: 3,
  aplicar(db) {
    db.exec(SQL);
    const upd = db.prepare(`UPDATE modelos SET fipe_marca = ?, fipe_modelo = ?, fipe_combustivel = ?, fipe_modelo_ref = ?,
      mobiauto_caminho = ?, mobiauto_versao = ? WHERE slug = ?`);
    for (const [slug, p] of Object.entries(PARAMETROS_REVENDA)) {
      upd.run(p.fipe_marca, p.fipe_modelo, p.fipe_combustivel, p.fipe_modelo_ref, p.mobiauto_caminho, p.mobiauto_versao, slug);
    }
    const ins = db.prepare("INSERT INTO premissas (chave, valor, atualizado_em) VALUES (?, ?, datetime('now'))");
    for (const [chave, valor] of Object.entries(PREMISSAS_INICIAIS)) ins.run(chave, valor);
  },
};
```

`src/migracoes/index.js` (inteiro):

```js
import { transacao } from '../db.js';
import legado from './001-legado.js';
import v2 from './002-v2.js';
import v3 from './003-revenda.js';

export const MIGRACOES = [legado, v2, v3];

export function versaoAtual(db) {
  return db.prepare('SELECT COALESCE(MAX(versao), 0) AS v FROM schema_versao').get().v;
}

export function migrar(db, lista = MIGRACOES) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_versao (versao INTEGER NOT NULL, aplicada_em TEXT NOT NULL)');
  for (const m of lista) {
    if (m.versao <= versaoAtual(db)) continue;
    transacao(db, () => {
      if (versaoAtual(db) >= m.versao) return;
      m.aplicar(db);
      db.prepare("INSERT INTO schema_versao (versao, aplicada_em) VALUES (?, datetime('now'))").run(m.versao);
    });
  }
  return versaoAtual(db);
}
```

- [ ] **Step 4: Ajustar o teste de corrida**: em `test/migracao.test.js`, no teste `migrar relê a versão dentro da transação e não reaplica`, a migração falsa passa a ser a 4 (a 3 agora existe). Trocar estes quatro trechos:

```js
    const falsa = { versao: 4, aplicar() { aplicacoes++; } };
```
```js
          b.exec("INSERT INTO schema_versao (versao, aplicada_em) VALUES (4, datetime('now'))");
```
```js
    assert.equal(migrar(comCorrida, [falsa]), 4);
```
```js
    assert.equal(a.prepare('SELECT COUNT(*) n FROM schema_versao WHERE versao = 4').get().n, 1);
```

(antes: `versao: 3`, `VALUES (3,`, `), 3);`, `versao = 3`).

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: `ℹ tests 89`, `ℹ pass 89`, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/migracoes/003-revenda.js src/migracoes/index.js test/revenda-migracao.test.js test/migracao.test.js
git commit -m "Migracao v3 da Revenda: colunas FIPE/Mobiauto, tabelas novas e premissas, sem tocar no historico

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Leitor da FIPE

**Files:**
- Create: `src/revenda/fipe.js`, `test/revenda-fipe.test.js`
- Test fixtures (já salvas): `test/fixtures/fipe-referencias-2026-10-28.json`, `fipe-polo-2025-ref326.json`, `fipe-polo-2025-ref338.json`, `fipe-polo-0km-ref326.json`, `fipe-nada.json`

**Interfaces:**
- Consumes: `UA`, `TEMPO_LIMITE_MS` (`src/coletores/http.js`); `resposta(corpo, {status})` (`test/ajuda.js`).
- Produces: `referencias(buscar = fetch): Promise<{codigo: number, mes: 'YYYY-MM'}[]>` · `valor({ codigoReferencia, marca, modelo, ano, combustivel }, buscar = fetch): Promise<{ valor, codigo_fipe, ano_modelo, referencia } | null>` (null = nada encontrado) · `mesDeTexto(s)`, `valorEmReais(s)`, `lerReferencias(json)`, `lerValor(json)`.

- [ ] **Step 1: Teste que falha**: `test/revenda-fipe.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resposta } from './ajuda.js';
import { mesDeTexto, valorEmReais, lerReferencias, lerValor, referencias, valor } from '../src/revenda/fipe.js';

const fixture = nome => JSON.parse(readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), 'utf8'));

test('mesDeTexto entende os dois formatos da FIPE', () => {
  assert.equal(mesDeTexto('outubro/2026 '), '2026-10');
  assert.equal(mesDeTexto('outubro de 2025 '), '2025-10');
  assert.equal(mesDeTexto('março/2024'), '2024-03');
  assert.equal(mesDeTexto('13/2024'), null);
});

test('valorEmReais tira pontos e vírgula', () => {
  assert.equal(valorEmReais('R$ 77.170,00'), 77170);
  assert.equal(valorEmReais('R$ 186.990,50'), 186990.5);
  assert.equal(valorEmReais('sem valor'), null);
});

test('referências salvas em 28/10: 338 é out/2026 e 326 é out/2025', () => {
  const refs = lerReferencias(fixture('fipe-referencias-2026-10-28.json'));
  assert.equal(refs.length, 40);
  assert.deepEqual(refs[0], { codigo: 338, mes: '2026-10' });
  assert.deepEqual(refs.find(r => r.codigo === 326), { codigo: 326, mes: '2025-10' });
});

test('valor do Polo Track 2025 em out/2025 e out/2026, zero km e nada encontrado', () => {
  assert.deepEqual(lerValor(fixture('fipe-polo-2025-ref326.json')), { valor: 77170, codigo_fipe: '005540-9', ano_modelo: 2025, referencia: '2025-10' });
  assert.deepEqual(lerValor(fixture('fipe-polo-2025-ref338.json')), { valor: 73674, codigo_fipe: '005540-9', ano_modelo: 2025, referencia: '2026-10' });
  assert.deepEqual(lerValor(fixture('fipe-polo-0km-ref326.json')), { valor: 86668, codigo_fipe: '005540-9', ano_modelo: 32000, referencia: '2025-10' });
  assert.equal(lerValor(fixture('fipe-nada.json')), null);
  assert.throws(() => lerValor({ Valor: '???' }), /resposta inesperada/);
});

test('consulta manda o formulário e os cabeçalhos que a FIPE exige', async () => {
  const pedidos = [];
  const buscar = async (url, op) => { pedidos.push({ url, op }); return resposta(fixture('fipe-polo-2025-ref338.json')); };
  const v = await valor({ codigoReferencia: 338, marca: 59, modelo: 10176, ano: 2025, combustivel: 5 }, buscar);
  assert.equal(v.valor, 73674);
  const { url, op } = pedidos[0];
  assert.equal(url, 'https://veiculos.fipe.org.br/api/veiculos/ConsultarValorComTodosParametros');
  assert.equal(op.method, 'POST');
  assert.equal(op.headers.Referer, 'https://veiculos.fipe.org.br/');
  assert.equal(op.headers['X-Requested-With'], 'XMLHttpRequest');
  const form = Object.fromEntries(new URLSearchParams(op.body));
  assert.deepEqual(form, {
    codigoTabelaReferencia: '338', codigoMarca: '59', codigoModelo: '10176', codigoTipoVeiculo: '1', anoModelo: '2025',
    codigoTipoCombustivel: '5', tipoVeiculo: 'carro', modeloCodigoExterno: '', tipoConsulta: 'tradicional',
  });
});

test('referencias() lê a lista e erro HTTP vira exceção com o status', async () => {
  const refs = await referencias(async () => resposta(fixture('fipe-referencias-2026-10-28.json')));
  assert.equal(refs[1].mes, '2026-09');
  await assert.rejects(referencias(async () => resposta('x', { status: 429 })), /FIPE respondeu 429/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --experimental-sqlite --test test/revenda-fipe.test.js`
Expected: FAIL, `Cannot find module '.../src/revenda/fipe.js'`.

- [ ] **Step 3: Implementar**: `src/revenda/fipe.js`:

```js
// FIPE oficial (veiculos.fipe.org.br): histórico livre, uma consulta por preço.
// Sem resultado a FIPE devolve {"codigo":"0","erro":"nadaencontrado"}: vira null, não erro.
import { UA, TEMPO_LIMITE_MS } from '../coletores/http.js';

const BASE = 'https://veiculos.fipe.org.br/api/veiculos';
const NOMES = { janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

// "outubro/2026 " ou "outubro de 2025 " → "2026-10"
export function mesDeTexto(texto) {
  const m = String(texto ?? '').trim().toLowerCase().match(/^([a-zç]+)(?:\/|\s+de\s+)(\d{4})$/);
  if (!m || !NOMES[m[1]]) return null;
  return `${m[2]}-${String(NOMES[m[1]]).padStart(2, '0')}`;
}

// "R$ 77.170,00" → 77170
export function valorEmReais(texto) {
  const m = String(texto ?? '').match(/R\$\s*([\d.]+,\d{2})/);
  return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null;
}

export function lerReferencias(json) {
  if (!Array.isArray(json)) throw new Error('FIPE: lista de referências em formato inesperado');
  return json.map(x => ({ codigo: Number(x.Codigo), mes: mesDeTexto(x.Mes) })).filter(x => x.codigo > 0 && x.mes);
}

export function lerValor(json) {
  if (json?.erro === 'nadaencontrado') return null;
  const valor = valorEmReais(json?.Valor);
  if (valor == null) throw new Error(`FIPE: resposta inesperada ${JSON.stringify(json).slice(0, 80)}`);
  return { valor, codigo_fipe: json.CodigoFipe ?? null, ano_modelo: Number(json.AnoModelo), referencia: mesDeTexto(json.MesReferencia) };
}

async function postar(buscar, caminho, campos) {
  const r = await buscar(`${BASE}/${caminho}`, {
    method: 'POST',
    headers: {
      'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Referer: 'https://veiculos.fipe.org.br/', 'X-Requested-With': 'XMLHttpRequest',
    },
    body: new URLSearchParams(campos).toString(),
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  });
  if (!r.ok) throw new Error(`FIPE respondeu ${r.status}`);
  return r.json();
}

export async function referencias(buscar = fetch) {
  return lerReferencias(await postar(buscar, 'ConsultarTabelaDeReferencia', {}));
}

// codigoReferencia: 338 = out/2026; ano: 32000 = zero km; combustivel: 5 Flex, 4 Elétrico, 6 Híbrido
export async function valor({ codigoReferencia, marca, modelo, ano, combustivel }, buscar = fetch) {
  return lerValor(await postar(buscar, 'ConsultarValorComTodosParametros', {
    codigoTabelaReferencia: codigoReferencia, codigoMarca: marca, codigoModelo: modelo, codigoTipoVeiculo: 1,
    anoModelo: ano, codigoTipoCombustivel: combustivel, tipoVeiculo: 'carro', modeloCodigoExterno: '', tipoConsulta: 'tradicional',
  }));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --experimental-sqlite --test test/revenda-fipe.test.js` → `ℹ pass 6`. Depois `npm test` → `ℹ tests 95`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/revenda/fipe.js test/revenda-fipe.test.js
git commit -m "Revenda: leitor da FIPE oficial (referencias e valor por codigo, nada encontrado vira null)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Leitor da Mobiauto

**Files:**
- Create: `src/revenda/mobiauto.js`, `test/revenda-mobiauto.test.js`
- Test fixtures (já salvas): `test/fixtures/mobiauto-polo-p1-2026-10-28.json`, `mobiauto-polo-p2-2026-10-28.json`, `mobiauto-pagina-minima.html`

**Interfaces:**
- Consumes: `pegar(buscar, url, rotulo, 'html')` (`src/coletores/http.js`, User-Agent de navegador de mesa).
- Produces: `anuncios({ caminho, versao, anoMin, maxPaginas = 40, pausaMs = 2000 }, buscar = fetch): Promise<Anuncio[]>` com `Anuncio = { id_externo: 'mobiauto:<id>', versao, ano_modelo, ano_fabricacao, km, preco, loja }` · `lerPagina(html): { numResults, results }` · `filtrar(results, { versao, anoMin }): Anuncio[]` · `urlPagina(caminho, n)` · `POR_PAGINA = 24`.

- [ ] **Step 1: Teste que falha**: `test/revenda-mobiauto.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resposta } from './ajuda.js';
import { urlPagina, lerPagina, filtrar, anuncios } from '../src/revenda/mobiauto.js';

const texto = nome => readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), 'utf8');
const deals = p => JSON.parse(texto(`mobiauto-polo-p${p}-2026-10-28.json`));
// As páginas reais foram salvas só com o deals; aqui viram HTML de novo, como o site entrega.
const comoHtml = d => `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { deals: d } } })}</script></body></html>`;

test('urlPagina: a primeira sem sufixo, as outras com /pagina-N', () => {
  assert.equal(urlPagina('volkswagen/polo', 1), 'https://www.mobiauto.com.br/comprar/carros/sp/volkswagen/polo');
  assert.equal(urlPagina('volkswagen/polo', 2), 'https://www.mobiauto.com.br/comprar/carros/sp/volkswagen/polo/pagina-2');
});

test('lerPagina tira o deals do __NEXT_DATA__', () => {
  const d = lerPagina(texto('mobiauto-pagina-minima.html'));
  assert.equal(d.numResults, 4);
  assert.equal(d.results.length, 4);
  assert.throws(() => lerPagina('<html></html>'), /sem __NEXT_DATA__/);
});

test('filtrar deixa só usado, do ano mínimo em diante e da versão pedida', () => {
  const { results } = lerPagina(texto('mobiauto-pagina-minima.html'));
  assert.deepEqual(filtrar(results, { versao: '^Track', anoMin: 2023 }), [
    { id_externo: 'mobiauto:33144909', versao: 'Track 1.0 Flex 12V 5p', ano_modelo: 2025, ano_fabricacao: 2024, km: 51460, preco: 74870, loja: 'Loja A' },
  ]);
  assert.equal(filtrar(results, { versao: null, anoMin: 2020 }).length, 3);
  assert.equal(filtrar(results, { versao: 'track', anoMin: 2020 }).length, 2, 'sem diferenciar maiúsculas');
});

test('páginas reais de 28/10: Polo Track de 2023 em diante', () => {
  const p1 = filtrar(deals(1).results, { versao: '^Track', anoMin: 2023 });
  const p2 = filtrar(deals(2).results, { versao: '^Track', anoMin: 2023 });
  assert.equal(deals(1).numResults, 3073);
  assert.equal(p1.length, 10);
  assert.equal(p2.length, 17);
  assert.ok(p1.every(a => /^Track/.test(a.versao) && a.ano_modelo >= 2023));
});

test('anuncios percorre as páginas, junta repetidos e para na página vazia', async () => {
  const pedidos = [];
  const buscar = async url => {
    pedidos.push(url);
    if (url.endsWith('/polo')) return resposta(comoHtml(deals(1)));
    if (url.endsWith('/pagina-2')) return resposta(comoHtml(deals(2)));
    return resposta(comoHtml({ numResults: 3073, results: [] }));
  };
  const lista = await anuncios({ caminho: 'volkswagen/polo', versao: '^Track', anoMin: 2023, pausaMs: 0 }, buscar);
  assert.deepEqual(pedidos.map(u => u.replace('https://www.mobiauto.com.br/comprar/carros/sp/volkswagen/polo', '')), ['', '/pagina-2', '/pagina-3']);
  assert.equal(lista.length, 26, '10 + 17 com 1 anúncio repetido entre as páginas');
  assert.equal(new Set(lista.map(a => a.id_externo)).size, 26);
});

test('anuncios respeita o limite de páginas e o total de resultados', async () => {
  let n = 0;
  const buscar = async () => { n++; return resposta(comoHtml(deals(1))); };
  await anuncios({ caminho: 'volkswagen/polo', versao: '^Track', anoMin: 2023, maxPaginas: 3, pausaMs: 0 }, buscar);
  assert.equal(n, 3);
  n = 0;
  await anuncios({ caminho: 'x/y', anoMin: 2023, pausaMs: 0 }, async () => { n++; return resposta(texto('mobiauto-pagina-minima.html')); });
  assert.equal(n, 1, 'numResults 4 cabe em uma página');
});

test('erro HTTP da Mobiauto vira exceção', async () => {
  await assert.rejects(anuncios({ caminho: 'x/y', anoMin: 2023, pausaMs: 0 }, async () => resposta('', { status: 403 })), /Mobiauto respondeu 403/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --experimental-sqlite --test test/revenda-mobiauto.test.js`
Expected: FAIL, `Cannot find module '.../src/revenda/mobiauto.js'`.

- [ ] **Step 3: Implementar**: `src/revenda/mobiauto.js`:

```js
// Anúncios da Mobiauto em SP: o JSON da página vem em <script id="__NEXT_DATA__">,
// em props.pageProps.deals. 24 por página; a página N é o caminho "/pagina-N"
// (o parâmetro ?page=N é ignorado pelo site, conferido em 28/10/2026).
import { pegar } from '../coletores/http.js';

export const POR_PAGINA = 24;
const BASE = 'https://www.mobiauto.com.br/comprar/carros/sp';
const espera = ms => new Promise(r => setTimeout(r, ms));

export const urlPagina = (caminho, n) => `${BASE}/${caminho}${n > 1 ? `/pagina-${n}` : ''}`;

export function lerPagina(html) {
  const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Mobiauto: página sem __NEXT_DATA__');
  const deals = JSON.parse(m[1])?.props?.pageProps?.deals;
  if (!deals || !Array.isArray(deals.results)) throw new Error('Mobiauto: página sem a lista de anúncios');
  return { numResults: Number(deals.numResults) || 0, results: deals.results };
}

// Só usados (sem deal0km), de ano-modelo >= anoMin, cuja versão casa com a expressão do modelo.
export function filtrar(results, { versao = null, anoMin }) {
  const re = versao ? new RegExp(versao, 'i') : null;
  return results
    .filter(r => !r.deal0km && Number(r.trim?.model?.year) >= anoMin && Number(r.price) > 0 && Number.isFinite(Number(r.km))
      && (!re || re.test(String(r.trim?.name ?? ''))))
    .map(r => ({
      id_externo: `mobiauto:${r.id}`, versao: r.trim.name, ano_modelo: Number(r.trim.model.year),
      ano_fabricacao: r.trim.productionYear == null ? null : Number(r.trim.productionYear),
      km: Math.round(Number(r.km)), preco: Number(r.price), loja: r.dealer?.name ?? null,
    }));
}

// Percorre as páginas até maxPaginas, até a página vir vazia ou até passar do total.
// Um anúncio que aparece em duas páginas conta uma vez.
export async function anuncios({ caminho, versao = null, anoMin, maxPaginas = 40, pausaMs = 2000 }, buscar = fetch) {
  const vistos = new Map();
  for (let n = 1; n <= maxPaginas; n++) {
    if (n > 1) await espera(pausaMs);
    const { numResults, results } = lerPagina(await pegar(buscar, urlPagina(caminho, n), 'Mobiauto', 'html'));
    if (!results.length) break;
    for (const a of filtrar(results, { versao, anoMin })) vistos.set(a.id_externo, a);
    if (n * POR_PAGINA >= numResults) break;
  }
  return [...vistos.values()];
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --experimental-sqlite --test test/revenda-mobiauto.test.js` → `ℹ pass 7` (10 Track de 2023 em diante na página 1, 17 na 2, 26 sem repetir). Depois `npm test` → `ℹ tests 102`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/revenda/mobiauto.js test/revenda-mobiauto.test.js
git commit -m "Revenda: leitor da Mobiauto (__NEXT_DATA__, paginas /pagina-N, filtro por ano e versao)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Leitor do IPCA

**Files:**
- Create: `src/revenda/ipca.js`, `test/revenda-ipca.test.js`
- Test fixture (já salva): `test/fixtures/bcb-ipca-2026-10-28.json`

**Interfaces:**
- Consumes: `pegar()` (`src/coletores/http.js`).
- Produces: `serie(desde: 'YYYY-MM', buscar = fetch): Promise<{ mes: 'YYYY-MM', variacao: number }[]>` · `lerSerie(json)` · `URL_BCB`.

- [ ] **Step 1: Teste que falha**: `test/revenda-ipca.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resposta } from './ajuda.js';
import { lerSerie, serie } from '../src/revenda/ipca.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/bcb-ipca-2026-10-28.json', import.meta.url), 'utf8'));

test('série salva em 28/10: jan/2024 a set/2026', () => {
  const s = lerSerie(fixture);
  assert.equal(s.length, 33);
  assert.deepEqual(s[0], { mes: '2024-01', variacao: 0.42 });
  assert.deepEqual(s.at(-1), { mes: '2026-09', variacao: 0.82 });
  assert.deepEqual(s.find(x => x.mes === '2026-08'), { mes: '2026-08', variacao: -0.32 });
});

test('linha ilegível é erro, não zero', () => {
  assert.throws(() => lerSerie([{ data: '2026-09-01', valor: '0.82' }]), /linha ilegível/);
  assert.throws(() => lerSerie([{ data: '01/09/2026', valor: null }]), /linha ilegível/);
  assert.throws(() => lerSerie({}), /formato inesperado/);
});

test('serie() pede a partir do primeiro dia do mês', async () => {
  let url;
  const s = await serie('2026-08', async u => { url = u; return resposta(fixture.slice(-2)); });
  assert.equal(url, 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=01/08/2026');
  assert.equal(s.length, 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --experimental-sqlite --test test/revenda-ipca.test.js`
Expected: FAIL, `Cannot find module '.../src/revenda/ipca.js'`.

- [ ] **Step 3: Implementar**: `src/revenda/ipca.js`:

```js
// IPCA mensal do Banco Central (SGS 433): [{"data":"01/09/2026","valor":"0.82"}], em % no mês.
import { pegar } from '../coletores/http.js';

export const URL_BCB = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados';

export function lerSerie(json) {
  if (!Array.isArray(json)) throw new Error('BCB: série em formato inesperado');
  return json.map(x => {
    const m = String(x?.data ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const v = Number(x?.valor);
    if (!m || x?.valor == null || !Number.isFinite(v)) throw new Error(`BCB: linha ilegível ${JSON.stringify(x)}`);
    return { mes: `${m[3]}-${m[2]}`, variacao: v };
  });
}

// desde: "YYYY-MM"
export async function serie(desde, buscar = fetch) {
  const [ano, mes] = desde.split('-');
  return lerSerie(await pegar(buscar, `${URL_BCB}?formato=json&dataInicial=01/${mes}/${ano}`, 'BCB'));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --experimental-sqlite --test test/revenda-ipca.test.js` → `ℹ pass 3`. Depois `npm test` → `ℹ tests 105`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/revenda/ipca.js test/revenda-ipca.test.js
git commit -m "Revenda: leitor do IPCA mensal do BCB (SGS 433)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Método do estudo (funções puras)

**Files:**
- Create: `src/revenda/estudo.js`, `test/sinteticos.js`, `test/revenda-estudo.test.js`

**Interfaces:**
- Consumes: nada do banco nem da rede.
- Produces (todas em `src/revenda/estudo.js`):
  - constantes `MESES = [6, 12, 18, 24]`, `MIN_R = 6`, `MIN_ANUNCIOS = 30`, `JANELA = 24`, `ZERO_KM = 32000`, `CANAIS = ['atacado', 'varejo', 'motorista']`
  - `quantil(lista, q)`, `mediana(lista)`, `somarMeses('YYYY-MM', n)`, `idade(anoModelo, 'YYYY-MM-DD')`
  - `indexarFipe(linhas: {ano_modelo, referencia, valor}[]): Map<ref, Map<ano, valor>>`, `anoZeroKm(porAno)`
  - `observacoesR(linhasFipe, m, ipca: Map<mes, variacao>, janela?) : {t, r, real}[]`, `resumirR(obs, emprestado = null): {p25, p50, p75, real_p50, n, emprestado}`
  - `minimosQuadrados(X, y): number[]`, `ajustarKm(anuncios, hoje): {a, b, c, residuos}`
  - `calcularEstudo({ fipe, fipeRef, anuncios, ipca, hoje })` e `emprestar(estudos[])`, que devolvem o `dados` do estudo: `{ r: {6,12,18,24: {p25,p50,p75,real_p50,n,emprestado}|null}, km: {a,b,c,fator_10mil,km_tipico,n,emprestado}, residuos: {q10,q90}, anuncio_sobre_fipe, fipe_0km_atual, referencia, n_fipe, r_emprestado, km_emprestado }`
  - `interpolarR(r, meses)`, `multiplicadorCanal(dados, canal, premissas)`
  - `projetar(dados, { meses, km, canal, preco = null }, premissas): { p10, p50, p90: {nominal, real, pct, pct_real}, preco, preco_informado, r_p50, r_real_p50, fator_km, multiplicador }` (`pct` é fração do preço de compra: 0,784 = 78,4%)
- Produces (`test/sinteticos.js`): `fipeSintetica({de, ate, q, base, marca, modelo})` (com ela `r_m = q^m` exato), `ipcaSintetico({de, ate, variacao})`, `anunciosSinteticos({a, b, c, hoje, anos, kms, desvios})` (regressão devolve a, b, c exatos e resíduos = desvios).

- [ ] **Step 1: Dados sintéticos**: `test/sinteticos.js`:

```js
// Dados sintéticos com coeficientes conhecidos para o estudo de revenda.
import { somarMeses, idade } from '../src/revenda/estudo.js';

// FIPE em que r_m = q^m exato: o ano A vale base·q^(meses desde jan de A + 1) e o zero km (32000)
// vale o mesmo que o ano do zero km daquela referência. Anos de Y−3 a Y em cada referência Y.
export function fipeSintetica({ de = '2023-11', ate = '2026-10', q = 0.99, base = 100000, marca = 59, modelo = 10176 } = {}) {
  const linhas = [];
  for (let s = de; s <= ate; s = somarMeses(s, 1)) {
    const Y = Number(s.slice(0, 4));
    const valor = A => base * q ** ((Y - A) * 12 + Number(s.slice(5, 7)));
    for (let A = Y - 3; A <= Y; A++) linhas.push({ fipe_marca: marca, fipe_modelo: modelo, ano_modelo: A, referencia: s, valor: valor(A) });
    linhas.push({ fipe_marca: marca, fipe_modelo: modelo, ano_modelo: 32000, referencia: s, valor: valor(Y) });
  }
  return linhas;
}

// IPCA constante (em % no mês) de `de` até `ate`.
export function ipcaSintetico({ de = '2023-01', ate = '2026-09', variacao = 0.5 } = {}) {
  const m = new Map();
  for (let s = de; s <= ate; s = somarMeses(s, 1)) m.set(s, variacao);
  return m;
}

// ln(preço) = a + b·idade + c·km/10.000 + desvio. Cada combinação (ano, km) leva os mesmos
// desvios, que somam zero: a regressão devolve a, b, c exatos e os resíduos são os desvios.
export function anunciosSinteticos({ a = 11.5, b = -0.1, c = -0.03, hoje = '2026-10-28', anos = [2024, 2025, 2026], kms = [10000, 30000, 50000, 70000], desvios = [-0.1, -0.05, 0, 0.05, 0.1] } = {}) {
  const lista = [];
  let id = 1;
  for (const ano of anos) for (const km of kms) for (const e of desvios) {
    lista.push({ id_externo: `mobiauto:${id++}`, versao: 'Track 1.0', ano_modelo: ano, ano_fabricacao: ano - 1, km, preco: Math.exp(a + b * idade(ano, hoje) + c * km / 10000 + e), loja: null });
  }
  return lista;
}
```

- [ ] **Step 2: Teste que falha**: `test/revenda-estudo.test.js`:

```js
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --experimental-sqlite --test test/revenda-estudo.test.js`
Expected: FAIL, `Cannot find module '.../src/revenda/estudo.js'`.

- [ ] **Step 4: Implementar**: `src/revenda/estudo.js`:

```js
// O método da spec (seção 6), em funções puras: desvalorização pela FIPE, efeito do km
// e dispersão pelos anúncios, projeção por canal. Sem banco e sem rede.

export const MESES = [6, 12, 18, 24];
export const MIN_R = 6;            // observações de r_m para o código valer sozinho
export const MIN_ANUNCIOS = 30;    // anúncios para a regressão do km
export const JANELA = 24;          // r_m dos últimos 24 meses (pela referência final t+m)
export const ZERO_KM = 32000;
export const CANAIS = ['atacado', 'varejo', 'motorista'];

// Quantil com interpolação linear entre vizinhos (o "tipo 7" do R e do Excel).
export function quantil(lista, q) {
  const s = lista.filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const mediana = lista => quantil(lista, 0.5);
const media = l => (l.length ? l.reduce((s, v) => s + v, 0) / l.length : null);

// "2026-10" + 3 → "2027-01"
export function somarMeses(mes, n) {
  const total = Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

// idade = ano corrente + mês corrente/12 − ano-modelo (hoje: "YYYY-MM-DD")
export const idade = (anoModelo, hoje) => Number(hoje.slice(0, 4)) + Number(hoje.slice(5, 7)) / 12 - anoModelo;

// linhas [{ano_modelo, referencia, valor}] → Map referencia → Map ano → valor
export function indexarFipe(linhas) {
  const idx = new Map();
  for (const l of linhas) {
    if (!idx.has(l.referencia)) idx.set(l.referencia, new Map());
    idx.get(l.referencia).set(l.ano_modelo, l.valor);
  }
  return idx;
}

// O ano do zero km numa referência: o maior ano-modelo com preço, fora o 32000.
export function anoZeroKm(porAno) {
  const anos = [...porAno.keys()].filter(a => a !== ZERO_KM);
  return anos.length ? Math.max(...anos) : null;
}

// r_m(t) = FIPE(ano do 0 km em t, t+m) / FIPE(32000, t), com t+m dentro dos últimos `janela` meses.
// real = r / (1 + IPCA acumulado de t+1 a t+m); null se faltar algum mês do IPCA.
export function observacoesR(linhas, m, ipca, janela = JANELA) {
  const idx = indexarFipe(linhas);
  const refs = [...idx.keys()].sort();
  if (!refs.length) return [];
  const ultima = refs.at(-1);
  const limite = somarMeses(ultima, -janela);
  const obs = [];
  for (const t of refs) {
    const fim = somarMeses(t, m);
    if (fim > ultima || fim <= limite || !idx.has(fim)) continue;
    const emT = idx.get(t);
    const zero = emT.get(ZERO_KM);
    const ano = anoZeroKm(emT);
    const depois = ano == null ? null : idx.get(fim).get(ano);
    if (!zero || !depois) continue;
    const r = depois / zero;
    let acumulado = 1;
    for (let k = 1; k <= m && acumulado != null; k++) {
      const v = ipca.get(somarMeses(t, k));
      acumulado = v == null ? null : acumulado * (1 + v / 100);
    }
    obs.push({ t, r, real: acumulado == null ? null : r / acumulado });
  }
  return obs;
}

export function resumirR(obs, emprestado = null) {
  const rs = obs.map(o => o.r);
  const reais = obs.map(o => o.real).filter(v => v != null);
  return { p25: quantil(rs, 0.25), p50: mediana(rs), p75: quantil(rs, 0.75), real_p50: reais.length ? mediana(reais) : null, n: obs.length, emprestado };
}

// Mínimos quadrados pelas equações normais (X'X) β = X'y, resolvidas por eliminação de Gauss.
export function minimosQuadrados(X, y) {
  const k = X[0].length;
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k + 1 }, (_, j) =>
    (j < k ? X.reduce((s, linha) => s + linha[i] * linha[j], 0) : X.reduce((s, linha, n) => s + linha[i] * y[n], 0))));
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let i = col + 1; i < k; i++) if (Math.abs(A[i][col]) > Math.abs(A[piv][col])) piv = i;
    if (Math.abs(A[piv][col]) < 1e-12) throw new Error('regressão sem solução (dados sem variação)');
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let i = 0; i < k; i++) {
      if (i === col) continue;
      const f = A[i][col] / A[col][col];
      for (let j = col; j <= k; j++) A[i][j] -= f * A[col][j];
    }
  }
  return A.map((linha, i) => linha[k] / linha[i]);
}

// ln(preço) = a + b·idade + c·(km/10.000)
export function ajustarKm(anuncios, hoje) {
  const X = anuncios.map(x => [1, idade(x.ano_modelo, hoje), x.km / 10000]);
  const y = anuncios.map(x => Math.log(x.preco));
  const [a, b, c] = minimosQuadrados(X, y);
  return { a, b, c, residuos: X.map((l, i) => y[i] - (a + b * l[1] + c * l[2])) };
}

// Estudo de um modelo só com os dados dele (e do código de referência para a desvalorização).
// Os campos que faltam ficam marcados e são preenchidos depois por emprestar().
export function calcularEstudo({ fipe, fipeRef = null, anuncios, ipca, hoje }) {
  const idx = indexarFipe(fipe);
  const referencia = [...idx.keys()].sort().at(-1) ?? null;
  const r = {};
  for (const m of MESES) {
    const proprias = observacoesR(fipe, m, ipca);
    if (proprias.length >= MIN_R) { r[m] = resumirR(proprias); continue; }
    const daRef = fipeRef ? observacoesR(fipeRef, m, ipca) : [];
    r[m] = daRef.length >= MIN_R ? resumirR(daRef, 'ref') : null;
  }
  const tipicos = anuncios.filter(x => { const i = idade(x.ano_modelo, hoje); return i >= 0.5 && i <= 1.5; }).map(x => x.km);
  let km = { a: null, b: null, c: null, fator_10mil: null, km_tipico: tipicos.length ? mediana(tipicos) : null, n: anuncios.length, emprestado: true };
  let residuos = null;
  if (anuncios.length >= MIN_ANUNCIOS) {
    const aj = ajustarKm(anuncios, hoje);
    km = { ...km, a: aj.a, b: aj.b, c: aj.c, fator_10mil: Math.exp(aj.c) - 1, emprestado: false };
    residuos = { q10: quantil(aj.residuos, 0.1), q90: quantil(aj.residuos, 0.9) };
  }
  const atual = referencia ? idx.get(referencia) : null;
  const razoes = atual ? anuncios.filter(x => idade(x.ano_modelo, hoje) <= 1.5 && atual.get(x.ano_modelo)).map(x => x.preco / atual.get(x.ano_modelo)) : [];
  return {
    r, km, residuos, anuncio_sobre_fipe: razoes.length ? mediana(razoes) : null,
    fipe_0km_atual: atual?.get(ZERO_KM) ?? null, referencia, n_fipe: r[12]?.n ?? 0,
  };
}

// Preenche o que faltou num modelo com os outros: r_m pela mediana dos que têm dados próprios,
// c, km típico, dispersão e razão anúncio/FIPE pela média dos que têm anúncios suficientes.
// Sem nenhum doador: c = 0, sem dispersão e razão 1.
export function emprestar(estudos) {
  const doadoresR = m => estudos.filter(e => e.r[m] && e.r[m].emprestado === null).map(e => e.r[m]);
  const doadoresKm = estudos.filter(e => !e.km.emprestado);
  const mediaDe = f => media(doadoresKm.map(f).filter(v => v != null));
  return estudos.map(e => {
    const r = { ...e.r };
    for (const m of MESES) {
      if (r[m]) continue;
      const d = doadoresR(m);
      r[m] = d.length ? {
        p25: mediana(d.map(x => x.p25)), p50: mediana(d.map(x => x.p50)), p75: mediana(d.map(x => x.p75)),
        real_p50: mediana(d.map(x => x.real_p50).filter(v => v != null)), n: 0, emprestado: 'outros',
      } : null;
    }
    let { km, residuos, anuncio_sobre_fipe } = e;
    if (km.emprestado) {
      const c = mediaDe(x => x.km.c) ?? 0;
      km = { ...km, c, fator_10mil: Math.exp(c) - 1, km_tipico: km.km_tipico ?? mediaDe(x => x.km.km_tipico) };
      residuos = { q10: mediaDe(x => x.residuos.q10) ?? 0, q90: mediaDe(x => x.residuos.q90) ?? 0 };
    }
    if (anuncio_sobre_fipe == null) anuncio_sobre_fipe = mediaDe(x => x.anuncio_sobre_fipe) ?? 1;
    return {
      ...e, r, km, residuos, anuncio_sobre_fipe, n_fipe: r[12]?.n ?? 0,
      r_emprestado: MESES.some(m => r[m]?.emprestado), km_emprestado: km.emprestado,
    };
  });
}

// r para m meses: exato em 6, 12, 18, 24; entre eles, reta entre os vizinhos (0 meses = 1).
export function interpolarR(r, meses) {
  if (!Number.isInteger(meses) || meses < 1 || meses > 24) throw new Error('meses entre 1 e 24');
  if (r[meses]) return r[meses];
  const pontos = [[0, { p25: 1, p50: 1, p75: 1, real_p50: 1 }], ...MESES.filter(m => r[m]).map(m => [m, r[m]])];
  const lo = pontos.filter(([m]) => m < meses).at(-1);
  const hi = pontos.find(([m]) => m > meses);
  if (!lo || !hi) return null;
  const f = (meses - lo[0]) / (hi[0] - lo[0]);
  const entre = k => (lo[1][k] == null || hi[1][k] == null ? null : lo[1][k] + (hi[1][k] - lo[1][k]) * f);
  return { p25: entre('p25'), p50: entre('p50'), p75: entre('p75'), real_p50: entre('real_p50') };
}

export function multiplicadorCanal(dados, canal, premissas) {
  if (canal === 'atacado') return premissas.atacado_pct_base / 100;
  if (canal === 'varejo') return (dados.anuncio_sobre_fipe ?? 1) * (1 - premissas.varejo_negociacao_pct / 100);
  if (canal === 'motorista') return premissas.motorista_pct_base / 100;
  throw new Error('canal deve ser atacado, varejo ou motorista');
}

// Projeção (spec, seção 6). preco: preço de compra; sem ele, o FIPE do zero km do estudo.
export function projetar(dados, { meses, km, canal, preco = null }, premissas) {
  const r = interpolarR(dados.r, meses);
  if (!r) throw new Error('estudo sem desvalorização para esse prazo');
  const P = preco ?? dados.fipe_0km_atual;
  if (!(P > 0)) throw new Error('informe o preço de compra');
  const mult = multiplicadorCanal(dados, canal, premissas);
  const { c, km_tipico } = dados.km;
  const fatorKm = c && km_tipico != null ? Math.exp(c * (km - km_tipico) / 10000) : 1;
  const disp = { p10: Math.exp(dados.residuos?.q10 ?? 0), p50: 1, p90: Math.exp(dados.residuos?.q90 ?? 0) };
  const out = {};
  for (const [q, e] of Object.entries(disp)) {
    const nominal = P * r.p50 * fatorKm * e * mult;
    const real = r.real_p50 == null ? null : P * r.real_p50 * fatorKm * e * mult;
    out[q] = { nominal: Math.round(nominal), real: real == null ? null : Math.round(real), pct: nominal / P, pct_real: real == null ? null : real / P };
  }
  return { ...out, preco: P, preco_informado: preco != null, r_p50: r.p50, r_real_p50: r.real_p50, fator_km: fatorKm, multiplicador: mult };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --experimental-sqlite --test test/revenda-estudo.test.js` → `ℹ pass 12`. Depois `npm test` → `ℹ tests 117`, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/revenda/estudo.js test/sinteticos.js test/revenda-estudo.test.js
git commit -m "Revenda: metodo do estudo (r_m pela FIPE, regressao do km, dispersao, emprestimo, projecao por canal)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Coleta da Revenda na rodada semanal

**Files:**
- Create: `src/coletas.js`, `src/revenda/dados.js`, `src/revenda/coleta.js`, `test/revenda-coleta.test.js`
- Modify: `src/coleta.js` (inteiro abaixo), `src/dependencias.js` (inteiro abaixo), `test/coleta.test.js:127-128`

**Interfaces:**
- Consumes: `transacao()` (`src/db.js`); `lerReferencias()` (Task 2, só no teste); `calcularEstudo()`, `emprestar()`, `somarMeses()` (Task 5); `fipeSintetica`, `ipcaSintetico`, `anunciosSinteticos` (Task 5); módulos `fipe`, `mobiauto`, `ipca` (Tasks 2 a 4).
- Produces:
  - `src/coletas.js`: `novaColeta(db, fonte, origem): id`, `fecharColeta(db, id, {status, modelos_ok, itens, mudancas, erro})`, `alertaFalha(db, coletaId, texto, modeloId = null)`.
  - `src/revenda/dados.js`: `anoDe(data)`, `modelosComFipe(db)`, `codigosFipe(db): {marca, modelo, combustivel}[]`, `linhasFipe(db, fipeModelo)`, `ultimaReferencia(db, fipeModelo)`, `gravarFipe(db, linhas)`, `gravarAnuncios(db, modeloId, lista, data)`, `anunciosRecentes(db, modeloId, data, dias = 60)`, `gravarIpca(db, serie)`, `ultimoIpca(db)`, `mapaIpca(db)`, `premissasComData(db)`, `lerPremissas(db): {chave: valor}`, `recalcularEstudos(db, data): número de modelos`, `ultimoEstudo(db, modeloId, ate = null): { id, calculado_em, dados } | null`.
  - `src/revenda/coleta.js`: `rodarRevenda(db, { fipe, mobiauto, ipca, data, origem = 'agenda', pausaFipeMs = 1000, pausaPaginaMs = 2000 }): { ipca, fipe, mobiauto, estudos }` (cada fonte `{status, itens, modelos_ok, total, erros}`); `coletarIpca`, `coletarFipe`, `coletarAnuncios`; `REFERENCIAS_INICIAIS = 36`. As dependências têm a forma dos módulos: `fipe.referencias()`, `fipe.valor(p)`, `mobiauto.anuncios(p)`, `ipca.serie(desde)`.
  - `src/coleta.js`: `rodarColeta(db, { ..., revenda = null })`, resumo ganha `revenda`; `TRAVA_MINUTOS = 120`.
  - `src/dependencias.js`: `dependencias(env).revenda = { fipe, mobiauto, ipca }`.

- [ ] **Step 1: Teste que falha**: `test/revenda-coleta.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bancoNovo } from './ajuda.js';
import { fipeSintetica, ipcaSintetico, anunciosSinteticos } from './sinteticos.js';
import { lerReferencias } from '../src/revenda/fipe.js';
import { rodarRevenda } from '../src/revenda/coleta.js';
import { rodarColeta } from '../src/coleta.js';
import { ultimoEstudo } from '../src/revenda/dados.js';

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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --experimental-sqlite --test test/revenda-coleta.test.js`
Expected: FAIL, `Cannot find module '.../src/revenda/coleta.js'`.

- [ ] **Step 3: Registro das coletas**: `src/coletas.js`:

```js
// Registro das coletas (uma linha por fonte e rodada) e alerta de falha: usados pela
// rodada das Revisões e pela da Revenda.
export const novaColeta = (db, fonte, origem) =>
  Number(db.prepare("INSERT INTO coletas (fonte, inicio, origem) VALUES (?, datetime('now'), ?)").run(fonte, origem).lastInsertRowid);

export function fecharColeta(db, id, c) {
  db.prepare("UPDATE coletas SET fim = datetime('now'), status = ?, modelos_ok = ?, itens = ?, mudancas = ?, erro = ? WHERE id = ?")
    .run(c.status, c.modelos_ok ?? 0, c.itens ?? 0, c.mudancas ?? 0, c.erro ?? null, id);
}

export function alertaFalha(db, coletaId, texto, modeloId = null) {
  db.prepare("INSERT INTO alertas (coleta_id, tipo, modelo_id, texto) VALUES (?, 'falha', ?, ?)").run(coletaId, modeloId, texto);
}
```

- [ ] **Step 4: Banco da Revenda**: `src/revenda/dados.js`:

```js
// Leituras e escritas da Revenda no banco. Síncronas: quem grava envolve em transacao().
import { calcularEstudo, emprestar } from './estudo.js';

export const anoDe = data => Number(String(data).slice(0, 4));

export const modelosComFipe = db =>
  db.prepare('SELECT * FROM modelos WHERE ativo = 1 AND fipe_modelo IS NOT NULL ORDER BY id').all();

// Códigos FIPE distintos entre fipe_modelo e fipe_modelo_ref dos modelos ativos
// (o código de referência usa a marca e o combustível do modelo que aponta para ele).
export function codigosFipe(db) {
  const vistos = new Map();
  const modelos = modelosComFipe(db);
  for (const m of modelos) vistos.set(m.fipe_modelo, { marca: m.fipe_marca, modelo: m.fipe_modelo, combustivel: m.fipe_combustivel });
  for (const m of modelos) {
    if (m.fipe_modelo_ref && !vistos.has(m.fipe_modelo_ref)) vistos.set(m.fipe_modelo_ref, { marca: m.fipe_marca, modelo: m.fipe_modelo_ref, combustivel: m.fipe_combustivel });
  }
  return [...vistos.values()];
}

export const linhasFipe = (db, fipeModelo) =>
  db.prepare('SELECT ano_modelo, referencia, valor FROM fipe_precos WHERE fipe_modelo = ? ORDER BY referencia, ano_modelo').all(fipeModelo);

export const ultimaReferencia = (db, fipeModelo) =>
  db.prepare('SELECT MAX(referencia) r FROM fipe_precos WHERE fipe_modelo = ?').get(fipeModelo).r;

export function gravarFipe(db, linhas) {
  const ins = db.prepare(`INSERT INTO fipe_precos (fipe_marca, fipe_modelo, ano_modelo, referencia, valor, codigo_fipe) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (fipe_modelo, ano_modelo, referencia) DO UPDATE SET valor = excluded.valor, codigo_fipe = excluded.codigo_fipe`);
  for (const l of linhas) ins.run(l.fipe_marca, l.fipe_modelo, l.ano_modelo, l.referencia, l.valor, l.codigo_fipe ?? null);
  return linhas.length;
}

// Anúncio já conhecido: atualiza preço, km e último visto; primeiro visto fica.
export function gravarAnuncios(db, modeloId, lista, data) {
  const ins = db.prepare(`INSERT INTO anuncios (id_externo, modelo_id, versao, ano_modelo, ano_fabricacao, km, preco, loja, primeiro_visto, ultimo_visto)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id_externo) DO UPDATE SET preco = excluded.preco, km = excluded.km, ultimo_visto = excluded.ultimo_visto`);
  for (const a of lista) ins.run(a.id_externo, modeloId, a.versao, a.ano_modelo, a.ano_fabricacao, a.km, a.preco, a.loja, data, data);
  return lista.length;
}

export const anunciosRecentes = (db, modeloId, data, dias = 60) =>
  db.prepare("SELECT * FROM anuncios WHERE modelo_id = ? AND ultimo_visto >= date(?, ?) ORDER BY id_externo").all(modeloId, data, `-${dias} days`);

export function gravarIpca(db, serie) {
  const ins = db.prepare('INSERT INTO ipca (mes, variacao) VALUES (?, ?) ON CONFLICT (mes) DO UPDATE SET variacao = excluded.variacao');
  for (const s of serie) ins.run(s.mes, s.variacao);
  return serie.length;
}

export const ultimoIpca = db => db.prepare('SELECT MAX(mes) m FROM ipca').get().m;
export const mapaIpca = db => new Map(db.prepare('SELECT mes, variacao FROM ipca').all().map(x => [x.mes, x.variacao]));

export const premissasComData = db => db.prepare('SELECT chave, valor, atualizado_em FROM premissas ORDER BY chave').all();
export const lerPremissas = db => Object.fromEntries(premissasComData(db).map(p => [p.chave, p.valor]));

// Um estudo por modelo com código FIPE; os que faltam dados pegam emprestado dos outros.
export function recalcularEstudos(db, data) {
  const ipca = mapaIpca(db);
  const modelos = modelosComFipe(db);
  const parciais = modelos.map(m => calcularEstudo({
    fipe: linhasFipe(db, m.fipe_modelo),
    fipeRef: m.fipe_modelo_ref ? linhasFipe(db, m.fipe_modelo_ref) : null,
    anuncios: anunciosRecentes(db, m.id, data),
    ipca, hoje: data,
  }));
  const finais = emprestar(parciais);
  const ins = db.prepare('INSERT INTO estudos (modelo_id, calculado_em, dados) VALUES (?, ?, ?)');
  modelos.forEach((m, i) => ins.run(m.id, data, JSON.stringify(finais[i])));
  return modelos.length;
}

// O estudo mais recente do modelo (até a data, se informada; senão o primeiro que existir depois dela).
export function ultimoEstudo(db, modeloId, ate = null) {
  const linha = ate
    ? db.prepare('SELECT * FROM estudos WHERE modelo_id = ? AND calculado_em <= ? ORDER BY calculado_em DESC, id DESC LIMIT 1').get(modeloId, ate)
      ?? db.prepare('SELECT * FROM estudos WHERE modelo_id = ? ORDER BY calculado_em, id LIMIT 1').get(modeloId)
    : db.prepare('SELECT * FROM estudos WHERE modelo_id = ? ORDER BY id DESC LIMIT 1').get(modeloId);
  return linha ? { id: linha.id, calculado_em: linha.calculado_em, dados: JSON.parse(linha.dados) } : null;
}
```

- [ ] **Step 5: Rodada da Revenda**: `src/revenda/coleta.js`:

```js
// Parte da rodada semanal que alimenta a Revenda: IPCA, FIPE, anúncios e estudos.
// Cada fonte vira uma linha em coletas; falha vira alerta e não impede as outras.
import { transacao } from '../db.js';
import { novaColeta, fecharColeta, alertaFalha } from '../coletas.js';
import { somarMeses } from './estudo.js';
import {
  anoDe, codigosFipe, ultimaReferencia, gravarFipe, gravarAnuncios, gravarIpca, ultimoIpca, recalcularEstudos,
} from './dados.js';

export const REFERENCIAS_INICIAIS = 36;
const espera = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());
const curto = e => String(e?.message ?? e).slice(0, 140);

async function comRetentativa(fn, pausaMs) {
  try {
    return await fn();
  } catch {
    await espera(pausaMs * 5);
    return await fn();
  }
}

// Baixa a série desde o último mês salvo quando ele é anterior ao mês passado.
export async function coletarIpca(db, ipca, { data }) {
  const ultimo = ultimoIpca(db);
  if (ultimo && ultimo >= somarMeses(data.slice(0, 7), -1)) return { itens: 0, modelos_ok: 1, total: 1, erros: [] };
  const serie = await ipca.serie(ultimo ?? `${anoDe(data) - 4}-01`);
  transacao(db, () => gravarIpca(db, serie));
  return { itens: serie.length, modelos_ok: 1, total: 1, erros: [] };
}

// Para cada código: as referências mais novas que a última salva (na primeira vez, as 36 últimas),
// da mais antiga para a mais nova, anos de (ano da referência − 3) a (+1) e o zero km.
// Uma consulta por pausaMs; cada referência é gravada inteira numa transação.
export async function coletarFipe(db, fipe, { pausaMs = 1000, iniciais = REFERENCIAS_INICIAIS, coletaId }) {
  const refs = (await fipe.referencias()).sort((a, b) => a.mes.localeCompare(b.mes)).slice(-iniciais);
  if (!refs.length) throw new Error('FIPE sem tabelas de referência');
  const codigos = codigosFipe(db);
  let itens = 0, ok = 0;
  const erros = [];
  for (const cod of codigos) {
    const ultima = ultimaReferencia(db, cod.modelo);
    try {
      for (const ref of refs.filter(r => !ultima || r.mes > ultima)) {
        const Y = anoDe(ref.mes);
        const linhas = [];
        for (const ano of [Y - 3, Y - 2, Y - 1, Y, Y + 1, 32000]) {
          await espera(pausaMs);
          const v = await comRetentativa(() => fipe.valor({ codigoReferencia: ref.codigo, marca: cod.marca, modelo: cod.modelo, ano, combustivel: cod.combustivel }), pausaMs);
          if (v) linhas.push({ fipe_marca: cod.marca, fipe_modelo: cod.modelo, ano_modelo: ano, referencia: ref.mes, valor: v.valor, codigo_fipe: v.codigo_fipe });
        }
        itens += transacao(db, () => gravarFipe(db, linhas));
      }
      ok++;
    } catch (e) {
      erros.push(`${cod.modelo}: ${curto(e)}`);
      alertaFalha(db, coletaId, `FIPE ${cod.modelo}: ${curto(e)}`);
    }
  }
  return { itens, modelos_ok: ok, total: codigos.length, erros };
}

export async function coletarAnuncios(db, mobiauto, { data, pausaMs = 2000, maxPaginas = 40, coletaId }) {
  const modelos = db.prepare('SELECT * FROM modelos WHERE ativo = 1 AND mobiauto_caminho IS NOT NULL ORDER BY id').all();
  let itens = 0, ok = 0;
  const erros = [];
  for (const [i, m] of modelos.entries()) {
    if (i > 0) await espera(pausaMs);
    try {
      const lista = await mobiauto.anuncios({ caminho: m.mobiauto_caminho, versao: m.mobiauto_versao, anoMin: anoDe(data) - 3, maxPaginas, pausaMs });
      itens += transacao(db, () => gravarAnuncios(db, m.id, lista, data));
      ok++;
    } catch (e) {
      erros.push(`${m.nome}: ${curto(e)}`);
      alertaFalha(db, coletaId, `Mobiauto: ${curto(e)}`, m.id);
    }
  }
  return { itens, modelos_ok: ok, total: modelos.length, erros };
}

const ROTULO = { ipca: 'IPCA', fipe: 'FIPE', mobiauto: 'Mobiauto' };

async function umaFonte(db, fonte, origem, fn) {
  const id = novaColeta(db, fonte, origem);
  try {
    const r = await fn(id);
    const status = !r.erros.length ? 'ok' : r.modelos_ok > 0 ? 'parcial' : 'falha';
    fecharColeta(db, id, { status, modelos_ok: r.modelos_ok, itens: r.itens, erro: r.erros.join(' | ') || null });
    return { status, ...r };
  } catch (e) {
    alertaFalha(db, id, `${ROTULO[fonte]}: ${curto(e)}`);
    fecharColeta(db, id, { status: 'falha', erro: curto(e) });
    return { status: 'falha', erro: curto(e) };
  }
}

export async function rodarRevenda(db, { fipe = null, mobiauto = null, ipca = null, data, origem = 'agenda', pausaFipeMs = 1000, pausaPaginaMs = 2000 }) {
  const resumo = { ipca: null, fipe: null, mobiauto: null, estudos: 0 };
  if (ipca) resumo.ipca = await umaFonte(db, 'ipca', origem, () => coletarIpca(db, ipca, { data }));
  if (fipe) resumo.fipe = await umaFonte(db, 'fipe', origem, id => coletarFipe(db, fipe, { pausaMs: pausaFipeMs, coletaId: id }));
  if (mobiauto) resumo.mobiauto = await umaFonte(db, 'mobiauto', origem, id => coletarAnuncios(db, mobiauto, { data, pausaMs: pausaPaginaMs, coletaId: id }));
  try {
    resumo.estudos = transacao(db, () => recalcularEstudos(db, data));
  } catch (e) {
    resumo.erro_estudo = curto(e);
  }
  return resumo;
}
```

- [ ] **Step 6: Rodada semanal chama a Revenda**: `src/coleta.js` (inteiro; `novaColeta`/`fecharColeta` saem daqui para `src/coletas.js`, a trava vai a 120 minutos e a Revenda roda depois das fontes e antes dos alertas):

```js
// Uma rodada: frota do Ativos, depois cada fonte com os seus modelos ativos,
// depois a Revenda (IPCA, FIPE, anúncios, estudos) e por fim os alertas.
// Uma fonte que falha não impede as outras.
import { transacao } from './db.js';
import { gravarModelo } from './gravar.js';
import { aplicarFrota } from './frota.js';
import { hojeSP } from './datas.js';
import { novaColeta, fecharColeta, alertaFalha } from './coletas.js';
import { rodarRevenda } from './revenda/coleta.js';

let rodando = false;
export const emAndamento = () => rodando;

// A carga inicial da FIPE leva uns 25 minutos: a trava entre processos vale por 2 horas.
export const TRAVA_MINUTOS = 120;

async function rodarFrota(db, buscarFrota, origem) {
  const id = novaColeta(db, 'ativos', origem);
  try {
    const contagem = await buscarFrota();
    const r = transacao(db, () => aplicarFrota(db, contagem, id));
    fecharColeta(db, id, { status: 'ok', modelos_ok: r.modelos, itens: Object.keys(contagem).length });
    return { status: 'ok', ...r };
  } catch (e) {
    alertaFalha(db, id, `Ativos: ${e.message}`);
    fecharColeta(db, id, { status: 'falha', erro: e.message });
    return { status: 'falha', erro: e.message };
  }
}

// Uma segunda tentativa depois de uma pausa: os sites das montadoras erram de vez em quando.
async function coletarComRetentativa(coletor, parametros, pausaMs) {
  try {
    return await coletor.coletar(parametros);
  } catch {
    await new Promise(r => setTimeout(r, pausaMs));
    return await coletor.coletar(parametros);
  }
}

async function rodarFonte(db, fonte, modelos, coletor, data, origem, pausaMs) {
  const id = novaColeta(db, fonte, origem);
  let ok = 0, itens = 0, mudancas = 0;
  const erros = [];
  for (const m of modelos) {
    try {
      if (!coletor) throw new Error(`coletor desconhecido: ${fonte}`);
      const lista = await coletarComRetentativa(coletor, JSON.parse(m.parametros), pausaMs);
      const r = transacao(db, () => gravarModelo(db, { modeloId: m.id, itens: lista, coletaId: id, data }));
      if (r.erro) { erros.push(`${m.nome}: ${r.erro}`); continue; }
      ok++; itens += r.itens; mudancas += r.mudancas;
    } catch (e) {
      const texto = String(e.message).slice(0, 160);
      erros.push(`${m.nome}: ${texto}`);
      alertaFalha(db, id, texto, m.id);
    }
  }
  const status = ok === modelos.length ? 'ok' : ok > 0 ? 'parcial' : 'falha';
  fecharColeta(db, id, { status, modelos_ok: ok, itens, mudancas, erro: erros.join(' | ') || null });
  return { status, modelos_ok: ok, itens, mudancas, erros };
}

export async function rodarColeta(db, { coletores, buscarFrota = null, enviar = null, revenda = null, data = hojeSP(), origem = 'agenda', pausaMs = 5000 }) {
  if (rodando) throw new Error('já existe uma coleta em andamento');
  // Outro processo (a tarefa agendada ou o servidor) pode estar coletando no mesmo arquivo.
  if (db.prepare(`SELECT 1 FROM coletas WHERE fim IS NULL AND fonte <> 'legado' AND inicio > datetime('now', '-${TRAVA_MINUTOS} minutes')`).get()) throw new Error('já existe uma coleta em andamento');
  rodando = true;
  try {
    const resumo = { data, frota: null, fontes: {}, revenda: null, alertas: null };
    if (buscarFrota) resumo.frota = await rodarFrota(db, buscarFrota, origem);
    const modelos = db.prepare('SELECT * FROM modelos WHERE ativo = 1 ORDER BY id').all();
    for (const [fonte, lista] of Map.groupBy(modelos, m => m.coletor)) {
      resumo.fontes[fonte] = await rodarFonte(db, fonte, lista, coletores[fonte], data, origem, pausaMs);
    }
    if (revenda) resumo.revenda = await rodarRevenda(db, { ...revenda, data, origem });
    if (enviar) {
      try {
        resumo.alertas = await enviar(db, { data });
      } catch (e) {
        resumo.alertas = { enviados: 0, motivo: e.message };
      }
    }
    return resumo;
  } finally {
    try { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch { /* o checkpoint é só higiene */ }
    rodando = false;
  }
}
```

`src/dependencias.js` (inteiro):

```js
import { COLETORES } from './coletores/index.js';
import { buscarFrota } from './frota.js';
import { enviarPendentes } from './alertas.js';
import * as fipe from './revenda/fipe.js';
import * as mobiauto from './revenda/mobiauto.js';
import * as ipca from './revenda/ipca.js';

export function dependencias(env) {
  return {
    coletores: COLETORES,
    buscarFrota: env.ATIVOS_URL && env.ATIVOS_TOKEN ? () => buscarFrota({ url: env.ATIVOS_URL, token: env.ATIVOS_TOKEN }) : null,
    enviar: (db, opcoes) => enviarPendentes(db, { env, ...opcoes }),
    revenda: { fipe, mobiauto, ipca },
  };
}
```

Em `test/coleta.test.js`, no teste `coleta recusa começar se outro processo tem uma em andamento`, trocar:

```js
  // Uma linha esquecida há mais de 30 minutos (processo morto) não trava mais.
  db.prepare("UPDATE coletas SET inicio = datetime('now', '-31 minutes') WHERE fim IS NULL").run();
```

por:

```js
  // Uma linha esquecida há mais de 2 horas (processo morto) não trava mais.
  db.prepare("UPDATE coletas SET inicio = datetime('now', '-121 minutes') WHERE fim IS NULL").run();
```

- [ ] **Step 7: Rodar e ver passar**

Run: `node --experimental-sqlite --test test/revenda-coleta.test.js` → `ℹ pass 8`. Depois `npm test` → `ℹ tests 125`, `ℹ fail 0` (os testes antigos da rodada seguem iguais: sem `revenda`, nada muda).

- [ ] **Step 8: Commit**

```bash
git add src/coletas.js src/revenda/dados.js src/revenda/coleta.js src/coleta.js src/dependencias.js test/revenda-coleta.test.js test/coleta.test.js
git commit -m "Revenda na rodada semanal: IPCA, FIPE (36 referencias na 1a vez), anuncios e um estudo por modelo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: API da Revenda

**Files:**
- Create: `src/revenda/consultas.js`, `src/rotas/revenda.js`, `test/revenda-rotas.test.js`
- Modify: `src/auth.js` (import e função no fim), `src/rotas/admin.js:8` e `:81`, `src/app.js:8-11` e `:31`, `test/sinteticos.js` (função no fim)

**Interfaces:**
- Consumes: `exigirLogin(env)`, `logado(req, env)` (`src/auth.js`); `soJson` (`src/rotas/admin.js`, passa a ser exportado); `hojeSP()`; tudo de `src/revenda/dados.js` e `estudo.js`; `PREMISSAS_INICIAIS` (Task 1).
- Produces:
  - `tokenConfere(cabecalho, token): boolean` em `src/auth.js` (sha256 + `timingSafeEqual`; sem token configurado, sempre falso).
  - `src/revenda/consultas.js`: `ErroRevenda(status, mensagem)`, `modelosRevenda(db)`, `modeloRevenda(db, slug, hoje)`, `projecao(db, query)`, `premissasEModelos(db)`, `salvarPremissas(db, corpo)`, `salvarParametrosModelo(db, id, corpo)`, `registrarVenda(db, corpo, hoje): id`, `listarVendas(db)`; `KMS_RESUMO = [30000, 70000]`, `MESES_VENDA = 12`.
  - `rotasRevenda(db, env, { hoje = hojeSP })` em `src/rotas/revenda.js`; `criarApp` passa `deps.hoje` (só os testes usam).
  - Rotas (todas com `Cache-Control: no-store`):
    - `GET /api/revenda/projecao?modelo=&meses=12&km=&canal=atacado&preco=` (sessão ou `Authorization: Bearer <REVENDA_TOKEN>`) → `{ modelo, meses, km, canal, preco, preco_informado, p10, p50, p90: {nominal, real, pct, pct_real}, insumos: { r_p50, r_real_p50, fator_km, multiplicador, data_estudo, referencia_fipe, n_anuncios, km_tipico, fator_10mil, r_emprestado, km_emprestado, premissas } }`; 400 entrada inválida, 404 modelo ou estudo ausente, 422 estudo sem dado para o pedido.
    - `GET /api/revenda/modelos` → `[{ id, slug, montadora, nome, origem, qtd_frota, tem_fipe, data_estudo, p50_12m: {30000, 70000}, fator_10mil, n_anuncios, r_emprestado, km_emprestado }]`.
    - `GET /api/revenda/modelos/:slug` → `{ id, slug, montadora, nome, versao, parametros, estudo: { calculado_em, ...dados } | null, serie_fipe: [{ referencia, zero_km, ano_anterior }], anuncios: [{ ano_modelo, km, preco, idade }] }`.
    - `PATCH /api/revenda/modelos/:id` (JSON) → parâmetros salvos.
    - `GET /api/revenda/premissas` → `{ premissas: [{ chave, valor, atualizado_em }], modelos: [{ id, slug, nome, origem, ativo, fipe_*, mobiauto_* }] }`; `PUT /api/revenda/premissas` (JSON) → `{ premissas }`.
    - `GET /api/revenda/vendas` → `[{ id, placa, slug, nome, data, km, preco, canal, obs, previsto, diferenca, data_estudo }]`; `POST /api/revenda/vendas` (JSON) → 201 `{ id }`.
  - `semearRevenda(db, hoje)` em `test/sinteticos.js`.

- [ ] **Step 1: Semente para os testes de rota**: acrescentar no fim de `test/sinteticos.js`:

```js
// Banco com a FIPE do Polo Track (10176), os anúncios dele e o IPCA; o estudo fica para quem chama.
export function semearRevenda(db, hoje = '2026-10-28') {
  const polo = db.prepare("SELECT id FROM modelos WHERE slug = 'polo-track'").get().id;
  const insF = db.prepare('INSERT INTO fipe_precos (fipe_marca, fipe_modelo, ano_modelo, referencia, valor) VALUES (?, ?, ?, ?, ?)');
  for (const l of fipeSintetica()) insF.run(l.fipe_marca, l.fipe_modelo, l.ano_modelo, l.referencia, l.valor);
  const insA = db.prepare('INSERT INTO anuncios (id_externo, modelo_id, versao, ano_modelo, ano_fabricacao, km, preco, loja, primeiro_visto, ultimo_visto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const a of anunciosSinteticos({ hoje })) insA.run(a.id_externo, polo, a.versao, a.ano_modelo, a.ano_fabricacao, a.km, a.preco, a.loja, hoje, hoje);
  const insI = db.prepare('INSERT INTO ipca (mes, variacao) VALUES (?, ?)');
  for (const [mes, v] of ipcaSintetico()) insI.run(mes, v);
  return polo;
}
```

- [ ] **Step 2: Teste que falha**: `test/revenda-rotas.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoNovo, servidor } from './ajuda.js';
import { semearRevenda } from './sinteticos.js';
import { criarApp } from '../src/app.js';
import { gerarHash, tokenConfere } from '../src/auth.js';
import { recalcularEstudos } from '../src/revenda/dados.js';

const HOJE = '2026-10-28';
const ENV = { ADMIN_SENHA_HASH: gerarHash('certa'), SESSION_SECRET: 'segredo-de-teste', REVENDA_TOKEN: 'token-do-kpis' };
const JSON_ = { 'Content-Type': 'application/json' };

async function subir({ env = ENV, semear = true, deps = {} } = {}) {
  const db = bancoNovo();
  if (semear) { semearRevenda(db, HOJE); recalcularEstudos(db, HOJE); }
  const s = await servidor(criarApp({ db, env, deps: { coletores: {}, buscarFrota: null, enviar: null, hoje: () => HOJE, ...deps } }));
  const r = await fetch(`${s.url}/api/entrar`, { method: 'POST', headers: JSON_, body: JSON.stringify({ senha: 'certa' }) });
  return { db, ...s, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const PROJ = '/api/revenda/projecao?modelo=polo-track&meses=12&km=70000&canal=atacado';

test('tokenConfere: só com Bearer exato e token configurado', () => {
  assert.equal(tokenConfere('Bearer abc', 'abc'), true);
  assert.equal(tokenConfere('bearer abc', 'abc'), true);
  assert.equal(tokenConfere('Bearer abcd', 'abc'), false);
  assert.equal(tokenConfere('abc', 'abc'), false);
  assert.equal(tokenConfere('Bearer abc', undefined), false);
  assert.equal(tokenConfere(undefined, 'abc'), false);
});

test('sem login tudo da Revenda dá 401', async () => {
  const { url, fechar } = await subir();
  for (const [m, c] of [['GET', PROJ], ['GET', '/api/revenda/modelos'], ['GET', '/api/revenda/modelos/polo-track'], ['PATCH', '/api/revenda/modelos/1'],
    ['GET', '/api/revenda/premissas'], ['PUT', '/api/revenda/premissas'], ['GET', '/api/revenda/vendas'], ['POST', '/api/revenda/vendas']]) {
    const r = await fetch(url + c, { method: m, headers: JSON_, body: m === 'GET' ? undefined : '{}' });
    assert.equal(r.status, 401, `${m} ${c}`);
  }
  await fechar();
});

test('token do KPIs abre só a projeção', async () => {
  const { url, fechar } = await subir();
  const bearer = t => ({ Authorization: `Bearer ${t}` });
  const r = await fetch(url + PROJ, { headers: bearer('token-do-kpis') });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const j = await r.json();
  assert.equal(j.modelo, 'polo-track');
  assert.ok(j.p10.nominal < j.p50.nominal && j.p50.nominal < j.p90.nominal);
  assert.equal(j.insumos.data_estudo, HOJE);
  assert.equal(j.insumos.n_anuncios, 60);
  assert.deepEqual(j.insumos.premissas, { atacado_pct_base: 85, motorista_pct_base: 100, varejo_negociacao_pct: 5 });
  assert.equal((await fetch(url + PROJ, { headers: bearer('errado') })).status, 401);
  assert.equal((await fetch(`${url}/api/revenda/modelos`, { headers: bearer('token-do-kpis') })).status, 401);
  assert.equal((await fetch(`${url}/api/revenda/vendas`, { headers: bearer('token-do-kpis') })).status, 401);
  await fechar();
});

test('sem REVENDA_TOKEN nenhum Bearer passa', async () => {
  const { url, fechar } = await subir({ env: { ...ENV, REVENDA_TOKEN: '' } });
  assert.equal((await fetch(url + PROJ, { headers: { Authorization: 'Bearer ' } })).status, 401);
  assert.equal((await fetch(url + PROJ, { headers: { Authorization: 'Bearer token-do-kpis' } })).status, 401);
  await fechar();
});

test('projeção logado: validação, preço informado e interpolação', async () => {
  const { url, cookie, fechar } = await subir();
  const get = c => fetch(url + c, { headers: { Cookie: cookie } });
  const ok = await (await get('/api/revenda/projecao?modelo=polo-track&meses=12&km=40000&canal=motorista&preco=100000')).json();
  assert.ok(Math.abs(ok.p50.pct - 0.99 ** 12) < 1e-6, 'motorista a 100% e km no típico: % = r_12');
  assert.equal(ok.preco, 100000);
  assert.equal(ok.preco_informado, true);
  const nove = await (await get('/api/revenda/projecao?modelo=polo-track&meses=9&km=40000&canal=motorista&preco=100000')).json();
  assert.ok(Math.abs(nove.p50.pct - (0.99 ** 6 + 0.99 ** 12) / 2) < 1e-6);
  for (const [c, s] of [['meses=30&km=1', 400], ['meses=12&km=1&canal=leilao', 400], ['meses=12', 400], ['meses=12&km=1&preco=-5', 400]]) {
    assert.equal((await get(`/api/revenda/projecao?modelo=polo-track&${c}`)).status, s, c);
  }
  assert.equal((await get('/api/revenda/projecao?modelo=nada&km=1')).status, 404);
  await fechar();
});

test('modelo sem estudo dá 404 na projeção', async () => {
  const { url, cookie, fechar } = await subir({ semear: false });
  const r = await fetch(`${url}${PROJ}`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).erro, 'modelo sem estudo');
  await fechar();
});

test('lista e detalhe dos modelos', async () => {
  const { url, cookie, fechar } = await subir();
  const lista = await (await fetch(`${url}/api/revenda/modelos`, { headers: { Cookie: cookie } })).json();
  assert.equal(lista.length, 6);
  const polo = lista.find(m => m.slug === 'polo-track');
  assert.equal(polo.n_anuncios, 60);
  assert.equal(polo.data_estudo, HOJE);
  assert.ok(polo.p50_12m['30000'] > polo.p50_12m['70000']);
  const d = await (await fetch(`${url}/api/revenda/modelos/polo-track`, { headers: { Cookie: cookie } })).json();
  assert.equal(d.serie_fipe.length, 36);
  assert.deepEqual(Object.keys(d.serie_fipe[0]), ['referencia', 'zero_km', 'ano_anterior']);
  assert.equal(d.anuncios.length, 60);
  assert.equal(d.estudo.km.km_tipico, 40000);
  assert.equal(d.parametros.mobiauto_versao, '^Track');
  assert.equal((await fetch(`${url}/api/revenda/modelos/nada`, { headers: { Cookie: cookie } })).status, 404);
  await fechar();
});

test('premissas: fora de 0 a 200, texto ou chave desconhecida dão 400', async () => {
  const { url, cookie, db, fechar } = await subir();
  const put = corpo => fetch(`${url}/api/revenda/premissas`, { method: 'PUT', headers: { ...JSON_, Cookie: cookie }, body: JSON.stringify(corpo) });
  for (const corpo of [{ atacado_pct_base: 250 }, { atacado_pct_base: -1 }, { atacado_pct_base: '80' }, { outra: 5 }, {}]) {
    assert.equal((await put(corpo)).status, 400, JSON.stringify(corpo));
  }
  const r = await put({ atacado_pct_base: 80 });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).premissas.find(p => p.chave === 'atacado_pct_base').valor, 80);
  assert.equal(db.prepare("SELECT valor FROM premissas WHERE chave = 'varejo_negociacao_pct'").get().valor, 5);
  const g = await (await fetch(`${url}/api/revenda/premissas`, { headers: { Cookie: cookie } })).json();
  assert.equal(g.premissas.length, 3);
  assert.equal(g.modelos.length, 6);
  await fechar();
});

test('parâmetros FIPE e Mobiauto de um modelo', async () => {
  const { url, cookie, db, fechar } = await subir();
  const id = db.prepare("SELECT id FROM modelos WHERE slug = 'byd-king'").get().id;
  const patch = corpo => fetch(`${url}/api/revenda/modelos/${id}`, { method: 'PATCH', headers: { ...JSON_, Cookie: cookie }, body: JSON.stringify(corpo) });
  assert.equal((await patch({ mobiauto_versao: '([' })).status, 400);
  assert.equal((await patch({ fipe_combustivel: 1 })).status, 400);
  assert.equal((await patch({ mobiauto_caminho: 'BYD King' })).status, 400);
  assert.equal((await patch({ outra: 1 })).status, 400);
  assert.equal((await patch({ fipe_modelo_ref: 12122, mobiauto_versao: '^GL' })).status, 200);
  const m = db.prepare('SELECT fipe_modelo, fipe_modelo_ref, mobiauto_versao FROM modelos WHERE id = ?').get(id);
  assert.deepEqual({ ...m }, { fipe_modelo: 11078, fipe_modelo_ref: 12122, mobiauto_versao: '^GL' });
  await fechar();
});

test('vendas: registra, recusa inválida e lista com o previsto', async () => {
  const { url, cookie, fechar } = await subir();
  const post = corpo => fetch(`${url}/api/revenda/vendas`, { method: 'POST', headers: { ...JSON_, Cookie: cookie }, body: JSON.stringify(corpo) });
  const venda = { placa: 'abc-1d23', modelo: 'polo-track', data: HOJE, km: 40000, preco: 70000, canal: 'motorista' };
  assert.equal((await post(venda)).status, 201);
  for (const ruim of [{ placa: 'X1' }, { modelo: 'nada' }, { data: '2026-13-01' }, { data: '2030-01-01' }, { km: -1 }, { preco: 10 }, { canal: 'leilao' }]) {
    assert.equal((await post({ ...venda, ...ruim })).status, 400, JSON.stringify(ruim));
  }
  const lista = await (await fetch(`${url}/api/revenda/vendas`, { headers: { Cookie: cookie } })).json();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].placa, 'ABC1D23');
  const previsto = Math.round(100000 * 0.99 ** 10 * 0.99 ** 12);
  assert.ok(Math.abs(lista[0].previsto - previsto) <= 1, `${lista[0].previsto} ≈ ${previsto}`);
  assert.ok(Math.abs(lista[0].diferenca - (70000 - lista[0].previsto) / lista[0].previsto) < 1e-12);
  await fechar();
});

test('botão Coletar agora não roda a Revenda', async () => {
  let chamou = false;
  const revenda = { ipca: { serie: async () => { chamou = true; return []; } } };
  const { url, cookie, fechar } = await subir({ deps: { revenda } });
  const r = await fetch(`${url}/api/coletas`, { method: 'POST', headers: { ...JSON_, Cookie: cookie }, body: '{}' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).revenda, null);
  assert.equal(chamou, false);
  await fechar();
});

test('telas da Revenda abrem a casca do front', async () => {
  const { url, fechar } = await subir({ semear: false });
  for (const c of ['/revenda', '/revenda/simulador', '/revenda/premissas', '/revenda/vendas', '/revenda/polo-track']) {
    const r = await fetch(url + c);
    assert.equal(r.status, 200, c);
    assert.match(await r.text(), /<main id="tela"/);
  }
  await fechar();
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --experimental-sqlite --test test/revenda-rotas.test.js`
Expected: FAIL, `The requested module '../src/auth.js' does not provide an export named 'tokenConfere'`.

- [ ] **Step 4: Token em `src/auth.js`**: trocar a primeira linha de import por

```js
import { scrypt, scryptSync, randomBytes, timingSafeEqual, createHmac, createHash } from 'node:crypto';
```

e acrescentar no fim do arquivo:

```js
// Token fixo para leitura entre sistemas (o KPIs lê a projeção da Revenda com REVENDA_TOKEN).
// Compara os hashes, em tempo constante e sem vazar o tamanho. Sem token configurado, nunca confere.
export function tokenConfere(cabecalho, token) {
  if (!token) return false;
  const m = String(cabecalho || '').match(/^Bearer\s+(\S+)\s*$/i);
  if (!m) return false;
  const h = s => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(h(m[1]), h(token));
}
```

- [ ] **Step 5: `src/rotas/admin.js`**: exportar o `soJson` (linha 8):

```js
export const soJson = (req, res, next) => (req.is('application/json') ? next() : res.status(415).json({ erro: 'use application/json' }));
```

e, em `POST /api/coletas`, trocar `try { res.json(await rodarColeta(db, { ...deps, origem: 'manual' })); }` por:

```js
    // O botão roda só as Revisões: a Revenda (FIPE, anúncios) leva minutos e fica na tarefa semanal.
    try { res.json(await rodarColeta(db, { ...deps, revenda: null, origem: 'manual' })); }
```

- [ ] **Step 6: Consultas**: `src/revenda/consultas.js`:

```js
// Leituras e validações da Revenda para as rotas.
import { lerPremissas, premissasComData, ultimoEstudo, anunciosRecentes, linhasFipe } from './dados.js';
import { projetar, indexarFipe, anoZeroKm, idade, ZERO_KM, CANAIS } from './estudo.js';
import { PREMISSAS_INICIAIS } from '../migracoes/003-revenda.js';

export const KMS_RESUMO = [30000, 70000];
export const MESES_VENDA = 12;   // a venda guarda só a data: o previsto usa o prazo padrão
const CAMPOS_MODELO = ['fipe_marca', 'fipe_modelo', 'fipe_combustivel', 'fipe_modelo_ref', 'mobiauto_caminho', 'mobiauto_versao'];

export class ErroRevenda extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

const porSlug = (db, slug) => db.prepare('SELECT * FROM modelos WHERE slug = ?').get(String(slug ?? ''));
const parametros = m => Object.fromEntries(CAMPOS_MODELO.map(k => [k, m[k]]));

function pctP50(dados, meses, km, canal, premissas) {
  try { return projetar(dados, { meses, km, canal, preco: dados.fipe_0km_atual ?? 1 }, premissas).p50.pct; } catch { return null; }
}

export function modelosRevenda(db) {
  const premissas = lerPremissas(db);
  return db.prepare("SELECT * FROM modelos WHERE ativo = 1 ORDER BY origem = 'frota' DESC, qtd_frota DESC, nome").all().map(m => {
    const e = ultimoEstudo(db, m.id);
    const d = e?.dados;
    return {
      id: m.id, slug: m.slug, montadora: m.montadora, nome: m.nome, origem: m.origem, qtd_frota: m.qtd_frota,
      tem_fipe: m.fipe_modelo != null, data_estudo: e?.calculado_em ?? null,
      p50_12m: d ? Object.fromEntries(KMS_RESUMO.map(k => [k, pctP50(d, 12, k, 'atacado', premissas)])) : null,
      fator_10mil: d?.km.fator_10mil ?? null, n_anuncios: d?.km.n ?? 0,
      r_emprestado: d?.r_emprestado ?? null, km_emprestado: d?.km_emprestado ?? null,
    };
  });
}

export function modeloRevenda(db, slug, hoje) {
  const m = porSlug(db, slug);
  if (!m) return null;
  const e = ultimoEstudo(db, m.id);
  const idx = indexarFipe(m.fipe_modelo ? linhasFipe(db, m.fipe_modelo) : []);
  const serie_fipe = [...idx.keys()].sort().map(referencia => {
    const p = idx.get(referencia);
    const ano = anoZeroKm(p);
    return { referencia, zero_km: p.get(ZERO_KM) ?? null, ano_anterior: ano == null ? null : p.get(ano - 1) ?? null };
  });
  return {
    id: m.id, slug: m.slug, montadora: m.montadora, nome: m.nome, versao: m.versao, parametros: parametros(m),
    estudo: e ? { calculado_em: e.calculado_em, ...e.dados } : null,
    serie_fipe,
    anuncios: anunciosRecentes(db, m.id, hoje).map(a => ({ ano_modelo: a.ano_modelo, km: a.km, preco: a.preco, idade: idade(a.ano_modelo, hoje) })),
  };
}

const inteiro = (v, min, max) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};

// q: query string. Erros de entrada → 400; modelo ou estudo ausente → 404; estudo sem dado → 422.
export function projecao(db, q) {
  const meses = inteiro(q.meses ?? 12, 1, 24);
  const km = inteiro(q.km, 0, 300000);
  const canal = q.canal ?? 'atacado';
  const preco = q.preco === undefined || q.preco === '' ? null : Number(q.preco);
  if (!q.modelo) throw new ErroRevenda(400, 'informe o modelo');
  if (Number.isNaN(meses)) throw new ErroRevenda(400, 'meses entre 1 e 24');
  if (km === undefined || Number.isNaN(km)) throw new ErroRevenda(400, 'km entre 0 e 300.000');
  if (!CANAIS.includes(canal)) throw new ErroRevenda(400, 'canal deve ser atacado, varejo ou motorista');
  if (preco !== null && !(preco > 0 && preco <= 2000000)) throw new ErroRevenda(400, 'preço inválido');
  const m = porSlug(db, q.modelo);
  if (!m) throw new ErroRevenda(404, 'modelo não encontrado');
  const e = ultimoEstudo(db, m.id);
  if (!e) throw new ErroRevenda(404, 'modelo sem estudo');
  const premissas = lerPremissas(db);
  let p;
  try { p = projetar(e.dados, { meses, km, canal, preco }, premissas); } catch (x) { throw new ErroRevenda(422, x.message); }
  const { p10, p50, p90, preco: P, preco_informado, ...uso } = p;
  const d = e.dados;
  return {
    modelo: m.slug, meses, km, canal, preco: P, preco_informado, p10, p50, p90,
    insumos: {
      ...uso, data_estudo: e.calculado_em, referencia_fipe: d.referencia, n_anuncios: d.km.n, km_tipico: d.km.km_tipico,
      fator_10mil: d.km.fator_10mil, r_emprestado: d.r_emprestado, km_emprestado: d.km_emprestado, premissas,
    },
  };
}

export function premissasEModelos(db) {
  return {
    premissas: premissasComData(db),
    modelos: db.prepare("SELECT * FROM modelos ORDER BY ativo DESC, origem = 'frota' DESC, nome").all()
      .map(m => ({ id: m.id, slug: m.slug, nome: m.nome, origem: m.origem, ativo: m.ativo, ...parametros(m) })),
  };
}

// Só as chaves conhecidas, números de 0 a 200. Só a que mudou ganha data nova.
export function salvarPremissas(db, corpo) {
  const entradas = Object.entries(corpo ?? {});
  if (!entradas.length) throw new ErroRevenda(400, 'nenhuma premissa enviada');
  for (const [k, v] of entradas) {
    if (!Object.hasOwn(PREMISSAS_INICIAIS, k)) throw new ErroRevenda(400, `premissa desconhecida: ${k}`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 200) throw new ErroRevenda(400, `${k} deve ser um número entre 0 e 200`);
  }
  const upd = db.prepare("UPDATE premissas SET valor = ?, atualizado_em = datetime('now') WHERE chave = ? AND valor <> ?");
  for (const [k, v] of entradas) upd.run(v, k, v);
  return premissasComData(db);
}

export function salvarParametrosModelo(db, id, corpo) {
  const m = db.prepare('SELECT * FROM modelos WHERE id = ?').get(Number(id));
  if (!m) throw new ErroRevenda(404, 'modelo não encontrado');
  const b = corpo ?? {};
  const novo = parametros(m);
  for (const k of Object.keys(b)) if (!CAMPOS_MODELO.includes(k)) throw new ErroRevenda(400, `campo desconhecido: ${k}`);
  for (const k of ['fipe_marca', 'fipe_modelo', 'fipe_modelo_ref']) {
    if (!(k in b)) continue;
    const v = inteiro(b[k], 1, 999999);
    if (Number.isNaN(v)) throw new ErroRevenda(400, `${k} inválido`);
    novo[k] = v ?? null;
  }
  if ('fipe_combustivel' in b) {
    if (b.fipe_combustivel !== null && ![4, 5, 6].includes(b.fipe_combustivel)) throw new ErroRevenda(400, 'combustível deve ser 5 (Flex), 4 (Elétrico) ou 6 (Híbrido)');
    novo.fipe_combustivel = b.fipe_combustivel;
  }
  if ('mobiauto_caminho' in b) {
    if (b.mobiauto_caminho !== null && !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(String(b.mobiauto_caminho))) throw new ErroRevenda(400, 'caminho da Mobiauto no formato marca/modelo');
    novo.mobiauto_caminho = b.mobiauto_caminho;
  }
  if ('mobiauto_versao' in b) {
    if (b.mobiauto_versao !== null) {
      if (typeof b.mobiauto_versao !== 'string' || b.mobiauto_versao.length > 80) throw new ErroRevenda(400, 'versão da Mobiauto inválida');
      try { new RegExp(b.mobiauto_versao, 'i'); } catch { throw new ErroRevenda(400, 'versão da Mobiauto não é uma expressão válida'); }
    }
    novo.mobiauto_versao = b.mobiauto_versao || null;
  }
  db.prepare(`UPDATE modelos SET ${CAMPOS_MODELO.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...CAMPOS_MODELO.map(k => novo[k] ?? null), m.id);
  return novo;
}

export function registrarVenda(db, corpo, hoje) {
  const b = corpo ?? {};
  const placa = String(b.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) throw new ErroRevenda(400, 'placa inválida');
  const m = porSlug(db, b.modelo);
  if (!m) throw new ErroRevenda(400, 'modelo não encontrado');
  const data = String(b.data ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(`${data}T12:00:00Z`)) || data > hoje) throw new ErroRevenda(400, 'data inválida');
  const km = inteiro(b.km, 0, 500000);
  if (km === undefined || Number.isNaN(km)) throw new ErroRevenda(400, 'km inválido');
  const preco = Number(b.preco);
  if (!(preco >= 1000 && preco <= 2000000)) throw new ErroRevenda(400, 'preço inválido');
  if (!CANAIS.includes(b.canal)) throw new ErroRevenda(400, 'canal deve ser atacado, varejo ou motorista');
  const obs = b.obs == null || b.obs === '' ? null : String(b.obs).slice(0, 200);
  const r = db.prepare('INSERT INTO vendas (placa, modelo_id, data, km, preco, canal, obs) VALUES (?, ?, ?, ?, ?, ?, ?)').run(placa, m.id, data, km, preco, b.canal, obs);
  return Number(r.lastInsertRowid);
}

// Cada venda com o previsto pelo estudo vigente na data (P50, 12 meses, FIPE do zero km do estudo).
export function listarVendas(db) {
  const premissas = lerPremissas(db);
  return db.prepare('SELECT v.*, m.slug, m.nome FROM vendas v JOIN modelos m ON m.id = v.modelo_id ORDER BY v.data DESC, v.id DESC').all().map(v => {
    const e = ultimoEstudo(db, v.modelo_id, v.data);
    let previsto = null;
    try { previsto = e ? projetar(e.dados, { meses: MESES_VENDA, km: v.km, canal: v.canal }, premissas).p50.nominal : null; } catch { previsto = null; }
    return {
      id: v.id, placa: v.placa, slug: v.slug, nome: v.nome, data: v.data, km: v.km, preco: v.preco, canal: v.canal, obs: v.obs,
      previsto, diferenca: previsto ? (v.preco - previsto) / previsto : null, data_estudo: e?.calculado_em ?? null,
    };
  });
}
```

- [ ] **Step 7: Rotas**: `src/rotas/revenda.js`:

```js
// Módulo Revenda: tudo atrás do login. Só a projeção aceita também o token do KPIs.
import { Router } from 'express';
import { exigirLogin, logado, tokenConfere } from '../auth.js';
import { soJson } from './admin.js';
import { hojeSP } from '../datas.js';
import {
  ErroRevenda, modelosRevenda, modeloRevenda, projecao, premissasEModelos, salvarPremissas,
  salvarParametrosModelo, registrarVenda, listarVendas,
} from '../revenda/consultas.js';

export function rotasRevenda(db, env, { hoje = hojeSP } = {}) {
  const r = Router();
  const login = exigirLogin(env);
  const loginOuToken = (req, res, next) =>
    (logado(req, env) || tokenConfere(req.get('authorization'), env.REVENDA_TOKEN) ? next() : res.status(401).json({ erro: 'login necessário' }));
  // ErroRevenda leva o status; qualquer outro erro sobe para o tratador do app (500 em JSON).
  const responder = fn => (req, res, next) => {
    try { fn(req, res); } catch (e) { if (e instanceof ErroRevenda) res.status(e.status).json({ erro: e.message }); else next(e); }
  };

  r.use('/api/revenda', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  r.get('/api/revenda/projecao', loginOuToken, responder((req, res) => res.json(projecao(db, req.query))));
  r.get('/api/revenda/modelos', login, responder((req, res) => res.json(modelosRevenda(db))));
  r.get('/api/revenda/modelos/:slug', login, responder((req, res) => {
    const m = modeloRevenda(db, req.params.slug, hoje());
    return m ? res.json(m) : res.status(404).json({ erro: 'modelo não encontrado' });
  }));
  r.patch('/api/revenda/modelos/:id', login, soJson, responder((req, res) => res.json(salvarParametrosModelo(db, req.params.id, req.body))));
  r.get('/api/revenda/premissas', login, responder((req, res) => res.json(premissasEModelos(db))));
  r.put('/api/revenda/premissas', login, soJson, responder((req, res) => res.json({ premissas: salvarPremissas(db, req.body) })));
  r.get('/api/revenda/vendas', login, responder((req, res) => res.json(listarVendas(db))));
  r.post('/api/revenda/vendas', login, soJson, responder((req, res) => res.status(201).json({ id: registrarVenda(db, req.body, hoje()) })));
  return r;
}
```

- [ ] **Step 8: `src/app.js`**: três mudanças.

Depois de `import { rotasCompat } from './rotas/compat.js';`:

```js
import { rotasRevenda } from './rotas/revenda.js';
```

A lista de telas:

```js
const TELAS = ['/', '/comparar', '/coletores', '/entrar', '/modelo/:slug', '/revenda', '/revenda/:pagina'];
```

E logo depois de `app.use(rotasAdmin(db, env, deps));`:

```js
  app.use(rotasRevenda(db, env, { hoje: deps?.hoje }));
```

- [ ] **Step 9: Rodar e ver passar**

Run: `node --experimental-sqlite --test test/revenda-rotas.test.js` → `ℹ pass 12`. Depois `npm test` → `ℹ tests 137`, `ℹ pass 137`, `ℹ fail 0`.

- [ ] **Step 10: Commit**

```bash
git add src/auth.js src/rotas/admin.js src/rotas/revenda.js src/revenda/consultas.js src/app.js test/sinteticos.js test/revenda-rotas.test.js
git commit -m "API da Revenda: modelos, projecao (sessao ou REVENDA_TOKEN), premissas, parametros e vendas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Front: navegação do módulo, Modelos e Modelo

**Files:**
- Create: `public/css/revenda.css`, `public/js/revenda/graficos.js`, `public/js/revenda/modelos.js`, `public/js/revenda/modelo.js`
- Modify: `public/index.html` (inteiro abaixo), `public/js/app.js` (inteiro abaixo), `public/js/api.js`, `public/js/formato.js`, `public/js/graficos.js`, `public/js/entrar.js`, `public/js/coletores.js`

**Interfaces:**
- Consumes: `GET /api/revenda/modelos`, `GET /api/revenda/modelos/:slug`, `GET /api/modelos?todos=1` (imagens), `GET /api/sessao`; `brl`, `num`, `pct`, `dia`, `mesAno`, `esc` (`formato.js`).
- Produces: `put(c, b)` (`api.js`); `pctSimples(fração, casas = 1)` → `'78,4%'` (`formato.js`); `TINTA`, `DICA`, `semMovimento`, `referencias(refs)` exportados de `graficos.js`; `PAPEL`, `curvaUmAno(estudo, kmMax)`, `dispersaoKm(canvas, { anuncios, curva, refs })`, `degrausFipe(canvas, serie)` (`revenda/graficos.js`); telas `rvModelos(tela)`, `rvModelo(tela, slug)`. Sem sessão, toda tela `/revenda*` vai para `/entrar?volta=<caminho>` e o Entrar volta para lá.

Regras de gráfico (skill `dataviz`, carregar antes de mexer): cor pelo papel e nunca pela posição (anúncios em roxo semitransparente, curva em tinta escura, faixa em roxo a 10%, FIPE zero km em roxo, ano anterior em azul `#2a78d6`); pontos com raio 4,5 (9 px); linhas de 2 px; faixa P10 a P90 sombreada; legenda em HTML com as mesmas cores; números do estudo numa tabela ao lado.

- [ ] **Step 1: Casca**: `public/index.html` (inteiro):

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
  <link rel="stylesheet" href="/css/revenda.css">
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
    <nav class="abas" id="nav-revenda" aria-label="Revenda" hidden>
      <span class="modulo">Revenda</span>
      <a href="/revenda" data-link>Modelos</a>
      <a href="/revenda/simulador" data-link>Simulador</a>
      <a href="/revenda/premissas" data-link>Premissas</a>
      <a href="/revenda/vendas" data-link>Vendas</a>
    </nav>
    <div class="sessao" id="sessao"></div>
  </header>
  <main id="tela" tabindex="-1"></main>
</body>
</html>
```

- [ ] **Step 2: Pequenos acréscimos nos módulos que já existem**

`public/js/api.js`, depois da linha do `patch`:

```js
export const put = (c, b) => pedir('PUT', c, b);
```

`public/js/formato.js`, antes da linha `export const mesAno =`:

```js
// Fração como porcentagem sem sinal: 0.784 → 78,4%
export const pctSimples = (p, casas = 1) => (p == null ? '' : `${(p * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
```

`public/js/graficos.js`: pôr `export` na frente de `const TINTA =`, `const semMovimento =`, `const DICA =` e `const referencias =` (só isso; o resto do arquivo fica igual).

`public/js/entrar.js`: trocar `      ir('/coletores');` por:

```js
      const volta = new URLSearchParams(location.search).get('volta');
      ir(volta && /^\/[\w/-]*$/.test(volta) ? volta : '/coletores');
```

`public/js/coletores.js`: a constante `FONTES` passa a ser:

```js
const FONTES = { byd: 'BYD', vw: 'Volkswagen', gm: 'Chevrolet', fiat: 'Fiat', ativos: 'Frota (Ativos)', fipe: 'FIPE', mobiauto: 'Mobiauto', ipca: 'IPCA' };
```

- [ ] **Step 3: Rotas do front**: `public/js/app.js` (inteiro; a Task 9 acrescenta Simulador, Premissas e Vendas):

```js
import { inicio } from './inicio.js';
import { modelo } from './modelo.js';
import { comparar } from './comparar.js';
import { coletores } from './coletores.js';
import { entrar } from './entrar.js';
import { rvModelos } from './revenda/modelos.js';
import { rvModelo } from './revenda/modelo.js';
import { get, post } from './api.js';

const ROTAS = [
  [/^\/$/, inicio],
  [/^\/modelo\/([\w-]+)$/, modelo],
  [/^\/comparar$/, comparar],
  [/^\/coletores$/, coletores],
  [/^\/entrar$/, entrar],
  [/^\/revenda$/, rvModelos],
  [/^\/revenda\/([\w-]+)$/, rvModelo],
];
const DETALHE_REVENDA = /^\/revenda\/(?!simulador$|premissas$|vendas$)[\w-]+$/;
let limpar = null;
let seq = 0;
let ultimo = null; // caminho já na tela: redesenho no mesmo lugar não anima

const seguro = fn => { try { fn?.(); } catch { /* limpeza não pode travar a navegação */ } };

function marcarAba(a) {
  const alvo = a.getAttribute('href');
  const p = location.pathname;
  const atual = alvo === p || (alvo === '/' && p.startsWith('/modelo/')) || (alvo === '/revenda' && DETALHE_REVENDA.test(p));
  a.setAttribute('aria-current', atual ? 'page' : 'false');
}

export async function ir(caminho, empilhar = true) {
  const meu = ++seq;
  if (empilhar) history.pushState(null, '', caminho);
  const tela = document.getElementById('tela');
  const anterior = limpar;
  limpar = null;
  seguro(anterior);
  document.querySelectorAll('.abas a').forEach(marcarAba);
  const rota = ROTAS.find(([re]) => re.test(location.pathname));
  if (!rota) { tela.innerHTML = '<p class="vazio">Página não encontrada</p>'; return; }
  try {
    const fim = (await rota[1](tela, ...location.pathname.match(rota[0]).slice(1))) ?? null;
    if (meu !== seq) { seguro(fim); return; }
    limpar = fim;
    if (location.pathname !== ultimo) tela.firstElementChild?.classList.add('entra');
    ultimo = location.pathname;
    tela.focus({ preventScroll: true });
  } catch (e) {
    if (meu !== seq) return;
    // Revenda é só logado: sem sessão, vai para Entrar e volta depois.
    if (e.status === 401 && location.pathname.startsWith('/revenda')) { ir(`/entrar?volta=${encodeURIComponent(location.pathname)}`); return; }
    const p = document.createElement('p');
    p.className = 'erro';
    p.textContent = e.message;
    tela.replaceChildren(p);
  }
}

export async function atualizarSessao() {
  const { logado } = await get('/api/sessao').catch(() => ({ logado: false }));
  const el = document.getElementById('sessao');
  el.innerHTML = logado ? '<button type="button" id="sair">Sair</button>' : '<a href="/entrar" data-link>Entrar</a>';
  document.getElementById('nav-revenda').hidden = !logado;
  el.querySelector('#sair')?.addEventListener('click', async () => {
    try { await post('/api/sair'); } catch { /* segue e relê a sessão */ }
    await atualizarSessao();
    ir(location.pathname.startsWith('/revenda') ? '/' : location.pathname, location.pathname.startsWith('/revenda'));
  });
  return logado;
}

document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || a.target) return;
  e.preventDefault();
  const alvo = a.getAttribute('href');
  ir(alvo, alvo !== location.pathname);
});
addEventListener('popstate', () => ir(location.pathname, false));
atualizarSessao();
ir(location.pathname, false);
```

- [ ] **Step 4: Estilos**: `public/css/revenda.css` (inteiro, já com as cinco telas):

```css
/* Revenda: 1280×585 = topo 52 + 16 + conteúdo ≤ 501 + 16 */
.abas[hidden] { display: none; }
.rv-modelos, .rv-detalhe, .rv-simulador, .rv-premissas, .rv-vendas { height: 100%; min-height: 0; }

/* Modelos */
.rv-modelos { display: grid; grid-template-rows: auto 1fr; gap: 10px; }
.rv-cartoes { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: 12px; align-content: start; overflow: auto; }
.rv-cartao { grid-template-rows: 64px auto auto auto auto; }
.rv-par { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 4px 0 2px; }
.rv-par dt { font-size: .72rem; color: var(--tinta-3); font-weight: 600; }
.rv-par dd { margin: 0; font-size: 1.3rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.rv-par dd.vazio { font-size: .85rem; font-weight: 500; }

/* Modelo */
.rv-detalhe { display: grid; grid-template-rows: auto 1fr; gap: 12px; }
.rv-simular { display: inline-flex; align-items: center; margin-left: auto; }
.rv-detalhe-corpo { display: grid; grid-template-columns: 1fr 470px; gap: 16px; min-height: 0; }
.rv-lado { display: grid; grid-template-rows: 1fr auto; gap: 12px; min-height: 0; }
.rv-fig { margin: 0; background: var(--cartao); border-radius: var(--raio); box-shadow: 0 0 0 1px var(--linha); padding: 12px 14px; display: flex; flex-direction: column; min-height: 0; }
.rv-fig figcaption { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: .8rem; font-weight: 700; color: var(--tinta-2); margin-bottom: 6px; }
.rv-fig .legenda { margin: 0; font-weight: 600; }
.rv-fig .legenda .ponto { width: 9px; height: 9px; margin-right: 6px; }
.rv-fig .legenda i.faixa { height: 10px; }
.rv-numeros { background: var(--cartao); border-radius: var(--raio); box-shadow: 0 0 0 1px var(--linha); padding: 6px 4px 8px; }
.rv-numeros .tabela td, .rv-numeros .tabela th { padding: 4px 10px; }
.rv-dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 12px; margin: 8px 10px 0; }
.rv-dl dt { font-size: .7rem; color: var(--tinta-3); font-weight: 600; }
.rv-dl dd { margin: 0; font-size: .88rem; font-weight: 700; font-variant-numeric: tabular-nums; }

/* Simulador */
.rv-simulador { display: grid; grid-template-columns: 360px 1fr; gap: 16px; }
.rv-form { margin: 0; align-content: start; background: var(--cartao); border-radius: var(--raio); box-shadow: 0 0 0 1px var(--linha); padding: 12px 14px; }
.rv-campo { display: grid; gap: 6px; font-size: .78rem; font-weight: 600; color: var(--tinta-2); }
.rv-campo .filtros { flex-wrap: wrap; }
.rv-campo .filtros button { height: 30px; padding: 0 10px; font-size: .82rem; }
.rv-campo input { height: 34px; border: 1px solid var(--linha); border-radius: 10px; padding: 0 10px; background: #fff; }
.rv-resultado { display: grid; grid-template-rows: auto auto 1fr; gap: 12px; align-content: start; min-height: 0; }
.rv-destaque { display: grid; gap: 2px; background: var(--escuro); color: #fff; border-radius: var(--raio); padding: 14px 18px; }
.rv-destaque span { font-size: .82rem; color: #D8D2EA; }
.rv-destaque strong { font-size: 2rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.rv-quantis { background: var(--cartao); border-radius: var(--raio); overflow: hidden; box-shadow: 0 0 0 1px var(--linha); }
.rv-p50 td { font-weight: 800; background: var(--roxo-claro); }
.rv-insumos { margin: 0; background: var(--cartao); border-radius: var(--raio); box-shadow: 0 0 0 1px var(--linha); padding: 10px 14px; align-content: start; }

/* Premissas */
.rv-premissas { display: grid; grid-template-columns: 300px 1fr; gap: 16px; }
.rv-premissas > section { background: var(--cartao); border-radius: var(--raio); box-shadow: 0 0 0 1px var(--linha); padding: 12px 14px; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.rv-linha { display: flex; align-items: center; gap: 8px; }
.rv-linha input { width: 96px; }
.rv-linha i { font-style: normal; color: var(--tinta-3); font-weight: 500; }
.rv-premissas small { color: var(--tinta-3); font-weight: 500; }
.rv-params input, .rv-params select { width: 100%; height: 30px; border: 1px solid var(--linha); border-radius: 8px; padding: 0 6px; background: #fff; font-size: .82rem; }
.rv-params td { padding: 4px 6px; }
.rv-params td:first-child { font-weight: 700; white-space: nowrap; }
.rv-params .btn { height: 30px; padding: 0 12px; }
.rv-params tr.inativo td { color: var(--tinta-3); }

/* Vendas */
.rv-vendas { display: grid; grid-template-rows: auto auto 1fr; gap: 10px; }
.rv-nova { display: grid; grid-template-columns: 110px 170px 150px 110px 120px 130px auto; gap: 8px; align-items: end; background: var(--cartao); border-radius: var(--raio); box-shadow: 0 0 0 1px var(--linha); padding: 10px 14px; }
.rv-nova label { display: grid; gap: 3px; font-size: .78rem; font-weight: 600; color: var(--tinta-2); }
.rv-nova input, .rv-nova select { height: 34px; border: 1px solid var(--linha); border-radius: 10px; padding: 0 10px; background: #fff; }
.rv-nova .btn { justify-self: start; }
.rv-vendas .erro { margin: 0; }
```

- [ ] **Step 5: Gráficos**: `public/js/revenda/graficos.js`:

```js
// Gráficos da Revenda (skill dataviz): cor pelo papel da série, nunca pela posição;
// pontos de 9 px semitransparentes, linhas de 2 px, faixa sombreada, legenda em HTML.
import { brl, num, mesAno } from '../formato.js';
import { TINTA, DICA, semMovimento, referencias } from '../graficos.js';

export const PAPEL = {
  anuncios: 'rgba(88, 0, 247, 0.32)',
  curva: '#0A0118',
  faixa: 'rgba(88, 0, 247, 0.10)',
  zero_km: '#5800F7',
  ano_anterior: '#2a78d6',
};
const animacao = () => (semMovimento() ? false : { duration: 250 });
const ts = ref => Date.parse(`${ref}-15T12:00:00Z`);
const refDe = ms => new Date(ms).toISOString().slice(0, 7);

// Curva de 1 ano do estudo (ln preço = a + b·1 + c·km/10.000) com a faixa P10 a P90.
export function curvaUmAno(estudo, kmMax) {
  const { a, b, c } = estudo.km;
  if (a == null || !estudo.residuos) return null;
  const pts = [];
  for (let km = 0; km <= kmMax; km += 2000) {
    const p50 = Math.exp(a + b + c * km / 10000);
    pts.push({ km, p50, p10: p50 * Math.exp(estudo.residuos.q10), p90: p50 * Math.exp(estudo.residuos.q90) });
  }
  return pts;
}

export function dispersaoKm(canvas, { anuncios, curva, refs }) {
  const datasets = [{
    type: 'scatter', label: 'Anúncios', data: anuncios.map(a => ({ x: a.km, y: a.preco })),
    backgroundColor: PAPEL.anuncios, borderWidth: 0, pointRadius: 4.5, pointHoverRadius: 6, order: 2,
  }];
  if (curva) {
    datasets.push(
      { type: 'line', label: 'P90', data: curva.map(p => ({ x: p.km, y: p.p90 })), borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: '+1', backgroundColor: PAPEL.faixa, order: 3 },
      { type: 'line', label: 'P10', data: curva.map(p => ({ x: p.km, y: p.p10 })), borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: false, order: 3 },
      { type: 'line', label: 'Curva de 1 ano', data: curva.map(p => ({ x: p.km, y: p.p50 })), borderColor: PAPEL.curva, borderWidth: 2, pointRadius: 0, pointHoverRadius: 0, order: 1 },
    );
  }
  return new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: animacao(),
      interaction: { mode: 'nearest', intersect: true },
      scales: {
        x: { type: 'linear', min: 0, max: curva?.at(-1).km, ticks: { callback: v => `${num(v / 1000)} mil`, maxTicksLimit: 9 }, grid: { color: TINTA.grade } },
        y: { ticks: { callback: v => brl(v), maxTicksLimit: 6 }, grid: { color: TINTA.grade }, border: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...DICA, displayColors: false, filter: it => it.dataset.label === 'Anúncios',
          callbacks: { title: () => '', label: it => `${num(it.parsed.x)} km · ${brl(it.parsed.y)}` } },
      },
    },
    plugins: [referencias(refs)],
  });
}

export function degrausFipe(canvas, serie) {
  const linha = (chave, label, cor) => ({
    label, data: serie.filter(s => s[chave] != null).map(s => ({ x: ts(s.referencia), y: s[chave] })),
    stepped: 'after', borderColor: cor, backgroundColor: cor, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
    pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
  });
  return new Chart(canvas, {
    type: 'line',
    data: { datasets: [linha('zero_km', 'Zero km', PAPEL.zero_km), linha('ano_anterior', 'Ano anterior', PAPEL.ano_anterior)] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: animacao(),
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'linear', ticks: { callback: v => mesAno(`${refDe(v)}-01`), maxTicksLimit: 6 }, grid: { display: false } },
        y: { grace: '5%', ticks: { callback: v => brl(v), maxTicksLimit: 5 }, grid: { color: TINTA.grade }, border: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...DICA, callbacks: { title: it => mesAno(`${refDe(it[0].parsed.x)}-01`), label: it => ` ${it.dataset.label}  ${brl(it.parsed.y)}` } },
      },
    },
  });
}
```

- [ ] **Step 6: Tela Modelos**: `public/js/revenda/modelos.js`:

```js
import { get } from '../api.js';
import { pctSimples, pct, num, dia, esc } from '../formato.js';

const plural = (n, um, varios) => `${num(n)} ${n === 1 ? um : varios}`;

export async function rvModelos(tela) {
  const [modelos, publicos] = await Promise.all([get('/api/revenda/modelos'), get('/api/modelos?todos=1')]);
  const imagem = new Map(publicos.map(m => [m.slug, m.imagem]));
  tela.innerHTML = `<div class="rv-modelos">
    <h2>Revenda em 12 meses · atacado · P50</h2>
    <div class="rv-cartoes">${modelos.map((m, i) => cartao(m, imagem.get(m.slug), i)).join('')}</div>
  </div>`;
}

function cartao(m, img, i) {
  const p = m.p50_12m;
  const valor = k => (p?.[k] == null ? '<dd class="vazio">sem estudo</dd>' : `<dd>${pctSimples(p[k])}</dd>`);
  const emprestado = m.r_emprestado || m.km_emprestado;
  return `<a class="cartao rv-cartao" href="/revenda/${esc(m.slug)}" data-link style="--i:${i}">
    <img src="${esc(img ?? '/img/placeholder.svg')}" alt="" loading="lazy">
    <div class="cartao-topo"><strong>${esc(m.nome)}</strong>${m.qtd_frota ? `<span class="qtd">${plural(m.qtd_frota, 'carro', 'carros')}</span>` : ''}</div>
    <dl class="rv-par"><div><dt>30 mil km</dt>${valor('30000')}</div><div><dt>70 mil km</dt>${valor('70000')}</div></dl>
    <div class="cartao-meta">${m.fator_10mil == null ? '' : `${pct(m.fator_10mil)} por 10 mil km · `}${plural(m.n_anuncios, 'anúncio', 'anúncios')}</div>
    <div class="cartao-meta">${m.data_estudo ? `estudo ${dia(m.data_estudo)}` : 'sem estudo'}</div>
    ${emprestado ? '<span class="conferir">emprestado</span>' : ''}
  </a>`;
}
```

- [ ] **Step 7: Tela Modelo**: `public/js/revenda/modelo.js`:

```js
import { get } from '../api.js';
import { brl, num, pct, pctSimples, dia, mesAno, esc } from '../formato.js';
import { PAPEL, curvaUmAno, dispersaoKm, degrausFipe } from './graficos.js';

const REFS = [30000, 70000];
const MESES = ['6', '12', '18', '24'];
const ORIGEM = { ref: 'ref', outros: 'outros' };

export async function rvModelo(tela, slug) {
  const [m, publicos] = await Promise.all([get(`/api/revenda/modelos/${encodeURIComponent(slug)}`), get('/api/modelos?todos=1')]);
  const img = publicos.find(x => x.slug === m.slug)?.imagem ?? '/img/placeholder.svg';
  const e = m.estudo;
  const umAno = m.anuncios.filter(a => a.idade >= 0.5 && a.idade <= 1.5);
  const kmMax = Math.max(80000, Math.ceil(Math.max(0, ...umAno.map(a => a.km)) / 10000) * 10000);
  const curva = e ? curvaUmAno(e, kmMax) : null;
  tela.innerHTML = `<div class="rv-detalhe">
    <header class="detalhe-topo">
      <img src="${esc(img)}" alt="">
      <div><h1>${esc(m.montadora)} ${esc(m.nome)}</h1><p class="meta">${e ? `estudo ${dia(e.calculado_em)}${e.referencia ? ` · FIPE ${mesAno(`${e.referencia}-01`)}` : ''}` : 'sem estudo'}</p></div>
      <a class="btn sec rv-simular" href="/revenda/simulador?modelo=${esc(m.slug)}" data-link>Simular</a>
    </header>
    <div class="rv-detalhe-corpo">
      <figure class="rv-fig">
        <figcaption><span>Anúncios de 1 ano</span>
          <span class="legenda"><span><i class="ponto" style="background:${PAPEL.anuncios}"></i>Anúncios</span>${curva ? `<span><i style="background:${PAPEL.curva}"></i>Curva de 1 ano</span><span><i class="faixa" style="background:${PAPEL.faixa}"></i>P10 a P90</span>` : ''}</span>
        </figcaption>
        <div class="area"><canvas id="g-km" role="img" aria-label="Preço dos anúncios por km"></canvas></div>
      </figure>
      <div class="rv-lado">
        <figure class="rv-fig">
          <figcaption><span>FIPE</span>
            <span class="legenda"><span><i style="background:${PAPEL.zero_km}"></i>Zero km</span><span><i style="background:${PAPEL.ano_anterior}"></i>Ano anterior</span></span>
          </figcaption>
          <div class="area"><canvas id="g-fipe" role="img" aria-label="FIPE do zero km e do ano anterior no tempo"></canvas></div>
        </figure>
        ${e ? tabela(e) : '<p class="vazio">Sem estudo</p>'}
      </div>
    </div>
  </div>`;
  const graficos = [];
  try {
    graficos.push(dispersaoKm(tela.querySelector('#g-km'), { anuncios: umAno, curva, refs: REFS }));
    graficos.push(degrausFipe(tela.querySelector('#g-fipe'), m.serie_fipe));
  } catch (x) {
    graficos.forEach(g => g.destroy());
    throw x;
  }
  return () => graficos.forEach(g => g.destroy());
}

function tabela(e) {
  const marca = r => (r?.emprestado ? ` <span class="conferir">${ORIGEM[r.emprestado]}</span>` : '');
  const linha = (rotulo, k) => `<tr><td>${rotulo}</td>${MESES.map(m => `<td class="num">${e.r[m] ? pctSimples(e.r[m][k]) : ''}</td>`).join('')}</tr>`;
  const disp = e.residuos ? `${pct(Math.exp(e.residuos.q10) - 1)} / ${pct(Math.exp(e.residuos.q90) - 1)}` : '';
  return `<div class="rv-numeros">
    <table class="tabela">
      <thead><tr><th>Meses</th>${MESES.map(m => `<th class="num">${m}${marca(e.r[m])}</th>`).join('')}</tr></thead>
      <tbody>${linha('P25', 'p25')}${linha('P50', 'p50')}${linha('P75', 'p75')}${linha('P50 real', 'real_p50')}</tbody>
    </table>
    <dl class="rv-dl">
      <div><dt>Por 10 mil km</dt><dd>${e.km.fator_10mil == null ? '' : pct(e.km.fator_10mil)}${e.km_emprestado ? ' <span class="conferir">outros</span>' : ''}</dd></div>
      <div><dt>Km típico de 1 ano</dt><dd>${e.km.km_tipico == null ? '' : `${num(Math.round(e.km.km_tipico))} km`}</dd></div>
      <div><dt>Anúncios</dt><dd>${num(e.km.n)}</dd></div>
      <div><dt>P10 / P90</dt><dd>${disp}</dd></div>
      <div><dt>Anúncio sobre FIPE</dt><dd>${pctSimples(e.anuncio_sobre_fipe)}</dd></div>
      <div><dt>FIPE zero km</dt><dd>${e.fipe_0km_atual == null ? '' : brl(e.fipe_0km_atual)}</dd></div>
    </dl>
  </div>`;
}
```

- [ ] **Step 8: Banco de demonstração local e servidor** (tudo local, arquivo `demo.db` já está no `.gitignore`; senha de teste só para esta máquina):

```bash
rm -f demo.db demo.db-wal demo.db-shm
node --experimental-sqlite --input-type=module -e "
import { abrir } from './src/db.js';
import { migrar } from './src/migracoes/index.js';
import { semearRevenda } from './test/sinteticos.js';
import { recalcularEstudos } from './src/revenda/dados.js';
import { registrarVenda } from './src/revenda/consultas.js';
const db = abrir('demo.db');
migrar(db);
semearRevenda(db, '2026-10-28');
recalcularEstudos(db, '2026-10-28');
registrarVenda(db, { placa: 'ABC1D23', modelo: 'polo-track', data: '2026-10-20', km: 52000, preco: 68000, canal: 'atacado' }, '2026-10-28');
console.log(db.prepare('SELECT COUNT(*) n FROM estudos').get().n);
db.close();"
```

Expected: `6`. Subir em segundo plano (ferramenta Bash com `run_in_background`):

```bash
DB_PATH=demo.db PORT=3077 ADMIN_SENHA_HASH="$(node scripts/gerar-hash.js teste-local)" SESSION_SECRET=local-demo node --experimental-sqlite server.js
```

- [ ] **Step 9: Conferir no navegador** (painel Browser, `preview_start` com `url: http://localhost:3077/`, viewport 1280×585):
  - deslogado: o menu Revenda não aparece; abrir `/revenda` leva a `/entrar?volta=%2Frevenda`; entrar com a senha de teste volta para `/revenda`.
  - logado: o menu Revenda aparece ao lado de Revisões; `/revenda` mostra seis cartões (Polo Track com 30 e 70 mil km, `−3,0% por 10 mil km`, `60 anúncios`, `estudo 28/10/26`; os outros com o selo `emprestado`); `/revenda/polo-track` mostra a dispersão com a curva e a faixa, as linhas de 30 e 70 mil km, o FIPE em degraus com as duas cores e a tabela.
  - em cada tela, `javascript_tool` com `[document.documentElement.scrollHeight, innerHeight]` dá os dois iguais a 585; `read_console_messages` com `onlyErrors` vazio.
  - nenhum travessão em texto de tela; nenhum parágrafo explicativo.

- [ ] **Step 10: Testes e commit**

Run: `npm test` → `ℹ tests 137`, `ℹ fail 0`.

```bash
git add public/index.html public/css/revenda.css public/js/app.js public/js/api.js public/js/formato.js public/js/graficos.js public/js/entrar.js public/js/coletores.js public/js/revenda/graficos.js public/js/revenda/modelos.js public/js/revenda/modelo.js
git commit -m "Front da Revenda: menu so logado, telas Modelos e Modelo (dispersao com curva e faixa, FIPE em degraus)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Front: Simulador, Premissas e Vendas

**Files:**
- Create: `public/js/revenda/simulador.js`, `public/js/revenda/premissas.js`, `public/js/revenda/vendas.js`
- Modify: `public/js/app.js` (3 imports e 3 rotas)

**Interfaces:**
- Consumes: `GET /api/revenda/projecao`, `GET/PUT /api/revenda/premissas`, `PATCH /api/revenda/modelos/:id`, `GET/POST /api/revenda/vendas`, `GET /api/revenda/modelos`; `get`, `post`, `put`, `patch` (`api.js`); `ir()` (`app.js`).
- Produces: telas `rvSimulador(tela)` (aceita `?modelo=<slug>`, que o botão Simular da tela Modelo usa), `rvPremissas(tela)`, `rvVendas(tela)`.

- [ ] **Step 1: Simulador**: `public/js/revenda/simulador.js`:

```js
import { get } from '../api.js';
import { brl, num, pct, pctSimples, dia, mesAno, esc } from '../formato.js';

const KMS = [30000, 40000, 50000, 60000, 70000];
const CANAIS = [['atacado', 'Atacado'], ['varejo', 'Varejo'], ['motorista', 'Motorista']];
const QUANTIS = [['p10', 'P10'], ['p50', 'P50'], ['p90', 'P90']];

const seg = (nome, opcoes, atual) => `<div class="filtros" role="group" data-grupo="${nome}">${opcoes.map(([v, r]) =>
  `<button type="button" data-v="${esc(v)}" aria-pressed="${String(String(v) === String(atual))}">${esc(r)}</button>`).join('')}</div>`;

export async function rvSimulador(tela) {
  const modelos = (await get('/api/revenda/modelos')).filter(m => m.data_estudo);
  if (!modelos.length) { tela.innerHTML = '<p class="vazio">Nenhum modelo com estudo</p>'; return; }
  const pedido = new URLSearchParams(location.search).get('modelo');
  const estado = { modelo: modelos.some(m => m.slug === pedido) ? pedido : modelos[0].slug, preco: '', meses: 12, km: 70000, canal: 'atacado' };
  tela.innerHTML = `<div class="rv-simulador">
    <form class="form rv-form" id="f-sim">
      <label>Modelo<select name="modelo">${modelos.map(m => `<option value="${esc(m.slug)}"${m.slug === estado.modelo ? ' selected' : ''}>${esc(m.nome)}</option>`).join('')}</select></label>
      <label>Preço de compra<input name="preco" type="number" min="1000" step="100" inputmode="numeric" placeholder="FIPE zero km"></label>
      <label>Meses<input name="meses" type="number" min="1" max="24" step="1" value="12"></label>
      <div class="rv-campo"><span>Km no fim</span>${seg('km', KMS.map(k => [k, `${num(k / 1000)} mil`]), estado.km)}
        <input name="km" type="number" min="0" max="300000" step="1000" value="${estado.km}" aria-label="Km no fim"></div>
      <div class="rv-campo"><span>Canal</span>${seg('canal', CANAIS, estado.canal)}</div>
    </form>
    <section class="rv-resultado" id="r-sim" aria-live="polite"></section>
  </div>`;
  const form = tela.querySelector('#f-sim');
  const saida = tela.querySelector('#r-sim');
  let rodada = 0, timer = null;

  async function calcular() {
    const minha = ++rodada;
    const q = new URLSearchParams({ modelo: estado.modelo, meses: estado.meses, km: estado.km, canal: estado.canal });
    if (estado.preco) q.set('preco', estado.preco);
    saida.classList.add('ocupado');
    try {
      const r = await get(`/api/revenda/projecao?${q}`);
      if (minha === rodada) saida.innerHTML = resultado(r);
    } catch (x) {
      if (minha === rodada) saida.innerHTML = `<p class="erro">${esc(x.message)}</p>`;
    }
    if (minha === rodada) saida.classList.remove('ocupado');
  }
  const depois = () => { clearTimeout(timer); timer = setTimeout(calcular, 200); };
  const marcar = (grupo, v) => form.querySelectorAll(`[data-grupo="${grupo}"] button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));

  form.addEventListener('input', e => {
    const t = e.target;
    if (t.name === 'modelo') estado.modelo = t.value;
    if (t.name === 'preco') estado.preco = t.value && Number(t.value) > 0 ? t.value : '';
    if (t.name === 'meses') { if (!t.checkValidity() || t.value === '') return; estado.meses = Number(t.value); }
    if (t.name === 'km') { if (!t.checkValidity() || t.value === '') return; estado.km = Number(t.value); marcar('km', estado.km); }
    depois();
  });
  form.addEventListener('click', e => {
    const b = e.target.closest('[data-grupo] button');
    if (!b) return;
    const grupo = b.parentElement.dataset.grupo;
    if (grupo === 'km') { estado.km = Number(b.dataset.v); form.km.value = estado.km; }
    if (grupo === 'canal') estado.canal = b.dataset.v;
    marcar(grupo, b.dataset.v);
    depois();
  });
  form.addEventListener('submit', e => e.preventDefault());
  await calcular();
  return () => { clearTimeout(timer); rodada++; };
}

function resultado(r) {
  const i = r.insumos;
  const p = i.premissas;
  return `<div class="rv-destaque">
      <span>P50 ${esc(r.canal)} · ${esc(r.meses)} meses · ${num(r.km)} km</span>
      <strong>${brl(r.p50.nominal)}</strong>
      <span>${pctSimples(r.p50.pct)} de ${brl(r.preco)}${r.preco_informado ? '' : ' (FIPE zero km)'}</span>
    </div>
    <table class="tabela rv-quantis">
      <thead><tr><th></th><th class="num">Nominal</th><th class="num">% compra</th><th class="num">Real</th><th class="num">% real</th></tr></thead>
      <tbody>${QUANTIS.map(([k, rot]) => `<tr${k === 'p50' ? ' class="rv-p50"' : ''}><td>${rot}</td><td class="num">${brl(r[k].nominal)}</td><td class="num">${pctSimples(r[k].pct)}</td>
        <td class="num">${r[k].real == null ? '' : brl(r[k].real)}</td><td class="num">${r[k].pct_real == null ? '' : pctSimples(r[k].pct_real)}</td></tr>`).join('')}</tbody>
    </table>
    <dl class="rv-dl rv-insumos">
      <div><dt>Estudo</dt><dd>${dia(i.data_estudo)}</dd></div>
      <div><dt>FIPE</dt><dd>${i.referencia_fipe ? mesAno(`${i.referencia_fipe}-01`) : ''}</dd></div>
      <div><dt>Anúncios</dt><dd>${num(i.n_anuncios)}${i.km_emprestado ? ' <span class="conferir">outros</span>' : ''}</dd></div>
      <div><dt>Desvalorização P50</dt><dd>${pctSimples(i.r_p50)}${i.r_emprestado ? ' <span class="conferir">emprestada</span>' : ''}</dd></div>
      <div><dt>Por 10 mil km</dt><dd>${i.fator_10mil == null ? '' : pct(i.fator_10mil)}</dd></div>
      <div><dt>Km típico</dt><dd>${i.km_tipico == null ? '' : `${num(Math.round(i.km_tipico))} km`}</dd></div>
      <div><dt>Ajuste de km</dt><dd>${pct(i.fator_km - 1)}</dd></div>
      <div><dt>Canal</dt><dd>${pctSimples(i.multiplicador)}</dd></div>
      <div><dt>Premissas</dt><dd>atacado ${num(p.atacado_pct_base)}% · varejo −${num(p.varejo_negociacao_pct)}% · motorista ${num(p.motorista_pct_base)}%</dd></div>
    </dl>`;
}
```

- [ ] **Step 2: Premissas**: `public/js/revenda/premissas.js`:

```js
import { get, put, patch } from '../api.js';
import { dia, esc } from '../formato.js';
import { ir } from '../app.js';

const ROTULOS = [
  ['atacado_pct_base', 'Atacado', '% do preço-base'],
  ['varejo_negociacao_pct', 'Negociação no varejo', '% do anúncio'],
  ['motorista_pct_base', 'Motorista', '% do preço-base'],
];
const COMBUSTIVEIS = [[5, 'Flex'], [4, 'Elétrico'], [6, 'Híbrido']];
const val = v => (v == null ? '' : esc(v));

export async function rvPremissas(tela) {
  const { premissas, modelos } = await get('/api/revenda/premissas');
  const porChave = new Map(premissas.map(p => [p.chave, p]));
  tela.innerHTML = `<div class="rv-premissas">
    <section>
      <h2>Premissas</h2>
      <form class="form" id="f-prem">
        ${ROTULOS.map(([k, rot, un]) => {
          const p = porChave.get(k);
          return `<label>${esc(rot)}<span class="rv-linha"><input name="${k}" type="number" min="0" max="200" step="0.5" value="${val(p?.valor)}" required><i>${esc(un)}</i></span>
            <small>desde ${p ? dia(p.atualizado_em.slice(0, 10)) : ''}</small></label>`;
        }).join('')}
        <div class="acoes"><button class="btn" type="submit">Salvar</button><span class="teste" id="r-prem" role="status"></span></div>
      </form>
    </section>
    <section>
      <h2>Modelos</h2>
      <div class="tabela-rolagem"><table class="tabela rv-params">
        <thead><tr><th>Modelo</th><th>Marca</th><th>Código</th><th>Combustível</th><th>Referência</th><th>Mobiauto</th><th>Versão</th><th></th></tr></thead>
        <tbody>${modelos.map(linha).join('')}</tbody>
      </table></div>
      <p class="erro" id="e-params" role="alert" hidden></p>
    </section>
  </div>`;

  const form = tela.querySelector('#f-prem');
  const aviso = tela.querySelector('#r-prem');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const botao = form.querySelector('button');
    botao.disabled = true;
    aviso.textContent = '';
    try {
      await put('/api/revenda/premissas', Object.fromEntries(ROTULOS.map(([k]) => [k, Number(form[k].value)])));
      ir(location.pathname, false);
    } catch (x) { aviso.textContent = x.message; botao.disabled = false; }
  });

  const erro = tela.querySelector('#e-params');
  tela.querySelector('.rv-params').addEventListener('click', async e => {
    const b = e.target.closest('button[data-salvar]');
    if (!b) return;
    const tr = b.closest('tr');
    const campo = n => tr.querySelector(`[name="${n}"]`).value.trim();
    const numero = n => (campo(n) === '' ? null : Number(campo(n)));
    erro.hidden = true;
    b.disabled = true;
    try {
      await patch(`/api/revenda/modelos/${b.dataset.salvar}`, {
        fipe_marca: numero('fipe_marca'), fipe_modelo: numero('fipe_modelo'), fipe_combustivel: numero('fipe_combustivel'),
        fipe_modelo_ref: numero('fipe_modelo_ref'), mobiauto_caminho: campo('mobiauto_caminho') || null, mobiauto_versao: campo('mobiauto_versao') || null,
      });
      b.textContent = 'Salvo';
      setTimeout(() => { b.textContent = 'Salvar'; b.disabled = false; }, 1200);
    } catch (x) { erro.textContent = x.message; erro.hidden = false; b.disabled = false; }
  });

}

function linha(m) {
  return `<tr${m.ativo ? '' : ' class="inativo"'}>
    <td>${esc(m.nome)}</td>
    <td><input name="fipe_marca" type="number" min="1" value="${val(m.fipe_marca)}" aria-label="Marca FIPE"></td>
    <td><input name="fipe_modelo" type="number" min="1" value="${val(m.fipe_modelo)}" aria-label="Código FIPE"></td>
    <td><select name="fipe_combustivel" aria-label="Combustível"><option value=""></option>${COMBUSTIVEIS.map(([v, r]) => `<option value="${v}"${m.fipe_combustivel === v ? ' selected' : ''}>${r}</option>`).join('')}</select></td>
    <td><input name="fipe_modelo_ref" type="number" min="1" value="${val(m.fipe_modelo_ref)}" aria-label="Código de referência"></td>
    <td><input name="mobiauto_caminho" value="${val(m.mobiauto_caminho)}" aria-label="Caminho na Mobiauto"></td>
    <td><input name="mobiauto_versao" value="${val(m.mobiauto_versao)}" aria-label="Versão na Mobiauto"></td>
    <td><button class="btn sec" type="button" data-salvar="${esc(m.id)}">Salvar</button></td>
  </tr>`;
}
```

- [ ] **Step 3: Vendas**: `public/js/revenda/vendas.js`:

```js
import { get, post } from '../api.js';
import { brl, num, pct, dia, esc } from '../formato.js';
import { ir } from '../app.js';

const CANAIS = [['atacado', 'Atacado'], ['varejo', 'Varejo'], ['motorista', 'Motorista']];
const NOME_CANAL = Object.fromEntries(CANAIS);
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export async function rvVendas(tela) {
  const [vendas, modelos] = await Promise.all([get('/api/revenda/vendas'), get('/api/revenda/modelos')]);
  tela.innerHTML = `<div class="rv-vendas">
    <form class="rv-nova" id="f-venda">
      <label>Placa<input name="placa" required maxlength="8" autocomplete="off"></label>
      <label>Modelo<select name="modelo">${modelos.map(m => `<option value="${esc(m.slug)}">${esc(m.nome)}</option>`).join('')}</select></label>
      <label>Data<input name="data" type="date" required value="${hoje()}" max="${hoje()}"></label>
      <label>Km<input name="km" type="number" min="0" max="500000" step="1" required></label>
      <label>Preço<input name="preco" type="number" min="1000" step="1" required></label>
      <label>Canal<select name="canal">${CANAIS.map(([v, r]) => `<option value="${v}">${r}</option>`).join('')}</select></label>
      <button class="btn" type="submit">Registrar</button>
    </form>
    <p class="erro" id="e-venda" role="alert" hidden></p>
    <div class="tabela-rolagem">
      ${vendas.length ? `<table class="tabela">
        <thead><tr><th>Data</th><th>Placa</th><th>Modelo</th><th>Canal</th><th class="num">Km</th><th class="num">Preço</th><th class="num">Previsto</th><th class="num">Diferença</th></tr></thead>
        <tbody>${vendas.map(linha).join('')}</tbody>
      </table>` : '<p class="vazio">Nenhuma venda</p>'}
    </div>
  </div>`;
  const form = tela.querySelector('#f-venda');
  const erro = tela.querySelector('#e-venda');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const botao = form.querySelector('button');
    if (botao.disabled) return;
    botao.disabled = true;
    erro.hidden = true;
    try {
      await post('/api/revenda/vendas', {
        placa: form.placa.value, modelo: form.modelo.value, data: form.data.value,
        km: Number(form.km.value), preco: Number(form.preco.value), canal: form.canal.value,
      });
      ir(location.pathname, false);
    } catch (x) { erro.textContent = x.message; erro.hidden = false; botao.disabled = false; }
  });
}

function linha(v) {
  const cls = v.diferenca == null ? '' : v.diferenca >= 0 ? 'desce' : 'sobe';
  return `<tr>
    <td>${dia(v.data)}</td><td>${esc(v.placa)}</td><td>${esc(v.nome)}</td><td>${esc(NOME_CANAL[v.canal] ?? v.canal)}</td>
    <td class="num">${num(v.km)}</td><td class="num">${brl(v.preco)}</td><td class="num">${v.previsto == null ? '' : brl(v.previsto)}</td>
    <td class="num"><span class="var ${cls}">${v.diferenca == null ? '' : pct(v.diferenca)}</span></td>
  </tr>`;
}
```

- [ ] **Step 4: Rotas**: em `public/js/app.js`, depois de `import { rvModelo } from './revenda/modelo.js';`:

```js
import { rvSimulador } from './revenda/simulador.js';
import { rvPremissas } from './revenda/premissas.js';
import { rvVendas } from './revenda/vendas.js';
```

e em `ROTAS`, entre `[/^\/revenda$/, rvModelos],` e `[/^\/revenda\/([\w-]+)$/, rvModelo],` (a ordem importa: o detalhe por slug fica por último):

```js
  [/^\/revenda\/simulador$/, rvSimulador],
  [/^\/revenda\/premissas$/, rvPremissas],
  [/^\/revenda\/vendas$/, rvVendas],
```

- [ ] **Step 5: Conferir no navegador** (mesmo servidor de demonstração da Task 8, 1280×585):
  - `/revenda/simulador?modelo=polo-track`: P50 atacado 12 meses 70 mil km em destaque, tabela P10/P50/P90 com nominal, % compra, real e % real, insumos; trocar canal, km (botões e campo), meses e preço recalcula sem piscar a tela; `meses` 30 mostra `meses entre 1 e 24`.
  - `/revenda/premissas`: três premissas com "desde"; mudar Atacado para 80 e Salvar recarrega com 80; na tabela de modelos, versão `([` em King e Salvar mostra o erro; `^GL` salva e o botão vira "Salvo".
  - `/revenda/vendas`: a venda da demonstração com previsto e diferença em verde; registrar uma venda nova aparece no topo da lista; placa `X1` mostra `placa inválida`.
  - página sem rolar (`scrollHeight` = 585) e console sem erro nas três.
  - Parar o servidor de demonstração (TaskStop) e apagar `demo.db*`.

- [ ] **Step 6: Testes e commit**

Run: `npm test` → `ℹ tests 137`, `ℹ fail 0`.

```bash
git add public/js/app.js public/js/revenda/simulador.js public/js/revenda/premissas.js public/js/revenda/vendas.js
git commit -m "Front da Revenda: Simulador, Premissas (com parametros FIPE/Mobiauto) e Vendas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Animações

**Files:**
- Modify: `public/css/revenda.css`, `public/js/revenda/simulador.js`, e os outros `public/js/revenda/*.js` que as propostas aceitas tocarem

**Interfaces:**
- Consumes: keyframes `surge` e `chega`, `--curva` e o bloco `prefers-reduced-motion` de `public/css/telas.css`; classe `entra` que `app.js` põe na tela nova.
- Produces: nada usado depois.

- [ ] **Step 1:** Carregar a skill `find-animation-opportunities` e rodar sobre `public/js/revenda/` e `public/css/revenda.css` (telas Modelos, Modelo, Simulador, Premissas, Vendas). Ela só propõe, com valores exatos, e descarta o que não deve animar.
- [ ] **Step 2:** Implementar as aceitas com a skill `animate`, nas mesmas regras das Revisões: só `transform` e `opacity`; até 250 ms; saída mais curta que a entrada; nada some animado; o bloco `prefers-reduced-motion` que já existe em `telas.css` desliga tudo. O ponto de partida, que a skill pode ajustar, é este bloco no fim de `public/css/revenda.css`:

```css
/* Movimento da Revenda: cartões entram escalonados; o resultado do Simulador troca com um fade curto */
.rv-modelos.entra { animation: none; }
.rv-modelos.entra h2 { animation: surge 160ms var(--curva); }
.rv-modelos.entra .rv-cartao { animation: chega 160ms var(--curva) backwards; animation-delay: calc(min(var(--i, 0), 3) * 30ms); }
.rv-cartao { transition: box-shadow .15s ease; }
.rv-resultado.troca .rv-destaque strong, .rv-resultado.troca .rv-quantis tbody { animation: surge 140ms var(--curva); }
.rv-campo .filtros button { transition: transform 120ms var(--curva); }
.rv-campo .filtros button:active { transform: scale(.97); }
```

e em `public/js/revenda/simulador.js`, dentro de `calcular()`, trocar `if (minha === rodada) saida.innerHTML = resultado(r);` por:

```js
      if (minha === rodada) {
        saida.innerHTML = resultado(r);
        saida.classList.remove('troca');
        void saida.offsetWidth; // reinicia a animação a cada resultado novo
        saida.classList.add('troca');
      }
```

- [ ] **Step 3:** Conferir no navegador (servidor de demonstração da Task 8): nada pula de lugar nem atrasa clique; os gráficos da tela Modelo entram em 250 ms (já configurado em `revenda/graficos.js`); com `prefers-reduced-motion` (DevTools, Rendering) tudo aparece direto.
- [ ] **Step 4: Commit**

```bash
git add public
git commit -m "Animacoes da Revenda (find-animation-opportunities + animate), respeitando reduced motion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: KPIs: seletor Digitado / Do estudo no Sandbox

Repo `C:/Users/enric_zg4u5vi/OneDrive/Desktop/CLAUDE_1/ocn-kpis-site`, branch `experimentos` (conferir com `git -C ../ocn-kpis-site branch --show-current`). Escopo mínimo: nenhuma outra tela do KPIs muda.

**Files:**
- Create: `lib/revenda.js`, `tests/revenda.test.js`
- Modify: `config/static.js` (3 constantes e o `module.exports`), `server.js` (require, rota nova e um campo em `/api/sandbox/bases`), `public/sandbox-engine.js` (`limparAlteracoes`, `semIguais`, `avaliar`), `public/sandbox.js` (estado, carga, `mudar`, `vendaA2` e ouvintes do painel), `public/styles.css` (3 regras no fim)

**Interfaces:**
- Consumes: `GET <REVENDA_URL>/api/revenda/projecao` com `Authorization: Bearer <REVENDA_TOKEN>` (Task 7); `requireGiga`, `sandbox`, `THEORIC_SEED` (`server.js`); `aplicar`, `refazer`, `premissasDe`, `selecionado`, `api`, `msg`, `num` (`public/sandbox.js`).
- Produces: `buscarProjecao({ modelo, meses, km, canal, preco }, { url, token, buscar, agora })`, `configurado(cfg)`, `limparCache()`, `UMA_HORA` (`lib/revenda.js`); `C.REVENDA_URL`, `C.REVENDA_TOKEN`, `C.REVENDA_SLUG = { Polo: 'polo-track', Argo: 'argo-drive', Tera: 'tera', tera_compra: 'tera', dolphin_compra: 'byd-dolphin', dolphin_sub: 'byd-dolphin' }` (id do modelo do Theoric → slug do Preços); rota `GET /api/sandbox/revenda-estudo?modelo=<id do Theoric>&meses=&km=&canal=&preco=`; `GET /api/sandbox/bases` ganha `revenda: { modelos: [ids] } | null`; alteração de cenário `revenda_estudo: { canal, km, data_estudo }`.

- [ ] **Step 1: Teste que falha**: `tests/revenda.test.js`:

```js
// node --test tests/
// A leitura da projeção de revenda do site de Preços, contra um servidor falso.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const R = require('../lib/revenda');
const E = require('../public/sandbox-engine.js');

const PROJECAO = { modelo: 'polo-track', meses: 12, km: 70000, canal: 'atacado', preco: 89990, p50: { nominal: 61000, pct: 0.6779 }, insumos: { data_estudo: '2026-11-02' } };

async function falso(responder) {
  const pedidos = [];
  const s = http.createServer((req, res) => {
    pedidos.push({ url: req.url, auth: req.headers.authorization });
    const { status, corpo } = responder(req);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(corpo));
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + s.address().port, pedidos, fechar: () => new Promise((r) => s.close(r)) };
}

test('buscarProjecao manda o token, monta a consulta e guarda por 1 hora', async () => {
  R.limparCache();
  const f = await falso(() => ({ status: 200, corpo: PROJECAO }));
  const op = { url: f.url + '/', token: 'tok', agora: 1000 };
  const pedido = { modelo: 'polo-track', meses: 12, km: 70000, canal: 'atacado', preco: 89990 };
  const a = await R.buscarProjecao(pedido, op);
  assert.equal(a.p50.pct, 0.6779);
  assert.equal(f.pedidos.length, 1);
  assert.equal(f.pedidos[0].url, '/api/revenda/projecao?modelo=polo-track&meses=12&km=70000&canal=atacado&preco=89990');
  assert.equal(f.pedidos[0].auth, 'Bearer tok');
  await R.buscarProjecao(pedido, { ...op, agora: 1000 + R.UMA_HORA - 1 });
  assert.equal(f.pedidos.length, 1, 'dentro da hora vem do cache');
  await R.buscarProjecao(pedido, { ...op, agora: 1000 + R.UMA_HORA + 1 });
  assert.equal(f.pedidos.length, 2, 'passou da hora: pede de novo');
  await R.buscarProjecao({ ...pedido, km: 30000 }, op);
  assert.equal(f.pedidos.length, 3, 'outro km é outro pedido');
  await f.fechar();
});

test('sem preço não manda o parâmetro; erro do site vira mensagem', async () => {
  R.limparCache();
  const f = await falso((req) => (req.url.includes('meses=30') ? { status: 400, corpo: { erro: 'meses entre 1 e 24' } } : { status: 200, corpo: PROJECAO }));
  await R.buscarProjecao({ modelo: 'tera', meses: 12, km: 50000, canal: 'varejo' }, { url: f.url, token: 't' });
  assert.equal(f.pedidos[0].url, '/api/revenda/projecao?modelo=tera&meses=12&km=50000&canal=varejo');
  await assert.rejects(R.buscarProjecao({ modelo: 'tera', meses: 30, km: 1, canal: 'varejo' }, { url: f.url, token: 't' }), /Revenda: meses entre 1 e 24/);
  await f.fechar();
});

test('sem URL ou token não está configurado e não chama nada', async () => {
  assert.equal(R.configurado({ REVENDA_URL: '', REVENDA_TOKEN: 'x' }), false);
  assert.equal(R.configurado({ REVENDA_URL: 'https://precos.ocnbrasil.com.br', REVENDA_TOKEN: 'x' }), true);
  await assert.rejects(R.buscarProjecao({ modelo: 'tera', meses: 12, km: 1, canal: 'atacado' }, { url: '', token: '', buscar: () => { throw new Error('não deveria chamar'); } }), /não configurados/);
});

test('o cenário guarda a origem da revenda do estudo', () => {
  const alt = E.limparAlteracoes({ revenda_pct: 67.79, revenda_estudo: { canal: 'atacado', km: 70000.4, data_estudo: '2026-11-02T00:00' } });
  assert.deepEqual(alt.revenda_estudo, { canal: 'atacado', km: 70000, data_estudo: '2026-11-02' });
  assert.deepEqual(E.semIguais({ revenda_pct: 70 }, alt).revenda_estudo, alt.revenda_estudo);
  assert.throws(() => E.limparAlteracoes({ revenda_estudo: { canal: 'leilao', km: 1 } }), /Canal da revenda/);
  assert.throws(() => E.limparAlteracoes({ revenda_estudo: { canal: 'varejo', km: -1 } }), /Km da revenda/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ../ocn-kpis-site && node --test tests/revenda.test.js tests/sandbox-engine.test.js`
Expected: FAIL, `Cannot find module '../lib/revenda'`.

- [ ] **Step 3: Configuração**: em `config/static.js`, logo depois de `const REVISAO_KM = 10000; // revisão a cada 10.000 km`:

```js
// Módulo Revenda do site de Preços (projeção do preço de revenda). Sem URL, o seletor do Sandbox some.
const REVENDA_URL = process.env.REVENDA_URL || '';
const REVENDA_TOKEN = process.env.REVENDA_TOKEN || '';
// Modelo do Theoric (id) → slug do modelo no site de Preços
const REVENDA_SLUG = { Polo: 'polo-track', Argo: 'argo-drive', Tera: 'tera', tera_compra: 'tera', dolphin_compra: 'byd-dolphin', dolphin_sub: 'byd-dolphin' };
```

e no `module.exports`, a linha `  FROTA_API, FROTA_TOKEN, REVISOES_API, REVISAO_KM, modelos, corEsperado, mapModelo,` vira:

```js
  FROTA_API, FROTA_TOKEN, REVISOES_API, REVISAO_KM, REVENDA_URL, REVENDA_TOKEN, REVENDA_SLUG, modelos, corEsperado, mapModelo,
```

- [ ] **Step 4: Leitura**: `lib/revenda.js`:

```js
// =====================================================================
// REVENDA: projeção do preço de revenda pelo estudo do site de Preços
// (módulo Revenda, GET /api/revenda/projecao com token). Cache de 1 h por pedido.
// =====================================================================
const C = require('../config/static');

const UMA_HORA = 60 * 60 * 1000;
const cache = new Map();

function configurado(cfg = C) {
  return !!(cfg.REVENDA_URL && cfg.REVENDA_TOKEN);
}

async function buscarProjecao({ modelo, meses, km, canal, preco }, { url = C.REVENDA_URL, token = C.REVENDA_TOKEN, buscar = fetch, agora = Date.now() } = {}) {
  if (!url || !token) throw new Error('Revenda: REVENDA_URL e REVENDA_TOKEN não configurados');
  const q = new URLSearchParams({ modelo: String(modelo), meses: String(meses), km: String(km), canal: String(canal) });
  if (preco) q.set('preco', String(preco));
  const chave = q.toString();
  const guardado = cache.get(chave);
  if (guardado && agora - guardado.em < UMA_HORA) return guardado.dados;
  const r = await buscar(url.replace(/\/$/, '') + '/api/revenda/projecao?' + chave, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Revenda: ' + (j.erro || 'o site de Preços respondeu ' + r.status));
  cache.set(chave, { em: agora, dados: j });
  return j;
}

function limparCache() { cache.clear(); }

module.exports = { buscarProjecao, configurado, limparCache, UMA_HORA };
```

- [ ] **Step 5: Motor do Sandbox guarda a origem**: em `public/sandbox-engine.js`, três mudanças.

Em `limparAlteracoes`, logo antes de `      if (!CAMPOS[k]) throw new Error('Campo desconhecido no cenário: ' + k);`:

```js
      // de onde veio a % de revenda quando ela sai do estudo do site de Preços
      if (k === 'revenda_estudo') {
        if (!v || typeof v !== 'object') throw new Error('A revenda do estudo vem com canal, km e data.');
        if (!['atacado', 'varejo', 'motorista'].includes(v.canal)) throw new Error('Canal da revenda inválido: use atacado, varejo ou motorista.');
        const km = Number(v.km);
        if (!isFinite(km) || km < 0) throw new Error('Km da revenda inválido.');
        out.revenda_estudo = { canal: v.canal, km: Math.round(km), data_estudo: String(v.data_estudo || '').slice(0, 10) };
        return;
      }
```

Em `semIguais`, logo depois da linha do `rev_tabela`:

```js
      if (k === 'revenda_estudo') { if (alt.revenda_estudo) out.revenda_estudo = alt.revenda_estudo; return; }
```

Em `avaliar`, logo antes de `      peso(k, calcular(premissas(base, { [k]: alt[k] })));`:

```js
      if (k === 'revenda_estudo') return;   // só a origem da % de revenda: não mexe na conta
```

- [ ] **Step 6: Rodar e ver passar**

Run: `node --test tests/revenda.test.js tests/sandbox-engine.test.js`
Expected: `ℹ tests 16`, `ℹ pass 16`, `ℹ fail 0` (4 novos + os 12 que já existiam).

- [ ] **Step 7: Rota do servidor**: em `server.js`, logo depois de `const sandbox = require('./lib/sandbox');`:

```js
const revenda = require('./lib/revenda');
```

Em `GET /api/sandbox/bases`, a linha do `try` vira:

```js
  try { res.json({ bases: await sandbox.bases(THEORIC_SEED), revisoes: sandbox.tabelasRevisao(sbRevisoes()), revenda: revenda.configurado() ? { modelos: Object.keys(C.REVENDA_SLUG) } : null }); } catch (e) { sbErro(res, e); }
```

E logo depois do bloco dessa rota (o `});` que fecha `/api/sandbox/bases`):

```js
// a revenda do estudo do site de Preços para um cenário (Giga Admin, como as outras do Sandbox)
app.get('/api/sandbox/revenda-estudo', requireGiga, async (req, res) => {
  if (!revenda.configurado()) return res.status(404).json({ error: 'Revenda do estudo não configurada.' });
  const slug = C.REVENDA_SLUG[String(req.query.modelo || '')];
  if (!slug) return res.status(400).json({ error: 'Modelo sem estudo de revenda: ' + req.query.modelo });
  const preco = Number(req.query.preco);
  try {
    res.json(await revenda.buscarProjecao({ modelo: slug, meses: Math.round(Number(req.query.meses) || 12), km: Math.max(0, Math.round(Number(req.query.km) || 0)), canal: String(req.query.canal || 'atacado'), preco: preco > 0 ? Math.round(preco) : null }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 8: Tela do Sandbox**: em `public/sandbox.js`, seis mudanças.

(a) No fim da linha 18 (`let pronto = false, ... editarTabela = false;`), antes do `;`, acrescentar `, revendaEstudo = null`.

(b) Em `carregar()`, depois de `    revTabelas = b.revisoes || {};`:

```js
    revendaEstudo = b.revenda || null;
```

(c) Em `mudar`, a venda digitada à mão tira a origem do estudo. O começo da função fica:

```js
  function mudar(c, k, v) {
    const base = c.base_premissas[k];
    const alt = { ...c.alteracoes };
    if (k === 'revenda_pct') delete alt.revenda_estudo;
```

(d) Logo antes do comentário `  // a venda do carro em valor: edita a % de revenda por baixo; a % fica à esquerda`:

```js
  // revenda do estudo (site de Preços): só para os modelos do Theoric que têm slug lá
  const CANAL_RV = { atacado: 'Atacado', varejo: 'Varejo', motorista: 'Motorista' };
  const temEstudo = (c) => !!(revendaEstudo && revendaEstudo.modelos.includes(c.base.modelo_id));
  const kmDoCenario = (p) => Math.round(num(p.km_semana) * (52 / 12) * num(p.prazo) / 1000) * 1000;
  function seletorRevenda(c, est) {
    if (!temEstudo(c)) return '';
    return '<span class="sb-seg sb-seg-mini sb-rv" style="--i:' + (est ? 1 : 0) + '"><span class="sb-seg-pin"></span>' +
      '<button type="button" class="sb-seg-b' + (est ? '' : ' on') + '" data-rvmodo="dig">Digitado</button>' +
      '<button type="button" class="sb-seg-b' + (est ? ' on' : '') + '" data-rvmodo="est">Do estudo</button></span>' +
      (est ? '<select class="sb-rv-canal" data-rvcanal aria-label="Canal de venda">' + Object.keys(CANAL_RV).map((k) => '<option value="' + k + '"' + (k === est.canal ? ' selected' : '') + '>' + CANAL_RV[k] + '</option>').join('') + '</select>' +
        '<input type="number" class="sb-a2-in sb-rv-km" data-rvkm value="' + est.km + '" step="1000" min="0" aria-label="Km no fim">' : '');
  }
  // pede a % ao site de Preços (P50 nominal do canal, sobre o preço de compra) e guarda a origem
  async function usarEstudo(c, canal, km) {
    const p = premissasDe(c);
    const sobre = p.forma === 'subrental' ? num(p.recompra) : num(p.preco_carro);
    const q = new URLSearchParams({ modelo: c.base.modelo_id, meses: String(p.prazo), km: String(km), canal });
    if (sobre > 0) q.set('preco', String(Math.round(sobre)));
    try {
      const r = await api('GET', '/api/sandbox/revenda-estudo?' + q.toString());
      aplicar(c, { ...c.alteracoes, revenda_pct: Math.round(r.p50.pct * 1e6) / 1e4, revenda_estudo: { canal, km, data_estudo: r.insumos.data_estudo } });
      refazer();
    } catch (e) { msg(e.message, true); }
  }
```

(e) Dentro de `vendaA2`, três trocas. Antes do `return linhaA2({ nome: 'Venda do carro', ...`:

```js
    const est = (c.alteracoes || {}).revenda_estudo;
    const origem = est ? ' · do estudo de ' + est.data_estudo.split('-').reverse().join('/') + ', ' + CANAL_RV[est.canal].toLowerCase() + ', ' + Math.round(est.km / 1000) + ' mil km' : '';
```

na mesma linha do `return`, o fim `(p.forma === 'subrental' ? 'da recompra' : 'da compra'),` vira `(p.forma === 'subrental' ? 'da recompra' : 'da compra') + origem,`; a linha `      sub: '<span class="sb-cf t-pct sb-cf-txt">...` passa a começar com `      sub: seletorRevenda(c, est) + '<span class="sb-cf t-pct sb-cf-txt">` (o resto igual); e `desfazer: mudou ? 'data-k2="revenda_pct"' : '' });` vira `desfazer: mudou ? 'data-k2="revenda_pct,revenda_estudo"' : '' });`.

(f) Em `ligarEditor`, logo depois de `    box.dataset.ligado = '1';` (a da função `ligarEditor(box)`, perto da linha 1524, não a da linha 839):

```js
    // revenda do estudo: Digitado ou Do estudo; canal e km no fim refazem o pedido
    box.addEventListener('click', (ev) => {
      const t = ev.target.closest ? ev.target.closest('[data-rvmodo]') : null; const c = selecionado();
      if (!t || !c) return;
      const est = (c.alteracoes || {}).revenda_estudo;
      if (t.dataset.rvmodo === 'dig') { if (est) { const alt = { ...c.alteracoes }; delete alt.revenda_estudo; aplicar(c, alt); refazer(); } return; }
      usarEstudo(c, est ? est.canal : 'atacado', est ? est.km : kmDoCenario(premissasDe(c)));
    });
    box.addEventListener('change', (ev) => {
      const t = ev.target; const c = selecionado();
      if (!c || !t.dataset || (t.dataset.rvcanal == null && t.dataset.rvkm == null)) return;
      const est = (c.alteracoes || {}).revenda_estudo || { canal: 'atacado', km: kmDoCenario(premissasDe(c)) };
      usarEstudo(c, t.dataset.rvcanal != null ? t.value : est.canal, t.dataset.rvkm != null ? Math.max(0, Math.round(Number(t.value) || 0)) : est.km);
    });
```

(O ouvinte de `change` que já existe só reage a `.sb-range` e `.sb-num`; o km usa `.sb-a2-in` e o canal é um `select`, então os dois não se cruzam.)

- [ ] **Step 9: Estilo**: no fim de `public/styles.css`:

```css
/* Sandbox: revenda do estudo do site de Preços */
.sb-rv { flex: none; }
.sb-rv-canal { height: 24px; padding: 0 4px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); font: 600 12px var(--font); }
.sb-rv-km { width: 78px; flex: none; }
```

- [ ] **Step 10: Conferir no navegador** (local; usuário de desenvolvimento do `.env` do KPIs, nunca em produção): subir o Preços com o `demo.db` da Task 8 e `REVENDA_TOKEN=token-local`, e o KPIs com `REVENDA_URL=http://localhost:3077 REVENDA_TOKEN=token-local PORT=3010 npm start`. Na aba Sandbox, num cenário do Polo: o seletor aparece em "Venda do carro"; "Do estudo" preenche a % com a P50 atacado do km do cenário (km/semana × 52/12 × prazo) e a dica mostra a origem; trocar canal e km refaz; mexer no slider da venda volta para Digitado; cenário de modelo sem slug (Geely) não mostra o seletor; sem `REVENDA_URL` o seletor some. Se o KPIs não subir localmente (falta de credencial no `.env`), esta conferência passa para a Task 13, Step 8.

- [ ] **Step 11: Commit (só local, sem push)**

```bash
git -C ../ocn-kpis-site add lib/revenda.js tests/revenda.test.js config/static.js server.js public/sandbox-engine.js public/sandbox.js public/styles.css
git -C ../ocn-kpis-site commit -m "Sandbox: revenda Digitado ou Do estudo (projecao do site de Precos, cache de 1 h)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Ensaio com cópia da produção

Nada é escrito em produção. A cópia é feita por `VACUUM INTO` dentro do container (segura com WAL), baixada para o notebook e migrada aqui.

**Files:**
- Nenhum arquivo do repo (as cópias `copia-producao*.db*` já estão no `.gitignore`).

- [ ] **Step 1: Cópia de produção, só leitura** (SSH root na VPS a partir do notebook; app do Preços no Coolify `d8qy3lvsre5k21jqttnk5baj`):

```bash
ssh root@200.141.23.108 'CT=$(docker ps --format "{{.Names}}" | grep d8qy3lvsre5k21jqttnk5baj | head -1); docker exec "$CT" node --experimental-sqlite -e "const { DatabaseSync } = require(\"node:sqlite\"); const d = new DatabaseSync(process.env.DB_PATH || \"/data/revisoes.db\", { readOnly: true }); d.prepare(\"VACUUM INTO ?\").run(\"/tmp/copia-revenda.db\"); d.close();" && docker cp "$CT":/tmp/copia-revenda.db /tmp/copia-revenda.db && docker exec "$CT" rm /tmp/copia-revenda.db'
scp root@200.141.23.108:/tmp/copia-revenda.db ./copia-producao-revenda.db
ssh root@200.141.23.108 'rm /tmp/copia-revenda.db'
node --experimental-sqlite -e "const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync('copia-producao-revenda.db'); console.log(d.prepare('PRAGMA integrity_check').get(), d.prepare('SELECT MAX(versao) v FROM schema_versao').get(), d.prepare('SELECT (SELECT COUNT(*) FROM precos) precos, (SELECT COUNT(*) FROM vigencias) vigencias, (SELECT COUNT(*) FROM alertas) alertas').get())"
```

Expected: `integrity_check: 'ok'`, `v: 2`, e as três contagens anotadas para o Step 2. Se `readOnly` não existir no Node do container, tirar a opção (o `VACUUM INTO` não escreve no banco de origem).

- [ ] **Step 2: Migrar a cópia e conferir que o histórico não mudou**

```bash
node --experimental-sqlite --input-type=module -e "
import { abrir } from './src/db.js';
import { migrar } from './src/migracoes/index.js';
const db = abrir('copia-producao-revenda.db');
const conta = () => db.prepare('SELECT (SELECT COUNT(*) FROM precos) precos, (SELECT COUNT(*) FROM vigencias) vigencias, (SELECT COUNT(*) FROM alertas) alertas').get();
const antes = JSON.stringify(conta());
console.log('schema', migrar(db));
console.log('historico igual', JSON.stringify(conta()) === antes);
console.log(db.prepare('SELECT slug, fipe_modelo, mobiauto_caminho FROM modelos ORDER BY id').all());
db.close();"
```

Expected: `schema 3`, `historico igual true`, os seis modelos com código FIPE e caminho da Mobiauto.

- [ ] **Step 3: Rodada completa contra a cópia** (rede de verdade, só leitura nas fontes; uns 30 minutos; ferramenta Bash com `run_in_background`, sem WhatsApp e sem Ativos):

```bash
DB_PATH=copia-producao-revenda.db npm run coletar -- --sem-alerta --manual > ensaio-revenda.log 2>&1
```

Expected no fim do `ensaio-revenda.log`: `"revenda"` com `ipca.status`, `fipe.status` e `mobiauto.status` iguais a `"ok"` (ou `"parcial"` com o motivo em `erros`), `fipe.itens` acima de 1.000 e `"estudos": 6`. Se alguma fonte falhar, parar e investigar (skill `systematic-debugging`) antes de seguir.

- [ ] **Step 4: Números plausíveis**

```bash
node --experimental-sqlite --input-type=module -e "
import { abrir } from './src/db.js';
import { modelosRevenda, projecao } from './src/revenda/consultas.js';
const db = abrir('copia-producao-revenda.db');
for (const m of modelosRevenda(db)) {
  let p = null; try { p = projecao(db, { modelo: m.slug, meses: '12', km: '70000', canal: 'atacado' }); } catch (e) { p = { erro: e.message }; }
  console.log(m.slug, m.n_anuncios, m.fator_10mil?.toFixed(4), m.p50_12m, p.p50 ? [p.preco, p.p50.nominal, p.p50.pct.toFixed(3), p.insumos.r_emprestado, p.insumos.km_emprestado] : p.erro);
}
db.close();"
```

Expected: para Polo Track e Argo Drive, `r_emprestado` falso, P50 de 12 meses entre 60% e 95% do zero km, fator por 10 mil km entre −8% e 0%, dezenas de anúncios ou mais. Tera e Onix com `r_emprestado` verdadeiro (código novo, usam o de referência). Anotar os seis números para mostrar ao Enrico. Fora dessas faixas: parar e investigar.

- [ ] **Step 5: Telas com a cópia**: subir `DB_PATH=copia-producao-revenda.db PORT=3077 ADMIN_SENHA_HASH="$(node scripts/gerar-hash.js teste-local)" SESSION_SECRET=local-ensaio REVENDA_TOKEN=token-local node --experimental-sqlite server.js` em segundo plano; no navegador, 1280×585, as cinco telas da Revenda e as quatro das Revisões (as das Revisões têm de estar iguais às de produção); captura de cada uma. Conferir também `curl -s -H "Authorization: Bearer token-local" "http://localhost:3077/api/revenda/projecao?modelo=polo-track&km=70000"` (200) e sem o cabeçalho (401).

- [ ] **Step 6: Suite e estado da branch**

Run: `npm test` → `ℹ tests 137`, `ℹ fail 0`. `git status --short` sem nada fora do `.gitignore`. Parar o servidor do ensaio.

- [ ] **Step 7: PARAR.** Mostrar ao Enrico as capturas, os números do Step 4, o `git log --oneline main..revenda` e o `git -C ../ocn-kpis-site log --oneline -3`. Pedir OK explícito para a Task 13 (push, merge, variáveis, primeira rodada em produção). Sem esse OK, nada da Task 13 acontece.

---

### Task 13: Implantação (só com OK do Enrico)

- [ ] **Step 1: Cópia de segurança de produção**: repetir a Task 12, Step 1, com o nome `copia-producao-antes-revenda.db` (no `.gitignore`), e `PRAGMA integrity_check` dela.
- [ ] **Step 2: Token**: gerar `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, guardar só nas variáveis (nunca em arquivo do repo nem no chat).
- [ ] **Step 3: Variável no Preços**: Coolify, app `d8qy3lvsre5k21jqttnk5baj`, `REVENDA_TOKEN=<token>` (ferramenta `manage_env` do MCP do Coolify ou a API com `.coolify-token`). Sem redeploy ainda.
- [ ] **Step 4: Publicar o Preços**: `git switch main && git merge --no-ff revenda && git push origin main`. O Coolify publica sozinho. Conferir: `curl -s https://precos.ocnbrasil.com.br/api/saude` → `"schema":3`; as quatro telas das Revisões iguais a antes; `curl -s -o /dev/null -w "%{http_code}" https://precos.ocnbrasil.com.br/api/revenda/modelos` → `401`.
- [ ] **Step 5: Primeira rodada em produção** (carga inicial da FIPE, uns 25 minutos), dentro do container, sem WhatsApp na primeira vez para não mandar a rodada de Revisões em dobro:

```bash
ssh root@200.141.23.108 'CT=$(docker ps --format "{{.Names}}" | grep d8qy3lvsre5k21jqttnk5baj | head -1); docker exec "$CT" npm run coletar -- --manual --sem-alerta' > primeira-rodada-revenda.log 2>&1
```

Conferir no log `"estudos": 6` e as três fontes `ok`; na tela Coletores, as linhas FIPE, Mobiauto e IPCA. A tarefa agendada `coleta-semanal` (`npm run coletar`, segunda 12h) já inclui a Revenda daqui em diante.
- [ ] **Step 6: Conferir as telas**: logado em https://precos.ocnbrasil.com.br, as cinco telas da Revenda a 1280×585, sem rolar; deslogado, o menu Revenda não aparece e `/revenda` leva ao Entrar. Nenhuma venda de teste registrada em produção.
- [ ] **Step 7: KPIs**: Coolify, app `x4lmwh1tqmgrg5zhuullyjf0` (branch `experimentos`, publica sozinho), variáveis `REVENDA_URL=https://precos.ocnbrasil.com.br` e `REVENDA_TOKEN=<o mesmo token>`; depois `git -C ../ocn-kpis-site push origin experimentos`.
- [ ] **Step 8: Conferir o Sandbox sem gravar nada**: em https://kpis.ocnbrasil.com.br (logado como Giga Admin), no console do navegador: `await (await fetch('/api/sandbox/bases')).json()` traz `revenda.modelos` com os seis ids; `await (await fetch('/api/sandbox/revenda-estudo?modelo=Polo&meses=12&km=70000&canal=atacado')).json()` traz `p50.pct` e `insumos.data_estudo`. Na aba Sandbox, num cenário do Polo, o seletor Digitado / Do estudo aparece em "Venda do carro" (só olhar: clicar grava no cenário). O clique completo foi conferido localmente na Task 11, Step 10; se aquela conferência não foi possível, pedir ao Enrico que clique ele mesmo num cenário dele.
- [ ] **Step 9: Memória**: atualizar `projeto-frota-revisoes.md` (módulo Revenda no ar, schema 3, token só nas variáveis, primeira rodada feita) e `projeto-ocn-kpis.md` (seletor Do estudo no Sandbox, `REVENDA_URL`/`REVENDA_TOKEN`).
- [ ] **Step 9b (se algo der errado):** Preços: `rollback_application` no Coolify para o commit anterior (a v3 só acrescentou tabelas e colunas; o código anterior ignora tudo isso e segue funcionando). KPIs: tirar `REVENDA_URL` (o seletor some) ou `rollback_application` no app `x4lmwh1tqmgrg5zhuullyjf0`.
