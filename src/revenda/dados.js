// Leituras e escritas da Revenda no banco. Síncronas: quem grava envolve em transacao().
import { calcularEstudo, emprestar } from './estudo.js';

export const anoDe = data => Number(String(data).slice(0, 4));

export const modelosComFipe = db =>
  db.prepare('SELECT * FROM modelos WHERE ativo = 1 AND fipe_modelo IS NOT NULL ORDER BY id').all();

// Códigos FIPE distintos entre fipe_modelo e fipe_modelo_ref dos modelos ativos
// (o código de referência usa a marca e o combustível do modelo que aponta para ele).
export function codigosFipe(db) {
  const vistos = new Map();
  const modelos = modelosComFipe(db);
  for (const m of modelos) vistos.set(m.fipe_modelo, { marca: m.fipe_marca, modelo: m.fipe_modelo, combustivel: m.fipe_combustivel });
  for (const m of modelos) {
    if (m.fipe_modelo_ref && !vistos.has(m.fipe_modelo_ref)) vistos.set(m.fipe_modelo_ref, { marca: m.fipe_marca, modelo: m.fipe_modelo_ref, combustivel: m.fipe_combustivel });
  }
  return [...vistos.values()];
}

export const linhasFipe = (db, fipeModelo) =>
  db.prepare('SELECT ano_modelo, referencia, valor FROM fipe_precos WHERE fipe_modelo = ? ORDER BY referencia, ano_modelo').all(fipeModelo);

export const ultimaReferencia = (db, fipeModelo) =>
  db.prepare('SELECT MAX(referencia) r FROM fipe_precos WHERE fipe_modelo = ?').get(fipeModelo).r;

export function gravarFipe(db, linhas) {
  const ins = db.prepare(`INSERT INTO fipe_precos (fipe_marca, fipe_modelo, ano_modelo, referencia, valor, codigo_fipe) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (fipe_modelo, ano_modelo, referencia) DO UPDATE SET valor = excluded.valor, codigo_fipe = excluded.codigo_fipe`);
  for (const l of linhas) ins.run(l.fipe_marca, l.fipe_modelo, l.ano_modelo, l.referencia, l.valor, l.codigo_fipe ?? null);
  return linhas.length;
}

// Anúncio já conhecido: atualiza preço, km, último visto e o que a fonte trouxe de novo; primeiro visto fica.
// Cada coleta também vira uma leitura (anúncio, data, preço, km): é a base que a tela Anúncios baixa.
// fonte: o prefixo do id_externo ("napista:abc" → napista) quando o anúncio não traz a sua.
export function gravarAnuncios(db, modeloId, lista, data) {
  const ins = db.prepare(`INSERT INTO anuncios (id_externo, modelo_id, versao, ano_modelo, ano_fabricacao, km, preco, loja, primeiro_visto, ultimo_visto,
      fonte, url, tipo_vendedor, leilao, leilao_por, cidade)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id_externo) DO UPDATE SET preco = excluded.preco, km = excluded.km, ultimo_visto = excluded.ultimo_visto,
      url = COALESCE(excluded.url, url), loja = COALESCE(excluded.loja, loja), tipo_vendedor = COALESCE(excluded.tipo_vendedor, tipo_vendedor),
      leilao = COALESCE(excluded.leilao, leilao), leilao_por = COALESCE(excluded.leilao_por, leilao_por), cidade = COALESCE(excluded.cidade, cidade)`);
  const leitura = db.prepare(`INSERT INTO anuncio_leituras (id_externo, data, preco, km) VALUES (?, ?, ?, ?)
    ON CONFLICT (id_externo, data) DO UPDATE SET preco = excluded.preco, km = excluded.km`);
  for (const a of lista) {
    const fonte = a.fonte ?? String(a.id_externo).split(':')[0];
    ins.run(a.id_externo, modeloId, a.versao ?? null, a.ano_modelo ?? null, a.ano_fabricacao ?? null, a.km, a.preco, a.loja ?? null, data, data,
      fonte, a.url ?? null, a.tipo_vendedor ?? null, a.leilao ?? null, a.leilao == null ? null : (a.leilao_por ?? 'fonte'), a.cidade ?? null);
    leitura.run(a.id_externo, data, a.preco, a.km);
  }
  return lista.length;
}

// Só os anúncios vistos nos últimos `dias` dias (spec, seção 6.2): o que saiu do ar não entra no estudo.
// fonte: só os de uma fonte (o estudo de hoje, lido pelo KPIs, usa só a Mobiauto até o estudo novo entrar).
export const anunciosRecentes = (db, modeloId, data, { dias = 60, fonte = null } = {}) =>
  db.prepare(`SELECT * FROM anuncios WHERE modelo_id = ? AND ultimo_visto >= date(?, ?) ${fonte ? 'AND fonte = ?' : ''} ORDER BY id_externo`)
    .all(modeloId, data, `-${dias} days`, ...(fonte ? [fonte] : []));

// Onde buscar os modelos ativos numa fonte: [{ modelo, caminho, versao }].
export const fontesAtivas = (db, fonte) =>
  db.prepare('SELECT m.*, f.caminho, f.versao AS filtro FROM fontes_modelo f JOIN modelos m ON m.id = f.modelo_id WHERE m.ativo = 1 AND f.fonte = ? ORDER BY m.id').all(fonte);

export function gravarIpca(db, serie) {
  const ins = db.prepare('INSERT INTO ipca (mes, variacao) VALUES (?, ?) ON CONFLICT (mes) DO UPDATE SET variacao = excluded.variacao');
  for (const s of serie) ins.run(s.mes, s.variacao);
  return serie.length;
}

export const ultimoIpca = db => db.prepare('SELECT MAX(mes) m FROM ipca').get().m;
export const mapaIpca = db => new Map(db.prepare('SELECT mes, variacao FROM ipca').all().map(x => [x.mes, x.variacao]));

export const premissasComData = db => db.prepare('SELECT p.chave, p.valor, p.atualizado_em, u.nome AS por FROM premissas p LEFT JOIN usuarios u ON u.id = p.usuario_id ORDER BY p.chave').all();
export const lerPremissas = db => Object.fromEntries(premissasComData(db).map(p => [p.chave, p.valor]));

// Um estudo por modelo com código FIPE; os que faltam dados pegam emprestado dos outros.
export function recalcularEstudos(db, data) {
  const ipca = mapaIpca(db);
  const modelos = modelosComFipe(db);
  const parciais = modelos.map(m => calcularEstudo({
    fipe: linhasFipe(db, m.fipe_modelo),
    fipeRef: m.fipe_modelo_ref ? linhasFipe(db, m.fipe_modelo_ref) : null,
    anuncios: anunciosRecentes(db, m.id, data, { fonte: 'mobiauto' }),
    ipca, hoje: data,
  }));
  const finais = emprestar(parciais);
  const ins = db.prepare('INSERT INTO estudos (modelo_id, calculado_em, dados) VALUES (?, ?, ?)');
  modelos.forEach((m, i) => ins.run(m.id, data, JSON.stringify(finais[i])));
  return modelos.length;
}

// O estudo mais recente do modelo (até a data, se informada; senão o primeiro que existir depois dela).
export function ultimoEstudo(db, modeloId, ate = null) {
  const linha = ate
    ? db.prepare('SELECT * FROM estudos WHERE modelo_id = ? AND calculado_em <= ? ORDER BY calculado_em DESC, id DESC LIMIT 1').get(modeloId, ate)
      ?? db.prepare('SELECT * FROM estudos WHERE modelo_id = ? ORDER BY calculado_em, id LIMIT 1').get(modeloId)
    : db.prepare('SELECT * FROM estudos WHERE modelo_id = ? ORDER BY id DESC LIMIT 1').get(modeloId);
  return linha ? { id: linha.id, calculado_em: linha.calculado_em, dados: JSON.parse(linha.dados) } : null;
}
