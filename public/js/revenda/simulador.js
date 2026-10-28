import { get } from '../api.js';
import { brl, num, pct, pctSimples, dia, mesAno, esc } from '../formato.js';

const KMS = [30000, 40000, 50000, 60000, 70000];
const CANAIS = [['atacado', 'Atacado'], ['varejo', 'Varejo'], ['motorista', 'Motorista']];
const NOME_CANAL = Object.fromEntries(CANAIS);
const QUANTIS = [['p10', 'P10'], ['p50', 'P50'], ['p90', 'P90']];
const numero = v => (v == null ? '' : num(v));

const seg = (nome, opcoes, atual) => `<div class="filtros" role="group" data-grupo="${nome}">${opcoes.map(([v, r]) =>
  `<button type="button" data-v="${esc(v)}" aria-pressed="${String(String(v) === String(atual))}">${esc(r)}</button>`).join('')}</div>`;

export async function rvSimulador(tela) {
  const modelos = (await get('/api/revenda/modelos')).filter(m => m.data_estudo);
  if (!modelos.length) { tela.innerHTML = '<p class="vazio">Nenhum modelo com estudo</p>'; return; }
  const pedido = new URLSearchParams(location.search).get('modelo');
  const estado = { modelo: modelos.some(m => m.slug === pedido) ? pedido : modelos[0].slug, preco: '', meses: 12, km: 70000, canal: 'atacado' };
  tela.innerHTML = `<div class="rv-simulador">
    <form class="form rv-form" id="f-sim">
      <label>Modelo<select name="modelo">${modelos.map(m => `<option value="${esc(m.slug)}"${m.slug === estado.modelo ? ' selected' : ''}>${esc(m.nome)}</option>`).join('')}</select></label>
      <label>Preço de compra<input name="preco" type="number" min="1000" step="1" inputmode="numeric" placeholder="FIPE zero km"></label>
      <label>Meses<input name="meses" type="number" min="1" max="24" step="1" value="12"></label>
      <div class="rv-campo"><span>Km no fim</span>${seg('km', KMS.map(k => [k, `${num(k / 1000)} mil`]), estado.km)}
        <input name="km" type="number" min="0" max="300000" step="1" value="${estado.km}" aria-label="Km no fim"></div>
      <div class="rv-campo"><span>Canal</span>${seg('canal', CANAIS, estado.canal)}</div>
    </form>
    <section class="rv-resultado" id="r-sim" aria-live="polite"></section>
  </div>`;
  const form = tela.querySelector('#f-sim');
  const saida = tela.querySelector('#r-sim');
  let rodada = 0, timer = null;

  async function calcular() {
    const minha = ++rodada;
    const q = new URLSearchParams({ modelo: estado.modelo, meses: estado.meses, km: estado.km, canal: estado.canal });
    if (estado.preco) q.set('preco', estado.preco);
    saida.classList.add('ocupado');
    try {
      const r = await get(`/api/revenda/projecao?${q}`);
      if (minha === rodada) saida.innerHTML = resultado(r);
    } catch (x) {
      if (minha === rodada) saida.innerHTML = `<p class="erro">${esc(x.message)}</p>`;
    }
    if (minha === rodada) saida.classList.remove('ocupado');
  }
  const depois = () => { clearTimeout(timer); timer = setTimeout(calcular, 200); };
  const marcar = (grupo, v) => form.querySelectorAll(`[data-grupo="${grupo}"] button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));

  // Valor fora da faixa vai ao servidor, que responde com a mensagem ("meses entre 1 e 24") ao lado do formulário.
  form.addEventListener('input', e => {
    const t = e.target;
    if (t.name === 'modelo') estado.modelo = t.value;
    if (t.name === 'preco') estado.preco = t.value !== '' && Number(t.value) > 0 ? t.value : '';
    if (t.name === 'meses') { if (t.value === '' || Number.isNaN(Number(t.value))) return; estado.meses = Number(t.value); }
    if (t.name === 'km') { if (t.value === '' || Number.isNaN(Number(t.value))) return; estado.km = Number(t.value); marcar('km', estado.km); }
    depois();
  });
  form.addEventListener('click', e => {
    const b = e.target.closest('[data-grupo] button');
    if (!b) return;
    const grupo = b.parentElement.dataset.grupo;
    if (grupo === 'km') { estado.km = Number(b.dataset.v); form.km.value = estado.km; }
    if (grupo === 'canal') estado.canal = b.dataset.v;
    marcar(grupo, b.dataset.v);
    depois();
  });
  form.addEventListener('submit', e => e.preventDefault());
  await calcular();
  return () => { clearTimeout(timer); rodada++; };
}

function resultado(r) {
  const i = r.insumos ?? {};
  const p = i.premissas ?? {};
  return `<div class="rv-destaque">
      <span>P50 ${esc((NOME_CANAL[r.canal] ?? r.canal ?? '').toLowerCase())} · ${esc(r.meses)} ${r.meses === 1 ? 'mês' : 'meses'} · ${numero(r.km)} km</span>
      <strong>${brl(r.p50?.nominal)}</strong>
      <span>${pctSimples(r.p50?.pct)} de ${brl(r.preco)}${r.preco_informado ? '' : ' (FIPE zero km)'}</span>
    </div>
    <table class="tabela rv-quantis">
      <thead><tr><th></th><th class="num">Nominal</th><th class="num">% compra</th><th class="num">Real</th><th class="num">% real</th></tr></thead>
      <tbody>${QUANTIS.map(([k, rot]) => `<tr${k === 'p50' ? ' class="rv-p50"' : ''}><td>${rot}</td><td class="num">${brl(r[k]?.nominal)}</td><td class="num">${pctSimples(r[k]?.pct)}</td>
        <td class="num">${r[k]?.real == null ? '' : brl(r[k].real)}</td><td class="num">${r[k]?.pct_real == null ? '' : pctSimples(r[k].pct_real)}</td></tr>`).join('')}</tbody>
    </table>
    <dl class="rv-dl rv-insumos">
      <div><dt>Estudo</dt><dd>${i.data_estudo ? dia(i.data_estudo) : ''}</dd></div>
      <div><dt>FIPE</dt><dd>${i.referencia_fipe ? mesAno(`${i.referencia_fipe}-01`) : ''}</dd></div>
      <div><dt>Anúncios</dt><dd>${numero(i.n_anuncios)}${i.km_emprestado ? ' <span class="conferir">outros</span>' : ''}</dd></div>
      <div><dt>Valor retido P50</dt><dd>${pctSimples(i.r_p50)}${i.r_emprestado ? ' <span class="conferir">emprestada</span>' : ''}</dd></div>
      <div><dt>Por 10 mil km</dt><dd>${i.fator_10mil == null ? '' : pct(i.fator_10mil)}</dd></div>
      <div><dt>Km típico</dt><dd>${i.km_tipico == null ? '' : `${num(Math.round(i.km_tipico))} km`}</dd></div>
      <div><dt>Ajuste de km</dt><dd>${i.fator_km == null ? '' : pct(i.fator_km - 1)}</dd></div>
      <div><dt>Canal</dt><dd>${pctSimples(i.multiplicador)}</dd></div>
      <div><dt>Premissas</dt><dd>atacado ${numero(p.atacado_pct_base)}% · varejo −${numero(p.varejo_negociacao_pct)}% · motorista ${numero(p.motorista_pct_base)}%</dd></div>
    </dl>`;
}
