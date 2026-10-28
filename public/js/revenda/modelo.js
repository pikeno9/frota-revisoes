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
