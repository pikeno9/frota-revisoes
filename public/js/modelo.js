import { get } from './api.js';
import { brl, num, dia, esc, seta } from './formato.js';
import { linhaPlano } from './graficos.js';

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

export async function modelo(tela, slug) {
  const m = await get(`/api/modelos/${encodeURIComponent(slug)}`);
  const revisoes = m.revisoes_lista.filter(r => r.atual);
  tela.innerHTML = `<div class="detalhe">
    <header class="detalhe-topo">
      <img src="${esc(m.imagem ?? '/img/placeholder.svg')}" alt="">
      <div><h1>${esc(m.montadora)} ${esc(m.nome)}</h1><p class="meta">${esc(m.versao ?? '')}${m.qtd_frota ? ` · ${plural(m.qtd_frota, 'carro', 'carros')} na frota` : ' · candidato'}</p></div>
      <div class="detalhe-total"><span>${brl(m.total)}</span>${seta(m.variacao)}</div>
    </header>
    <div class="detalhe-corpo">
      <div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>Revisão</th><th class="num">km</th><th class="num">Meses</th><th class="num">Preço</th><th>Desde</th><th class="num">Antes</th><th></th></tr></thead>
        <tbody>${revisoes.map(linha).join('')}</tbody>
      </table></div>
      <figure class="grafico-plano"><figcaption>Plano completo</figcaption><div class="area"><canvas id="g-plano" role="img" aria-label="Total do plano no tempo"></canvas></div></figure>
    </div>
  </div>`;
  const graficos = [];
  try {
    graficos.push(linhaPlano(tela.querySelector('#g-plano'), m.serie));
    for (const r of revisoes) {
      const canvas = tela.querySelector(`[data-rev="${r.ordem}"]`);
      if (canvas) graficos.push(linhaPlano(canvas, r.historico.map(h => ({ data: h.de, total: h.valor })), { mini: true }));
    }
  } catch (e) {
    graficos.forEach(g => g.destroy());
    throw e;
  }
  return () => graficos.forEach(g => g.destroy());
}

function linha(r) {
  return `<tr${r.conferir ? ' class="a-conferir"' : ''}>
    <td>${r.ordem}ª${r.conferir ? ' <span class="conferir">conferir</span>' : ''}</td><td class="num">${num(r.km)}</td><td class="num">${r.meses ?? ''}</td>
    <td class="num"><strong>${brl(r.valor)}</strong></td><td>${dia(r.desde)}</td><td class="num">${r.anterior == null ? '' : brl(r.anterior)}</td>
    <td class="mini"><div><canvas data-rev="${r.ordem}" aria-hidden="true"></canvas></div></td>
  </tr>`;
}
