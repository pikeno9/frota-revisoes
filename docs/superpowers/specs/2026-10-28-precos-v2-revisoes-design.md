# Preços v2: módulo Revisões (design)

Data: 28/10/2026 · Repo `pikeno9/frota-revisoes` · Produção https://precos.ocnbrasil.com.br (Coolify, app `d8qy3lvsre5k21jqttnk5baj`, banco `/data/revisoes.db`).

## 1. Contexto

O site ganha dois módulos. Esta spec cobre só o primeiro:

1. **Revisões** (esta spec): preço oficial de revisão das montadoras, hoje e o histórico desde jun/2026. Reconstrução do que já existe.
2. **Revenda** (spec própria, depois): preço esperado de venda do carro usado ao fim do contrato (1 ano, 30 a 70 mil km), com depreciação, inflação, fator marginal por km e faixas de probabilidade, para embasar o UE. Usa a base desta spec (modelos, login, navegação).

### Levantamento de 28/10/2026

| Coletor | Hoje (local, sem envio) | 1ª / 4ª revisão hoje | Produção (set/26) |
|---|---|---|---|
| BYD | quebrado: sem PDF; os preços de 21 modelos estão no HTML como `{"n":..,"km":[..],"p":[..]}` | Dolphin 393 / 1.292 · King 926 / 2.472 | Dolphin 393 / 1.292 · King 926 / 2.795 |
| VW | ok (Polo Track, Tera) | 864,46 / 1.279,53 | 846,64 / 1.261,71 |
| Chevrolet | coleta, mas o Onix não existe no banco (descartado desde jun) | 556 / 1.028 | sem dado |
| Fiat | ok, 5 revisões reais (6ª a 10ª projetadas por cópia) | 701 / 1.576 | 659 / 1.833 |

- Action `coleta-mensal.yml`: `disabled_inactivity` desde 01/09; outubro não foi coletado.
- Produção: 5 veículos, 200 linhas (jun a set).
- `POST/DELETE /api/veiculos` e `/api/precos` abertos, sem token, no site público.
- Frota real (Ativos, 18/09): 170 carros, Polo 76, Argo 69, Tera 25. Dolphin, King e Onix são candidatos.
- O KPIs (`ocn-kpis-site/lib/revisoes.js`) lê `/api/veiculos` e `/api/precos`, tira nº e km do texto `revisao` e usa no Sandbox de UE.

## 2. Decisões (brainstorming com o Enrico)

| Tema | Decisão |
|---|---|
| Ordem | Revisões agora; Revenda numa spec seguinte |
| Lista de modelos | Frota vem do Ativos (com quantidade); candidatos cadastrados no site, atrás do login |
| Acesso | Leitura pública; cadastro, coleta manual e ajustes com login |
| Frequência | Semanal, grava só mudança (faixas de vigência) |
| Alertas | WhatsApp pelo Evolution do Central |
| Revisões | Todas as que a montadora publica, sem corte em 70 mil km; nada projetado na tela |
| Telas | Início, Detalhe do modelo, Comparar, Coletores |
| Stack | Mesmo repo e base: Node 22, Express, `node:sqlite`, front em módulos ES sem build |

## 3. Dados

Tabelas novas. As antigas `veiculos` e `precos` **ficam intactas** (congeladas, só leitura) para servir de cópia e permitir voltar à versão anterior.

```sql
CREATE TABLE schema_versao (versao INTEGER NOT NULL, aplicada_em TEXT NOT NULL);

CREATE TABLE modelos (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,            -- 'polo-track', 'byd-king'
  montadora TEXT NOT NULL,
  nome TEXT NOT NULL,                   -- 'Polo Track'
  versao TEXT, ano_modelo INTEGER,
  origem TEXT NOT NULL CHECK (origem IN ('frota','candidato')),
  chave_ativos TEXT UNIQUE,             -- 'polo' | 'argo' | 'tera' (campo mo do Ativos)
  qtd_frota INTEGER NOT NULL DEFAULT 0,
  coletor TEXT NOT NULL CHECK (coletor IN ('byd','vw','gm','fiat')),
  parametros TEXT NOT NULL,             -- JSON do coletor (ex.: {"mvsCode":"358ATS1","modelYear":2026,"dealer":"919654"})
  legado_veiculo_id INTEGER,            -- id em veiculos (compatibilidade com o KPIs)
  projetar_ciclo INTEGER NOT NULL DEFAULT 0, -- só a rota antiga do KPIs projeta (Fiat)
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE coletas (
  id INTEGER PRIMARY KEY,
  fonte TEXT NOT NULL,                  -- byd | vw | gm | fiat | ativos | legado
  inicio TEXT NOT NULL, fim TEXT,
  status TEXT CHECK (status IN ('ok','parcial','falha')),
  modelos_ok INTEGER DEFAULT 0, itens INTEGER DEFAULT 0, mudancas INTEGER DEFAULT 0,
  erro TEXT, origem TEXT NOT NULL DEFAULT 'agenda' -- agenda | manual | migracao
);

CREATE TABLE vigencias (
  id INTEGER PRIMARY KEY,
  modelo_id INTEGER NOT NULL REFERENCES modelos(id),
  ordem INTEGER NOT NULL,               -- 1ª, 2ª...
  km INTEGER NOT NULL,
  meses INTEGER,
  valor REAL NOT NULL,
  vigente_de TEXT NOT NULL,             -- YYYY-MM-DD
  vigente_ate TEXT,                     -- NULL = atual
  visto_em TEXT NOT NULL,               -- última coleta que confirmou o valor
  coleta_id INTEGER REFERENCES coletas(id),
  conferir INTEGER NOT NULL DEFAULT 0   -- variação > 40%
);
CREATE UNIQUE INDEX vig_atual ON vigencias(modelo_id, ordem) WHERE vigente_ate IS NULL;

CREATE TABLE alertas (
  id INTEGER PRIMARY KEY,
  coleta_id INTEGER REFERENCES coletas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('mudanca','nova_revisao','sumiu_revisao','falha','conferir','frota_sem_modelo')),
  modelo_id INTEGER, ordem INTEGER, de REAL, para REAL, texto TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  enviado_em TEXT
);
```

Não há `ON DELETE CASCADE`: modelo nunca é apagado, só `ativo = 0`.

### Regra de gravação (por modelo coletado)

1. O coletor devolve `[{ordem, km, meses, valor}]`.
2. Validação: 50 ≤ valor ≤ 30.000; ordens únicas; quantidade ≥ quantidade de vigências atuais do modelo. Se falhar, **nada é gravado para o modelo**, a coleta vira `parcial` ou `falha` e nasce alerta `falha`.
3. Para cada ordem: mesma vigência atual com o mesmo valor → só atualiza `visto_em`. Valor diferente → fecha a atual (`vigente_ate` = dia anterior à coleta) e abre nova; alerta `mudanca` (e `conferir = 1` mais alerta `conferir` se |Δ| > 40%). Ordem nova → abre vigência e alerta `nova_revisao`.
4. Ordem que existia e não veio: nada se fecha; alerta `sumiu_revisao`.
5. Tudo de um modelo numa transação.

### Migração (versão 2, roda no boot, idempotente)

1. Antes do deploy, em produção: `cp /data/revisoes.db /data/revisoes-antes-v2-AAAAMMDD.db` com o container parado, cópia baixada para o notebook, `PRAGMA integrity_check` nas duas. O backup diário da VPS já leva o volume.
2. Cria as tabelas novas numa transação.
3. `veiculos` → `modelos` com `legado_veiculo_id`, parâmetros vindos dos `ALVOS` atuais, origem frota (Polo Track, Tera, Argo Drive) ou candidato (Dolphin, King). Onix Sedan Plus entra como candidato novo. Argo com `projetar_ciclo = 1`.
4. `precos` → `vigencias`: ordem e km tirados do texto; Fiat com ordem > 5 ignorada (era cópia). Por (modelo, ordem) em ordem de mês, meses seguidos de mesmo valor viram uma faixa: `vigente_de` = 1º mês, `vigente_ate` = dia anterior ao mês da mudança, `visto_em` = último mês. Uma coleta `fonte='legado', origem='migracao'` é registrada.
5. Conferência na mesma transação: para cada (modelo, ordem, mês) do legado, o valor que a vigência dá naquele mês é igual ao do legado. Diferença aborta a migração e o servidor sobe em modo só leitura com o erro no `/api/saude`.

## 4. Coleta

- `src/coletores/{byd,vw,gm,fiat}.js`, mesma interface: `coletar(modelo) → [{ordem, km, meses, valor}]` e, quando a fonte permite, `catalogo() → [{rotulo, parametros}]` (BYD: 21 modelos do HTML; GM: modelo/ano/versão do JSON). Fiat e VW: parâmetros digitados no cadastro, com botão Testar que roda o coletor sem gravar.
- BYD: lê os objetos `{"n","km","p"}` do HTML de `/br/plano-de-manutencao`; `parametros = {"nome":"BYD King"}`.
- VW, GM, Fiat: lógica atual, parametrizada (sem `ALVOS` no código). Fiat devolve só as revisões publicadas.
- `src/frota.js`: lê a frota do Ativos (`ATIVOS_URL` + `ATIVOS_TOKEN`, Bearer), conta carros por `mo`, atualiza `qtd_frota` e `origem`. Chave sem modelo → alerta `frota_sem_modelo`.
- `scripts/coletar.js` (`npm run coletar`): frota, depois cada modelo ativo, registra `coletas`, envia alertas. Agendado como tarefa do Coolify `0 12 * * 1` (segunda, 09:00 BRT). Botão Coletar agora na tela Coletores chama a mesma função.
- SQLite em WAL com `busy_timeout = 5000` (servidor e tarefa escrevem no mesmo arquivo).
- A Action `coleta-mensal.yml` e `POST /api/ingest` saem quando a coleta interna estiver no ar.

## 5. Alertas

- `src/alertas.js` junta os alertas sem `enviado_em` de uma rodada numa mensagem só e manda via Evolution (`POST {EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCIA}`, header `apikey`), para `ALERTA_WHATSAPP`.
- Formato: `Preços de revisão 03/11` / `King 4ª 2.795 → 2.472 (−11,6%)` / `Coletor BYD falhou: <erro curto>`. Sem mensagem quando não há nada.
- Sem variáveis de Evolution, os alertas ficam pendentes e aparecem na tela Coletores. Falha no envio não derruba a coleta.

## 6. API

Públicas (GET):
- `/api/modelos` · `/api/modelos/:slug` (vigências atuais e histórico) · `/api/comparar` (custo acumulado por km) · `/api/mudancas?limite=` · `/api/coletas?limite=` · `/api/saude`.
- Compatibilidade com o KPIs, mesmo formato de hoje e só leitura: `/api/veiculos` (de `modelos`, `id = legado_veiculo_id` ou id novo) e `/api/precos` (de `vigencias`, texto `Nª revisão (X km)`, mais recente primeiro, com projeção em ciclo até a 10ª só onde `projetar_ciclo = 1`). Teste garante que o leitor do KPIs tira os mesmos números que tirava do legado.

Com login (`/entrar`, cookie de sessão assinado, senha em `ADMIN_SENHA_HASH` com scrypt e `SESSION_SECRET`):
- `POST /api/modelos`, `PATCH /api/modelos/:id`, `POST /api/modelos/:id/testar`, `GET /api/catalogo/:coletor`, `POST /api/coletas` (coletar agora), `POST /api/alertas/reenviar`.

Removidos: `POST/DELETE /api/veiculos`, `POST/DELETE /api/precos`, `POST /api/ingest` (este depois da troca).

## 7. Telas

Viewport de referência 1280×585: o conteúdo principal cabe sem rolar a página; listas longas rolam por dentro. Sem texto explicativo, sem travessão. Identidade OCN atual (Plus Jakarta Sans, roxo `#5800F7`, escuro `#0A0118`), tema claro. Navegação no topo com espaço para o módulo Revenda depois.

1. **Início** (`/`): grade de cartões, frota primeiro e candidatos depois. Cartão: foto, nome, nº de carros na frota, total do plano publicado (soma das revisões), "N revisões · até X mil km", variação desde a última mudança (seta + % + texto, nunca só cor) e uma linha em degraus do total no tempo. Coluna à direita: mudanças recentes.
2. **Detalhe** (`/modelo/:slug`): tabela revisão | km | meses | preço | desde | variação, com degrau pequeno por linha; gráfico em degraus do total do plano no tempo (uma série, sem legenda, cruz com dica ao passar o mouse). Marcador nas vigências com `conferir`.
3. **Comparar** (`/comparar`): custo acumulado de revisão × km, linha em degraus por modelo, linhas de referência em 30 mil e 70 mil km, filtro Frota/Candidatos/Todos numa linha acima do gráfico. Legenda sempre, rótulo direto no fim de cada linha; Polo Track e Tera coincidem, então a dica lista os dois. Tabela equivalente ao lado do gráfico.
4. **Coletores** (`/coletores`): por fonte, última coleta, status (ícone + palavra), itens e erro; alertas pendentes. Com login: Coletar agora, cadastro de candidato (catálogo ou parâmetros + Testar), ativar e desativar.

Gráficos (skill `dataviz`): Chart.js com versão exata guardada em `public/vendor/`; paleta categórica padrão da skill em ordem fixa, cor presa ao modelo (`modelos.id`), nunca à posição; série única no roxo OCN; validar com `validate_palette.js` no fundo claro; linhas de 2px, degraus (`stepped`), dica sempre ligada.

Animações: depois das telas prontas, rodar `find-animation-opportunities` nelas, aplicar as aceitas com a skill `animate`, respeitando `prefers-reduced-motion`.

## 8. Estrutura de arquivos

```
server.js                 → só monta o app e sobe
src/db.js                 → abre o banco (WAL), roda migrações
src/migracoes/002-v2.js   → seção 3
src/gravar.js             → regra de gravação
src/coletores/{byd,vw,gm,fiat}.js
src/frota.js · src/alertas.js · src/coleta.js (rodada inteira)
src/auth.js · src/rotas/{publicas,admin,compat}.js
scripts/coletar.js
public/index.html (casca) · public/css/*.css · public/js/{app,api,inicio,modelo,comparar,coletores,graficos,formato}.js
public/vendor/chart.umd.min.js · public/img/*
test/*.test.js · test/fixtures/*
```

## 9. Erros

- Coletor que lança erro ou não passa na validação: modelo não grava, coleta `parcial`/`falha`, alerta. Os outros seguem.
- Ativos fora do ar: mantém `qtd_frota` anterior, coleta `ativos` com `falha`.
- Migração com conferência divergente: rollback, servidor só leitura, erro em `/api/saude`.
- Rotas de escrita sem sessão: 401.

## 10. Testes (`node --test`)

- Leitores com arquivos salvos: HTML da BYD de 28/10, recorte do JSON da GM, resposta da Fiat, respostas da VW.
- `gravar.js`: mesmo valor, mudança, ordem nova, ordem sumida, validação falhando, Δ > 40%.
- Migração: banco sintético commitado e, localmente, cópia do banco de produção (caminho por variável, fora do git); a conferência da seção 3 passa.
- Compatibilidade: a função do KPIs aplicada a `/api/precos` novo dá os mesmos `{n, km, valor}` que dava no legado.
- Rotas: escrita sem sessão = 401.
- Telas: conferidas em 1280×585 no navegador.

## 11. Implantação

1. Passo 0 (antes da reconstrução, com OK do Enrico para o push): BYD lendo o HTML novo, Onix cadastrado em produção pela rota atual (`POST /api/veiculos`, com OK), Action religada (`gh workflow enable`), coleta manual de outubro.
2. Reconstrução na branch `reconstrucao-v2`, testada com cópia do banco de produção.
3. Com OK: backup da seção 3, merge na `main` (deploy automático), conferir `/api/saude`, telas e o KPIs.
4. Criar a tarefa agendada no Coolify e as variáveis (`ADMIN_SENHA_HASH`, `SESSION_SECRET`, `ATIVOS_URL`, `ATIVOS_TOKEN`, `EVOLUTION_*`, `ALERTA_WHATSAPP`); rodar Coletar agora uma vez.
5. Desligar a Action e tirar `/api/ingest` e o secret `INGEST_TOKEN`.

## 12. Fora desta spec

Módulo Revenda; troca do KPIs para uma rota nova (fica a de compatibilidade); preços por cidade ou concessionária além de SP; envio de foto de modelo pelo site (imagem por arquivo em `public/img/<slug>.*`).
