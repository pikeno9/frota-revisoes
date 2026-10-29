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

// Curva de 1 ano do estudo (ln preço = a + b·1 + c·km/10.000) com a faixa P10 a P90.
export function curvaUmAno(estudo, kmMax) {
  const { a, b, c } = estudo.km;
  if (a == null || !estudo.residuos) return null;
  const pts = [];
  for (let km = 0; km <= kmMax; km += 2000) {
    const p50 = Math.exp(a + b + c * km / 10000);
    pts.push({ km, p50, p10: p50 * Math.exp(estudo.residuos.q10), p90: p50 * Math.exp(estudo.residuos.q90) });
  }
  return pts;
}

export function dispersaoKm(canvas, { anuncios, curva, refs }) {
  const datasets = [{
    type: 'scatter', label: 'Anúncios', data: anuncios.map(a => ({ x: a.km, y: a.preco })),
    backgroundColor: PAPEL.anuncios, borderWidth: 0, pointRadius: 4.5, pointHoverRadius: 6, order: 2,
  }];
  if (curva) {
    datasets.push(
      { type: 'line', label: 'P90', data: curva.map(p => ({ x: p.km, y: p.p90 })), borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: '+1', backgroundColor: PAPEL.faixa, order: 3 },
      { type: 'line', label: 'P10', data: curva.map(p => ({ x: p.km, y: p.p10 })), borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: false, order: 3 },
      { type: 'line', label: 'Curva de 1 ano', data: curva.map(p => ({ x: p.km, y: p.p50 })), borderColor: PAPEL.curva, borderWidth: 2, pointRadius: 0, pointHoverRadius: 0, order: 1 },
    );
  }
  return new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: animacao(),
      interaction: { mode: 'nearest', intersect: true },
      scales: {
        x: { type: 'linear', min: 0, max: curva?.at(-1).km, ticks: { callback: v => `${num(v / 1000)} mil`, maxTicksLimit: 9 }, grid: { color: TINTA.grade } },
        y: { ticks: { callback: v => brl(v), maxTicksLimit: 6 }, grid: { color: TINTA.grade }, border: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...DICA, displayColors: false, filter: it => it.dataset.label === 'Anúncios',
          callbacks: { title: () => '', label: it => `${num(it.parsed.x)} km · ${brl(it.parsed.y)}` } },
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
