// Leituras para as telas. Tudo calculado a partir das faixas de vigência.

// A comparação entre modelos é sempre o custo até 100 mil km.
export const KM_PADRAO = 100000;
export const REFERENCIAS_KM = [30000, 70000, KM_PADRAO];
// A Fiat publica só até a 5ª revisão (50 mil km). Decisão do Enrico (29/10): da 6ª em diante repete a 1ª a 5ª,
// como o KPIs já faz. (O que cada uma troca sugeriria ciclo de 40 mil km; descartado.)
export const CICLO_FIAT = 5;

const soma = l => Math.round(l.reduce((s, v) => s + v.valor, 0) * 100) / 100;
const vigentesEm = (vigs, d) => vigs.filter(v => v.vigente_de <= d && (!v.vigente_ate || v.vigente_ate >= d));
const datasDe = vigs => [...new Set(vigs.map(v => v.vigente_de))].sort();
const porKm = l => [...l].sort((a, b) => a.km - b.km);

export function seriePlano(vigs) {
  return datasDe(vigs).map(d => ({ data: d, total: soma(vigentesEm(vigs, d)) }));
}

// Revisões que faltam até kmAlvo: cada uma copia a publicada no mesmo ponto do ciclo (com ciclo 5: 6ª = 1ª, 10ª = 5ª).
// O passo de km é o da 1ª revisão; a ordem segue a das publicadas.
export function projetar(publicadas, kmAlvo = KM_PADRAO, ciclo = CICLO_FIAT) {
  const pub = porKm(publicadas);
  const n = pub.length;
  if (n < ciclo) return [];
  const passo = pub[0].km;
  const extra = [];
  for (let o = n + 1; o * passo <= kmAlvo; o++) {
    let i = o;
    while (i > n) i -= ciclo;
    extra.push({ ordem: o, km: o * passo, valor: pub[i - 1].valor, base: i, projetada: true });
  }
  return extra;
}

const comProjecao = (m, atuais) => (m.projetar_ciclo ? [...porKm(atuais), ...projetar(atuais)] : porKm(atuais));
const ate100 = l => l.filter(v => v.km <= KM_PADRAO);

// Variação do plano na última mudança de preço de verdade: anda para trás pelos pares de datas
// consecutivas e devolve o primeiro em que o preço das revisões presentes nas duas datas mudou.
// Uma data que só acrescenta revisão nova não esconde uma mudança anterior.
export function variacao(vigs) {
  const datas = datasDe(vigs);
  for (let i = datas.length - 1; i >= 1; i--) {
    const d1 = datas[i], d0 = datas[i - 1];
    const antes = new Map(vigentesEm(vigs, d0).map(v => [v.ordem, v.valor]));
    let de = 0, para = 0;
    for (const v of vigentesEm(vigs, d1)) if (antes.has(v.ordem)) { de += antes.get(v.ordem); para += v.valor; }
    de = soma([{ valor: de }]);
    para = soma([{ valor: para }]);
    if (de && de !== para) return { de, para, pct: (para - de) / de, em: d1 };
  }
  return null;
}

function cores(db) {
  return new Map(db.prepare('SELECT id FROM modelos ORDER BY id').all().map((m, i) => [m.id, i]));
}

function resumir(db, m, cor) {
  const vigs = db.prepare('SELECT * FROM vigencias WHERE modelo_id = ? ORDER BY ordem, vigente_de').all(m.id);
  const atuais = vigs.filter(v => !v.vigente_ate);
  const cem = ate100(comProjecao(m, atuais));
  return {
    id: m.id, slug: m.slug, montadora: m.montadora, nome: m.nome, versao: m.versao, origem: m.origem,
    qtd_frota: m.qtd_frota, ativo: m.ativo, coletor: m.coletor, parametros: JSON.parse(m.parametros),
    cor: cor.get(m.id), total: soma(atuais), revisoes: atuais.length,
    km_max: atuais.reduce((x, v) => Math.max(x, v.km), 0),
    total_100: soma(cem), revisoes_100: cem.filter(v => !v.projetada).length, projetadas_100: cem.filter(v => v.projetada).length,
    variacao: variacao(vigs), serie: seriePlano(vigs), conferir: atuais.some(v => v.conferir === 1),
    serie_100: datasDe(vigs).map(d => ({ data: d, total: soma(ate100(comProjecao(m, vigentesEm(vigs, d)))) })),
    _vigs: vigs, _projetar: !!m.projetar_ciclo,
  };
}

const limpar = ({ _vigs, _projetar, ...r }) => r;

export function modelosResumo(db, { todos = false } = {}) {
  const cor = cores(db);
  const sql = `SELECT * FROM modelos ${todos ? '' : 'WHERE ativo = 1'} ORDER BY origem = 'frota' DESC, qtd_frota DESC, nome`;
  return db.prepare(sql).all().map(m => limpar(resumir(db, m, cor)));
}

export function modeloDetalhe(db, slug) {
  const m = db.prepare('SELECT * FROM modelos WHERE slug = ?').get(slug);
  if (!m) return null;
  const r = resumir(db, m, cores(db));
  const porOrdem = Map.groupBy(r._vigs, v => v.ordem);
  r.revisoes_lista = [...porOrdem.values()].map(faixas => {
    const atual = faixas.find(v => !v.vigente_ate) ?? faixas.at(-1);
    const idx = faixas.indexOf(atual);
    return {
      ordem: atual.ordem, km: atual.km, meses: atual.meses, valor: atual.valor, desde: atual.vigente_de,
      anterior: idx > 0 ? faixas[idx - 1].valor : null, conferir: atual.conferir === 1, atual: !atual.vigente_ate,
      historico: faixas.map(v => ({ de: v.vigente_de, ate: v.vigente_ate, valor: v.valor })),
    };
  }).sort((a, b) => a.ordem - b.ordem);
  r.projecao = r._projetar ? projetar(r._vigs.filter(v => !v.vigente_ate)) : [];
  return limpar(r);
}

export function comparar(db) {
  const cor = cores(db);
  const modelos = db.prepare("SELECT * FROM modelos WHERE ativo = 1 ORDER BY origem = 'frota' DESC, qtd_frota DESC, nome").all().map(m => resumir(db, m, cor));
  const planoDe = m => comProjecao({ projetar_ciclo: m._projetar }, m._vigs.filter(v => !v.vigente_ate));
  const kms = [...new Set([0, ...REFERENCIAS_KM, ...modelos.flatMap(m => planoDe(m).map(v => v.km))])].sort((a, b) => a - b);
  const acumulado = (plano, km) => soma(plano.filter(v => v.km <= km));
  return {
    kms, referencias: REFERENCIAS_KM, km_padrao: KM_PADRAO,
    modelos: modelos.map(m => {
      const plano = planoDe(m);
      const fim = plano.at(-1)?.km ?? 0;
      return {
        id: m.id, slug: m.slug, nome: m.nome, origem: m.origem, cor: m.cor, total: m.total, km_max: m.km_max,
        total_100: m.total_100, projetado_de: m.projetadas_100 ? m.km_max : null, variacao: m.variacao, serie_100: m.serie_100,
        valores: kms.map(k => (k <= fim ? acumulado(plano, k) : null)),
        ate: REFERENCIAS_KM.map(k => (k <= fim ? acumulado(plano, k) : null)),
      };
    }),
  };
}

export function mudancas(db, limite = 30) {
  return db.prepare(`SELECT a.id, a.tipo, a.ordem, a.de, a.para, a.criado_em, m.slug, m.nome
    FROM alertas a JOIN modelos m ON m.id = a.modelo_id
    WHERE a.tipo IN ('mudanca', 'nova_revisao') ORDER BY a.criado_em DESC, a.id DESC LIMIT ?`).all(Math.min(Number(limite) || 30, 200));
}

export function estadoColetas(db) {
  return {
    fontes: db.prepare("SELECT * FROM coletas c WHERE c.fonte <> 'legado' AND c.id = (SELECT MAX(id) FROM coletas c2 WHERE c2.fonte = c.fonte) ORDER BY c.fonte").all(),
    recentes: db.prepare('SELECT * FROM coletas ORDER BY id DESC LIMIT 20').all(),
    pendentes: db.prepare('SELECT a.id, a.tipo, a.ordem, a.de, a.para, a.texto, a.criado_em, m.nome FROM alertas a LEFT JOIN modelos m ON m.id = a.modelo_id WHERE a.enviado_em IS NULL ORDER BY a.id DESC LIMIT 50').all(),
  };
}
