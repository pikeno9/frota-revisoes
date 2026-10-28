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
    grafico = null;
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
