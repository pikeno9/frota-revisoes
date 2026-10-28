// Espera e tenta de novo quando a fonte limita (429) ou erra do lado dela (5xx).
// O erro leva `status`, então quem decide não depende do texto da mensagem.
import { pegar } from '../coletores/http.js';

export const RETENTATIVAS = 3;
const espera = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());

export const erroHttp = (rotulo, status) => Object.assign(new Error(`${rotulo} respondeu ${status}`), { status });
export const limitado = e => e?.status === 429 || e?.status >= 500;

// Repete fn() quando o erro é 429/5xx: espera esperaMs, depois o dobro, depois o dobro de novo.
// Esgotadas as retentativas (1 pedido + 3), o último erro sobe.
export async function comEspera(fn, { esperaMs, retentativas = RETENTATIVAS }) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!limitado(e) || i >= retentativas) throw e;
      await espera(esperaMs * 2 ** i);
    }
  }
}

// Como pegar() de coletores/http.js, mas com o status no erro e com a espera acima.
export function pegarComEspera(buscar, url, rotulo, tipo, { esperaMs }) {
  const marcando = async (u, opcoes) => {
    const r = await buscar(u, opcoes);
    if (!r.ok) throw erroHttp(rotulo, r.status);
    return r;
  };
  return comEspera(() => pegar(marcando, url, rotulo, tipo), { esperaMs });
}
