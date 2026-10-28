// Gráficos (skill dataviz): paleta categórica em ordem fixa presa ao modelo,
// série única no roxo OCN, linhas de 2px em degraus, dica sempre ligada.
import { brl, num, mesAno, dia } from './formato.js';

// Um 9º modelo reaproveitaria a cor 1: se isso acontecer, agrupar ou separar em facetas.
export const CATEG =['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const ROXO = '#5800F7';
export const corDe = i => CATEG[i % CATEG.length];
const TINTA = { forte: '#0A0118', media: '#52514e', grade: 'rgba(10,1,24,.08)' };
const FONTE = '600 11px "Plus Jakarta Sans", system-ui';
const semMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ts = iso => Date.parse(`${iso}T12:00:00Z`);
const isoDe = ms => new Date(ms).toISOString().slice(0, 10);
const hoje = () => new Date().toISOString().slice(0, 10);
const DICA = { backgroundColor: TINTA.forte, padding: 10, boxPadding: 4, titleFont: { family: 'Plus Jakarta Sans', weight: '700' }, bodyFont: { family: 'Plus Jakarta Sans' } };

Chart.defaults.font.family = 'Plus Jakarta Sans, system-ui';
Chart.defaults.color = TINTA.media;

export function pontosDegrau(serie) {
  const p = serie.map(s => ({ x: ts(s.data), y: s.total }));
  if (p.length) {
    const ultima = serie.at(-1).data;
    const fim = hoje() > ultima ? hoje() : ultima; // nunca volta no tempo
    p.push({ x: ts(fim), y: p.at(-1).y });
  }
  return p;
}

export function linhaPlano(canvas, serie, { mini = false } = {}) {
  const dados = pontosDegrau(serie);
  const ultimo = dados.length - 1;
  const opcoes = {
    // Minis não animam: no Início o cartão já chega animado, no Detalhe seriam oito traços se mexendo.
    responsive: true, maintainAspectRatio: false, animation: mini || semMovimento() ? false : { duration: 250 },
    transitions: { active: { animation: { duration: 150 } } },
    layout: { padding: mini ? 2 : 4 },
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { type: 'linear', display: !mini, ticks: { callback: v => mesAno(isoDe(v)), maxTicksLimit: 6 }, grid: { display: false } },
      y: { display: !mini, grace: '10%', ticks: { callback: v => brl(v), maxTicksLimit: 5 }, grid: { color: TINTA.grade }, border: { display: false } },
    },
    plugins: {
      legend: { display: false },
      tooltip: mini ? { enabled: false } : { ...DICA, displayColors: false, callbacks: { title: it => dia(isoDe(it[0].parsed.x)), label: it => brl(it.parsed.y) } },
    },
  };
  if (mini) opcoes.events = [];
  return new Chart(canvas, {
    type: 'line',
    data: { datasets: [{ data: dados, stepped: 'after', borderColor: ROXO, backgroundColor: ROXO, borderWidth: 2,
      pointRadius: c => (mini || c.dataIndex === ultimo ? 0 : 3), pointHoverRadius: mini ? 0 : 5,
      pointBorderColor: '#fff', pointBorderWidth: 2 }] },
    options: opcoes,
  });
}

const referencias = refs => ({
  id: 'referencias',
  afterDatasetsDraw(c) {
    const { ctx, chartArea: a, scales: { x } } = c;
    ctx.save();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = TINTA.media; ctx.fillStyle = TINTA.media; ctx.font = FONTE;
    for (const r of refs) {
      const px = x.getPixelForValue(r);
      if (px < a.left || px > a.right) continue;
      ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
      ctx.fillText(`${num(r / 1000)} mil km`, px + 4, a.top + 10);
    }
    ctx.restore();
  },
});

// Nome no fim de cada linha, em tinta de texto (não na cor da série), sem sobrepor.
const rotuloFinal = {
  id: 'rotuloFinal',
  afterDatasetsDraw(c) {
    const { ctx } = c;
    ctx.save(); ctx.font = FONTE; ctx.fillStyle = TINTA.forte; ctx.textBaseline = 'middle';
    const usados = [];
    c.data.datasets.forEach((d, i) => {
      const meta = c.getDatasetMeta(i);
      let j = d.data.length - 1;
      while (j >= 0 && d.data[j].y == null) j--;
      if (j < 0 || meta.hidden) return;
      const p = meta.data[j];
      let y = p.y;
      while (usados.some(u => Math.abs(u - y) < 13)) y -= 13;
      usados.push(y);
      ctx.fillText(d.label, p.x + 6, y);
    });
    ctx.restore();
  },
};

export function graficoComparar(canvas, kms, modelos, refs) {
  return new Chart(canvas, {
    type: 'line',
    data: { datasets: modelos.map(m => ({
      label: m.nome, data: kms.map((k, i) => ({ x: k, y: m.valores[i] })), stepped: 'after', spanGaps: false,
      cor: corDe(m.cor), borderColor: corDe(m.cor), backgroundColor: corDe(m.cor), borderWidth: 2, pointRadius: 0,
      pointHoverRadius: 5, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
    })) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: semMovimento() ? false : { duration: 250 },
      transitions: { active: { animation: { duration: 150 } }, realce: { animation: { duration: 120 } }, solta: { animation: { duration: 100 } } },
      layout: { padding: { right: 110, top: 6 } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'linear', min: 0, max: kms.at(-1), ticks: { callback: v => `${num(v / 1000)} mil`, maxTicksLimit: 11 }, grid: { color: TINTA.grade } },
        y: { beginAtZero: true, ticks: { callback: v => brl(v), maxTicksLimit: 6 }, grid: { color: TINTA.grade }, border: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...DICA, filter: it => it.parsed.y != null, itemSort: (a, b) => b.parsed.y - a.parsed.y,
          callbacks: { title: it => `${num(it[0].parsed.x)} km`, label: it => ` ${it.dataset.label}  ${brl(it.parsed.y)}` } },
      },
    },
    plugins: [referencias(refs), rotuloFinal],
  });
}

// Filtro sem recriar o gráfico: quem sai some na hora, quem entra surge no lugar
// e as linhas que ficam acompanham o eixo novo (250 ms).
export function mostrarSo(chart, ver) {
  const entram = new Set();
  let mudou = false;
  ver.forEach((v, i) => {
    if (chart.isDatasetVisible(i) === v) return;
    chart.setDatasetVisibility(i, v);
    if (v) entram.add(i);
    mudou = true;
  });
  if (mudou) chart.update(c => (entram.has(c.datasetIndex) ? 'show' : undefined));
}

// Realce de uma linha (legenda ou tabela): as outras vão a 20% em 120 ms e voltam em 100 ms.
export function realcar(chart, i) {
  chart.data.datasets.forEach((d, j) => {
    const c = i == null || i === j ? d.cor : `${d.cor}33`;
    d.borderColor = c;
    d.backgroundColor = c;
  });
  chart.update(i == null ? 'solta' : 'realce');
}
