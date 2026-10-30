import { get } from '../api.js';
import { pctSimples, pct, num, dia, brl, esc } from '../formato.js';

const plural = (n, um, varios) => `${num(n)} ${n === 1 ? um : varios}`;
export const CATEGORIAS = [['', 'Todas'], ['combustao', 'Combustão'], ['eletrico', 'Elétrico'], ['hibrido', 'Híbrido']];

export async function rvModelos(tela) {
  const [modelos, publicos] = await Promise.all([get('/api/revenda/modelos'), get('/api/modelos?todos=1')]);
  const imagem = new Map(publicos.map(m => [m.slug, m.imagem]));
  const data = modelos.map(m => m.data_estudo).filter(Boolean).sort().at(-1);
  const pedida = new URLSearchParams(location.search).get('categoria') ?? '';
  const existentes = new Set(modelos.map(m => m.categoria));
  const opcoes = CATEGORIAS.filter(([v]) => !v || existentes.has(v));
  let atual = opcoes.some(([v]) => v === pedida) ? pedida : '';
  tela.innerHTML = `<div class="rv-modelos">
    <div class="rv-topo">
      <h2>Fim de contrato · 12 meses · 70 mil km · atacado · mediana${data ? ` · estudo ${dia(data)}` : ''}</h2>
      <div class="filtros" role="group" aria-label="Categoria">${opcoes.map(([v, r]) => `<button type="button" data-v="${v}" aria-pressed="${v === atual}">${r}</button>`).join('')}</div>
    </div>
    <div class="rv-cartoes"></div>
  </div>`;
  const grade = tela.querySelector('.rv-cartoes');
  const pintar = () => { grade.innerHTML = modelos.filter(m => !atual || m.categoria === atual).map((m, i) => cartao(m, imagem.get(m.slug), i)).join(''); };
  pintar();
  tela.querySelector('.rv-topo .filtros').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    atual = b.dataset.v;
    tela.querySelectorAll('.rv-topo .filtros button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    history.replaceState(null, '', atual ? `/revenda?categoria=${atual}` : '/revenda');
    pintar();
  });
}

// Etiquetas de origem: o que não veio do próprio modelo.
function origens(m) {
  const t = [];
  if (m.origem_r12 === 'ref') t.push(m.ref_nome ? `FIPE do ${esc(m.ref_nome)}` : `FIPE do código ${esc(m.ref_codigo)}`);
  else if (m.origem_r12 === 'outros') t.push('FIPE: média dos outros');
  if (m.km_emprestado) t.push('km: média dos outros');
  if (m.criterios_ok === 1) t.push('só FIPE');
  return t.map(x => `<span class="rv-tag">${x}</span>`).join('');
}

function cartao(m, img, i) {
  const p = m.p50_12m;
  const valor = k => (p?.[k] == null ? '<dd class="vazio">sem estudo</dd>' : `<dd>${pctSimples(p[k])}</dd>`);
  const fim = m.fim_contrato;
  const fontes = m.fontes ? Object.values(m.fontes).filter(n => n > 0).length : 0;
  return `<a class="cartao rv-cartao" href="/revenda/${esc(m.slug)}" data-link style="--i:${i}">
    <strong class="cartao-nome">${esc(m.nome)}</strong>
    ${m.qtd_frota ? `<span class="qtd rv-qtd">${plural(m.qtd_frota, 'carro', 'carros')}</span>` : '<span class="rv-qtd"></span>'}
    <img src="${esc(img ?? '/img/placeholder.svg')}" alt="" loading="lazy">
    <div class="rv-fim">
      <div><span>Compra${m.compra?.origem === 'fipe' ? ' <i class="rv-tag">FIPE</i>' : ''}</span><b>${m.compra ? brl(m.compra.valor) : '·'}</b></div>
      <div class="rv-final"><span>Fim de contrato</span><b>${fim ? brl(fim.valor) : 'sem estudo'}</b>
        ${fim?.pct_compra == null ? '' : `<small>${pctSimples(fim.pct_compra)} da compra</small>`}</div>
    </div>
    <dl class="rv-par"><div><dt>30 mil km</dt>${valor('30000')}</div><div><dt>70 mil km</dt>${valor('70000')}</div></dl>
    <div class="cartao-meta">${m.fator_10mil == null ? '' : `${pct(m.fator_10mil)} por 10 mil km · `}${plural(m.n_anuncios, 'anúncio', 'anúncios')}${fontes > 1 ? ` · ${fontes} fontes` : ''}</div>
    <div class="rv-tags">${origens(m)}</div>
  </a>`;
}
