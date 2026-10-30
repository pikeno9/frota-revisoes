// Gráficos da Revenda (skill dataviz): cor pelo papel da série, nunca pela posição;
// pontos de 9 px semitransparentes, linhas de 2 px, faixa sombreada, legenda em HTML.
import { brl, num, mesAno } from '../formato.js';
import { TINTA, DICA, semMovimento, referencias } from '../graficos.js';

export const PAPEL = {
  anuncios: 'rgba(88, 0, 247, 0.32)',
  curva: '#0A0118',
  faixa: 'rgba(88, 0, 247, 0.10)',
  zero_km: '#5800F7',
  ano_anterior: '#2a78d6',
};
const animacao = () => (semMovimento() ? false : { duration: 250 });
const ts = ref => Date.parse(`${ref}-15T12:00:00Z`);
const refDe = ms => new Date(ms).toISOString().slice(0, 7);

// Uma cor por fonte, sempre a mesma em todas as telas.
export const NOME_FONTE = { mobiauto: 'Mobiauto', napista: 'NaPista', olx: 'OLX', kavak: 'Kavak', webmotors: 'Webmotors' };
const COR_FONTE = { mobiauto: 'rgba(88, 0, 247, 0.45)', napista: 'rgba(42, 120, 214, 0.45)', olx: 'rgba(214, 120, 42, 0.5)', kavak: 'rgba(6, 118, 71, 0.45)', webmotors: 'rgba(180, 35, 24, 0.45)' };
export const corFonte = f => COR_FONTE[f] ?? 'rgba(82, 81, 78, 0.45)';
const LEILAO = '#B42318';

// Reta do consenso em 1 ano de idade (ln preço = a + b·1 + c·km/10.000, preço da fonte base) e a faixa P10 a P90.
export function curvaConsenso(consenso, kmMax) {
  const r = consenso.regressao;
  if (!r || !consenso.residuos) return null;
  const pts = [];
  for (let km = 0; km <= kmMax; km += 2000) {
    const p50 = Math.exp(r.a + r.b + r.c * km / 10000);
    pts.push({ km, p50, p10: p50 * Math.exp(consenso.residuos.q10), p90: p50 * Math.exp(consenso.residuos.q90) });
  }
  return pts;
}

// Anúncios de 1 ano por fonte (os usados no estudo) e os de leilão em anel vermelho.
export function dispersaoFontes(canvas, { anuncios, curva, refs, kmMax }) {
  const usados = anuncios.filter(a => a.status === 'usado');
  const fontes = [...new Set(usados.map(a => a.fonte))].sort();
  const datasets = fontes.map(f => ({
    type: 'scatter', label: NOME_FONTE[f] ?? f, data: usados.filter(a => a.fonte === f).map(a => ({ x: a.km, y: a.preco })),
    backgroundColor: corFonte(f), borderWidth: 0, pointRadius: 4, pointHoverRadius: 6, order: 2,
  }));
  const leilao = anuncios.filter(a => a.status === 'leilao' || a.status === 'possivel_leilao');
  if (leilao.length) {
    datasets.push({ type: 'scatter', label: 'Leilão', data: leilao.map(a => ({ x: a.km, y: a.preco })),
      backgroundColor: 'transparent', borderColor: LEILAO, borderWidth: 1.5, pointRadius: 4, pointHoverRadius: 6, order: 2 });
  }
  if (curva) {
    datasets.push(
      { type: 'line', label: 'P90', data: curva.map(p => ({ x: p.km, y: p.p90 })), borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: '+1', backgroundColor: PAPEL.faixa, order: 3 },
      { type: 'line', label: 'P10', data: curva.map(p => ({ x: p.km, y: p.p10 })), borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: false, order: 3 },
      { type: 'line', label: 'Reta', data: curva.map(p => ({ x: p.km, y: p.p50 })), borderColor: PAPEL.curva, borderWidth: 2, pointRadius: 0, pointHoverRadius: 0, order: 1 },
    );
  }
  const pontos = new Set([...fontes.map(f => NOME_FONTE[f] ?? f), 'Leilão']);
  return new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: animacao(),
      interaction: { mode: 'nearest', intersect: true },
      scales: {
        x: { type: 'linear', min: 0, max: kmMax, ticks: { callback: v => `${num(v / 1000)} mil`, maxTicksLimit: 9 }, grid: { color: TINTA.grade } },
        y: { ticks: { callback: v => brl(v), maxTicksLimit: 6 }, grid: { color: TINTA.grade }, border: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...DICA, displayColors: false, filter: it => pontos.has(it.dataset.label),
          callbacks: { title: () => '', label: it => `${it.dataset.label} · ${num(it.parsed.x)} km · ${brl(it.parsed.y)}` } },
      },
    },
    plugins: [referencias(refs)],
  });
}

export function degrausFipe(canvas, serie) {
  const linha = (chave, label, cor) => ({
    label, data: serie.filter(s => s[chave] != null).map(s => ({ x: ts(s.referencia), y: s[chave] })),
    stepped: 'before', borderColor: cor, backgroundColor: cor, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
    pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
  });
  return new Chart(canvas, {
    type: 'line',
    data: { datasets: [linha('zero_km', 'Zero km', PAPEL.zero_km), linha('ano_anterior', 'Ano anterior', PAPEL.ano_anterior)] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: animacao(),
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'linear', ticks: { callback: v => mesAno(`${refDe(v)}-01`), maxTicksLimit: 6 }, grid: { display: false } },
        y: { grace: '5%', ticks: { callback: v => brl(v), maxTicksLimit: 5 }, grid: { color: TINTA.grade }, border: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...DICA, callbacks: { title: it => mesAno(`${refDe(it[0].parsed.x)}-01`), label: it => ` ${it.dataset.label}  ${brl(it.parsed.y)}` } },
      },
    },
  });
}
