import { get, put, patch } from '../api.js';
import { dia, esc } from '../formato.js';
import { ir } from '../app.js';

const ROTULOS = [
  ['atacado_pct_base', 'Atacado', '% do preço-base'],
  ['varejo_negociacao_pct', 'Negociação no varejo', '% do anúncio'],
  ['motorista_pct_base', 'Motorista', '% do preço-base'],
];
const COMBUSTIVEIS = [[5, 'Flex'], [4, 'Elétrico'], [6, 'Híbrido']];
const val = v => (v == null ? '' : esc(v));

export async function rvPremissas(tela) {
  const { premissas, modelos } = await get('/api/revenda/premissas');
  const porChave = new Map(premissas.map(p => [p.chave, p]));
  tela.innerHTML = `<div class="rv-premissas">
    <section>
      <h2>Premissas</h2>
      <form class="form" id="f-prem">
        ${ROTULOS.map(([k, rot, un]) => {
          const p = porChave.get(k);
          return `<label>${esc(rot)}<span class="rv-linha"><input name="${k}" type="number" min="0" max="200" step="0.5" value="${val(p?.valor)}" required><i>${esc(un)}</i></span>
            <small>${p?.atualizado_em ? `desde ${dia(p.atualizado_em.slice(0, 10))}` : ''}</small></label>`;
        }).join('')}
        <div class="acoes"><button class="btn" type="submit">Salvar</button><span class="erro" id="r-prem" role="alert"></span></div>
      </form>
    </section>
    <section>
      <h2>Modelos</h2>
      <div class="tabela-rolagem"><table class="tabela rv-params">
        <thead><tr><th>Modelo</th><th>Marca</th><th>Código</th><th>Combustível</th><th>Referência</th><th>Mobiauto</th><th>Versão</th><th></th></tr></thead>
        <tbody>${modelos.map(linha).join('')}</tbody>
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
  tela.querySelector('.rv-params').addEventListener('click', async e => {
    const b = e.target.closest('button[data-salvar]');
    if (!b || b.disabled) return;
    const tr = b.closest('tr');
    const campo = n => tr.querySelector(`[name="${n}"]`).value.trim();
    const numero = n => (campo(n) === '' ? null : Number(campo(n)));
    erro.hidden = true;
    b.disabled = true;
    try {
      await patch(`/api/revenda/modelos/${encodeURIComponent(b.dataset.salvar)}`, {
        fipe_marca: numero('fipe_marca'), fipe_modelo: numero('fipe_modelo'), fipe_combustivel: numero('fipe_combustivel'),
        fipe_modelo_ref: numero('fipe_modelo_ref'), mobiauto_caminho: campo('mobiauto_caminho') || null, mobiauto_versao: campo('mobiauto_versao') || null,
      });
      b.textContent = 'Salvo';
      religar = setTimeout(() => { b.textContent = 'Salvar'; b.disabled = false; }, 1200);
    } catch (x) {
      erro.textContent = `${tr.cells[0].textContent}: ${x.message}`;
      erro.hidden = false;
      b.disabled = false;
    }
  });
  return () => clearTimeout(religar);
}

function linha(m) {
  return `<tr${m.ativo ? '' : ' class="inativo"'}>
    <td>${esc(m.nome)}</td>
    <td><input name="fipe_marca" type="number" min="1" value="${val(m.fipe_marca)}" aria-label="Marca FIPE"></td>
    <td><input name="fipe_modelo" type="number" min="1" value="${val(m.fipe_modelo)}" aria-label="Código FIPE"></td>
    <td><select name="fipe_combustivel" aria-label="Combustível"><option value=""></option>${COMBUSTIVEIS.map(([v, r]) => `<option value="${v}"${m.fipe_combustivel === v ? ' selected' : ''}>${r}</option>`).join('')}</select></td>
    <td><input name="fipe_modelo_ref" type="number" min="1" value="${val(m.fipe_modelo_ref)}" aria-label="Código de referência"></td>
    <td><input name="mobiauto_caminho" value="${val(m.mobiauto_caminho)}" aria-label="Caminho na Mobiauto"></td>
    <td><input name="mobiauto_versao" value="${val(m.mobiauto_versao)}" aria-label="Versão na Mobiauto"></td>
    <td><button class="btn sec" type="button" data-salvar="${esc(m.id)}">Salvar</button></td>
  </tr>`;
}
