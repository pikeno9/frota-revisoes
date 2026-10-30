// Leituras e validações da Revenda para as rotas.
import { lerPremissas, premissasComData, ultimoEstudo, anunciosRecentes, linhasFipe, consensoDoModelo } from './dados.js';
import { projetar, indexarFipe, anoZeroKm, idade, ZERO_KM, CANAIS } from './estudo.js';
import { projetarConsenso, FIM } from './consenso.js';

export const CATEGORIA = { 5: 'combustao', 4: 'eletrico', 6: 'hibrido' };
import { PREMISSAS_INICIAIS } from '../migracoes/003-revenda.js';

export const KMS_RESUMO = [30000, 70000];
export const MESES_VENDA = 12;   // a venda guarda só a data: o previsto usa o prazo padrão
const CAMPOS_MODELO = ['fipe_marca', 'fipe_modelo', 'fipe_combustivel', 'fipe_modelo_ref', 'mobiauto_caminho', 'mobiauto_versao'];

export class ErroRevenda extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

const porSlug = (db, slug) => db.prepare('SELECT * FROM modelos WHERE slug = ?').get(String(slug ?? ''));
const parametros = m => Object.fromEntries(CAMPOS_MODELO.map(k => [k, m[k]]));

// Percentual do FIPE 0 km no P50 pelo consenso (o do site; o KPIs lê projecao sem base=consenso).
function pctP50(dados, meses, km, canal, premissas) {
  try { return projetarConsenso(dados, { meses, km, canal }, premissas).p50.pct; } catch { return null; }
}

// O que pagamos no zero km: o preço de compra cadastrado; sem ele, o FIPE 0 km do estudo.
function compra(m, d) {
  if (m.preco_compra) return { valor: m.preco_compra, origem: 'compra', em: m.preco_compra_em };
  return d?.fipe_0km_atual ? { valor: d.fipe_0km_atual, origem: 'fipe', em: null } : null;
}

// Fim de contrato (12 meses, 70 mil km), atacado, P50 do consenso, em R$ e sobre a compra e o FIPE 0 km.
function fimDeContrato(d, c, premissas) {
  if (!d) return null;
  try {
    const p = projetarConsenso(d, { ...FIM, canal: 'atacado', preco: c?.valor ?? null }, premissas);
    return { valor: p.p50.nominal, pct_compra: c ? p.p50.nominal / c.valor : null, pct_fipe: d.fipe_0km_atual ? p.p50.nominal / d.fipe_0km_atual : null };
  } catch { return null; }
}

export function modelosRevenda(db) {
  const premissas = lerPremissas(db);
  const todos = db.prepare("SELECT * FROM modelos WHERE ativo = 1 ORDER BY origem = 'frota' DESC, qtd_frota DESC, nome").all();
  return todos.map(m => {
    const e = ultimoEstudo(db, m.id);
    const d = e?.dados;
    const c = compra(m, d);
    // De onde veio a desvalorização de 12 meses: do próprio código FIPE, do código de referência ou da mediana dos outros.
    const r12 = d?.r?.[12]?.emprestado ?? null;
    const cs = d?.consenso;
    return {
      origem_r12: r12, ref_nome: r12 === 'ref' ? (todos.find(x => x.fipe_modelo === m.fipe_modelo_ref)?.nome ?? null) : null, ref_codigo: r12 === 'ref' ? m.fipe_modelo_ref : null,
      id: m.id, slug: m.slug, montadora: m.montadora, nome: m.nome, origem: m.origem, qtd_frota: m.qtd_frota,
      categoria: CATEGORIA[m.fipe_combustivel] ?? null,
      tem_fipe: m.fipe_modelo != null, data_estudo: e?.calculado_em ?? null,
      compra: c, fim_contrato: fimDeContrato(d, c, premissas),
      p50_12m: d ? Object.fromEntries(KMS_RESUMO.map(k => [k, pctP50(d, 12, k, 'atacado', premissas)])) : null,
      fator_10mil: cs?.regressao?.fator_10mil ?? d?.km.fator_10mil ?? null,
      n_anuncios: cs ? cs.n_usados : d?.km.n ?? 0,
      fontes: cs ? Object.fromEntries(Object.entries(cs.contagem).map(([f, x]) => [f, x.usados])) : null,
      criterios_ok: cs ? cs.criterios.filter(x => x.ok).length : 0,
      r_emprestado: d?.r_emprestado ?? null, km_emprestado: cs?.regressao ? false : d?.km_emprestado ?? null,
    };
  });
}

export function modeloRevenda(db, slug, hoje) {
  const m = porSlug(db, slug);
  if (!m) return null;
  const e = ultimoEstudo(db, m.id);
  const idx = indexarFipe(m.fipe_modelo ? linhasFipe(db, m.fipe_modelo) : []);
  const serie_fipe = [...idx.keys()].sort().map(referencia => {
    const p = idx.get(referencia);
    const ano = anoZeroKm(p);
    return { referencia, zero_km: p.get(ZERO_KM) ?? null, ano_anterior: ano == null ? null : p.get(ano - 1) ?? null };
  });
  // Os anúncios do estudo, de todas as fontes, com o que o consenso fez com cada um.
  const data = e?.calculado_em ?? hoje;
  const status = e?.dados?.consenso && m.fipe_modelo ? consensoDoModelo(db, m, e.dados, undefined, data).status : new Map();
  const c = compra(m, e?.dados);
  const premissas = lerPremissas(db);
  return {
    id: m.id, slug: m.slug, montadora: m.montadora, nome: m.nome, versao: m.versao, parametros: parametros(m),
    categoria: CATEGORIA[m.fipe_combustivel] ?? null,
    estudo: e ? { calculado_em: e.calculado_em, ...e.dados } : null,
    compra: c, fim_contrato: fimDeContrato(e?.dados, c, premissas),
    serie_fipe,
    anuncios: anunciosRecentes(db, m.id, data).map(a => ({
      ano_modelo: a.ano_modelo, km: a.km, preco: a.preco, idade: idade(a.ano_modelo, data), fonte: a.fonte,
      status: status.get(a.id_externo) ?? null, url: a.url,
    })),
  };
}

const inteiro = (v, min, max) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};

// q: query string. Erros de entrada → 400; modelo ou estudo ausente → 404; estudo sem dado → 422.
export function projecao(db, q) {
  // meses ausente vale 12; meses vazio ("meses=") é entrada inválida, não "usar o padrão".
  const meses = q.meses === undefined ? 12 : inteiro(q.meses, 1, 24);
  const km = inteiro(q.km, 0, 300000);
  const canal = q.canal ?? 'atacado';
  const preco = q.preco === undefined || q.preco === '' ? null : Number(q.preco);
  if (!q.modelo) throw new ErroRevenda(400, 'informe o modelo');
  if (meses === undefined || Number.isNaN(meses)) throw new ErroRevenda(400, 'meses entre 1 e 24');
  if (km === undefined || Number.isNaN(km)) throw new ErroRevenda(400, 'km entre 0 e 300.000');
  if (!CANAIS.includes(canal)) throw new ErroRevenda(400, 'canal deve ser atacado, varejo ou motorista');
  if (preco !== null && !(preco > 0 && preco <= 2000000)) throw new ErroRevenda(400, 'preço inválido');
  const m = porSlug(db, q.modelo);
  if (!m) throw new ErroRevenda(404, 'modelo não encontrado');
  const e = ultimoEstudo(db, m.id);
  if (!e) throw new ErroRevenda(404, 'modelo sem estudo');
  const premissas = lerPremissas(db);
  // base=consenso: a projeção do site (consenso de todas as fontes, compra cadastrada como base do %).
  // Sem base: a de antes, só FIPE e Mobiauto, que o KPIs lê.
  const consenso = q.base === 'consenso';
  if (q.base !== undefined && !consenso) throw new ErroRevenda(400, 'base deve ser consenso');
  let p;
  try {
    p = consenso
      ? projetarConsenso(e.dados, { meses, km, canal, preco: preco ?? m.preco_compra ?? null }, premissas)
      : projetar(e.dados, { meses, km, canal, preco }, premissas);
  } catch (x) { throw new ErroRevenda(422, x.message); }
  const { p10, p50, p90, preco: P, preco_informado, ...uso } = p;
  const d = e.dados;
  const cs = consenso ? d.consenso : null;
  return {
    modelo: m.slug, meses, km, canal, preco: P, preco_informado, p10, p50, p90,
    ...(consenso ? { base: 'consenso', preco_origem: preco != null ? 'informado' : m.preco_compra ? 'compra' : 'fipe' } : {}),
    insumos: {
      ...uso, data_estudo: e.calculado_em, referencia_fipe: d.referencia, n_anuncios: cs ? cs.n_usados : d.km.n, km_tipico: d.km.km_tipico,
      km_tipico_emprestado: d.km.km_tipico_emprestado ?? false, km_motivo: d.km.motivo ?? null, sem_faixa: d.residuos?.sem_faixa ?? false,
      fator_10mil: cs?.regressao?.fator_10mil ?? d.km.fator_10mil, r_emprestado: d.r_emprestado, km_emprestado: d.km_emprestado, premissas,
      ...(cs ? { consenso: cs.consenso, criterios_ok: cs.criterios.filter(x => x.ok).length, fontes: Object.keys(cs.contagem) } : {}),
    },
  };
}

// Fontes de anúncios por modelo e o formato do caminho em cada uma.
export const FONTES_ANUNCIOS = {
  mobiauto: { rotulo: 'Mobiauto', caminho: /^[a-z0-9-]+\/[a-z0-9-]+$/, formato: 'marca/modelo' },
  napista: { rotulo: 'NaPista', caminho: /^[a-z0-9-]+(\/[a-z0-9-]+){1,3}$/, formato: 'sp/marca/modelo' },
};

const fontesDoModelo = (db, id) => Object.fromEntries(Object.keys(FONTES_ANUNCIOS).map(f => {
  const r = db.prepare('SELECT caminho, versao FROM fontes_modelo WHERE modelo_id = ? AND fonte = ?').get(id, f);
  return [f, r ? { caminho: r.caminho, versao: r.versao } : null];
}));

export function premissasEModelos(db) {
  return {
    premissas: premissasComData(db),
    modelos: db.prepare("SELECT * FROM modelos ORDER BY ativo DESC, origem = 'frota' DESC, nome").all()
      .map(m => ({
        id: m.id, slug: m.slug, nome: m.nome, origem: m.origem, ativo: m.ativo, ...parametros(m), fontes: fontesDoModelo(db, m.id),
        preco_compra: m.preco_compra, preco_compra_em: m.preco_compra_em,
        preco_compra_por: m.preco_compra_por == null ? null : db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(m.preco_compra_por)?.nome ?? null,
      })),
  };
}

// corpo: { mobiauto: { caminho, versao } | null, napista: ... }. null tira o modelo da fonte.
// A Mobiauto também fica nas colunas antigas de modelos, que a tela de premissas de antes lia.
export function salvarFontesModelo(db, id, corpo) {
  const n = Number(id);
  const m = Number.isInteger(n) ? db.prepare('SELECT * FROM modelos WHERE id = ?').get(n) : null;
  if (!m) throw new ErroRevenda(404, 'modelo não encontrado');
  const b = corpo ?? {};
  const novos = {};
  for (const [f, v] of Object.entries(b)) {
    const def = FONTES_ANUNCIOS[f];
    if (!def) throw new ErroRevenda(400, `fonte desconhecida: ${f}`);
    if (v === null || !String(v?.caminho ?? '').trim()) { novos[f] = null; continue; }
    const caminho = String(v.caminho).trim();
    if (!def.caminho.test(caminho)) throw new ErroRevenda(400, `caminho da ${def.rotulo} no formato ${def.formato}`);
    const versao = v.versao == null || v.versao === '' ? null : v.versao;
    if (versao !== null) {
      if (typeof versao !== 'string' || versao.length > 120) throw new ErroRevenda(400, `versão da ${def.rotulo} inválida`);
      try { new RegExp(versao, 'i'); } catch { throw new ErroRevenda(400, `versão da ${def.rotulo} não é uma expressão válida`); }
    }
    novos[f] = { caminho, versao };
  }
  const del = db.prepare('DELETE FROM fontes_modelo WHERE modelo_id = ? AND fonte = ?');
  const ins = db.prepare(`INSERT INTO fontes_modelo (modelo_id, fonte, caminho, versao) VALUES (?, ?, ?, ?)
    ON CONFLICT (modelo_id, fonte) DO UPDATE SET caminho = excluded.caminho, versao = excluded.versao`);
  for (const [f, v] of Object.entries(novos)) {
    if (v) ins.run(m.id, f, v.caminho, v.versao); else del.run(m.id, f);
    if (f === 'mobiauto') db.prepare('UPDATE modelos SET mobiauto_caminho = ?, mobiauto_versao = ? WHERE id = ?').run(v?.caminho ?? null, v?.versao ?? null, m.id);
  }
  return fontesDoModelo(db, m.id);
}

// Só as chaves conhecidas, números de 0 a 200. Só a que mudou ganha data nova.
export function salvarPremissas(db, corpo, usuarioId = null) {
  const entradas = Object.entries(corpo ?? {});
  if (!entradas.length) throw new ErroRevenda(400, 'nenhuma premissa enviada');
  for (const [k, v] of entradas) {
    if (!Object.hasOwn(PREMISSAS_INICIAIS, k)) throw new ErroRevenda(400, `premissa desconhecida: ${k}`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 200) throw new ErroRevenda(400, `${k} deve ser um número entre 0 e 200`);
  }
  const upd = db.prepare("UPDATE premissas SET valor = ?, atualizado_em = datetime('now'), usuario_id = ? WHERE chave = ? AND valor <> ?");
  for (const [k, v] of entradas) upd.run(v, usuarioId, k, v);
  return premissasComData(db);
}

export function salvarParametrosModelo(db, id, corpo, usuarioId = null) {
  const n = Number(id);
  const m = Number.isInteger(n) ? db.prepare('SELECT * FROM modelos WHERE id = ?').get(n) : null;
  if (!m) throw new ErroRevenda(404, 'modelo não encontrado');
  const b = { ...(corpo ?? {}) };
  // Preço de compra: valor, data e quem mudou; só grava quando muda.
  if ('preco_compra' in b) {
    const v = b.preco_compra === null || b.preco_compra === '' ? null : Number(b.preco_compra);
    if (v !== null && !(Number.isFinite(v) && v >= 1000 && v <= 2000000)) throw new ErroRevenda(400, 'preço de compra inválido');
    if (v !== m.preco_compra) db.prepare("UPDATE modelos SET preco_compra = ?, preco_compra_em = datetime('now'), preco_compra_por = ? WHERE id = ?").run(v, usuarioId, m.id);
    delete b.preco_compra;
  }
  const novo = parametros(m);
  for (const k of Object.keys(b)) if (!CAMPOS_MODELO.includes(k)) throw new ErroRevenda(400, `campo desconhecido: ${k}`);
  for (const k of ['fipe_marca', 'fipe_modelo', 'fipe_modelo_ref']) {
    if (!(k in b)) continue;
    const v = inteiro(b[k], 1, 999999);
    if (Number.isNaN(v)) throw new ErroRevenda(400, `${k} inválido`);
    novo[k] = v ?? null;
  }
  if ('fipe_combustivel' in b) {
    if (b.fipe_combustivel !== null && ![4, 5, 6].includes(b.fipe_combustivel)) throw new ErroRevenda(400, 'combustível deve ser 5 (Flex), 4 (Elétrico) ou 6 (Híbrido)');
    novo.fipe_combustivel = b.fipe_combustivel;
  }
  if ('mobiauto_caminho' in b) {
    if (b.mobiauto_caminho !== null && !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(String(b.mobiauto_caminho))) throw new ErroRevenda(400, 'caminho da Mobiauto no formato marca/modelo');
    novo.mobiauto_caminho = b.mobiauto_caminho;
  }
  if ('mobiauto_versao' in b) {
    if (b.mobiauto_versao !== null) {
      if (typeof b.mobiauto_versao !== 'string' || b.mobiauto_versao.length > 80) throw new ErroRevenda(400, 'versão da Mobiauto inválida');
      try { new RegExp(b.mobiauto_versao, 'i'); } catch { throw new ErroRevenda(400, 'versão da Mobiauto não é uma expressão válida'); }
    }
    novo.mobiauto_versao = b.mobiauto_versao || null;
  }
  db.prepare(`UPDATE modelos SET ${CAMPOS_MODELO.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...CAMPOS_MODELO.map(k => novo[k] ?? null), m.id);
  if ('mobiauto_caminho' in b || 'mobiauto_versao' in b) {
    if (novo.mobiauto_caminho) {
      db.prepare(`INSERT INTO fontes_modelo (modelo_id, fonte, caminho, versao) VALUES (?, 'mobiauto', ?, ?)
        ON CONFLICT (modelo_id, fonte) DO UPDATE SET caminho = excluded.caminho, versao = excluded.versao`).run(m.id, novo.mobiauto_caminho, novo.mobiauto_versao ?? null);
    } else db.prepare("DELETE FROM fontes_modelo WHERE modelo_id = ? AND fonte = 'mobiauto'").run(m.id);
  }
  return novo;
}

// AAAA-MM-DD que existe no calendário (2026-02-31 não passa: a data não volta igual).
function dataReal(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const t = Date.parse(`${data}T12:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === data;
}

export function registrarVenda(db, corpo, hoje, usuarioId = null) {
  const b = corpo ?? {};
  const placa = String(b.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) throw new ErroRevenda(400, 'placa inválida');
  const m = porSlug(db, b.modelo);
  if (!m) throw new ErroRevenda(400, 'modelo não encontrado');
  const data = String(b.data ?? '');
  if (!dataReal(data) || data > hoje) throw new ErroRevenda(400, 'data inválida');
  const km = inteiro(b.km, 0, 500000);
  if (km === undefined || Number.isNaN(km)) throw new ErroRevenda(400, 'km inválido');
  const preco = Number(b.preco);
  if (!(preco >= 1000 && preco <= 2000000)) throw new ErroRevenda(400, 'preço inválido');
  if (!CANAIS.includes(b.canal)) throw new ErroRevenda(400, 'canal deve ser atacado, varejo ou motorista');
  const obs = b.obs == null || b.obs === '' ? null : String(b.obs).slice(0, 200);
  const r = db.prepare('INSERT INTO vendas (placa, modelo_id, data, km, preco, canal, obs, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(placa, m.id, data, km, preco, b.canal, obs, usuarioId);
  return Number(r.lastInsertRowid);
}

// Cada venda com o previsto pelo estudo vigente na data (P50, 12 meses, consenso a partir do FIPE do zero km).
export function listarVendas(db) {
  const premissas = lerPremissas(db);
  return db.prepare('SELECT v.*, m.slug, m.nome, u.nome AS por FROM vendas v JOIN modelos m ON m.id = v.modelo_id LEFT JOIN usuarios u ON u.id = v.usuario_id ORDER BY v.data DESC, v.id DESC').all().map(v => {
    const e = ultimoEstudo(db, v.modelo_id, v.data);
    let previsto = null;
    try { previsto = e ? projetarConsenso(e.dados, { meses: MESES_VENDA, km: v.km, canal: v.canal }, premissas).p50.nominal : null; } catch { previsto = null; }
    return {
      id: v.id, placa: v.placa, slug: v.slug, nome: v.nome, data: v.data, km: v.km, preco: v.preco, canal: v.canal, obs: v.obs, por: v.por ?? null,
      previsto, diferenca: previsto ? (v.preco - previsto) / previsto : null, data_estudo: e?.calculado_em ?? null,
    };
  });
}
