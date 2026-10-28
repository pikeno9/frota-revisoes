import { get } from '../api.js';
import { pctSimples, pct, num, dia, esc } from '../formato.js';

const plural = (n, um, varios) => `${num(n)} ${n === 1 ? um : varios}`;

export async function rvModelos(tela) {
  const [modelos, publicos] = await Promise.all([get('/api/revenda/modelos'), get('/api/modelos?todos=1')]);
  const imagem = new Map(publicos.map(m => [m.slug, m.imagem]));
  tela.innerHTML = `<div class="rv-modelos">
    <h2>Revenda em 12 meses · atacado · P50</h2>
    <div class="rv-cartoes">${modelos.map((m, i) => cartao(m, imagem.get(m.slug), i)).join('')}</div>
  </div>`;
}

function cartao(m, img, i) {
  const p = m.p50_12m;
  const valor = k => (p?.[k] == null ? '<dd class="vazio">sem estudo</dd>' : `<dd>${pctSimples(p[k])}</dd>`);
  const emprestado = m.r_emprestado || m.km_emprestado;
  return `<a class="cartao rv-cartao" href="/revenda/${esc(m.slug)}" data-link style="--i:${i}">
    <img src="${esc(img ?? '/img/placeholder.svg')}" alt="" loading="lazy">
    <div class="cartao-topo"><strong>${esc(m.nome)}</strong>${m.qtd_frota ? `<span class="qtd">${plural(m.qtd_frota, 'carro', 'carros')}</span>` : ''}</div>
    <dl class="rv-par"><div><dt>30 mil km</dt>${valor('30000')}</div><div><dt>70 mil km</dt>${valor('70000')}</div></dl>
    <div class="cartao-meta">${m.fator_10mil == null ? '' : `${pct(m.fator_10mil)} por 10 mil km · `}${plural(m.n_anuncios, 'anúncio', 'anúncios')}</div>
    <div class="cartao-meta">${m.data_estudo ? `estudo ${dia(m.data_estudo)}` : 'sem estudo'}</div>
    ${emprestado ? '<span class="conferir">emprestado</span>' : ''}
  </a>`;
}
