// Leituras para as telas. Tudo calculado a partir das faixas de vigência.

export const REFERENCIAS_KM = [30000, 70000];

const soma = l => Math.round(l.reduce((s, v) => s + v.valor, 0) * 100) / 100;
const vigentesEm = (vigs, d) => vigs.filter(v => v.vigente_de <= d && (!v.vigente_ate || v.vigente_ate >= d));
const datasDe = vigs => [...new Set(vigs.map(v => v.vigente_de))].sort();

export function seriePlano(vigs) {
  return datasDe(vigs).map(d => ({ data: d, total: soma(vigentesEm(vigs, d)) }));
}

// Variação do plano na última mudança, só com as revisões que existiam nas duas datas.
export function variacao(vigs) {
  const datas = datasDe(vigs);
  if (datas.length < 2) return null;
  const d1 = datas.at(-1), d0 = datas.at(-2);
  const antes = new Map(vigentesEm(vigs, d0).map(v => [v.ordem, v.valor]));
  let de = 0, para = 0;
  for (const v of vigentesEm(vigs, d1)) if (antes.has(v.ordem)) { de += antes.get(v.ordem); para += v.valor; }
  if (!de || de === para) return null;
  return { de, para, pct: (para - de) / de, em: d1 };
}

function cores(db) {
  return new Map(db.prepare('SELECT id FROM modelos ORDER BY id').all().map((m, i) => [m.id, i]));
}

function resumir(db, m, cor) {
  const vigs = db.prepare('SELECT * FROM vigencias WHERE modelo_id = ? ORDER BY ordem, vigente_de').all(m.id);
  const atuais = vigs.filter(v => !v.vigente_ate);
  return {
    id: m.id, slug: m.slug, montadora: m.montadora, nome: m.nome, versao: m.versao, origem: m.origem,
    qtd_frota: m.qtd_frota, ativo: m.ativo, coletor: m.coletor, parametros: JSON.parse(m.parametros),
    cor: cor.get(m.id), total: soma(atuais), revisoes: atuais.length,
    km_max: atuais.reduce((x, v) => Math.max(x, v.km), 0),
    variacao: variacao(vigs), serie: seriePlano(vigs), conferir: atuais.some(v => v.conferir === 1),
    _vigs: vigs,
  };
}

const limpar = ({ _vigs, ...r }) => r;

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
  return limpar(r);
}

export function comparar(db) {
  const cor = cores(db);
  const modelos = db.prepare("SELECT * FROM modelos WHERE ativo = 1 ORDER BY origem = 'frota' DESC, qtd_frota DESC, nome").all().map(m => resumir(db, m, cor));
  const atuaisDe = m => m._vigs.filter(v => !v.vigente_ate).sort((a, b) => a.km - b.km);
  const kms = [...new Set([0, ...REFERENCIAS_KM, ...modelos.flatMap(m => atuaisDe(m).map(v => v.km))])].sort((a, b) => a - b);
  const acumulado = (atuais, km) => soma(atuais.filter(v => v.km <= km));
  return {
    kms, referencias: REFERENCIAS_KM,
    modelos: modelos.map(m => {
      const atuais = atuaisDe(m);
      return {
        id: m.id, slug: m.slug, nome: m.nome, origem: m.origem, cor: m.cor, total: m.total, km_max: m.km_max,
        valores: kms.map(k => (k <= m.km_max ? acumulado(atuais, k) : null)),
        ate: REFERENCIAS_KM.map(k => (k <= m.km_max ? acumulado(atuais, k) : null)),
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
