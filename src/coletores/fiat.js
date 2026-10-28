// Fiat: microserviço de manutenção, preço por concessionária (dealer fixo de SP).
// Devolve só as revisões publicadas (hoje 5); km vem em milhares.
import { pegar } from './http.js';

export const BASE = 'https://maintenance-service.k8s.fcalatam.com.br/v3/maintenance';

export function ler(arr) {
  return arr
    .filter(it => it.totalPrice != null)
    .sort((a, b) => a.km - b.km)
    .map((it, i) => ({ ordem: i + 1, km: Math.round(it.km * 1000), meses: it.timeUseInMonths ?? null, valor: Number(it.totalPrice) }));
}

export async function coletar(p, buscar = fetch) {
  const url = `${BASE}?brand=FIAT&market=pt-BR&modelYear=${p.modelYear}&mvsCode=${encodeURIComponent(p.mvsCode)}&dealer=${encodeURIComponent(p.dealer)}`;
  const itens = ler(await pegar(buscar, url, 'Fiat'));
  if (!itens.length) throw new Error(`Fiat: nenhuma revisão para ${p.mvsCode}`);
  return itens;
}
