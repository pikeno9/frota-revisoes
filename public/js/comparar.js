import { get } from './api.js';
import { brl, kmMil, esc } from './formato.js';
import { graficoComparar, corDe, mostrarSo, realcar } from './graficos.js';

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
  // Um gráfico só, com todos os modelos: o filtro liga e desliga linhas em vez de recriar.
  const grafico = graficoComparar(tela.querySelector('#g-comp'), dados.kms, dados.modelos, dados.referencias);
  let realce = null;
  const realcarLinha = i => {
    if (i === realce) return;
    realce = i;
    realcar(grafico, i);
  };
  const desenhar = () => {
    const ver = dados.modelos.map(m => filtro === 'todos' || m.origem === filtro);
    if (realce != null && !ver[realce]) realcarLinha(null);
    mostrarSo(grafico, ver);
    tela.querySelector('#legenda').innerHTML = dados.modelos.map((m, i) => (ver[i] ? `<span data-i="${i}"><i style="background:${corDe(m.cor)}"></i>${esc(m.nome)}</span>` : '')).join('');
    tela.querySelector('#t-comp').innerHTML = tabela(dados.modelos, ver, dados.referencias);
  };
  tela.querySelector('.filtros').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    filtro = b.dataset.f;
    tela.querySelectorAll('.filtros button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    desenhar();
  });
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const corpo = tela.querySelector('.comparar-corpo');
    corpo.addEventListener('mouseover', e => {
      const alvo = e.target.closest('[data-i]');
      realcarLinha(alvo ? Number(alvo.dataset.i) : null);
    });
    corpo.addEventListener('mouseleave', () => realcarLinha(null));
  }
  desenhar();
  return () => grafico.destroy();
}

function tabela(modelos, ver, refs) {
  return `<thead><tr><th>Modelo</th>${refs.map(r => `<th class="num">${kmMil(r)}</th>`).join('')}<th class="num">Plano</th></tr></thead>
  <tbody>${modelos.map((m, i) => (ver[i] ? `<tr data-i="${i}">
    <td><i class="ponto" style="background:${corDe(m.cor)}"></i>${esc(m.nome)}</td>
    ${m.ate.map(v => `<td class="num">${v == null ? '' : brl(v)}</td>`).join('')}
    <td class="num">${brl(m.total)}<br><small>${kmMil(m.km_max)}</small></td>
  </tr>` : '')).join('')}</tbody>`;
}
