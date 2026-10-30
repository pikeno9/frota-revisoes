// O estudo do fim de contrato (spec de 29/10, seção 4), em funções puras: junta os anúncios de
// todas as fontes, tira repetidos, leilão e fora de propósito, ajusta uma regressão conjunta e
// calcula os critérios para 12 meses e 70 mil km. O consenso é a mediana dos critérios válidos.
// Tudo em "base FIPE": o preço de anúncio dividido pela relação anúncio/FIPE da própria fonte.
import { minimosQuadrados, mediana, quantil, idade, interpolarR, projetar } from './estudo.js';

export const FIM = { meses: 12, km: 70000 };
export const MIN_RETA = 30;          // anúncios usados na regressão conjunta
export const MIN_COMPARAVEIS = 10;   // anúncios com peso nos comparáveis de uma fonte
export const RAIO_KM = 30000;        // 70 mil vale 1; 40 ou 100 mil, zero
export const SIGMAS_FORA = 3;
export const SIGMAS_LEILAO = 2;      // abaixo disso, sem informação de leilão: possível leilão
export const MIN_DUMMY = 5;          // fonte ou tipo de vendedor com menos anúncios não ganha coeficiente
const MAD_PARA_DESVIO = 1.4826;

export const pesoKm = (km, alvo = FIM.km, raio = RAIO_KM) => Math.max(0, 1 - Math.abs(km - alvo) / raio);

export function medianaPonderada(pares) {
  const s = pares.filter(([v, w]) => Number.isFinite(v) && w > 0).sort((a, b) => a[0] - b[0]);
  const total = s.reduce((t, [, w]) => t + w, 0);
  if (!total) return null;
  let acc = 0;
  for (const [v, w] of s) { acc += w; if (acc >= total / 2) return v; }
  return s.at(-1)[0];
}

// O mesmo carro em duas fontes (ou duas vezes na mesma): mesmo ano, mesmo km e preço até 1% acima
// do mais barato do grupo. Fica o que diz se é de leilão; empatado, o primeiro.
export function deduplicar(anuncios) {
  const grupos = new Map();
  for (const a of anuncios) {
    const k = `${a.ano_modelo}|${a.km}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a);
  }
  const lista = [];
  let duplicados = 0;
  for (const g of grupos.values()) {
    g.sort((x, y) => x.preco - y.preco);
    let i = 0;
    while (i < g.length) {
      let j = i + 1;
      while (j < g.length && g[j].preco <= g[i].preco * 1.01) j++;
      const bloco = g.slice(i, j);
      lista.push(bloco.find(a => a.leilao != null) ?? bloco[0]);
      duplicados += bloco.length - 1;
      i = j;
    }
  }
  return { lista, duplicados };
}

// Tipo de vendedor para a regressão. A Mobiauto gravada antes de 30/10 não tem o tipo: com nome
// de loja é loja, sem nome é particular. Fora isso, sem tipo fica sem coeficiente próprio.
export const tipoDe = a => a.tipo_vendedor ?? (a.fonte === 'mobiauto' ? (a.loja ? 'loja' : 'particular') : 'sem');

// Colunas da regressão: constante, idade, km/10 mil e uma por fonte e por tipo de vendedor quando há
// anúncios suficientes dos dois lados. A base é a fonte mais comum e, no tipo, a loja.
function desenho(anuncios, hoje, campos) {
  const valor = (a, campo) => (campo === 'fonte' ? a.fonte : tipoDe(a));
  const n = anuncios.length;
  const dummies = [];
  for (const campo of campos) {
    const m = new Map();
    for (const a of anuncios) { const v = valor(a, campo); m.set(v, (m.get(v) ?? 0) + 1); }
    const ordem = [...m].sort((x, y) => y[1] - x[1]);
    const base = campo === 'tipo_vendedor' && (m.get('loja') ?? 0) >= MIN_DUMMY ? 'loja' : ordem[0]?.[0];
    for (const [v, q] of ordem) if (v !== base && v !== 'sem' && q >= MIN_DUMMY && n - q >= MIN_DUMMY) dummies.push([campo, v]);
  }
  const X = anuncios.map(a => [1, idade(a.ano_modelo, hoje), a.km / 10000, ...dummies.map(([campo, v]) => (valor(a, campo) === v ? 1 : 0))]);
  return { X, y: anuncios.map(a => Math.log(a.preco)), dummies };
}

// Com fonte e tipo juntos a conta pode não ter solução (uma fonte só com um tipo de vendedor, por
// exemplo): tenta sem o tipo e depois sem a fonte antes de desistir.
function ajustar(anuncios, hoje) {
  for (const campos of [['fonte', 'tipo_vendedor'], ['fonte'], []]) {
    const { X, y, dummies } = desenho(anuncios, hoje, campos);
    try {
      const beta = minimosQuadrados(X, y);
      const residuos = X.map((l, i) => y[i] - l.reduce((s, v, k) => s + v * beta[k], 0));
      return { beta, dummies, residuos };
    } catch (e) {
      if (e.codigo !== 'SEM_VARIACAO' || !campos.length) throw e;
    }
  }
  throw new Error('inalcançável');
}

const coef = (aj, campo, v) => {
  const i = aj.dummies.findIndex(([c, x]) => c === campo && x === v);
  return i < 0 ? 0 : aj.beta[3 + i];
};

// Relação anúncio/FIPE: anúncios de até 1,5 ano sobre a FIPE do mesmo ano-modelo na referência atual.
function relacoes(anuncios, fipeAtual, hoje) {
  const r = anuncios.filter(a => idade(a.ano_modelo, hoje) <= 1.5 && fipeAtual?.get(a.ano_modelo)).map(a => ({ fonte: a.fonte, r: a.preco / fipeAtual.get(a.ano_modelo) }));
  const geral = mediana(r.map(x => x.r));
  const porFonte = {};
  for (const f of new Set(r.map(x => x.fonte))) {
    const v = r.filter(x => x.fonte === f).map(x => x.r);
    porFonte[f] = v.length >= MIN_DUMMY ? mediana(v) : geral;
  }
  return { geral, porFonte };
}

// Critério FIPE: o cálculo de hoje (queda de 12 meses × ajuste de km do estudo da Mobiauto).
export function criterioFipe(legado, { meses = FIM.meses, km = FIM.km } = {}) {
  const P = legado?.fipe_0km_atual;
  if (!P) return null;
  let r;
  try { r = interpolarR(legado.r, meses); } catch { r = null; }
  if (!r?.p50) return null;
  const { c, km_tipico } = legado.km ?? {};
  const kmRef = km_tipico == null ? null : km_tipico * meses / 12;
  const fator = c && kmRef != null ? Math.exp(c * (km - kmRef) / 10000) : 1;
  return P * r.p50 * fator;
}

// anuncios: os do modelo, de todas as fontes, vistos nos últimos 60 dias.
// fipeAtual: Map ano-modelo → FIPE na referência mais nova. legado: o estudo de hoje (calcularEstudo + emprestar).
export function calcularConsenso({ anuncios: brutos, fipeAtual, legado, hoje }) {
  const fipe0 = legado?.fipe_0km_atual ?? null;
  const validos = brutos.filter(a => Number.isFinite(a.ano_modelo) && Number.isFinite(a.km) && a.km >= 0 && Number.isFinite(a.preco) && a.preco > 0)
    .map(a => ({ ...a, fonte: a.fonte ?? String(a.id_externo).split(':')[0] }));
  const fontes = [...new Set(validos.map(a => a.fonte))].sort();
  const contagem = Object.fromEntries(fontes.map(f => [f, { lidos: 0, duplicados: 0, leilao: 0, possivel_leilao: 0, fora: 0, usados: 0 }]));
  for (const a of validos) contagem[a.fonte].lidos++;
  const { lista, duplicados } = deduplicar(validos);
  const ficou = new Set(lista);
  for (const a of validos) if (!ficou.has(a)) contagem[a.fonte].duplicados++;
  const status = new Map(validos.map(a => [a.id_externo, ficou.has(a) ? null : 'duplicado']));
  const semLeilao = lista.filter(a => { if (a.leilao === 1) { contagem[a.fonte].leilao++; status.set(a.id_externo, 'leilao'); return false; } return true; });

  let aj = null, usados = semLeilao, motivo = null;
  if (semLeilao.length >= MIN_RETA) {
    try {
      const primeiro = ajustar(semLeilao, hoje);
      const centro = mediana(primeiro.residuos);
      const sigma = MAD_PARA_DESVIO * mediana(primeiro.residuos.map(e => Math.abs(e - centro)));
      if (sigma > 1e-12) {
        usados = semLeilao.filter((a, i) => {
          const e = primeiro.residuos[i] - centro;
          if (a.leilao == null && e < -SIGMAS_LEILAO * sigma) { contagem[a.fonte].possivel_leilao++; status.set(a.id_externo, 'possivel_leilao'); return false; }
          if (Math.abs(e) > SIGMAS_FORA * sigma) { contagem[a.fonte].fora++; status.set(a.id_externo, 'fora'); return false; }
          return true;
        });
      }
      aj = usados.length >= MIN_RETA ? ajustar(usados, hoje) : null;
      if (!aj) motivo = 'poucos anúncios depois dos descartes';
    } catch (e) {
      if (e.codigo !== 'SEM_VARIACAO') throw e;
      motivo = 'anúncios sem variação de idade ou de km';
    }
  } else motivo = 'poucos anúncios';
  for (const a of usados) { contagem[a.fonte].usados++; if (!status.get(a.id_externo)) status.set(a.id_externo, 'usado'); }

  const rel = relacoes(usados, fipeAtual, hoje);
  const relDe = f => rel.porFonte[f] ?? rel.geral ?? 1;
  const [a0, b, c] = aj ? aj.beta : [null, null, null];

  const criterios = [];
  const fipe = criterioFipe(legado);
  criterios.push({ tipo: 'fipe', fonte: 'fipe', n: legado?.n_fipe ?? 0, valor: fipe, ok: fipe != null, motivo: fipe == null ? 'sem FIPE' : null });

  // Reta: o previsto em 1 ano e 70 mil km para cada fonte (vendedor da base), em base FIPE, ponderado pelos anúncios da fonte.
  if (aj) {
    let soma = 0, peso = 0;
    for (const f of fontes) {
      const n = contagem[f].usados;
      if (!n) continue;
      const previsto = Math.exp(a0 + b * 1 + c * FIM.km / 10000 + coef(aj, 'fonte', f));
      soma += n * previsto / relDe(f);
      peso += n;
    }
    criterios.push({ tipo: 'reta', fonte: 'todas', n: usados.length, valor: soma / peso, ok: true, motivo: null });
  } else criterios.push({ tipo: 'reta', fonte: 'todas', n: usados.length, valor: null, ok: false, motivo });

  // Comparáveis: anúncios de 6 a 18 meses, levados a 1 ano e 70 mil km pela regressão, peso pelo km.
  for (const f of fontes) {
    const perto = usados.filter(a => a.fonte === f && pesoKm(a.km) > 0 && (x => x >= 0.5 && x <= 1.5)(idade(a.ano_modelo, hoje)));
    const pares = perto.map(a => {
      const ajuste = aj ? Math.exp(b * (1 - idade(a.ano_modelo, hoje)) + c * (FIM.km - a.km) / 10000) : 1;
      return [a.preco * ajuste / relDe(f), pesoKm(a.km)];
    });
    const ok = perto.length >= MIN_COMPARAVEIS;
    criterios.push({ tipo: 'comparaveis', fonte: f, n: perto.length, valor: ok ? medianaPonderada(pares) : null, ok, motivo: ok ? null : 'poucos anúncios perto de 1 ano e 70 mil km' });
  }

  for (const x of criterios) x.pct = x.valor != null && fipe0 ? x.valor / fipe0 : null;
  const validosCrit = criterios.filter(x => x.ok && x.valor != null);
  const consenso = validosCrit.length ? mediana(validosCrit.map(x => x.valor)) : null;
  const residuos = aj ? { q10: quantil(aj.residuos, 0.1), q90: quantil(aj.residuos, 0.9), sem_faixa: false } : null;
  return {
    fim: FIM, fipe_0km: fipe0, consenso, pct_fipe: consenso != null && fipe0 ? consenso / fipe0 : null,
    ajuste: consenso != null && fipe ? consenso / fipe : 1, criterios, contagem, duplicados,
    n_usados: usados.length, anuncio_sobre_fipe: rel.geral, relacao_por_fonte: rel.porFonte, residuos,
    regressao: aj ? {
      a: a0, b, c, fator_10mil: Math.exp(c) - 1, fator_ano: Math.exp(b) - 1,
      // Efeito de cada fonte e tipo de vendedor contra a base (a fonte e o tipo com mais anúncios).
      premios: aj.dummies.map(([campo, v], i) => ({ campo, valor: v, efeito: Math.exp(aj.beta[3 + i]) - 1 })),
      base_fonte: fontes.slice().sort((x, y) => contagem[y].usados - contagem[x].usados)[0] ?? null,
    } : null,
    motivo,
    status,
  };
}

// Projeção do site (não a do KPIs): o mercado parte do FIPE 0 km, a curva da FIPE dá a forma no
// tempo e no km, e o ajuste do consenso (consenso ÷ critério FIPE no fim de contrato) corrige o nível.
// preco: o preço de compra, só para o percentual; o valor do carro não depende do que pagamos.
export function projetarConsenso(dados, { meses, km, canal, preco = null }, premissas) {
  const k = dados.consenso?.ajuste ?? 1;
  const base = projetar({
    ...dados,
    residuos: dados.consenso?.residuos ?? dados.residuos,
    anuncio_sobre_fipe: dados.consenso?.anuncio_sobre_fipe ?? dados.anuncio_sobre_fipe,
  }, { meses, km, canal, preco: null }, premissas);
  const P = preco ?? base.preco;
  const out = {};
  for (const q of ['p10', 'p50', 'p90']) {
    const nominal = base[q].pct * base.preco * k;
    const real = base[q].pct_real == null ? null : base[q].pct_real * base.preco * k;
    out[q] = { nominal: Math.round(nominal), real: real == null ? null : Math.round(real), pct: nominal / P, pct_real: real == null ? null : real / P };
  }
  const { p10, p50, p90, preco: fipe0, preco_informado, ...uso } = base;
  return { ...out, ...uso, preco: P, preco_informado: preco != null, fipe_0km: fipe0, ajuste: k };
}
