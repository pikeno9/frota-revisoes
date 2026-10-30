import { get } from './api.js';
import { brl, num, pct, pctSimples, dia, esc } from './formato.js';

const numero = v => (v == null ? '' : num(v));

const SECOES = [
  ['m-revisoes', 'Preço de revisão'],
  ['m-comparacao', 'Como comparamos'],
  ['m-revenda', 'Preço do carro usado'],
  ['m-calculo', 'Como calculamos a revenda'],
  ['m-siglas', 'P10, P50, P90 e outras siglas'],
  ['m-limites', 'Premissas e limites'],
];
const fora = (href, texto) => `<a class="fora" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(texto)}</a>`;
const STATUS = { ok: 'ok', parcial: 'parcial', falha: 'falha' };
const quando = c => (c?.fim ? `${dia(c.fim.slice(0, 10))}${c.status && c.status !== 'ok' ? ` · ${STATUS[c.status] ?? c.status}` : ''}` : '');

export async function metodo(tela) {
  const f = await get('/api/fontes');
  // Exemplo ao vivo com o modelo de mais carros na frota que tenha estudo.
  const exemplo = f.revenda.find(m => m.anuncios > 0) ?? f.revenda[0];
  let p = null;
  if (exemplo) {
    try { p = await get(`/api/revenda/projecao?modelo=${encodeURIComponent(exemplo.slug)}&meses=12&km=70000&canal=atacado&base=consenso`); } catch { p = null; }
  }
  tela.innerHTML = `<div class="metodo">
    <nav class="metodo-indice" aria-label="Seções">${SECOES.map(([id, t], i) => `<a href="#${id}" data-secao="${id}"${i === 0 ? ' aria-current="true"' : ''}>${t}</a>`).join('')}</nav>
    <div class="metodo-texto" id="metodo-texto">
      ${revisoes(f)}
      ${comparacao(f)}
      ${revenda(f)}
      ${calculo(exemplo, p)}
      ${siglas()}
      ${limites(f)}
    </div>
  </div>`;

  const texto = tela.querySelector('#metodo-texto');
  const links = [...tela.querySelectorAll('[data-secao]')];
  tela.querySelector('.metodo-indice').addEventListener('click', e => {
    const a = e.target.closest('[data-secao]');
    if (!a) return;
    e.preventDefault();
    texto.querySelector(`#${a.dataset.secao}`).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });
  // Marca no índice a seção que está no topo da leitura.
  const marcar = () => {
    const topo = texto.getBoundingClientRect().top + 24;
    let atual = SECOES[0][0];
    for (const [id] of SECOES) if (texto.querySelector(`#${id}`).getBoundingClientRect().top <= topo) atual = id;
    if (texto.scrollTop + texto.clientHeight >= texto.scrollHeight - 4) atual = SECOES.at(-1)[0];
    links.forEach(a => a.setAttribute('aria-current', String(a.dataset.secao === atual)));
  };
  texto.addEventListener('scroll', marcar, { passive: true });
}

function revisoes(f) {
  return `<section id="m-revisoes">
    <h2>Preço de revisão</h2>
    <p>O preço de cada revisão vem do site da própria montadora, o mesmo que qualquer cliente consulta. Um robô lê esses sites toda segunda-feira às 9h e guarda o preço só quando ele muda, com a data em que começou a valer.</p>
    <p>A quantidade de carros de cada modelo na nossa frota vem do site ${fora(f.links.ativos, 'Ativos')}.</p>
    <div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Modelo</th><th>Onde conferir</th><th>O que escolher no site</th><th class="num">Revisões</th><th>Última leitura</th></tr></thead>
      <tbody>${f.revisoes.map(m => `<tr>
        <td><strong>${esc(m.nome)}</strong><br><small>${esc(m.montadora)}${m.qtd_frota ? ` · ${num(m.qtd_frota)} carros` : ' · candidato'}</small></td>
        <td>${m.pagina ? fora(m.pagina, `Site ${m.montadora}`) : ''}</td>
        <td>${esc(m.como_achar)}</td>
        <td class="num">${num(m.revisoes)}<br><small>até ${num((m.km_max ?? 0) / 1000)} mil km</small></td>
        <td>${quando(m.ultima_coleta)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="nota">A Fiat mostra o preço por concessionária: usamos uma de São Paulo. Na Chevrolet o site mostra o valor em parcelas; guardamos o total.</p>
  </section>`;
}

function comparacao(f) {
  const argo = f.revisoes.find(m => m.projetar);
  return `<section id="m-comparacao">
    <h2>Como comparamos</h2>
    <p>Cada montadora publica um número diferente de revisões: umas até 100 mil km, outras até 50 mil, outras até 200 mil. Para comparar modelos de forma justa, somamos o custo de todas as revisões <strong>até 100 mil km</strong>. É esse o valor grande nos cartões do Início e na coluna "100 mil" do Comparar.</p>
    ${argo ? `<p>A Fiat publica só até a 5ª revisão (50 mil km) do ${esc(argo.nome)}. Da 6ª à 10ª repetimos a 1ª à 5ª, na mesma ordem. Essas revisões aparecem marcadas como "proj." e tracejadas no gráfico. É a mesma regra que o KPIs usa no Unit Economics.</p>` : ''}
    <p>No detalhe de cada modelo, "Desde" é quando o preço atual começou a valer e "Antes" é o último preço diferente, com o período em que valeu.</p>
  </section>`;
}

function revenda(f) {
  return `<section id="m-revenda">
    <h2>Preço do carro usado</h2>
    <p>Usamos quatro fontes públicas, lidas na mesma rodada de segunda-feira, e as planilhas importadas na aba Anúncios:</p>
    <ul class="fontes">
      <li><strong>Tabela FIPE</strong>, no ${fora(f.links.fipe, 'site oficial da FIPE')}. Dá o preço médio de cada modelo por ano, mês a mês, desde 3 anos atrás. Serve para medir quanto o carro perde de valor com o tempo. No site, use "Consulta por código" com o código da tabela abaixo.${f.coletas.fipe ? ` <small>Última leitura: ${quando(f.coletas.fipe)}.</small>` : ''}</li>
      <li><strong>Anúncios da Mobiauto e da NaPista</strong>, carros à venda em São Paulo. A FIPE não sabe a quilometragem; os anúncios sabem. Servem para medir quanto o km derruba o preço, quanto os preços variam entre carros iguais e quanto vale hoje um carro de 1 ano com 70 mil km.${f.coletas.mobiauto ? ` <small>Mobiauto: ${quando(f.coletas.mobiauto)}.</small>` : ''}${f.coletas.napista ? ` <small>NaPista: ${quando(f.coletas.napista)}.</small>` : ''}</li>
      <li><strong>IPCA do Banco Central</strong> (${fora(f.links.ipca, 'últimos 12 meses')}). Serve para mostrar o valor também sem a inflação.</li>
    </ul>
    <div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Modelo</th><th>Código FIPE</th><th>Anúncios</th><th>Versão considerada</th><th class="num">Anúncios usados</th></tr></thead>
      <tbody>${f.revenda.map(m => `<tr>
        <td><strong>${esc(m.nome)}</strong></td>
        <td>${m.codigo_fipe ? esc(m.codigo_fipe) : ''}${m.apoio ? `<br><small>apoio: ${esc(m.apoio.codigo_fipe ?? '')}${m.apoio.nome ? ` (${esc(m.apoio.nome)})` : ''}</small>` : ''}</td>
        <td>${m.mobiauto ? fora(m.mobiauto, 'Mobiauto') : ''}${m.napista ? `<br>${fora(m.napista, 'NaPista')}` : ''}</td>
        <td><code>${esc(m.filtro_versao ?? '')}</code>${m.filtro_napista ? `<br><code>${esc(m.filtro_napista)}</code>` : ''}</td>
        <td class="num">${num(m.anuncios)}${m.repetidos || m.leilao || m.descartados ? `<br><small>${[m.repetidos ? `${num(m.repetidos)} repetidos` : '', m.leilao ? `${num(m.leilao)} leilão ou possível leilão` : '', m.descartados ? `${num(m.descartados)} fora do padrão` : ''].filter(Boolean).join(' · ')}</small>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="nota">Os links abrem todas as versões do modelo; o robô fica só com as que batem com a versão considerada (por exemplo, só o Polo Track) e com ano até 3 anos atrás. O mesmo carro anunciado em dois sites, ou em duas lojas da mesma rede, conta uma vez.</p>
  </section>`;
}

function calculo(m, p) {
  if (!p) {
    return `<section id="m-calculo"><h2>Como calculamos a revenda</h2>
      <p>O valor sai de quatro passos: quanto o carro perde de valor em 1 ano pela FIPE, o ajuste pelo km rodado, a conferência com os anúncios e o percentual do canal de venda.</p></section>`;
  }
  const i = p.insumos;
  const reducaoKm = i.fator_km - 1;
  const fipe0 = i.fipe_0km ?? p.preco;
  return `<section id="m-calculo">
    <h2>Como calculamos a revenda</h2>
    <p>Exemplo com o estudo de ${dia(i.data_estudo)}: <strong>${esc(m.nome)}</strong> vendido no atacado no fim do contrato, depois de <strong>12 meses</strong> e <strong>${num(p.km)} km</strong>.</p>
    <ol class="passos">
      <li><span class="passo-n">1</span><div><strong>Quanto o carro vale depois de 1 ano, pela FIPE</strong>
        <p>Para cada mês dos últimos 2 anos, comparamos o preço FIPE do 0 km com o preço FIPE do mesmo carro 12 meses depois. Ficamos com a mediana dessas comparações, o valor do meio.</p>
        <p class="conta">${esc(m.nome)}: vale <strong>${pctSimples(i.r_p50)}</strong> do 0 km depois de 1 ano${i.r_real_p50 != null ? ` (${pctSimples(i.r_real_p50)} descontando a inflação)` : ''}.</p></div></li>
      <li><span class="passo-n">2</span><div><strong>Ajuste pelo km rodado</strong>
        <p>A FIPE já embute o km normal de um carro de 1 ano; ajustamos só a diferença, pelo quanto o preço dos anúncios cai a cada 10 mil km.</p>
        <p class="conta">Km normal em 12 meses: ${num(Math.round(i.km_referencia ?? 0))} km. Com ${num(p.km)} km: <strong>${pct(reducaoKm)}</strong>.</p></div></li>
      <li><span class="passo-n">3</span><div><strong>Conferência com os anúncios</strong>
        <p>Os passos 1 e 2 são o critério FIPE. Ao lado dele calculamos o mesmo carro de 1 ano e 70 mil km direto pelos ${num(i.n_anuncios)} anúncios: pela reta que liga preço, idade e km de todos eles, e pelos anúncios parecidos de cada site (de 6 a 18 meses, com mais peso quanto mais perto de 70 mil km). Anúncio de leilão, repetido ou com preço fora de propósito não entra. O valor final é a mediana dos critérios; o detalhe de cada modelo mostra todos eles.</p>
        <p class="conta">${numero(i.criterios_ok)} ${i.criterios_ok === 1 ? 'critério' : 'critérios'} · consenso <strong>${pct((i.ajuste ?? 1) - 1)}</strong> sobre o critério FIPE.</p></div></li>
      <li><span class="passo-n">4</span><div><strong>Canal de venda</strong>
        <p>O percentual vem da aba Premissas: no atacado, o lojista paga uma parte do valor; no varejo, vendemos pelo preço de anúncio menos a negociação; o motorista paga o valor cheio.</p>
        <p class="conta">Atacado: <strong>${pctSimples(i.multiplicador, 0)}</strong> do valor.</p></div></li>
    </ol>
    <div class="resultado">
      <span>${brl(fipe0)} (FIPE 0 km) × ${pctSimples(i.r_p50)} × ${pctSimples(i.fator_km)} × ${pctSimples(i.ajuste ?? 1)} × ${pctSimples(i.multiplicador, 0)}</span>
      <strong>= ${brl(p.p50.nominal)}</strong>
      <span>${pctSimples(p.p50.pct)} ${p.preco_origem === 'compra' ? `do preço de compra (${brl(p.preco)})` : 'do 0 km'}</span>
    </div>
  </section>`;
}

function siglas() {
  const termo = (t, d) => `<div><dt>${t}</dt><dd>${d}</dd></div>`;
  return `<section id="m-siglas">
    <h2>P10, P50, P90 e outras siglas</h2>
    <p>Carros iguais são vendidos por preços diferentes, por estado, cor, loja e região. Por isso o valor de revenda vem numa faixa, medida nos anúncios.</p>
    <dl class="glossario">
      ${termo('P50 · mediano', 'Metade das vendas fica abaixo desse valor e metade acima. É o número de referência.')}
      ${termo('P10 · baixo', 'Só 10% das vendas ficam abaixo. É o cenário ruim.')}
      ${termo('P90 · alto', 'Só 10% das vendas ficam acima. É o cenário bom.')}
      ${termo('P25 e P75', 'Na tela de cada modelo: quanto a perda de valor pela FIPE variou de um mês para outro. Metade dos meses ficou entre os dois.')}
      ${termo('Real', 'O mesmo valor descontando a inflação (IPCA): quanto ele vale em dinheiro de hoje.')}
      ${termo('Km típico', 'O km mediano dos anúncios de carros com cerca de 1 ano. É o km que a FIPE já embute.')}
      ${termo('Anúncio sobre FIPE', 'Quanto o preço anunciado fica acima ou abaixo da FIPE. Entra no canal varejo.')}
      ${termo('FIPE do outro modelo', 'O modelo ainda não tem 1 ano de FIPE (lançamento recente); usamos a perda de valor de um modelo parecido, o código de apoio.')}
      ${termo('Média dos outros', 'O modelo tem poucos dados próprios (menos de 30 anúncios ou pouca FIPE); usamos a média dos modelos que têm.')}
      ${termo('Consenso', 'A mediana dos critérios que tiveram anúncios suficientes: FIPE, reta dos anúncios e comparáveis de cada site.')}
      ${termo('Possível leilão', 'Anúncio sem informação de leilão com preço muito abaixo do esperado para a idade e o km. Fica fora da conta.')}
      ${termo('Compra', 'O preço que pagamos no 0 km, cadastrado em Premissas. Sem ele, usamos o FIPE 0 km. Muda só o percentual: o valor do carro usado vem do mercado.')}
    </dl>
  </section>`;
}

function limites(f) {
  const pr = f.premissas ?? {};
  return `<section id="m-limites">
    <h2>Premissas e limites</h2>
    <ul class="fontes">
      <li>Os percentuais de canal (atacado ${num(pr.atacado_pct_base ?? 0)}%, desconto no varejo ${num(pr.varejo_negociacao_pct ?? 0)}%, motorista ${num(pr.motorista_pct_base ?? 0)}%) são uma estimativa inicial. Quando registrarmos vendas reais na aba Vendas, dá para comparar o previsto com o vendido e ajustar.</li>
      <li>Anúncio não é venda: o preço pedido costuma ficar acima do fechado. Por isso o varejo desconta a negociação.</li>
      <li>Anúncios com preço muito fora do padrão (erro de digitação, lote de loja) saem da conta. A tabela acima mostra quantos saíram.</li>
      <li>Modelos com etiqueta "FIPE do outro modelo" ou "média dos outros" têm números menos confiáveis; melhoram sozinhos conforme o histórico cresce.</li>
      <li>A aba Estudo compara combustão, elétrico e híbrido pela FIPE de cada modelo, só com o histórico dele. Para não depender de um carro por categoria, a FIPE também lê modelos de referência, sem anúncios: outros elétricos e híbridos da BYD, GWM e Toyota, e dois compactos a combustão. Modelo lançado há menos de um ano e meio ainda não tem curva.</li>
      <li>O histórico de preço de revisão começa em junho de 2026.</li>
    </ul>
  </section>`;
}
