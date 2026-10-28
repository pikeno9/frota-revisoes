# Preços v2: módulo Revenda (design)

Data: 28/10/2026 · Repo `pikeno9/frota-revisoes` · Site https://precos.ocnbrasil.com.br (módulo Revisões no ar desde 28/10, main `ad0f70d`).

## 1. Objetivo

Estimar por quanto a OCN vende cada carro no fim do contrato, para embasar o UE: dado o modelo, o prazo (padrão 12 meses), o km no fim (de 30 a 70 mil, ou outro) e o canal de venda, devolver o preço esperado com faixa (P10, P50, P90), em reais e em % do preço de compra, nominal e real (sem inflação). O KPIs consulta esse número no Sandbox de UE.

## 2. Decisões (brainstorming com o Enrico)

| Tema | Decisão |
|---|---|
| Canais | Lojista/atacado, varejo próprio e o motorista compra |
| Histórico de vendas da OCN | Não existe ainda; o desconto de cada canal é premissa editável; o site já guarda as vendas reais para calibrar depois |
| Integração | O KPIs consulta a API (seletor "do estudo" na revenda do Sandbox); a revenda digitada continua valendo |
| Acesso | Atrás do login; o KPIs lê por token |
| Abordagem | A: FIPE (âncora e desvalorização por idade) + anúncios da Mobiauto (efeito do km e dispersão) + IPCA |

## 3. Fontes (conferidas em 28/10/2026)

| Fonte | Como | Observações |
|---|---|---|
| FIPE oficial | `POST https://veiculos.fipe.org.br/api/veiculos/ConsultarValorComTodosParametros` (form: `codigoTabelaReferencia`, `codigoMarca`, `codigoModelo`, `codigoTipoVeiculo=1`, `anoModelo`, `codigoTipoCombustivel=5` para Flex, `tipoVeiculo=carro`, `modeloCodigoExterno=`, `tipoConsulta=tradicional`), cabeçalhos `Referer: https://veiculos.fipe.org.br/` e `X-Requested-With: XMLHttpRequest`. Referências em `ConsultarTabelaDeReferencia` (338 = out/2026, 326 = out/2025). Anos em `ConsultarAnoModelo` (`32000` = zero km) | Histórico livre. Ex.: Polo Track (`codigoModelo` 10176, FIPE 005540-9) ano 2025: R$ 77.170 em out/2025, R$ 73.674 em out/2026. A API parallelum só dá 3 meses sem pagar: não usar |
| Mobiauto | `GET https://www.mobiauto.com.br/comprar/carros/sp/<marca>/<modelo>?page=N`; JSON em `<script id="__NEXT_DATA__">` → `props.pageProps.deals` (`numResults`, `results[]` com `id`, `price`, `km`, `deal0km`, `dealer`, `trim{name, productionYear, model{name, year}}`) | 24 anúncios por página; Polo em SP: 3.073. Preço é o pedido no anúncio, não o fechado. Uso interno com poucas consultas por semana (decisão do Enrico) |
| IPCA | `GET https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=01/01/2020` | Variação mensal em % |
| Webmotors, OLX | 403 | Fora |

## 4. Dados (migração v3, mesmo banco)

`modelos` ganha colunas: `fipe_marca` (ex. 59), `fipe_modelo` (ex. 10176), `fipe_combustivel` (5 Flex, 4 Elétrico, 6 Híbrido), `fipe_modelo_ref` (outro código FIPE da mesma marca usado na desvalorização quando o modelo ainda não tem histórico, ou nulo), `mobiauto_caminho` (ex. `volkswagen/polo`), `mobiauto_versao` (expressão regular que o nome da versão do anúncio precisa casar, sem diferenciar maiúsculas).

```sql
CREATE TABLE fipe_precos (               -- por código FIPE, não por modelo (o mesmo código serve de referência a outro)
  fipe_marca INTEGER NOT NULL,
  fipe_modelo INTEGER NOT NULL,
  ano_modelo INTEGER NOT NULL,          -- 32000 = zero km
  referencia TEXT NOT NULL,             -- YYYY-MM
  valor REAL NOT NULL,
  codigo_fipe TEXT,
  PRIMARY KEY (fipe_modelo, ano_modelo, referencia)
);
CREATE TABLE anuncios (
  id_externo TEXT PRIMARY KEY,          -- 'mobiauto:<id>'
  modelo_id INTEGER NOT NULL REFERENCES modelos(id),
  versao TEXT, ano_modelo INTEGER, ano_fabricacao INTEGER,
  km INTEGER NOT NULL, preco REAL NOT NULL, loja TEXT,
  primeiro_visto TEXT NOT NULL, ultimo_visto TEXT NOT NULL
);
CREATE TABLE ipca (mes TEXT PRIMARY KEY, variacao REAL NOT NULL);   -- YYYY-MM, % no mês
CREATE TABLE premissas (chave TEXT PRIMARY KEY, valor REAL NOT NULL, atualizado_em TEXT NOT NULL);
CREATE TABLE vendas (
  id INTEGER PRIMARY KEY, placa TEXT NOT NULL, modelo_id INTEGER NOT NULL REFERENCES modelos(id),
  data TEXT NOT NULL, km INTEGER NOT NULL, preco REAL NOT NULL,
  canal TEXT NOT NULL CHECK (canal IN ('atacado','varejo','motorista')), obs TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE estudos (
  id INTEGER PRIMARY KEY, modelo_id INTEGER NOT NULL REFERENCES modelos(id),
  calculado_em TEXT NOT NULL, dados TEXT NOT NULL      -- JSON da seção 6
);
```

Premissas iniciais (o Enrico ajusta na tela; ficam com data):

| Chave | Valor inicial | Significado |
|---|---|---|
| `atacado_pct_base` | 85 | Atacado = 85% do preço-base |
| `varejo_negociacao_pct` | 5 | Varejo = preço de anúncio equivalente menos 5% de negociação |
| `motorista_pct_base` | 100 | Motorista = 100% do preço-base |

Parâmetros por modelo na migração (conferidos em 28/10; os anos-modelo de cada código na FIPE estão entre parênteses):

| Modelo | fipe_marca / fipe_modelo / combustível | fipe_modelo_ref | mobiauto_caminho | mobiauto_versao |
|---|---|---|---|---|
| Polo Track | 59 / 10176 Polo Track 1.0 Flex 12V 5p (2023 a 2026, 0 km) / 5 | nulo | `volkswagen/polo` | `^Track` |
| Tera | 59 / 11467 Tera 1.0 MPI Flex 12V 5p Mec. (2026, 0 km) / 5 | 10176 (Polo Track) | `volkswagen/tera` | `MPI` |
| Argo Drive | 21 / 7965 ARGO DRIVE 1.0 6V Flex (2018 a 2026, 0 km) / 5 | nulo | `fiat/argo` | `^Drive 1\.0` |
| Onix Sedan Plus | 23 / 11617 ONIX SEDAN Plus 1.0 12V Mec. (2026, 2027, 0 km) / 5 | 8950 (ONIX SEDAN Plus LT 1.0 12V Flex, 2020 a 2026) | `chevrolet/onix-plus` | `^(?!.*Turbo).*1\.0` |
| Dolphin | 238 / 12122 Dolphin EV GS (2024 a 2027, 0 km) / 4 | nulo | `byd/dolphin` | `^GS` |
| King | 238 / 11078 King GL 1.5 16V Aut. (2025 a 2027, 0 km) / 6 | nulo | `byd/king` | `GL` |

Quando o próprio código tiver menos de 6 observações de `r_m`, o estudo usa as do `fipe_modelo_ref` (ou a mediana dos outros modelos, se não houver referência) e marca `r_emprestado`. Modelo sem `fipe_modelo` fica fora do estudo, sem erro. Os candidatos novos cadastrados pelo site ganham esses campos na tela Premissas (seção de modelos).

## 5. Coleta

Dentro da rodada semanal que já existe (`npm run coletar`), depois das revisões:

1. **IPCA:** se o último mês salvo for anterior ao mês passado, baixa a série desde o último mês salvo.
2. **FIPE:** se a referência mais recente da FIPE ainda não estiver salva para todos os modelos com código, baixa essa referência para os anos-modelo de (ano atual − 3) até o ano atual + 1 e o `32000`, de cada código distinto entre `fipe_modelo` e `fipe_modelo_ref` dos modelos ativos. Ano que a FIPE não tem naquela referência é pulado sem erro. Na primeira vez, preenche 36 referências para trás. Uma consulta por segundo (limite educado); ~5 anos × 36 meses × 6 modelos ≈ 1.100 consultas só na carga inicial.
3. **Anúncios:** por modelo com caminho, percorre as páginas até 40 páginas ou até a página vir vazia, guarda só os de ano-modelo ≥ ano atual − 3, sem `deal0km`, cuja versão contém `mobiauto_versao`; atualiza `ultimo_visto` dos já conhecidos. Dois segundos entre páginas.
4. **Estudo:** recalcula e grava um registro em `estudos` por modelo.

Falha de uma fonte vira alerta `falha` (mesmo mecanismo das Revisões) e não impede as outras. Fonte nova no `coletas.fonte`: `fipe`, `mobiauto`, `ipca`.

## 6. Método

Para cada modelo:

1. **Desvalorização em m meses (FIPE).** Para cada mês de referência t em que existam o zero km (`32000`) em t e o ano-modelo do zero km de t em t+m: `r_m(t) = FIPE(ano_do_0km_em_t, t+m) / FIPE(32000, t)`. O ano do zero km em t é o maior ano-modelo com preço em t, exceto 32000. Guarda a mediana e os quartis de `r_m` nos últimos 24 meses, para m = 6, 12, 18, 24. Versão real: `r_m_real = r_m / (1 + IPCA acumulado de t a t+m)`.
2. **Efeito do km (anúncios vistos nos últimos 60 dias).** Mínimos quadrados de `ln(preço) = a + b·idade_anos + c·(km/10.000)`, com idade = ano corrente + mês corrente/12 − ano_modelo. Exige ≥ 30 anúncios; com menos, usa c da média dos modelos com dados e marca `km_emprestado`. Fator por 10 mil km = `exp(c) − 1` (ex.: −3,1%).
3. **Km típico.** Mediana do km dos anúncios com idade entre 0,5 e 1,5 ano: é o km que a FIPE de 1 ano representa.
4. **Dispersão.** Quantis 10% e 90% dos resíduos da regressão (em log): `q10`, `q90`.
5. **Razão anúncio/FIPE.** Mediana de `preço_anúncio / FIPE(ano_modelo, mês atual)` nos anúncios com idade ≤ 1,5 ano: converte FIPE em preço de anúncio para o canal varejo.

`dados` do estudo (JSON): `{ r: { "6": {p25, p50, p75, real_p50}, "12": {...}, ... }, km: { c, fator_10mil, km_tipico, n, emprestado }, residuos: { q10, q90 }, anuncio_sobre_fipe, fipe_0km_atual, referencia, n_fipe }`.

**Projeção** para (modelo, meses m, km K, canal, preço de compra P opcional; sem P usa `fipe_0km_atual`):

- base_P50 = P × r_m.p50 × exp(c × (K − km_tipico) / 10.000)
- P10 = base_P50 × exp(q10), P90 = base_P50 × exp(q90)
- atacado = base × atacado_pct_base/100 · varejo = base × anuncio_sobre_fipe × (1 − varejo_negociacao_pct/100) · motorista = base × motorista_pct_base/100
- devolve para cada quantil: R$ nominal, R$ real (com `r_m.real_p50` no lugar), % de P; e os insumos usados (n de anúncios, referência FIPE, data do estudo, premissas).
- m fora de {6, 12, 18, 24}: interpola linearmente entre os vizinhos.

## 7. API

Atrás do login (sessão do site):
- `GET /api/revenda/modelos` → por modelo: último estudo resumido (P50 em % para 12 meses a 30 e 70 mil km, atacado), n de anúncios, data.
- `GET /api/revenda/modelos/:slug` → estudo completo, série FIPE (0 km e ano anterior por referência), anúncios dos últimos 60 dias (ano, km, preço).
- `GET /api/revenda/projecao?modelo=&meses=12&km=70000&canal=atacado&preco=` → seção 6.
- `GET /api/revenda/premissas`, `PUT /api/revenda/premissas` (JSON, valores entre 0 e 200).
- `GET /api/revenda/vendas`, `POST /api/revenda/vendas`.

Para o KPIs: `GET /api/revenda/projecao` também aceita `Authorization: Bearer <REVENDA_TOKEN>` (comparação em tempo constante); sem a variável, só sessão.

## 8. Telas (atrás do login; 1280×585, sem texto explicativo, sem travessão)

Navegação ganha o módulo "Revenda" ao lado de "Revisões", visível só logado: abas Modelos, Simulador, Premissas, Vendas.

1. **Modelos** (`/revenda`): cartão por modelo com % de revenda P50 em 12 meses a 30 e 70 mil km (atacado), fator por 10 mil km, n de anúncios, data do estudo.
2. **Modelo** (`/revenda/:slug`): gráfico de dispersão preço × km dos anúncios (idade 0,5 a 1,5 ano) com a curva ajustada para 1 ano e a faixa P10 a P90, linhas em 30 e 70 mil km; ao lado, gráfico em degraus do FIPE do zero km e do ano anterior no tempo; números do estudo numa tabela.
3. **Simulador** (`/revenda/simulador`): modelo, preço de compra, meses, km no fim, canal → P10/P50/P90 em R$ e %, nominal e real, e os insumos.
4. **Premissas** (`/revenda/premissas`): os três percentuais, editáveis, com data da última mudança.
5. **Vendas** (`/revenda/vendas`): registrar venda (placa, modelo, data, km, preço, canal) e lista com o previsto pelo estudo na data e a diferença.

Gráficos pela skill `dataviz` (dispersão com pontos ≥ 8 px semitransparentes, curva 2 px, faixa sombreada, tabela equivalente); animação pela `find-animation-opportunities`, como nas Revisões.

## 9. KPIs (repo `ocn-kpis-site`, branch `experimentos`)

- `lib/revenda.js`: `buscarProjecao({ modelo, meses, km, canal, preco })` com `REVENDA_URL` + `REVENDA_TOKEN`, cache de 1 h.
- Rota do servidor `GET /api/sandbox/revenda-estudo` (Giga Admin, mesma proteção das rotas do Sandbox) que chama `buscarProjecao`.
- Sandbox: no campo "Revenda no fim", um seletor Digitado / Do estudo. Em Do estudo: canal (atacado, varejo, motorista) e o km no fim calculado do cenário (km/semana × semanas do prazo), editável; o valor vira `revenda_pct` do cenário e guarda `revenda_estudo: { canal, km, data_estudo }` para mostrar a origem. Mapa do modelo do Theoric para o slug em `config/static.js`.
- Sem `REVENDA_URL`, o seletor não aparece.

## 10. Testes

- Leitores com arquivos salvos: resposta da FIPE (valor e referências), página da Mobiauto (só o `__NEXT_DATA__`), série do BCB.
- Método com dados sintéticos de coeficientes conhecidos (regressão devolve c dentro de 1e-6; r_m com histórico montado à mão; interpolação de meses; canais).
- Projeção ponta a ponta com banco em memória.
- Rotas: sem login 401; token do KPIs só na projeção; premissas fora da faixa 400.
- KPIs: `buscarProjecao` com servidor falso; Sandbox conferido no navegador.

## 11. Implantação

Mesmo caminho das Revisões: branch, ensaio com cópia da produção (backup WAL-safe por `VACUUM INTO`), OK do Enrico, merge na `main`, variáveis `REVENDA_TOKEN` no Preços e `REVENDA_URL`/`REVENDA_TOKEN` no KPIs, primeira rodada manual (carga inicial da FIPE, ~20 min), conferência das telas e do Sandbox.

## 12. Fora desta spec

Outros estados além de SP; leilões; Webmotors, OLX, Kavak; modelos de aprendizado de máquina; preço por cor ou opcional; calibração automática das premissas pelas vendas (as vendas ficam guardadas e comparadas na tela; o ajuste das premissas é manual).
