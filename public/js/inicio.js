import { get } from './api.js';
import { brl, kmMil, seta, esc, mesAno } from './formato.js';
import { linhaPlano } from './graficos.js';

export async function inicio(tela) {
  const [modelos, mud] = await Promise.all([get('/api/modelos'), get('/api/mudancas?limite=40')]);
  const grupo = (titulo, lista) => (lista.length ? `<section class="grupo"><h2>${titulo}</h2><div class="cartoes">${lista.map(cartao).join('')}</div></section>` : '');
  tela.innerHTML = `<div class="inicio">
    <div class="inicio-cartoes">${grupo('Frota', modelos.filter(m => m.origem === 'frota'))}${grupo('Candidatos', modelos.filter(m => m.origem === 'candidato'))}</div>
    <aside class="mudancas"><h2>Mudanças</h2>${listaMudancas(mud)}</aside>
  </div>`;
  const graficos = modelos.map(m => linhaPlano(tela.querySelector(`[data-spark="${m.slug}"]`), m.serie, { mini: true }));
  return () => graficos.forEach(g => g.destroy());
}

function cartao(m) {
  return `<a class="cartao" href="/modelo/${m.slug}" data-link>
    <img src="${m.imagem ?? '/img/placeholder.svg'}" alt="" loading="lazy">
    <div class="cartao-topo"><strong>${esc(m.nome)}</strong>${m.qtd_frota ? `<span class="qtd">${m.qtd_frota} carros</span>` : ''}</div>
    <div class="cartao-total">${brl(m.total)}</div>
    <div class="cartao-meta">${m.revisoes} revisões · até ${kmMil(m.km_max)}</div>
    <div>${seta(m.variacao)}</div>
    ${m.conferir ? '<span class="conferir">conferir</span>' : ''}
    <div class="spark"><canvas data-spark="${m.slug}" aria-hidden="true"></canvas></div>
  </a>`;
}

export function listaMudancas(lista) {
  if (!lista.length) return '<p class="vazio" style="padding:0 14px">Sem mudanças</p>';
  return `<ol class="lista-mud">${lista.map(a => `<li><a href="/modelo/${a.slug}" data-link>
    <span class="mud-quando">${mesAno(a.criado_em.slice(0, 10))}</span>
    <span class="mud-nome">${esc(a.nome)} ${a.ordem}ª</span>
    <span class="mud-valor">${a.tipo === 'nova_revisao' ? `nova ${brl(a.para)}` : `${brl(a.de)} → ${brl(a.para)}`}</span>
  </a></li>`).join('')}</ol>`;
}
