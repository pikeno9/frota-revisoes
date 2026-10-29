import { get } from '../api.js';
import { pctSimples, pct, num, dia, esc } from '../formato.js';

const plural = (n, um, varios) => `${num(n)} ${n === 1 ? um : varios}`;

export async function rvModelos(tela) {
  const [modelos, publicos] = await Promise.all([get('/api/revenda/modelos'), get('/api/modelos?todos=1')]);
  const imagem = new Map(publicos.map(m => [m.slug, m.imagem]));
  const data = modelos.map(m => m.data_estudo).filter(Boolean).sort().at(-1);
  tela.innerHTML = `<div class="rv-modelos">
    <h2>Valor em 12 meses · atacado · mediana (P50)${data ? ` · estudo ${dia(data)}` : ''}</h2>
    <div class="rv-cartoes">${modelos.map((m, i) => cartao(m, imagem.get(m.slug), i)).join('')}</div>
  </div>`;
}

// Etiquetas de origem: o que não veio do próprio modelo.
function origens(m) {
  const t = [];
  if (m.origem_r12 === 'ref') t.push(m.ref_nome ? `FIPE do ${esc(m.ref_nome)}` : `FIPE do código ${esc(m.ref_codigo)}`);
  else if (m.origem_r12 === 'outros') t.push('FIPE: média dos outros');
  if (m.km_emprestado) t.push('km: média dos outros');
  return t.map(x => `<span class="rv-tag">${x}</span>`).join('');
}

function cartao(m, img, i) {
  const p = m.p50_12m;
  const valor = k => (p?.[k] == null ? '<dd class="vazio">sem estudo</dd>' : `<dd>${pctSimples(p[k])}</dd>`);
  return `<a class="cartao rv-cartao" href="/revenda/${esc(m.slug)}" data-link style="--i:${i}">
    <strong class="cartao-nome">${esc(m.nome)}</strong>
    ${m.qtd_frota ? `<span class="qtd rv-qtd">${plural(m.qtd_frota, 'carro', 'carros')}</span>` : '<span class="rv-qtd"></span>'}
    <img src="${esc(img ?? '/img/placeholder.svg')}" alt="" loading="lazy">
    <dl class="rv-par"><div><dt>30 mil km</dt>${valor('30000')}</div><div><dt>70 mil km</dt>${valor('70000')}</div></dl>
    <div class="cartao-meta">${m.fator_10mil == null ? '' : `${pct(m.fator_10mil)} por 10 mil km · `}${plural(m.n_anuncios, 'anúncio', 'anúncios')}</div>
    <div class="rv-tags">${origens(m)}</div>
  </a>`;
}
