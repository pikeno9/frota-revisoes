import { get } from './api.js';
import { brl, seta, esc, dia, pct } from './formato.js';
import { linhaPlano } from './graficos.js';

export async function inicio(tela) {
  const [modelos, mud] = await Promise.all([get('/api/modelos'), get('/api/mudancas?limite=120')]);
  let ordem = 0;
  const grupo = (titulo, lista) => (lista.length ? `<section class="grupo"><h2>${titulo}</h2><div class="cartoes">${lista.map(m => cartao(m, ordem++)).join('')}</div></section>` : '');
  tela.innerHTML = `<div class="inicio">
    <div class="inicio-cartoes">${grupo('Frota', modelos.filter(m => m.origem === 'frota'))}${grupo('Candidatos', modelos.filter(m => m.origem === 'candidato'))}</div>
    <aside class="mudancas"><h2>Mudanças</h2>${listaMudancas(mud)}</aside>
  </div>`;
  const graficos = [];
  try {
    for (const m of modelos) {
      const canvas = tela.querySelector(`[data-spark="${CSS.escape(m.slug)}"]`);
      if (canvas) graficos.push(linhaPlano(canvas, m.serie_100, { mini: true }));
    }
  } catch (e) {
    graficos.forEach(g => g.destroy());
    throw e;
  }
  return () => graficos.forEach(g => g.destroy());
}

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function cartao(m, i) {
  const slug = esc(m.slug);
  const revisoes = m.projetadas_100 ? `${m.revisoes_100} revisões + ${m.projetadas_100} projetadas` : `${plural(m.revisoes_100, 'revisão', 'revisões')}`;
  return `<a class="cartao" href="/modelo/${slug}" data-link style="--i:${i}">
    <strong class="cartao-nome">${esc(m.nome)}</strong>
    <img src="${esc(m.imagem ?? '/img/placeholder.svg')}" alt="" loading="lazy">
    <div class="cartao-total${m.projetadas_100 ? ' projetado' : ''}">${brl(m.total_100)}</div>
    <div class="cartao-meta">${revisoes} · 100 mil km</div>
    <div class="cartao-pe">${seta(m.variacao)}${m.qtd_frota ? `<span class="qtd">${plural(m.qtd_frota, 'carro', 'carros')}</span>` : ''}</div>
    ${m.conferir ? '<span class="conferir">conferir</span>' : ''}
    <div class="spark"><canvas data-spark="${slug}" aria-hidden="true"></canvas></div>
  </a>`;
}

// Agrupa por dia e por modelo: uma linha por modelo com quantas revisões mudaram e a soma antes e depois.
export function listaMudancas(lista) {
  if (!lista.length) return '<p class="vazio">Sem mudanças</p>';
  const dias = Map.groupBy(lista, a => a.criado_em.slice(0, 10));
  return `<div class="lista-mud">${[...dias].map(([d, itens]) => `<section><h3>${dia(d)}</h3>${[...Map.groupBy(itens, a => a.slug).values()].map(linhaModelo).join('')}</section>`).join('')}</div>`;
}

function linhaModelo(itens) {
  const a = itens[0];
  const mudou = itens.filter(x => x.tipo === 'mudanca');
  const novas = itens.length - mudou.length;
  const de = mudou.reduce((s, x) => s + x.de, 0);
  const para = mudou.reduce((s, x) => s + x.para, 0);
  const qtd = [mudou.length ? plural(mudou.length, 'revisão', 'revisões') : '', novas ? plural(novas, 'nova', 'novas') : ''].filter(Boolean).join(' · ');
  const v = de ? (para - de) / de : 0;
  return `<a href="/modelo/${esc(a.slug)}" data-link>
    <span class="mud-nome">${esc(a.nome)}</span>${de ? `<span class="var ${v > 0 ? 'sobe' : v < 0 ? 'desce' : 'igual'}">${pct(v)}</span>` : '<span></span>'}
    <span class="mud-valor">${qtd}${de ? ` · ${brl(Math.round(de))} → ${brl(Math.round(para))}` : ''}</span>
  </a>`;
}
