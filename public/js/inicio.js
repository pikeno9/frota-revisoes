import { get } from './api.js';
import { brl, kmMil, seta, esc, dia } from './formato.js';
import { linhaPlano } from './graficos.js';

export async function inicio(tela) {
  const [modelos, mud] = await Promise.all([get('/api/modelos'), get('/api/mudancas?limite=40')]);
  const grupo = (titulo, lista) => (lista.length ? `<section class="grupo"><h2>${titulo}</h2><div class="cartoes">${lista.map(cartao).join('')}</div></section>` : '');
  tela.innerHTML = `<div class="inicio">
    <div class="inicio-cartoes">${grupo('Frota', modelos.filter(m => m.origem === 'frota'))}${grupo('Candidatos', modelos.filter(m => m.origem === 'candidato'))}</div>
    <aside class="mudancas"><h2>Mudanças</h2>${listaMudancas(mud)}</aside>
  </div>`;
  const graficos = [];
  try {
    for (const m of modelos) {
      const canvas = tela.querySelector(`[data-spark="${CSS.escape(m.slug)}"]`);
      if (canvas) graficos.push(linhaPlano(canvas, m.serie, { mini: true }));
    }
  } catch (e) {
    graficos.forEach(g => g.destroy());
    throw e;
  }
  return () => graficos.forEach(g => g.destroy());
}

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function cartao(m) {
  const slug = esc(m.slug);
  return `<a class="cartao" href="/modelo/${slug}" data-link>
    <img src="${esc(m.imagem ?? '/img/placeholder.svg')}" alt="" loading="lazy">
    <div class="cartao-topo"><strong>${esc(m.nome)}</strong>${m.qtd_frota ? `<span class="qtd">${plural(m.qtd_frota, 'carro', 'carros')}</span>` : ''}</div>
    <div class="cartao-total">${brl(m.total)}</div>
    <div class="cartao-meta">${plural(m.revisoes, 'revisão', 'revisões')} · até ${kmMil(m.km_max)}</div>
    <div>${seta(m.variacao)}</div>
    ${m.conferir ? '<span class="conferir">conferir</span>' : ''}
    <div class="spark"><canvas data-spark="${slug}" aria-hidden="true"></canvas></div>
  </a>`;
}

export function listaMudancas(lista) {
  if (!lista.length) return '<p class="vazio">Sem mudanças</p>';
  return `<ol class="lista-mud">${lista.map(a => `<li><a href="/modelo/${esc(a.slug)}" data-link>
    <span class="mud-quando">${dia(a.criado_em.slice(0, 10))}</span>
    <span class="mud-nome">${esc(a.nome)} ${a.ordem}ª</span>
    <span class="mud-valor">${a.tipo === 'nova_revisao' ? `nova ${brl(a.para)}` : `${brl(a.de)} → ${brl(a.para)}`}</span>
  </a></li>`).join('')}</ol>`;
}
