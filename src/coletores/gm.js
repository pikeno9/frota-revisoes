// Chevrolet: o simulador da GM carrega toda a base de um JSON estático
// {make, model, trim, year, mileDisplay, title, price}; price = "4 x R$ 139".
import { pegar } from './http.js';

export const DADOS = 'https://novoservico.gm.com/json/data_pt-br.json';
const literal = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parsePreco(s) {
  const num = t => Number(t.replace(/\./g, '').replace(',', '.'));
  const parc = String(s).match(/(\d+)\s*x\s*R\$\s*([\d.,]+)/i);
  if (parc) return +(Number(parc[1]) * num(parc[2])).toFixed(2);
  const avista = String(s).match(/R\$\s*([\d.,]+)/);
  return avista ? +num(avista[1]).toFixed(2) : null;
}

export function mesesDoTitulo(t) {
  const m = String(t).match(/(\d+)\s*Ano/i);
  return m ? +m[1] * 12 : null;
}

export async function coletar(p, buscar = fetch) {
  const re = new RegExp(literal(p.trim), 'i');
  const doModelo = (await pegar(buscar, DADOS, 'GM')).filter(x => x.model === p.model && String(x.year) === String(p.year));
  // Casa o trim exato primeiro; só cai para trecho se nada casar, e recusa se o trecho servir a mais de um trim.
  let recs = doModelo.filter(x => String(x.trim).toLowerCase() === String(p.trim).toLowerCase());
  if (!recs.length) {
    recs = doModelo.filter(x => re.test(x.trim));
    const trims = [...new Set(recs.map(x => x.trim))];
    if (trims.length > 1) throw new Error(`GM: versão "${p.trim}" é ambígua: ${trims.join(', ')}`);
  }
  recs.sort((a, b) => a.mileDisplay - b.mileDisplay);
  if (!recs.length) throw new Error(`GM: nenhum registro para ${p.model} ${p.year} ${p.trim}`);
  return recs.map((x, i) => {
    const valor = parsePreco(x.price);
    if (valor == null) throw new Error(`GM: preço ilegível "${x.price}"`);
    return { ordem: i + 1, km: x.mileDisplay, meses: mesesDoTitulo(x.title), valor };
  });
}

export async function catalogo(buscar = fetch) {
  const vistos = new Map();
  for (const x of await pegar(buscar, DADOS, 'GM')) {
    const k = `${x.model}|${x.year}|${x.trim}`;
    if (!vistos.has(k)) vistos.set(k, { rotulo: `${x.make} ${x.model} ${x.trim} ${x.year}`, parametros: { model: x.model, year: String(x.year), trim: x.trim } });
  }
  return [...vistos.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}
