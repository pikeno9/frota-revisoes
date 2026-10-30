import { get, put, patch } from '../api.js';
import { dia, esc } from '../formato.js';
import { ir } from '../app.js';

const ROTULOS = [
  ['atacado_pct_base', 'Atacado · lojista compra', '% da FIPE projetada'],
  ['varejo_negociacao_pct', 'Varejo · desconto na negociação', '% abaixo do anúncio'],
  ['motorista_pct_base', 'Motorista compra', '% da FIPE projetada'],
];
const COMBUSTIVEIS = [[5, 'Flex'], [4, 'Elétrico'], [6, 'Híbrido']];
const FONTES = [['mobiauto', 'Mobiauto'], ['napista', 'NaPista']];
const VISTAS = [['fipe', 'FIPE'], ['anuncios', 'Anúncios']];
const val = v => (v == null ? '' : esc(v));

export async function rvPremissas(tela) {
  const { premissas, modelos } = await get('/api/revenda/premissas');
  const porChave = new Map(premissas.map(p => [p.chave, p]));
  tela.innerHTML = `<div class="rv-premissas">
    <section>
      <h2>Preço por canal</h2>
      <form class="form" id="f-prem">
        ${ROTULOS.map(([k, rot, un]) => {
          const p = porChave.get(k);
          return `<label>${esc(rot)}<span class="rv-linha"><input name="${k}" type="number" min="0" max="200" step="0.5" value="${val(p?.valor)}" required><i>${esc(un)}</i></span>
            <small>${p?.atualizado_em ? `desde ${dia(p.atualizado_em.slice(0, 10))}${p.por ? ` · ${esc(p.por)}` : ''}` : ''}</small></label>`;
        }).join('')}
        <div class="acoes so-edicao"><button class="btn" type="submit">Salvar</button><span class="erro" id="r-prem" role="alert"></span></div>
      </form>
    </section>
    <section>
      <div class="rv-cab"><h2>Fontes por modelo</h2>
        <span class="rv-vistas" role="group" aria-label="Fontes">${VISTAS.map(([v, r], i) => `<button type="button" class="rv-alterna" data-vista="${v}" aria-pressed="${i === 0}">${r}</button>`).join('')}</span>
      </div>
      <div class="tabela-rolagem" data-vista="fipe"><table class="tabela rv-params" data-tabela="fipe">
        <colgroup><col style="width:150px"><col><col><col style="width:150px"><col><col style="width:84px"></colgroup>
        <thead><tr><th>Modelo</th><th>Marca</th><th>Código</th><th>Combustível</th><th>Apoio</th><th></th></tr></thead>
        <tbody>${modelos.map(linhaFipe).join('')}</tbody>
      </table></div>
      <div class="tabela-rolagem" data-vista="anuncios" hidden><table class="tabela rv-params" data-tabela="anuncios">
        <colgroup><col style="width:130px"><col><col><col><col><col style="width:84px"></colgroup>
        <thead>
          <tr class="rv-grupos"><th></th>${FONTES.map(([, r]) => `<th colspan="2">${r}</th>`).join('')}<th></th></tr>
          <tr><th>Modelo</th>${FONTES.map(() => '<th>Endereço</th><th>Versão</th>').join('')}<th></th></tr>
        </thead>
        <tbody>${modelos.map(linhaFontes).join('')}</tbody>
      </table></div>
      <p class="erro" id="e-params" role="alert" hidden></p>
    </section>
  </div>`;

  const form = tela.querySelector('#f-prem');
  const aviso = tela.querySelector('#r-prem');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const botao = form.querySelector('button');
    if (botao.disabled) return;
    botao.disabled = true;
    aviso.textContent = '';
    try {
      await put('/api/revenda/premissas', Object.fromEntries(ROTULOS.map(([k]) => [k, Number(form[k].value)])));
      ir(location.pathname, false);
    } catch (x) { aviso.textContent = x.message; botao.disabled = false; }
  });

  const erro = tela.querySelector('#e-params');
  let religar = null;
  tela.querySelector('.rv-vistas').addEventListener('click', e => {
    const b = e.target.closest('button[data-vista]');
    if (!b) return;
    tela.querySelectorAll('.rv-vistas button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    tela.querySelectorAll('.tabela-rolagem[data-vista]').forEach(t => { t.hidden = t.dataset.vista !== b.dataset.vista; });
    erro.hidden = true;
  });
  tela.querySelectorAll('.rv-params').forEach(t => t.addEventListener('click', async e => {
    const b = e.target.closest('button[data-salvar]');
    if (!b || b.disabled) return;
    const tr = b.closest('tr');
    const campo = n => tr.querySelector(`[name="${n}"]`).value.trim();
    const numero = n => (campo(n) === '' ? null : Number(campo(n)));
    erro.hidden = true;
    b.disabled = true;
    try {
      const id = encodeURIComponent(b.dataset.salvar);
      if (t.dataset.tabela === 'fipe') {
        await patch(`/api/revenda/modelos/${id}`, {
          fipe_marca: numero('fipe_marca'), fipe_modelo: numero('fipe_modelo'), fipe_combustivel: numero('fipe_combustivel'), fipe_modelo_ref: numero('fipe_modelo_ref'),
        });
      } else {
        await put(`/api/revenda/modelos/${id}/fontes`, Object.fromEntries(FONTES.map(([f]) => [f, campo(`${f}_caminho`) ? { caminho: campo(`${f}_caminho`), versao: campo(`${f}_versao`) || null } : null])));
      }
      b.textContent = 'Salvo';
      religar = setTimeout(() => { b.textContent = 'Salvar'; b.disabled = false; }, 1200);
    } catch (x) {
      erro.textContent = `${tr.cells[0].textContent}: ${x.message}`;
      erro.hidden = false;
      b.disabled = false;
    }
  }));
  return () => clearTimeout(religar);
}

const inicio = m => `<tr${m.ativo ? '' : ' class="inativo"'}><td>${esc(m.nome)}</td>`;
const salvar = m => `<td class="so-edicao"><button class="btn sec" type="button" data-salvar="${esc(m.id)}">Salvar</button></td></tr>`;

function linhaFipe(m) {
  return `${inicio(m)}
    <td><input name="fipe_marca" type="number" min="1" value="${val(m.fipe_marca)}" aria-label="Marca FIPE"></td>
    <td><input name="fipe_modelo" type="number" min="1" value="${val(m.fipe_modelo)}" aria-label="Código FIPE"></td>
    <td><select name="fipe_combustivel" aria-label="Combustível"><option value=""></option>${COMBUSTIVEIS.map(([v, r]) => `<option value="${v}"${m.fipe_combustivel === v ? ' selected' : ''}>${r}</option>`).join('')}</select></td>
    <td><input name="fipe_modelo_ref" type="number" min="1" value="${val(m.fipe_modelo_ref)}" aria-label="Código de referência"></td>
    ${salvar(m)}`;
}

function linhaFontes(m) {
  return `${inicio(m)}
    ${FONTES.map(([f, r]) => `<td><input name="${f}_caminho" value="${val(m.fontes?.[f]?.caminho)}" aria-label="Caminho na ${r}"></td>
    <td><input name="${f}_versao" value="${val(m.fontes?.[f]?.versao)}" aria-label="Versão na ${r}"></td>`).join('')}
    ${salvar(m)}`;
}
