// O método da spec (seção 6), em funções puras: desvalorização pela FIPE, efeito do km
// e dispersão pelos anúncios, projeção por canal. Sem banco e sem rede.

export const MESES = [6, 12, 18, 24];
export const MIN_R = 6;            // observações de r_m para o código valer sozinho
export const MIN_ANUNCIOS = 30;    // anúncios para a regressão do km
export const JANELA = 24;          // r_m dos últimos 24 meses (pela referência final t+m)
export const ZERO_KM = 32000;
export const CANAIS = ['atacado', 'varejo', 'motorista'];

// Quantil com interpolação linear entre vizinhos (o "tipo 7" do R e do Excel).
export function quantil(lista, q) {
  const s = lista.filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const mediana = lista => quantil(lista, 0.5);
const media = l => (l.length ? l.reduce((s, v) => s + v, 0) / l.length : null);

// "2026-10" + 3 → "2027-01"
export function somarMeses(mes, n) {
  const total = Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

// idade = ano corrente + mês corrente/12 − ano-modelo (hoje: "YYYY-MM-DD")
export const idade = (anoModelo, hoje) => Number(hoje.slice(0, 4)) + Number(hoje.slice(5, 7)) / 12 - anoModelo;

// linhas [{ano_modelo, referencia, valor}] → Map referencia → Map ano → valor
export function indexarFipe(linhas) {
  const idx = new Map();
  for (const l of linhas) {
    if (!idx.has(l.referencia)) idx.set(l.referencia, new Map());
    idx.get(l.referencia).set(l.ano_modelo, l.valor);
  }
  return idx;
}

// O ano do zero km numa referência: o maior ano-modelo com preço, fora o 32000.
export function anoZeroKm(porAno) {
  const anos = [...porAno.keys()].filter(a => a !== ZERO_KM);
  return anos.length ? Math.max(...anos) : null;
}

// r_m(t) = FIPE(ano do 0 km em t, t+m) / FIPE(32000, t), com t+m dentro dos últimos `janela` meses.
// real = r / (1 + IPCA acumulado de t+1 a t+m); null se faltar algum mês do IPCA.
export function observacoesR(linhas, m, ipca, janela = JANELA) {
  const idx = indexarFipe(linhas);
  const refs = [...idx.keys()].sort();
  if (!refs.length) return [];
  const ultima = refs.at(-1);
  const limite = somarMeses(ultima, -janela);
  const obs = [];
  for (const t of refs) {
    const fim = somarMeses(t, m);
    if (fim > ultima || fim <= limite || !idx.has(fim)) continue;
    const emT = idx.get(t);
    const zero = emT.get(ZERO_KM);
    const ano = anoZeroKm(emT);
    const depois = ano == null ? null : idx.get(fim).get(ano);
    if (!zero || !depois) continue;
    const r = depois / zero;
    let acumulado = 1;
    for (let k = 1; k <= m && acumulado != null; k++) {
      const v = ipca.get(somarMeses(t, k));
      acumulado = v == null ? null : acumulado * (1 + v / 100);
    }
    obs.push({ t, r, real: acumulado == null ? null : r / acumulado });
  }
  return obs;
}

export function resumirR(obs, emprestado = null) {
  const rs = obs.map(o => o.r);
  const reais = obs.map(o => o.real).filter(v => v != null);
  return { p25: quantil(rs, 0.25), p50: mediana(rs), p75: quantil(rs, 0.75), real_p50: reais.length ? mediana(reais) : null, n: obs.length, emprestado };
}

// Mínimos quadrados pelas equações normais (X'X) β = X'y, resolvidas por eliminação de Gauss.
export function minimosQuadrados(X, y) {
  const k = X[0].length;
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k + 1 }, (_, j) =>
    (j < k ? X.reduce((s, linha) => s + linha[i] * linha[j], 0) : X.reduce((s, linha, n) => s + linha[i] * y[n], 0))));
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let i = col + 1; i < k; i++) if (Math.abs(A[i][col]) > Math.abs(A[piv][col])) piv = i;
    if (Math.abs(A[piv][col]) < 1e-12) throw Object.assign(new Error('regressão sem solução (dados sem variação)'), { codigo: 'SEM_VARIACAO' });
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let i = 0; i < k; i++) {
      if (i === col) continue;
      const f = A[i][col] / A[col][col];
      for (let j = col; j <= k; j++) A[i][j] -= f * A[col][j];
    }
  }
  return A.map((linha, i) => linha[k] / linha[i]);
}

export const CORTE_MAD = 3;          // resíduo além de 3 desvios robustos sai da regressão
const MAD_PARA_DESVIO = 1.4826;      // MAD × 1,4826 ≈ desvio padrão numa distribuição normal

function ajustar(anuncios, hoje) {
  const X = anuncios.map(x => [1, idade(x.ano_modelo, hoje), x.km / 10000]);
  const y = anuncios.map(x => Math.log(x.preco));
  const [a, b, c] = minimosQuadrados(X, y);
  return { a, b, c, residuos: X.map((l, i) => y[i] - (a + b * l[1] + c * l[2])) };
}

// ln(preço) = a + b·idade + c·(km/10.000), ajustado duas vezes: o anúncio com preço fora de
// propósito (R$ 1, ou 5 vezes o normal) puxaria a reta, então depois do 1º ajuste saem os de
// resíduo além de 3 × MAD × 1,4826 (em torno da mediana dos resíduos) e ajusta de novo.
// Sem dispersão (MAD zero) nada sai. Devolve também quantos saíram e quantos ficaram.
export function ajustarKm(anuncios, hoje) {
  const primeiro = ajustar(anuncios, hoje);
  const centro = mediana(primeiro.residuos);
  const mad = mediana(primeiro.residuos.map(e => Math.abs(e - centro)));
  if (!(mad > 1e-12)) return { ...primeiro, descartados: 0, usados: anuncios.length };
  const corte = CORTE_MAD * MAD_PARA_DESVIO * mad;
  const mantidos = anuncios.filter((_, i) => Math.abs(primeiro.residuos[i] - centro) <= corte);
  const descartados = anuncios.length - mantidos.length;
  if (!descartados) return { ...primeiro, descartados: 0, usados: anuncios.length };
  return { ...ajustar(mantidos, hoje), descartados, usados: mantidos.length };
}

// Estudo de um modelo só com os dados dele (e do código de referência para a desvalorização).
// Os campos que faltam ficam marcados e são preenchidos depois por emprestar().
export function calcularEstudo({ fipe, fipeRef = null, anuncios: brutos, ipca, hoje }) {
  // Anúncios sem ano-modelo, km ou preço válidos não entram (o banco aceita ano_modelo nulo).
  const anuncios = brutos.filter(x => Number.isFinite(x.ano_modelo) && Number.isFinite(x.km) && x.km >= 0 && Number.isFinite(x.preco) && x.preco > 0);
  const idx = indexarFipe(fipe);
  const referencia = [...idx.keys()].sort().at(-1) ?? null;
  const r = {};
  for (const m of MESES) {
    const proprias = observacoesR(fipe, m, ipca);
    if (proprias.length >= MIN_R) { r[m] = resumirR(proprias); continue; }
    const daRef = fipeRef ? observacoesR(fipeRef, m, ipca) : [];
    r[m] = daRef.length >= MIN_R ? resumirR(daRef, 'ref') : null;
  }
  const tipicos = anuncios.filter(x => { const i = idade(x.ano_modelo, hoje); return i >= 0.5 && i <= 1.5; }).map(x => x.km);
  let km = { a: null, b: null, c: null, fator_10mil: null, km_tipico: tipicos.length ? mediana(tipicos) : null, km_tipico_emprestado: false, n: anuncios.length, descartados: 0, emprestado: true };
  let residuos = null;
  if (anuncios.length >= MIN_ANUNCIOS) {
    try {
      const aj = ajustarKm(anuncios, hoje);
      km.descartados = aj.descartados;
      // O mínimo de anúncios vale depois do descarte dos fora de propósito.
      if (aj.usados < MIN_ANUNCIOS) {
        km = { ...km, motivo: 'poucos anúncios após descartar os fora de propósito' };
      } else {
        km = { ...km, a: aj.a, b: aj.b, c: aj.c, fator_10mil: Math.exp(aj.c) - 1, emprestado: false };
        residuos = { q10: quantil(aj.residuos, 0.1), q90: quantil(aj.residuos, 0.9), sem_faixa: false };
      }
    } catch (erro) {
      // Todos os anúncios do mesmo ano-modelo (ou do mesmo km): a regressão não tem solução.
      // Trata como poucos anúncios: emprestar() completa c, dispersão e razão com os outros modelos.
      if (erro.codigo !== 'SEM_VARIACAO') throw erro;
      const mesmaIdade = new Set(anuncios.map(x => x.ano_modelo)).size === 1;
      km = { ...km, motivo: mesmaIdade ? 'sem variação de idade' : 'sem variação de km' };
    }
  }
  const atual = referencia ? idx.get(referencia) : null;
  const razoes = atual ? anuncios.filter(x => idade(x.ano_modelo, hoje) <= 1.5 && atual.get(x.ano_modelo)).map(x => x.preco / atual.get(x.ano_modelo)) : [];
  return {
    r, km, residuos, anuncio_sobre_fipe: razoes.length ? mediana(razoes) : null,
    fipe_0km_atual: atual?.get(ZERO_KM) ?? null, referencia, n_fipe: r[12]?.n ?? 0,
  };
}

// Preenche o que faltou num modelo com os outros: r_m pela mediana dos que têm dados próprios,
// c, km típico, dispersão e razão anúncio/FIPE pela média dos que têm anúncios suficientes.
// Sem nenhum doador: c = 0, sem dispersão e razão 1.
export function emprestar(estudos) {
  const doadoresR = m => estudos.filter(e => e.r[m] && e.r[m].emprestado === null).map(e => e.r[m]);
  const doadoresKm = estudos.filter(e => !e.km.emprestado);
  const mediaDe = f => media(doadoresKm.map(f).filter(v => v != null));
  return estudos.map(e => {
    const r = { ...e.r };
    for (const m of MESES) {
      if (r[m]) continue;
      const d = doadoresR(m);
      r[m] = d.length ? {
        p25: mediana(d.map(x => x.p25)), p50: mediana(d.map(x => x.p50)), p75: mediana(d.map(x => x.p75)),
        real_p50: mediana(d.map(x => x.real_p50).filter(v => v != null)), n: 0, emprestado: 'outros',
      } : null;
    }
    let { km, residuos, anuncio_sobre_fipe } = e;
    if (km.emprestado) {
      const c = mediaDe(x => x.km.c) ?? 0;
      km = { ...km, c, fator_10mil: Math.exp(c) - 1 };
      const q10 = mediaDe(x => x.residuos.q10), q90 = mediaDe(x => x.residuos.q90);
      // Sem doador a faixa P10 a P90 fica sem largura; sem_faixa avisa a tela.
      residuos = { q10: q10 ?? 0, q90: q90 ?? 0, sem_faixa: q10 == null || q90 == null };
    }
    if (km.km_tipico == null) {
      const emprestado = mediaDe(x => x.km.km_tipico);
      if (emprestado != null) km = { ...km, km_tipico: emprestado, km_tipico_emprestado: true };
    }
    if (anuncio_sobre_fipe == null) anuncio_sobre_fipe = mediaDe(x => x.anuncio_sobre_fipe) ?? 1;
    return {
      ...e, r, km, residuos, anuncio_sobre_fipe, n_fipe: r[12]?.n ?? 0,
      r_emprestado: MESES.some(m => r[m]?.emprestado), km_emprestado: km.emprestado,
    };
  });
}

// r para m meses: exato em 6, 12, 18, 24; entre eles, reta entre os vizinhos (0 meses = 1).
export function interpolarR(r, meses) {
  if (!Number.isInteger(meses) || meses < 1 || meses > 24) throw new Error('meses entre 1 e 24');
  if (r[meses]) return r[meses];
  const pontos = [[0, { p25: 1, p50: 1, p75: 1, real_p50: 1 }], ...MESES.filter(m => r[m]).map(m => [m, r[m]])];
  const lo = pontos.filter(([m]) => m < meses).at(-1);
  const hi = pontos.find(([m]) => m > meses);
  if (!lo || !hi) return null;
  const f = (meses - lo[0]) / (hi[0] - lo[0]);
  const entre = k => (lo[1][k] == null || hi[1][k] == null ? null : lo[1][k] + (hi[1][k] - lo[1][k]) * f);
  return { p25: entre('p25'), p50: entre('p50'), p75: entre('p75'), real_p50: entre('real_p50') };
}

export function multiplicadorCanal(dados, canal, premissas) {
  if (canal === 'atacado') return premissas.atacado_pct_base / 100;
  if (canal === 'varejo') return (dados.anuncio_sobre_fipe ?? 1) * (1 - premissas.varejo_negociacao_pct / 100);
  if (canal === 'motorista') return premissas.motorista_pct_base / 100;
  throw new Error('canal deve ser atacado, varejo ou motorista');
}

// Projeção (spec, seção 6). preco: preço de compra; sem ele, o FIPE do zero km do estudo.
export function projetar(dados, { meses, km, canal, preco = null }, premissas) {
  if (typeof km !== 'number' || !Number.isFinite(km) || km < 0) throw new Error('km deve ser um número maior ou igual a 0');
  for (const chave of ['atacado_pct_base', 'varejo_negociacao_pct', 'motorista_pct_base']) {
    if (typeof premissas?.[chave] !== 'number' || !Number.isFinite(premissas[chave])) throw new Error(`premissa ${chave} ausente ou inválida`);
  }
  const r = interpolarR(dados.r, meses);
  if (!r) throw new Error('estudo sem desvalorização para esse prazo');
  const P = preco ?? dados.fipe_0km_atual;
  if (typeof P !== 'number' || !Number.isFinite(P) || !(P > 0)) throw new Error('informe o preço de compra');
  const mult = multiplicadorCanal(dados, canal, premissas);
  const { c, km_tipico } = dados.km;
  // A FIPE de t+m já embute o km típico de um carro de m meses: km_tipico é o de 1 ano, então
  // a referência do ajuste cresce com o prazo (6 meses: metade; 24 meses: o dobro).
  const kmReferencia = km_tipico == null ? null : km_tipico * meses / 12;
  const fatorKm = c && kmReferencia != null ? Math.exp(c * (km - kmReferencia) / 10000) : 1;
  const disp = { p10: Math.exp(dados.residuos?.q10 ?? 0), p50: 1, p90: Math.exp(dados.residuos?.q90 ?? 0) };
  const out = {};
  for (const [q, e] of Object.entries(disp)) {
    const nominal = P * r.p50 * fatorKm * e * mult;
    const real = r.real_p50 == null ? null : P * r.real_p50 * fatorKm * e * mult;
    out[q] = { nominal: Math.round(nominal), real: real == null ? null : Math.round(real), pct: nominal / P, pct_real: real == null ? null : real / P };
  }
  return { ...out, preco: P, preco_informado: preco != null, r_p50: r.p50, r_real_p50: r.real_p50, fator_km: fatorKm, km_referencia: kmReferencia, multiplicador: mult };
}
