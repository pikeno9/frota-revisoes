const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const brl = v => (v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }));
export const num = v => Number(v).toLocaleString('pt-BR');
export const kmMil = km => `${num(km / 1000)} mil km`;
export const pct = p => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
// Fração como porcentagem sem sinal: 0.784 → 78,4%
export const pctSimples = (p, casas = 1) => (p == null ? '' : `${(p * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
export const mesAno = iso => `${MESES[+iso.slice(5, 7) - 1]}/${iso.slice(2, 4)}`;
// Período em que um preço valeu: "set/26", "jun a ago/26" ou "nov/25 a fev/26".
export function periodo(de, ate) {
  if (!de) return '';
  if (!ate || de.slice(0, 7) === ate.slice(0, 7)) return mesAno(de);
  return de.slice(0, 4) === ate.slice(0, 4) ? `${mesAno(de).slice(0, 3)} a ${mesAno(ate)}` : `${mesAno(de)} a ${mesAno(ate)}`;
}
export const dia = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function seta(v) {
  if (!v) return '';
  const [cls, s] = v.pct > 0 ? ['sobe', '▲'] : v.pct < 0 ? ['desce', '▼'] : ['igual', '='];
  return `<span class="var ${cls}"><span aria-hidden="true">${s}</span> ${pct(v.pct)} <span class="var-quando">${mesAno(v.em)}</span></span>`;
}
