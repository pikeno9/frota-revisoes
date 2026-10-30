import { get, post, patch } from './api.js';
import { brl, esc, dia, num } from './formato.js';
import { ir, podeEditar } from './app.js';

const ROTULO = { ok: '✓ ok', parcial: '! parcial', falha: '✕ falha' };
const FONTES = { byd: 'BYD', vw: 'Volkswagen', gm: 'Chevrolet', fiat: 'Fiat', ativos: 'Frota (Ativos)', fipe: 'FIPE', mobiauto: 'Mobiauto', napista: 'NaPista', ipca: 'IPCA' };
const MONTADORA = { byd: 'BYD', gm: 'Chevrolet', vw: 'Volkswagen', fiat: 'Fiat' };
const TIPOS = { mudanca: 'mudou', nova_revisao: 'nova', sumiu_revisao: 'não veio', falha: 'falha', conferir: 'conferir', frota_sem_modelo: 'frota sem modelo' };
const CAMPOS = {
  vw: [['modelo', 'Modelo no site da VW'], ['versao', 'Versão'], ['ano', 'Ano']],
  fiat: [['mvsCode', 'mvsCode'], ['modelYear', 'Ano modelo'], ['dealer', 'Concessionária']],
};

export async function coletores(tela) {
  const estado = await get('/api/coletas/estado');
  const logado = podeEditar();
  const modelos = logado ? await get('/api/modelos?todos=1') : [];
  tela.innerHTML = `<div class="coletores">
    <section>
      <h2>Última coleta</h2>
      <table class="tabela"><thead><tr><th>Fonte</th><th>Quando</th><th>Status</th><th class="num">Modelos</th><th class="num">Mudanças</th><th>Erro</th></tr></thead>
      <tbody>${estado.fontes.map(f => `<tr><td>${esc(FONTES[f.fonte] ?? f.fonte)}</td><td>${f.fim ? esc(dia(f.fim.slice(0, 10))) : 'rodando'}</td>
        <td class="status ${esc(f.status ?? '')}">${esc(ROTULO[f.status] ?? f.status ?? '')}</td><td class="num">${esc(f.modelos_ok)}</td><td class="num">${esc(f.mudancas)}</td>
        <td class="erro-curto">${esc(f.erro ?? '')}</td></tr>`).join('')}</tbody></table>
      ${logado ? `<div class="acoes"><button class="btn" id="coletar" type="button">Coletar agora</button><span class="teste" id="r-coletar" role="status"></span></div>` : ''}
      <h2 class="sep">Alertas pendentes</h2>
      ${estado.pendentes.length ? `<table class="tabela"><tbody>${estado.pendentes.map(a => `<tr><td>${esc(a.nome ?? '')} ${a.ordem ? `${esc(a.ordem)}ª` : ''}</td><td>${esc(TIPOS[a.tipo] ?? a.tipo)}</td>
        <td class="num">${a.de != null ? esc(brl(a.de)) : ''}${a.para != null ? ` → ${esc(brl(a.para))}` : ''}</td><td class="erro-curto">${esc(a.texto ?? '')}</td></tr>`).join('')}</tbody></table>` : '<p class="vazio">Nenhum</p>'}
    </section>
    ${logado ? painel(modelos) : ''}
  </div>`;
  if (logado) ligar(tela);
}

function painel(modelos) {
  return `<section>
    <h2>Modelos</h2>
    <table class="tabela"><tbody>${modelos.map(m => `<tr><td>${esc(m.nome)}</td><td>${m.origem === 'frota' ? `${esc(m.qtd_frota)} carros` : 'candidato'}</td>
      <td class="num"><label><input type="checkbox" data-ativo="${esc(m.id)}" ${m.ativo ? 'checked' : ''}> ativo</label></td></tr>`).join('')}</tbody></table>
    <p class="erro" id="e-modelo" role="alert" hidden></p>
    <h2 class="sep">Novo candidato</h2>
    <form class="form" id="f-novo">
      <label>Fonte<select name="coletor"><option value="byd">BYD</option><option value="gm">Chevrolet</option><option value="vw">Volkswagen</option><option value="fiat">Fiat</option></select></label>
      <div id="campos"></div>
      <label>Montadora<input name="montadora" required></label>
      <label>Nome<input name="nome" required></label>
      <div class="acoes"><button class="btn sec" type="button" id="testar">Testar</button><button class="btn" type="submit">Salvar</button></div>
      <div class="teste" id="r-teste" role="status"></div>
    </form>
  </section>`;
}

function ligar(tela) {
  const form = tela.querySelector('#f-novo');
  const campos = tela.querySelector('#campos');
  const resultado = tela.querySelector('#r-teste');
  let catalogo = [];
  let rodada = 0;

  async function trocarFonte() {
    const minha = ++rodada;
    const c = form.coletor.value;
    form.montadora.value = MONTADORA[c];
    resultado.textContent = '';
    if (CAMPOS[c]) {
      campos.innerHTML = CAMPOS[c].map(([k, r]) => `<label>${esc(r)}<input name="p_${esc(k)}" required></label>`).join('');
      return;
    }
    catalogo = [];
    campos.innerHTML = '<label>Modelo<select name="p_catalogo" disabled><option>carregando</option></select></label>';
    try {
      const lista = await get(`/api/catalogo/${c}`);
      if (minha !== rodada) return;
      catalogo = lista;
    } catch (e) {
      if (minha === rodada) resultado.textContent = e.message;
      return;
    }
    const sel = campos.querySelector('select');
    sel.innerHTML = catalogo.map((x, i) => `<option value="${i}">${esc(x.rotulo)}</option>`).join('');
    sel.disabled = false;
    sel.onchange = () => { form.nome.value = catalogo[sel.value].rotulo.replace(/^BYD |^Chevrolet /, ''); };
    sel.onchange();
  }

  function parametros() {
    const c = form.coletor.value;
    if (!CAMPOS[c]) {
      const item = catalogo[form.p_catalogo?.value];
      if (!item) throw new Error('Catálogo ainda não carregou');
      return item.parametros;
    }
    const p = Object.fromEntries(CAMPOS[c].map(([k]) => [k, form[`p_${k}`].value.trim()]));
    for (const k of ['ano', 'modelYear']) if (p[k]) p[k] = Number(p[k]);
    return p;
  }

  form.coletor.addEventListener('change', trocarFonte);
  tela.querySelector('#testar').addEventListener('click', async e => {
    e.target.disabled = true;
    resultado.textContent = 'testando';
    resultado.classList.add('ocupado');
    try {
      const { itens } = await post('/api/testar', { coletor: form.coletor.value, parametros: parametros() });
      resultado.innerHTML = itens.length ? itens.map(i => `${esc(i.ordem)}ª ${esc(num(i.km))} km ${esc(brl(i.valor))}`).join('<br>') : 'sem revisões';
    } catch (x) { resultado.textContent = x.message; }
    resultado.classList.remove('ocupado');
    e.target.disabled = false;
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const salvar = form.querySelector('button[type="submit"]');
    if (salvar.disabled) return;
    salvar.disabled = true;
    try {
      await post('/api/modelos', { coletor: form.coletor.value, montadora: form.montadora.value.trim(), nome: form.nome.value.trim(), parametros: parametros() });
      ir(location.pathname, false);
    } catch (x) { resultado.textContent = x.message; salvar.disabled = false; }
  });
  const erroModelo = tela.querySelector('#e-modelo');
  tela.querySelectorAll('[data-ativo]').forEach(cb => cb.addEventListener('change', async () => {
    erroModelo.hidden = true;
    try { await patch(`/api/modelos/${cb.dataset.ativo}`, { ativo: cb.checked }); }
    catch (x) { cb.checked = !cb.checked; erroModelo.textContent = x.message; erroModelo.hidden = false; }
  }));
  tela.querySelector('#coletar').addEventListener('click', async e => {
    const aviso = tela.querySelector('#r-coletar');
    e.target.disabled = true;
    aviso.textContent = 'coletando';
    aviso.classList.add('ocupado');
    try { await post('/api/coletas'); ir(location.pathname, false); }
    catch (x) { aviso.classList.remove('ocupado'); aviso.textContent = x.message; e.target.disabled = false; }
  });
  trocarFonte();
}
