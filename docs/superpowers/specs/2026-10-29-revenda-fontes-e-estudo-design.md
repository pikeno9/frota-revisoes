# Revenda: mais fontes, base de anúncios e o estudo do fim de contrato (rascunho de 29/10/2026)

## Objetivo
A pergunta principal da Revenda: quanto vale cada modelo no fim do contrato (12 meses e 70 mil km) comparado com o que pagamos nele zero. Hoje a resposta sai de um critério só (FIPE com ajuste de km tirado da Mobiauto). Passa a sair de vários critérios e de várias fontes de anúncios, com o número de anúncios sempre à vista, e com a base de anúncios inteira guardada e disponível para baixar.

Fica de fora: o KPIs continua lendo a projeção de hoje (só FIPE). A integração vem depois, quando o estudo estiver redondo no site de Preços.

## 1. Fontes de anúncios
| Fonte | Onde roda | Como |
|---|---|---|
| Mobiauto | servidor | já existe |
| NaPista | servidor | página de busca `/busca/sp/<marca>/<modelo>/<ano>?pn=N`, 48 por página; o JSON vem em `__NEXT_DATA__` (`searchResult.offers`) |
| OLX e Kavak | coletor no PC do Enrico | os dois barram endereço de servidor; do PC abrem normalmente. Script semanal (Agendador do Windows), no ritmo de uma pessoa navegando, que manda os anúncios para o site com um token próprio (`COLETOR_TOKEN`) |
| Qualquer outra (Webmotors e o que vier) | importação | arquivo CSV ou JSON enviado na tela Anúncios por quem tem papel de edição |

Regras comuns:
- Só usados de SP, ano-modelo de (ano atual − 3) em diante, versão filtrada por uma expressão por modelo e por fonte.
- Páginas proibidas no robots.txt de cada site não são lidas (por exemplo, a página de detalhe da NaPista e da Mobiauto).
- A Webmotors não é coletada pelo site: o antirrobô dela barra o acesso. Entra só por importação ou por dado licenciado.

## 2. Base de anúncios (migração 005, com cópia do banco antes)
- `anuncios` ganha: `fonte`, `url`, `vendedor` (nome), `tipo_vendedor` (loja, particular, locadora), `leilao` (1, 0 ou vazio quando a fonte não informa), `leilao_por` (campo da fonte, descrição ou preço), `cidade`. As 1.239 linhas atuais recebem `fonte = 'mobiauto'`.
- `anuncio_leituras (id_externo, data, preco, km)`: uma linha por anúncio por coleta. Guarda a data da coleta e a evolução do preço de cada anúncio. Estimativa: 3 a 5 mil anúncios por semana, uns 250 mil por ano; cabe folgado no SQLite.
- `fontes_modelo (modelo_id, fonte, caminho, versao)`: onde buscar cada modelo em cada fonte. Os caminhos da Mobiauto migram para cá; as colunas antigas ficam paradas, sem apagar.
- `modelos` ganha `preco_compra`, `preco_compra_em`, `preco_compra_por`.
- Mesmo carro em duas fontes (lojas publicam no mesmo dia em vários sites): no estudo conta uma vez quando bate modelo, ano, km exato e preço com diferença de até 1%. Na base continuam as duas linhas.

## 3. Leilão
- OLX traz o campo "De leilão" em cada anúncio. Vale o que o anunciante marcou.
- Importação: coluna `leilao` ou, sem ela, leitura da descrição ("leilão", "leilao"; ignora "não é de leilão", "sem passagem por leilão").
- Kavak não vende carro de leilão, por regra da loja: entra como 0.
- Mobiauto e NaPista não informam na lista. Anúncio dessas fontes com preço mais de 2 desvios robustos abaixo do esperado para a idade e o km fica marcado como "possível leilão" e sai do estudo.
- Com os anúncios marcados da OLX, o estudo mede o desconto típico de um carro de leilão e quanto a regra de preço acerta. Os dois números aparecem na tela.
- Leilão nunca entra nos critérios; a contagem dos que saíram aparece junto.

## 4. O estudo
Unidade comum: valor em base FIPE (anúncio dividido pela relação anúncio/FIPE da própria fonte), para todos os critérios serem comparáveis entre si e com o FIPE 0 km.

Regressão conjunta, com todos os anúncios válidos do modelo:
`ln(preço) = a + b·idade + c·(km/10 mil) + prêmio da fonte + prêmio de loja`
- `c` é o efeito do km. O prêmio da fonte mostra, por exemplo, quanto o Kavak pede acima da média.
- Descarte dos fora de propósito como hoje (3 desvios robustos), depois do leilão.

Critérios para o fim de contrato (12 meses, 70 mil km):
1. FIPE: queda de 12 meses × ajuste de km (o cálculo de hoje).
2. Reta: valor previsto pela regressão conjunta em 1 ano e 70 mil km.
3. Comparáveis, um por fonte: anúncios com 6 a 18 meses, peso pelo km (70 mil vale 1; 60 ou 80 mil, 2/3; 50 ou 90 mil, 1/3; fora de 40 a 100 mil, zero); mediana ponderada.

Amostra mínima: 30 anúncios para a reta, 10 com peso para os comparáveis. O consenso é a mediana dos critérios que passaram. Cada critério mostra fonte, anúncios usados, valor e o percentual sobre o FIPE 0 km.

Categorias: combustão, elétrico e híbrido, pelo combustível da FIPE. Para a comparação não depender de um modelo por categoria, a FIPE passa a ler também códigos de referência sem anúncios (outros elétricos e híbridos à venda, por exemplo Dolphin Mini, Seagull, Song Pro, Corolla Cross híbrido), só para as curvas de queda.

## 5. Telas
**Capa da Revenda (a informação principal).** Por modelo: Compra (preço pago; sem ele, FIPE 0 km com a etiqueta FIPE) e, em destaque, Fim de contrato (12 meses e 70 mil km, atacado, mediana do consenso), com o percentual sobre a compra e sobre o FIPE 0 km. Continua o que já existe hoje (30 e 70 mil km, km por 10 mil, anúncios, etiquetas). Filtro por categoria no topo.

**Detalhe do modelo.**
- Tabela dos critérios com o consenso.
- Gráfico preço × km dos anúncios de cerca de 1 ano, uma cor por fonte, leilão em destaque, com a curva da regressão.
- Curva de queda da FIPE (6 a 24 meses).
- Relação anúncio/FIPE por idade e por fonte.
- Contagem por fonte: lidos, leilão, possível leilão, fora de propósito, usados.

**Estudo (aba nova da Revenda).**
- Curvas de queda da FIPE por modelo e média por categoria, com filtro de categoria.
- Efeito do km por categoria.
- Prêmio por fonte e de loja contra particular.
- Desconto de leilão e acerto da regra de preço.

**Anúncios (aba nova da Revenda).** Tabela com filtros (modelo, fonte, categoria, leilão, período da coleta) e botão de baixar em CSV que o Excel abre direto (separador ponto e vírgula, acentos certos). Colunas: data da coleta, fonte, modelo, versão, ano, km, preço, vendedor, tipo de vendedor, leilão, cidade, link. Quem tem edição vê o botão de importar.

**Premissas.** Preço de compra por modelo. Fontes por modelo (caminho e versão em cada uma).

**Simulador.** Passa a usar o consenso: a razão entre o consenso e o critério FIPE no fim de contrato ajusta todos os prazos e kms. A rota `/api/revenda/projecao` lida pelo KPIs continua igual; o consenso vem com `base=consenso`.

**Método.** Atualizado com fontes, leilão, critérios e categorias.

## 6. Entregas
1. Migração 005, NaPista no servidor, leituras por coleta, importação, tela Anúncios com download.
2. Estudo novo (regressão conjunta, critérios, consenso, leilão) e capa e detalhe.
3. Coletor do PC (OLX e Kavak).
4. Aba Estudo com categorias e os códigos FIPE de referência; Método.

Cada entrega passa pelos testes, roda contra uma cópia do banco de produção e só sobe com OK.
