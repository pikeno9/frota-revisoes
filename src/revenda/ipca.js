// IPCA mensal do Banco Central (SGS 433): [{"data":"01/09/2026","valor":"0.82"}], em % no mês.
import { pegarComEspera } from './http.js';

export const URL_BCB = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados';

export function lerSerie(json) {
  if (!Array.isArray(json)) throw new Error('BCB: série em formato inesperado');
  return json.map(x => {
    const m = String(x?.data ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const v = Number(x?.valor);
    if (!m || x?.valor == null || !Number.isFinite(v)) throw new Error(`BCB: linha ilegível ${JSON.stringify(x)}`);
    return { mes: `${m[3]}-${m[2]}`, variacao: v };
  });
}

// desde: "YYYY-MM"; esperaMs: primeira espera quando o BCB responde 429/5xx ou não responde (dobra a cada nova tentativa)
export async function serie(desde, buscar = fetch, { esperaMs = 30000 } = {}) {
  const [ano, mes] = desde.split('-');
  return lerSerie(await pegarComEspera(buscar, `${URL_BCB}?formato=json&dataInicial=01/${mes}/${ano}`, 'BCB', 'json', { esperaMs }));
}
