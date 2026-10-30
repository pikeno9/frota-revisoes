import { get } from '../api.js';
import { num, pct, pctSimples, esc } from '../formato.js';
import { curvasCategoria, COR_CATEGORIA, NOME_FONTE } from './graficos.js';

const NOME = { combustao: 'Combustão', eletrico: 'Elétrico', hibrido: 'Híbrido' };
const MESES = ['6', '12', '18', '24'];
const nomeFonte = f => NOME_FONTE[f] ?? f;

export async function rvEstudo(tela) {
  const e = await get('/api/revenda/estudo');
  const cats = e.categorias.map(c => c.categoria);
  let atual = '';
  tela.innerHTML = `<div class="rv-estudo">
    <figure class="rv-fig">
      <figcaption><span>Valor retido do 0 km · FIPE</span>
        <span class="filtros" role="group" aria-label="Categoria">${[['', 'Todas'], ...cats.map(c => [c, NOME[c]])].map(([v, r]) => `<button type="button" data-v="${v}" aria-pressed="${v === atual}">${v ? `<i class="rv-ponto-cat" style="background:${COR_CATEGORIA[v]}"></i>` : ''}${r}</button>`).join('')}</span>
      </figcaption>
      <div class="area"><canvas id="g-cat" role="img" aria-label="Valor retido em relação ao 0 km por meses, por categoria"></canvas></div>
    </figure>
    <div class="rv-lado">
      <div class="rv-vistas" role="group" aria-label="Painel">
        <button type="button" class="rv-alterna" data-painel="modelos" aria-pressed="true">Modelos</button>
        <button type="button" class="rv-alterna" data-painel="anuncios" aria-pressed="false">Anúncios</button>
      </div>
      <div class="rv-painel rv-painel-rola" data-painel="modelos">${tabelaModelos(e, atual)}</div>
      <div class="rv-painel rv-painel-rola" data-painel="anuncios" hidden>${tabelaAnuncios(e)}</div>
    </div>
  </div>`;
  let grafico = curvasCategoria(tela.querySelector('#g-cat'), e, atual);
  tela.querySelector('.rv-estudo .filtros').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-v]');
    if (!b) return;
    atual = b.dataset.v;
    tela.querySelectorAll('.rv-estudo .filtros button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    grafico.destroy();
    grafico = curvasCategoria(tela.querySelector('#g-cat'), e, atual);
    tela.querySelector('.rv-painel[data-painel="modelos"]').innerHTML = tabelaModelos(e, atual);
  });
  tela.querySelector('.rv-lado > .rv-vistas').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-painel]');
    if (!b) return;
    tela.querySelectorAll('.rv-lado > .rv-vistas button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    tela.querySelectorAll('.rv-painel').forEach(p => { p.hidden = p.dataset.painel !== b.dataset.painel; });
  });
  return () => grafico.destroy();
}

function tabelaModelos(e, atual) {
  const cel = r => `<td class="num">${r ? pctSimples(r.p50) : ''}</td>`;
  const grupos = e.categorias.filter(c => !atual || c.categoria === atual).map(c => {
    const linhas = e.codigos.filter(x => x.categoria === c.categoria).map(x => `<tr>
      <td>${x.slug ? `<a href="/revenda/${esc(x.slug)}" data-link>${esc(x.nome)}</a>` : esc(x.nome)}${x.origem === 'frota' ? '' : ' <span class="rv-tag">referência</span>'}</td>
      ${MESES.map(m => cel(x.r[m])).join('')}</tr>`).join('');
    return `<tbody>
      <tr class="rv-p50"><td><i class="rv-ponto-cat" style="background:${COR_CATEGORIA[c.categoria]}"></i>${NOME[c.categoria]} · mediana</td>${MESES.map(m => cel(c.r[m])).join('')}</tr>
      ${linhas}</tbody>`;
  }).join('');
  return `<div class="rv-numeros"><table class="tabela rv-tab-estudo">
    <thead><tr><th>Meses</th>${MESES.map(m => `<th class="num">${m}</th>`).join('')}</tr></thead>${grupos}
  </table></div>`;
}

function tabelaAnuncios(e) {
  const frota = e.codigos.filter(x => x.anuncios);
  if (!frota.length) return '<p class="vazio">Sem estudo de anúncios</p>';
  const linhas = frota.map(x => {
    const a = x.anuncios;
    const premio = (campo, v) => a.premios.find(p => p.campo === campo && p.valor === v)?.efeito;
    const fontes = Object.keys(a.contagem).filter(f => f !== a.base_fonte).map(f => (premio('fonte', f) == null ? '' : `${esc(nomeFonte(f))} ${pct(premio('fonte', f))}`)).filter(Boolean).join(' · ');
    const leilao = Object.values(a.contagem).reduce((t, c) => t + c.leilao + c.possivel_leilao, 0);
    const lidos = Object.values(a.contagem).reduce((t, c) => t + c.lidos, 0);
    return `<tr><td><a href="/revenda/${esc(x.slug)}" data-link>${esc(x.nome)}</a></td>
      <td class="num">${num(a.usados)}</td>
      <td class="num">${a.fator_10mil == null ? '' : pct(a.fator_10mil)}</td>
      <td class="num">${a.fator_ano == null ? '' : pct(a.fator_ano)}</td>
      <td class="num">${premio('tipo_vendedor', 'locadora') == null ? '' : pct(premio('tipo_vendedor', 'locadora'))}</td>
      <td>${fontes}</td>
      <td class="num">${lidos ? pctSimples(leilao / lidos, 0) : ''}</td></tr>`;
  }).join('');
  const cats = e.categorias.filter(c => c.fator_10mil != null).map(c => `<div><dt>${NOME[c.categoria]} · por 10 mil km</dt><dd>${pct(c.fator_10mil)}</dd></div>`).join('');
  return `<div class="rv-numeros">
    <table class="tabela rv-tab-estudo">
      <thead><tr><th>Modelo</th><th class="num">Usados</th><th class="num">10 mil km</th><th class="num">Por ano</th><th class="num">Locadora</th><th>Fonte</th><th class="num">Leilão</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
    ${cats ? `<dl class="rv-dl">${cats}</dl>` : ''}
  </div>`;
}
