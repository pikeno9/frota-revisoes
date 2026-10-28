// Leituras e validações da Revenda para as rotas.
import { lerPremissas, premissasComData, ultimoEstudo, anunciosRecentes, linhasFipe } from './dados.js';
import { projetar, indexarFipe, anoZeroKm, idade, ZERO_KM, CANAIS } from './estudo.js';
import { PREMISSAS_INICIAIS } from '../migracoes/003-revenda.js';

export const KMS_RESUMO = [30000, 70000];
export const MESES_VENDA = 12;   // a venda guarda só a data: o previsto usa o prazo padrão
const CAMPOS_MODELO = ['fipe_marca', 'fipe_modelo', 'fipe_combustivel', 'fipe_modelo_ref', 'mobiauto_caminho', 'mobiauto_versao'];

export class ErroRevenda extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

const porSlug = (db, slug) => db.prepare('SELECT * FROM modelos WHERE slug = ?').get(String(slug ?? ''));
const parametros = m => Object.fromEntries(CAMPOS_MODELO.map(k => [k, m[k]]));

function pctP50(dados, meses, km, canal, premissas) {
  try { return projetar(dados, { meses, km, canal, preco: dados.fipe_0km_atual ?? 1 }, premissas).p50.pct; } catch { return null; }
}

export function modelosRevenda(db) {
  const premissas = lerPremissas(db);
  return db.prepare("SELECT * FROM modelos WHERE ativo = 1 ORDER BY origem = 'frota' DESC, qtd_frota DESC, nome").all().map(m => {
    const e = ultimoEstudo(db, m.id);
    const d = e?.dados;
    return {
      id: m.id, slug: m.slug, montadora: m.montadora, nome: m.nome, origem: m.origem, qtd_frota: m.qtd_frota,
      tem_fipe: m.fipe_modelo != null, data_estudo: e?.calculado_em ?? null,
      p50_12m: d ? Object.fromEntries(KMS_RESUMO.map(k => [k, pctP50(d, 12, k, 'atacado', premissas)])) : null,
      fator_10mil: d?.km.fator_10mil ?? null, n_anuncios: d?.km.n ?? 0,
      r_emprestado: d?.r_emprestado ?? null, km_emprestado: d?.km_emprestado ?? null,
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
  return {
    id: m.id, slug: m.slug, montadora: m.montadora, nome: m.nome, versao: m.versao, parametros: parametros(m),
    estudo: e ? { calculado_em: e.calculado_em, ...e.dados } : null,
    serie_fipe,
    anuncios: anunciosRecentes(db, m.id, hoje).map(a => ({ ano_modelo: a.ano_modelo, km: a.km, preco: a.preco, idade: idade(a.ano_modelo, hoje) })),
  };
}

const inteiro = (v, min, max) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};

// q: query string. Erros de entrada → 400; modelo ou estudo ausente → 404; estudo sem dado → 422.
export function projecao(db, q) {
  const meses = inteiro(q.meses ?? 12, 1, 24);
  const km = inteiro(q.km, 0, 300000);
  const canal = q.canal ?? 'atacado';
  const preco = q.preco === undefined || q.preco === '' ? null : Number(q.preco);
  if (!q.modelo) throw new ErroRevenda(400, 'informe o modelo');
  if (Number.isNaN(meses)) throw new ErroRevenda(400, 'meses entre 1 e 24');
  if (km === undefined || Number.isNaN(km)) throw new ErroRevenda(400, 'km entre 0 e 300.000');
  if (!CANAIS.includes(canal)) throw new ErroRevenda(400, 'canal deve ser atacado, varejo ou motorista');
  if (preco !== null && !(preco > 0 && preco <= 2000000)) throw new ErroRevenda(400, 'preço inválido');
  const m = porSlug(db, q.modelo);
  if (!m) throw new ErroRevenda(404, 'modelo não encontrado');
  const e = ultimoEstudo(db, m.id);
  if (!e) throw new ErroRevenda(404, 'modelo sem estudo');
  const premissas = lerPremissas(db);
  let p;
  try { p = projetar(e.dados, { meses, km, canal, preco }, premissas); } catch (x) { throw new ErroRevenda(422, x.message); }
  const { p10, p50, p90, preco: P, preco_informado, ...uso } = p;
  const d = e.dados;
  return {
    modelo: m.slug, meses, km, canal, preco: P, preco_informado, p10, p50, p90,
    insumos: {
      ...uso, data_estudo: e.calculado_em, referencia_fipe: d.referencia, n_anuncios: d.km.n, km_tipico: d.km.km_tipico,
      km_tipico_emprestado: d.km.km_tipico_emprestado ?? false, km_motivo: d.km.motivo ?? null, sem_faixa: d.residuos?.sem_faixa ?? false,
      fator_10mil: d.km.fator_10mil, r_emprestado: d.r_emprestado, km_emprestado: d.km_emprestado, premissas,
    },
  };
}

export function premissasEModelos(db) {
  return {
    premissas: premissasComData(db),
    modelos: db.prepare("SELECT * FROM modelos ORDER BY ativo DESC, origem = 'frota' DESC, nome").all()
      .map(m => ({ id: m.id, slug: m.slug, nome: m.nome, origem: m.origem, ativo: m.ativo, ...parametros(m) })),
  };
}

// Só as chaves conhecidas, números de 0 a 200. Só a que mudou ganha data nova.
export function salvarPremissas(db, corpo) {
  const entradas = Object.entries(corpo ?? {});
  if (!entradas.length) throw new ErroRevenda(400, 'nenhuma premissa enviada');
  for (const [k, v] of entradas) {
    if (!Object.hasOwn(PREMISSAS_INICIAIS, k)) throw new ErroRevenda(400, `premissa desconhecida: ${k}`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 200) throw new ErroRevenda(400, `${k} deve ser um número entre 0 e 200`);
  }
  const upd = db.prepare("UPDATE premissas SET valor = ?, atualizado_em = datetime('now') WHERE chave = ? AND valor <> ?");
  for (const [k, v] of entradas) upd.run(v, k, v);
  return premissasComData(db);
}

export function salvarParametrosModelo(db, id, corpo) {
  const n = Number(id);
  const m = Number.isInteger(n) ? db.prepare('SELECT * FROM modelos WHERE id = ?').get(n) : null;
  if (!m) throw new ErroRevenda(404, 'modelo não encontrado');
  const b = corpo ?? {};
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
  return novo;
}

export function registrarVenda(db, corpo, hoje) {
  const b = corpo ?? {};
  const placa = String(b.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) throw new ErroRevenda(400, 'placa inválida');
  const m = porSlug(db, b.modelo);
  if (!m) throw new ErroRevenda(400, 'modelo não encontrado');
  const data = String(b.data ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(`${data}T12:00:00Z`)) || data > hoje) throw new ErroRevenda(400, 'data inválida');
  const km = inteiro(b.km, 0, 500000);
  if (km === undefined || Number.isNaN(km)) throw new ErroRevenda(400, 'km inválido');
  const preco = Number(b.preco);
  if (!(preco >= 1000 && preco <= 2000000)) throw new ErroRevenda(400, 'preço inválido');
  if (!CANAIS.includes(b.canal)) throw new ErroRevenda(400, 'canal deve ser atacado, varejo ou motorista');
  const obs = b.obs == null || b.obs === '' ? null : String(b.obs).slice(0, 200);
  const r = db.prepare('INSERT INTO vendas (placa, modelo_id, data, km, preco, canal, obs) VALUES (?, ?, ?, ?, ?, ?, ?)').run(placa, m.id, data, km, preco, b.canal, obs);
  return Number(r.lastInsertRowid);
}

// Cada venda com o previsto pelo estudo vigente na data (P50, 12 meses, FIPE do zero km do estudo).
export function listarVendas(db) {
  const premissas = lerPremissas(db);
  return db.prepare('SELECT v.*, m.slug, m.nome FROM vendas v JOIN modelos m ON m.id = v.modelo_id ORDER BY v.data DESC, v.id DESC').all().map(v => {
    const e = ultimoEstudo(db, v.modelo_id, v.data);
    let previsto = null;
    try { previsto = e ? projetar(e.dados, { meses: MESES_VENDA, km: v.km, canal: v.canal }, premissas).p50.nominal : null; } catch { previsto = null; }
    return {
      id: v.id, placa: v.placa, slug: v.slug, nome: v.nome, data: v.data, km: v.km, preco: v.preco, canal: v.canal, obs: v.obs,
      previsto, diferenca: previsto ? (v.preco - previsto) / previsto : null, data_estudo: e?.calculado_em ?? null,
    };
  });
}
