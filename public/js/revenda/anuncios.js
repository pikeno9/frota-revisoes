import { get, post } from '../api.js';
import { brl, num, dia, esc } from '../formato.js';
import { ir } from '../app.js';
import { lerCsv } from './csv.js';

const CATEGORIAS = [['', 'Todas'], ['combustao', 'Combustão'], ['eletrico', 'Elétrico'], ['hibrido', 'Híbrido']];
const LEILAO = [['', 'Todos'], ['nao', 'Não'], ['sim', 'Sim'], ['sem_info', 'Sem informação']];
const NOME_FONTE = { mobiauto: 'Mobiauto', napista: 'NaPista', olx: 'OLX', kavak: 'Kavak', webmotors: 'Webmotors' };
const TIPO = { loja: 'Loja', particular: 'Particular', locadora: 'Locadora' };
const FILTROS = ['modelo', 'fonte', 'categoria', 'leilao', 'de', 'ate'];
const fonte = f => NOME_FONTE[f] ?? f;
const ICONE_LINK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

const opcoes = (lista, atual) => lista.map(([v, r]) => `<option value="${esc(v)}"${v === (atual ?? '') ? ' selected' : ''}>${esc(r)}</option>`).join('');

export async function rvAnuncios(tela) {
  const q = new URLSearchParams(location.search);
  const filtros = Object.fromEntries(FILTROS.map(k => [k, q.get(k) ?? '']));
  const pagina = Number(q.get('pagina')) || 1;
  const consulta = new URLSearchParams(Object.entries({ ...filtros, pagina }).filter(([, v]) => v !== '' && v != null));
  const [dados, modelos] = await Promise.all([get(`/api/revenda/anuncios?${consulta}`), get('/api/revenda/modelos')]);
  const csv = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v));
  const ini = dados.total ? (dados.pagina - 1) * dados.por_pagina + 1 : 0;
  const fim = Math.min(dados.total, dados.pagina * dados.por_pagina);

  tela.innerHTML = `<div class="rv-anuncios">
    <form class="rv-filtros" id="f-anuncios">
      <label>Modelo<select name="modelo">${opcoes([['', 'Todos'], ...modelos.map(m => [m.slug, m.nome])], filtros.modelo)}</select></label>
      <label>Fonte<select name="fonte">${opcoes([['', 'Todas'], ...dados.fontes.map(f => [f, fonte(f)])], filtros.fonte)}</select></label>
      <label>Categoria<select name="categoria">${opcoes(CATEGORIAS, filtros.categoria)}</select></label>
      <label>Leilão<select name="leilao">${opcoes(LEILAO, filtros.leilao)}</select></label>
      <label>Coleta de<input name="de" type="date" value="${esc(filtros.de)}"></label>
      <label>até<input name="ate" type="date" value="${esc(filtros.ate)}"></label>
      <div class="rv-filtros-acoes">
        <a class="btn sec" href="/api/revenda/anuncios.csv${csv.size ? `?${csv}` : ''}" download>Baixar CSV</a>
        <button class="btn sec so-edicao" type="button" id="b-importar">Importar</button>
      </div>
    </form>
    <div class="rv-contagem">
      <strong>${num(dados.total)} ${dados.total === 1 ? 'leitura' : 'leituras'}</strong>
      ${dados.por_fonte.map(f => `<span class="rv-tag">${esc(fonte(f.fonte))} · ${num(f.anuncios)} ${f.anuncios === 1 ? 'anúncio' : 'anúncios'}</span>`).join('')}
    </div>
    <div class="tabela-rolagem">
      ${dados.linhas.length ? `<table class="tabela rv-tab-anuncios">
        <thead><tr><th>Coleta</th><th>Fonte</th><th>Modelo</th><th>Versão</th><th class="num">Ano</th><th class="num">Km</th><th class="num">Preço</th><th>Vendedor</th><th>Leilão</th><th>Cidade</th><th></th></tr></thead>
        <tbody>${dados.linhas.map(linha).join('')}</tbody>
      </table>` : '<p class="vazio">Nenhum anúncio</p>'}
    </div>
    <nav class="rv-paginas" aria-label="Páginas">
      <button class="btn sec" type="button" data-pagina="${dados.pagina - 1}"${dados.pagina > 1 ? '' : ' disabled'} aria-label="Página anterior">‹</button>
      <span>${num(ini)} a ${num(fim)} de ${num(dados.total)}</span>
      <button class="btn sec" type="button" data-pagina="${dados.pagina + 1}"${fim < dados.total ? '' : ' disabled'} aria-label="Próxima página">›</button>
    </nav>
    ${dialogo()}
  </div>`;

  const form = tela.querySelector('#f-anuncios');
  const navegar = (extra = {}) => {
    const p = new URLSearchParams(Object.entries({ ...Object.fromEntries(FILTROS.map(k => [k, form[k].value])), ...extra }).filter(([, v]) => v !== '' && v != null && v !== 1));
    ir(`/revenda/anuncios${p.size ? `?${p}` : ''}`);
  };
  form.addEventListener('change', () => navegar());
  tela.querySelector('.rv-paginas').addEventListener('click', e => {
    const b = e.target.closest('button[data-pagina]');
    if (b && !b.disabled) navegar({ pagina: Number(b.dataset.pagina) });
  });
  ligarImportacao(tela);
}

function linha(a) {
  const leilao = a.leilao == null ? '' : a.leilao ? '<span class="rv-leilao">Sim</span>' : 'Não';
  return `<tr>
    <td>${dia(a.data)}</td><td>${esc(fonte(a.fonte))}</td><td>${esc(a.modelo)}</td><td class="rv-versao" title="${esc(a.versao)}">${esc(a.versao)}</td>
    <td class="num">${a.ano_modelo ?? ''}</td><td class="num">${num(a.km)}</td><td class="num">${brl(a.preco)}</td>
    <td class="rv-versao" title="${esc(a.vendedor)}">${esc(a.vendedor)}${a.tipo_vendedor ? ` <small>${esc(TIPO[a.tipo_vendedor] ?? a.tipo_vendedor)}</small>` : ''}</td>
    <td>${leilao}</td><td>${esc(a.cidade)}</td>
    <td>${a.url ? `<a class="rv-link" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir anúncio">${ICONE_LINK}</a>` : ''}</td>
  </tr>`;
}

function dialogo() {
  return `<dialog class="rv-importar" id="d-importar" aria-labelledby="t-importar">
    <form method="dialog" id="f-importar">
      <h2 id="t-importar">Importar anúncios</h2>
      <label>Fonte<input name="fonte" required pattern="[a-z0-9][a-z0-9\\-]{1,29}" placeholder="webmotors" autocomplete="off"></label>
      <label>Arquivo<input name="arquivo" type="file" accept=".csv,.json,text/csv,application/json" required></label>
      <p class="rv-previa" id="p-importar" hidden></p>
      <p class="erro" id="e-importar" role="alert" hidden></p>
      <div class="acoes">
        <button class="btn" type="submit" id="b-enviar" disabled>Importar</button>
        <button class="btn sec" type="button" value="fechar" id="b-fechar">Fechar</button>
      </div>
    </form>
  </dialog>`;
}

function ligarImportacao(tela) {
  const d = tela.querySelector('#d-importar');
  const form = tela.querySelector('#f-importar');
  const previa = tela.querySelector('#p-importar');
  const erro = tela.querySelector('#e-importar');
  const enviar = tela.querySelector('#b-enviar');
  let lidos = null, enviou = false;
  const aviso = (el, txt) => { el.textContent = txt; el.hidden = !txt; };
  tela.querySelector('#b-importar')?.addEventListener('click', () => d.showModal());
  tela.querySelector('#b-fechar').addEventListener('click', () => { d.close(); if (enviou) ir(location.pathname + location.search, false); });
  form.arquivo.addEventListener('change', async () => {
    lidos = null;
    enviar.disabled = true;
    aviso(erro, '');
    const f = form.arquivo.files[0];
    if (!f) return aviso(previa, '');
    try {
      const texto = await f.text();
      if (/\.json$/i.test(f.name)) {
        const j = JSON.parse(texto);
        lidos = { anuncios: Array.isArray(j) ? j : j.anuncios, colunas: [], ignoradas: [] };
        if (!Array.isArray(lidos.anuncios)) throw new Error('o JSON precisa ser uma lista de anúncios');
      } else lidos = lerCsv(texto);
      const falta = ['modelo', 'ano_modelo', 'km', 'preco'].filter(c => lidos.colunas.length && !lidos.colunas.includes(c));
      if (falta.length) throw new Error(`faltam as colunas: ${falta.join(', ')}`);
      aviso(previa, `${num(lidos.anuncios.length)} ${lidos.anuncios.length === 1 ? 'linha' : 'linhas'}${lidos.ignoradas.length ? ` · colunas ignoradas: ${lidos.ignoradas.join(', ')}` : ''}`);
      enviar.disabled = !lidos.anuncios.length;
    } catch (x) { aviso(previa, ''); aviso(erro, x.message); }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!lidos || enviar.disabled || !form.fonte.reportValidity()) return;
    enviar.disabled = true;
    aviso(erro, '');
    try {
      const r = await post('/api/revenda/anuncios/importar', { fonte: form.fonte.value.trim().toLowerCase(), anuncios: lidos.anuncios });
      enviou = true;
      aviso(previa, `${num(r.importados)} ${r.importados === 1 ? 'importado' : 'importados'}${r.recusados ? ` · ${num(r.recusados)} recusados` : ''}`);
      if (r.erros.length) aviso(erro, r.erros.slice(0, 8).map(x => `linha ${x.linha}: ${x.erro}`).join(' · '));
    } catch (x) { aviso(erro, x.message); enviar.disabled = false; }
  });
}
