import { get, post } from '../api.js';
import { brl, num, pct, dia, esc } from '../formato.js';
import { ir } from '../app.js';

const CANAIS = [['atacado', 'Atacado'], ['varejo', 'Varejo'], ['motorista', 'Motorista']];
const NOME_CANAL = Object.fromEntries(CANAIS);
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export async function rvVendas(tela) {
  const [vendas, modelos] = await Promise.all([get('/api/revenda/vendas'), get('/api/revenda/modelos')]);
  tela.innerHTML = `<div class="rv-vendas">
    <form class="rv-nova so-edicao" id="f-venda">
      <label>Placa<input name="placa" required maxlength="8" autocomplete="off"></label>
      <label>Modelo<select name="modelo">${modelos.map(m => `<option value="${esc(m.slug)}">${esc(m.nome)}</option>`).join('')}</select></label>
      <label>Data<input name="data" type="date" required value="${hoje()}" max="${hoje()}"></label>
      <label>Km<input name="km" type="number" min="0" max="500000" step="1" required></label>
      <label>Preço<input name="preco" type="number" min="1000" step="1" required></label>
      <label>Canal<select name="canal">${CANAIS.map(([v, r]) => `<option value="${v}">${r}</option>`).join('')}</select></label>
      <button class="btn" type="submit">Registrar</button>
    </form>
    <p class="erro" id="e-venda" role="alert" hidden></p>
    <div class="tabela-rolagem">
      ${vendas.length ? `<table class="tabela">
        <thead><tr><th>Data</th><th>Placa</th><th>Modelo</th><th>Canal</th><th class="num">Km</th><th class="num">Preço</th><th class="num">Previsto</th><th class="num">Diferença</th><th>Por</th></tr></thead>
        <tbody>${vendas.map(linha).join('')}</tbody>
      </table>` : '<p class="vazio">Nenhuma venda</p>'}
    </div>
  </div>`;
  const form = tela.querySelector('#f-venda');
  const erro = tela.querySelector('#e-venda');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const botao = form.querySelector('button');
    if (botao.disabled) return;
    botao.disabled = true;
    erro.hidden = true;
    try {
      await post('/api/revenda/vendas', {
        placa: form.placa.value, modelo: form.modelo.value, data: form.data.value,
        km: Number(form.km.value), preco: Number(form.preco.value), canal: form.canal.value,
      });
      ir(location.pathname, false);
    } catch (x) { erro.textContent = x.message; erro.hidden = false; botao.disabled = false; }
  });
}

function linha(v) {
  const cls = v.diferenca == null ? '' : v.diferenca >= 0 ? 'desce' : 'sobe';
  return `<tr>
    <td>${dia(v.data)}</td><td>${esc(v.placa)}</td><td>${esc(v.nome)}</td><td>${esc(NOME_CANAL[v.canal] ?? v.canal)}</td>
    <td class="num">${num(v.km)}</td><td class="num">${brl(v.preco)}</td><td class="num">${v.previsto == null ? '' : brl(v.previsto)}</td>
    <td class="num"><span class="var ${cls}">${v.diferenca == null ? '' : pct(v.diferenca)}</span></td><td>${esc(v.por ?? '')}</td>
  </tr>`;
}
