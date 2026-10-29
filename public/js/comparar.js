import { get } from './api.js';
import { brl, esc, pct, mesAno } from './formato.js';
import { graficoComparar, graficoTempo, trocarModo, corDe, mostrarSo, realcar } from './graficos.js';

const GRUPOS = [['frota', 'Frota'], ['candidato', 'Candidatos']];

export async function comparar(tela) {
  const dados = await get('/api/comparar');
  const modelos = dados.modelos;
  const ver = modelos.map(() => true);
  let vista = 'km', modo = 'pct', realce = null;
  tela.innerHTML = `<div class="comparar">
    <div class="comparar-topo">
      <div class="segmento" id="vista"><button type="button" data-v="km" aria-pressed="true">Até 100 mil km</button><button type="button" data-v="tempo" aria-pressed="false">No tempo</button></div>
      <div class="segmento" id="modo" hidden><button type="button" data-m="pct" aria-pressed="true">%</button><button type="button" data-m="rs" aria-pressed="false">R$</button></div>
    </div>
    <div class="comparar-corpo">
      <figure class="grafico-comparar">
        <div class="legenda" id="legenda">${GRUPOS.map(([g, nome]) => (modelos.some(m => m.origem === g)
          ? `<span class="leg-grupo"><button type="button" class="leg-titulo" data-g="${g}">${nome}</button>${modelos.map((m, i) => (m.origem === g
            ? `<button type="button" class="chip" data-i="${i}" aria-pressed="true"><i style="background:${corDe(m.cor)}"></i>${esc(m.nome)}</button>` : '')).join('')}</span>` : '')).join('')}</div>
        <div class="area" id="a-km"><canvas id="g-km" role="img" aria-label="Custo acumulado de revisão até 100 mil km"></canvas></div>
        <div class="area" id="a-tempo" hidden><canvas id="g-tempo" role="img" aria-label="Custo até 100 mil km no tempo"></canvas></div>
      </figure>
      <div class="tabela-rolagem"><table class="tabela" id="t-comp">${tabela(modelos, dados.referencias)}</table></div>
    </div>
  </div>`;
  const gKm = graficoComparar(tela.querySelector('#g-km'), dados.kms, modelos, dados.referencias, dados.km_padrao);
  let gTempo = null;
  const ativo = () => (vista === 'km' ? gKm : gTempo);

  const realcarLinha = i => {
    if (i === realce) return;
    realce = i;
    realcar(ativo(), i);
  };
  const aplicar = () => {
    if (realce != null && !ver[realce]) realcarLinha(null);
    [gKm, gTempo].forEach(g => g && mostrarSo(g, ver));
    tela.querySelectorAll('[data-i]').forEach(el => {
      const on = ver[Number(el.dataset.i)];
      if (el.matches('button')) el.setAttribute('aria-pressed', String(on));
      else el.classList.toggle('fora', !on);
    });
  };
  const alternar = i => { ver[i] = !ver[i]; aplicar(); };

  tela.querySelector('.comparar-corpo').addEventListener('click', e => {
    const g = e.target.closest('[data-g]');
    if (g) {
      const idx = modelos.map((m, i) => (m.origem === g.dataset.g ? i : -1)).filter(i => i >= 0);
      const todos = idx.every(i => ver[i]);
      idx.forEach(i => { ver[i] = !todos; });
      aplicar();
      return;
    }
    const alvo = e.target.closest('[data-i]');
    if (alvo) alternar(Number(alvo.dataset.i));
  });
  tela.querySelector('#vista').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.dataset.v === vista) return;
    realcarLinha(null);
    vista = b.dataset.v;
    tela.querySelectorAll('#vista button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    tela.querySelector('#a-km').hidden = vista !== 'km';
    tela.querySelector('#a-tempo').hidden = vista !== 'tempo';
    tela.querySelector('#modo').hidden = vista !== 'tempo';
    if (vista === 'tempo' && !gTempo) {
      gTempo = graficoTempo(tela.querySelector('#g-tempo'), modelos, modo);
      mostrarSo(gTempo, ver);
    }
  });
  tela.querySelector('#modo').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.dataset.m === modo) return;
    modo = b.dataset.m;
    tela.querySelectorAll('#modo button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    trocarModo(gTempo, modo);
  });
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const corpo = tela.querySelector('.comparar-corpo');
    corpo.addEventListener('mouseover', e => {
      const alvo = e.target.closest('[data-i]');
      const i = alvo ? Number(alvo.dataset.i) : null;
      realcarLinha(i != null && ver[i] ? i : null);
    });
    corpo.addEventListener('mouseleave', () => realcarLinha(null));
  }
  return () => [gKm, gTempo].forEach(g => g?.destroy());
}

// Variação do custo até 100 mil km desde o primeiro preço guardado de cada modelo.
function desdeInicio(serie) {
  if (serie.length < 2) return null;
  const a = serie[0].total, b = serie.at(-1).total;
  return { pct: a ? b / a - 1 : 0, desde: serie[0].data };
}

function tabela(modelos, refs) {
  return `<thead><tr><th>Modelo</th>${refs.map(r => `<th class="num">${r / 1000} mil</th>`).join('')}<th class="num">Variação</th></tr></thead>
  <tbody>${modelos.map((m, i) => {
    const v = desdeInicio(m.serie_100);
    return `<tr data-i="${i}">
      <td><i class="ponto" style="background:${corDe(m.cor)}"></i>${esc(m.nome)}</td>
      ${m.ate.map((x, j) => `<td class="num${m.projetado_de != null && refs[j] > m.projetado_de ? ' projetado' : ''}">${x == null ? '' : brl(Math.round(x))}</td>`).join('')}
      <td class="num">${v ? `<span class="var ${v.pct > 0 ? 'sobe' : v.pct < 0 ? 'desce' : 'igual'}">${pct(v.pct)}</span><br><small>${mesAno(v.desde)}</small>` : ''}</td>
    </tr>`;
  }).join('')}</tbody>`;
}
