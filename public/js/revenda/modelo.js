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
  const semCurva = e && !curva ? `<span class="conferir">sem curva${e.km.motivo ? ` · ${esc(e.km.motivo)}` : ''}</span>` : '';
  tela.innerHTML = `<div class="rv-detalhe">
    <header class="detalhe-topo">
      <img src="${esc(img)}" alt="">
      <div><h1>${esc(m.montadora)} ${esc(m.nome)}</h1><p class="meta">${e ? `estudo ${dia(e.calculado_em)}${e.referencia ? ` · FIPE ${mesAno(`${e.referencia}-01`)}` : ''}` : 'sem estudo'}</p></div>
      <a class="btn sec rv-simular" href="/revenda/simulador?modelo=${encodeURIComponent(m.slug)}" data-link>Simular</a>
    </header>
    <div class="rv-detalhe-corpo">
      <figure class="rv-fig">
        <figcaption><span>Anúncios de 1 ano ${semCurva}</span>
          <span class="rv-cab">
            <span class="legenda"><span><i class="ponto" style="background:${PAPEL.anuncios}"></i>Anúncios</span>${curva ? `<span><i style="background:${PAPEL.curva}"></i>Curva de 1 ano</span><span><i class="faixa" style="background:${PAPEL.faixa}"></i>P10 a P90</span>` : ''}</span>
            <button type="button" class="rv-alterna" aria-pressed="false">Tabela</button>
          </span>
        </figcaption>
        <div class="area"><canvas id="g-km" role="img" aria-label="Preço dos anúncios por km"></canvas></div>
        <div class="rv-tab" hidden>${tabelaFaixas(umAno)}</div>
      </figure>
      <div class="rv-lado">
        <figure class="rv-fig">
          <figcaption><span>FIPE</span>
            <span class="rv-cab">
              <span class="legenda"><span><i style="background:${PAPEL.zero_km}"></i>Zero km</span><span><i style="background:${PAPEL.ano_anterior}"></i>Ano anterior</span></span>
              <button type="button" class="rv-alterna" aria-pressed="false">Tabela</button>
            </span>
          </figcaption>
          <div class="area"><canvas id="g-fipe" role="img" aria-label="FIPE do zero km e do ano anterior no tempo"></canvas></div>
          <div class="rv-tab" hidden>${tabelaFipe(m.serie_fipe)}</div>
        </figure>
        ${e ? tabela(e) : '<p class="vazio">Sem estudo</p>'}
      </div>
    </div>
  </div>`;
  // Equivalente em tabela: o botão troca o gráfico pela tabela na mesma figura.
  tela.querySelectorAll('.rv-fig').forEach(fig => {
    const botao = fig.querySelector('.rv-alterna');
    botao.addEventListener('click', () => {
      const tabelaAberta = botao.getAttribute('aria-pressed') !== 'true';
      botao.setAttribute('aria-pressed', String(tabelaAberta));
      botao.textContent = tabelaAberta ? 'Gráfico' : 'Tabela';
      fig.classList.add('trocou'); // só a troca pedida entra com fade, não a primeira pintura
      fig.querySelector('.area').hidden = tabelaAberta;
      fig.querySelector('.rv-tab').hidden = !tabelaAberta;
      fig.querySelector('.legenda').hidden = tabelaAberta;
    });
  });
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

const FAIXAS = [['Até 30 mil km', 0, 30000], ['30 a 50 mil km', 30000, 50000], ['50 a 70 mil km', 50000, 70000], ['70 mil km ou mais', 70000, Infinity]];
const mediana = v => {
  const s = v.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const meio = s.length >> 1;
  return s.length % 2 ? s[meio] : (s[meio - 1] + s[meio]) / 2;
};

// Mesmos anúncios do gráfico de dispersão, por faixa de km.
function tabelaFaixas(anuncios) {
  if (!anuncios.length) return '<p class="vazio">Sem anúncios</p>';
  const linhas = FAIXAS.map(([rotulo, de, ate]) => {
    const f = anuncios.filter(a => a.km >= de && a.km < ate);
    const md = mediana(f.map(a => a.preco));
    return `<tr><td>${esc(rotulo)}</td><td class="num">${num(f.length)}</td><td class="num">${md == null ? '' : brl(Math.round(md))}</td></tr>`;
  }).join('');
  return `<table class="tabela"><thead><tr><th>Faixa de km</th><th class="num">Anúncios</th><th class="num">Preço mediano</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

// Últimas 6 referências da FIPE, a mais recente primeiro.
function tabelaFipe(serie) {
  const ultimas = serie.slice(-6).reverse();
  if (!ultimas.length) return '<p class="vazio">Sem FIPE</p>';
  const linhas = ultimas.map(s => `<tr><td>${mesAno(`${s.referencia}-01`)}</td><td class="num">${brl(s.zero_km)}</td><td class="num">${brl(s.ano_anterior)}</td></tr>`).join('');
  return `<table class="tabela"><thead><tr><th>Referência</th><th class="num">Zero km</th><th class="num">Ano anterior</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

function tabela(e) {
  const outros = '<span class="conferir">outros</span>';
  const marca = r => (r?.emprestado ? ` <span class="conferir">${esc(ORIGEM[r.emprestado] ?? r.emprestado)}</span>` : '');
  const real = r => (r == null ? '' : r.real_p50 == null ? '<span class="vazio">sem IPCA</span>' : pctSimples(r.real_p50));
  const linha = (rotulo, k) => `<tr><td>${rotulo}</td>${MESES.map(m => `<td class="num">${e.r[m] ? pctSimples(e.r[m][k]) : ''}</td>`).join('')}</tr>`;
  const linhaReal = `<tr><td>P50 real</td>${MESES.map(m => `<td class="num">${real(e.r[m])}</td>`).join('')}</tr>`;
  const faixa = e.residuos && !e.residuos.sem_faixa ? `${pct(Math.exp(e.residuos.q10) - 1)} / ${pct(Math.exp(e.residuos.q90) - 1)}` : '';
  const kmEmprestado = e.km.emprestado || e.km_emprestado;
  return `<div class="rv-numeros">
    <table class="tabela">
      <thead><tr><th>Meses</th>${MESES.map(m => `<th class="num">${m}${marca(e.r[m])}</th>`).join('')}</tr></thead>
      <tbody>${linha('P25', 'p25')}${linha('P50', 'p50')}${linha('P75', 'p75')}${linhaReal}</tbody>
    </table>
    <dl class="rv-dl">
      <div><dt>Por 10 mil km</dt><dd>${e.km.fator_10mil == null ? '' : pct(e.km.fator_10mil)}${kmEmprestado ? ` ${outros}` : ''}</dd></div>
      <div><dt>Km típico de 1 ano</dt><dd>${e.km.km_tipico == null ? '' : `${num(Math.round(e.km.km_tipico))} km`}${e.km.km_tipico_emprestado ? ` ${outros}` : ''}</dd></div>
      <div><dt>Anúncios</dt><dd>${num(e.km.n ?? 0)}</dd></div>
      <div><dt>P10 / P90</dt><dd>${faixa}${kmEmprestado && faixa ? ` ${outros}` : ''}</dd></div>
      <div><dt>Anúncio sobre FIPE</dt><dd>${pctSimples(e.anuncio_sobre_fipe)}</dd></div>
      <div><dt>FIPE zero km</dt><dd>${e.fipe_0km_atual == null ? '' : brl(e.fipe_0km_atual)}</dd></div>
    </dl>
  </div>`;
}
