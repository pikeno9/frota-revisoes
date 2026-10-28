const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const brl = v => (v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }));
export const num = v => Number(v).toLocaleString('pt-BR');
export const kmMil = km => `${num(km / 1000)} mil km`;
export const pct = p => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const mesAno = iso => `${MESES[+iso.slice(5, 7) - 1]}/${iso.slice(2, 4)}`;
export const dia = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function seta(v) {
  if (!v) return '';
  const [cls, s] = v.pct > 0 ? ['sobe', '▲'] : v.pct < 0 ? ['desce', '▼'] : ['igual', '='];
  return `<span class="var ${cls}"><span aria-hidden="true">${s}</span> ${pct(v.pct)} <span class="var-quando">${mesAno(v.em)}</span></span>`;
}
