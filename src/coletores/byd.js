// BYD: a página do plano de manutenção traz no HTML um objeto por modelo,
// {"n":"BYD King","img":..,"km":[..],"p":[..]}. Meses: (i+1)*12, como no rótulo do site.
import { pegar } from './http.js';

export const PAGINA = 'https://www.byd.com/br/plano-de-manutencao';
const RE = /\{"n":"([^"]+)"[^{}]*?"km":\[([^\]]*)\],"p":\[([^\]]*)\]/g;

export function lerHtml(html) {
  return [...html.matchAll(RE)].map(m => ({ nome: m[1], km: m[2].split(',').map(Number), p: m[3].split(',').map(Number) }));
}

async function lista(buscar) {
  const l = lerHtml(await pegar(buscar, PAGINA, 'BYD', 'html'));
  if (!l.length) throw new Error('BYD: tabela de preços não encontrada na página');
  return l;
}

export async function coletar(parametros, buscar = fetch) {
  const alvo = (await lista(buscar)).find(x => x.nome === parametros.nome);
  if (!alvo) throw new Error(`BYD: "${parametros.nome}" não está na página`);
  return alvo.p.map((valor, i) => ({ ordem: i + 1, km: alvo.km[i], meses: (i + 1) * 12, valor }));
}

export async function catalogo(buscar = fetch) {
  return (await lista(buscar)).map(x => ({ rotulo: x.nome, parametros: { nome: x.nome } }));
}
