// Dados sintéticos com coeficientes conhecidos para o estudo de revenda.
import { somarMeses, idade } from '../src/revenda/estudo.js';

// FIPE em que r_m = q^m exato: o ano A vale base·q^(meses desde jan de A + 1) e o zero km (32000)
// vale o mesmo que o ano do zero km daquela referência. Anos de Y−3 a Y em cada referência Y.
export function fipeSintetica({ de = '2023-11', ate = '2026-10', q = 0.99, base = 100000, marca = 59, modelo = 10176 } = {}) {
  const linhas = [];
  for (let s = de; s <= ate; s = somarMeses(s, 1)) {
    const Y = Number(s.slice(0, 4));
    const valor = A => base * q ** ((Y - A) * 12 + Number(s.slice(5, 7)));
    for (let A = Y - 3; A <= Y; A++) linhas.push({ fipe_marca: marca, fipe_modelo: modelo, ano_modelo: A, referencia: s, valor: valor(A) });
    linhas.push({ fipe_marca: marca, fipe_modelo: modelo, ano_modelo: 32000, referencia: s, valor: valor(Y) });
  }
  return linhas;
}

// IPCA constante (em % no mês) de `de` até `ate`.
export function ipcaSintetico({ de = '2023-01', ate = '2026-09', variacao = 0.5 } = {}) {
  const m = new Map();
  for (let s = de; s <= ate; s = somarMeses(s, 1)) m.set(s, variacao);
  return m;
}

// ln(preço) = a + b·idade + c·km/10.000 + desvio. Cada combinação (ano, km) leva os mesmos
// desvios, que somam zero: a regressão devolve a, b, c exatos e os resíduos são os desvios.
export function anunciosSinteticos({ a = 11.5, b = -0.1, c = -0.03, hoje = '2026-10-28', anos = [2024, 2025, 2026], kms = [10000, 30000, 50000, 70000], desvios = [-0.1, -0.05, 0, 0.05, 0.1] } = {}) {
  const lista = [];
  let id = 1;
  for (const ano of anos) for (const km of kms) for (const e of desvios) {
    lista.push({ id_externo: `mobiauto:${id++}`, versao: 'Track 1.0', ano_modelo: ano, ano_fabricacao: ano - 1, km, preco: Math.exp(a + b * idade(ano, hoje) + c * km / 10000 + e), loja: null });
  }
  return lista;
}
