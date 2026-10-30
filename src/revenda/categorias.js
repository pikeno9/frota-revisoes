// O estudo por categoria (combustão, elétrico, híbrido): a queda de valor pela FIPE de cada código,
// da frota e de referência, só com os dados do próprio código (nada emprestado), e a mediana da
// categoria. Junto, o que os anúncios dizem dos modelos da frota (km, fontes, leilão).
import { MESES, MIN_R, observacoesR, resumirR, mediana, indexarFipe, ZERO_KM } from './estudo.js';
import { linhasFipe, mapaIpca, ultimoEstudo } from './dados.js';

export const CATEGORIA_DO_COMBUSTIVEL = { 5: 'combustao', 4: 'eletrico', 6: 'hibrido' };
const ORDEM = ['combustao', 'eletrico', 'hibrido'];

// Queda de um código: r_m (6, 12, 18, 24) com observações próprias suficientes, ou null.
function curva(linhas, ipca) {
  const r = {};
  for (const m of MESES) {
    const obs = observacoesR(linhas, m, ipca);
    r[m] = obs.length >= MIN_R ? resumirR(obs) : null;
  }
  const idx = indexarFipe(linhas);
  const ultima = [...idx.keys()].sort().at(-1);
  return { r, fipe_0km: ultima ? idx.get(ultima).get(ZERO_KM) ?? null : null, referencia: ultima ?? null };
}

export function estudoCategorias(db) {
  const ipca = mapaIpca(db);
  const frota = db.prepare("SELECT * FROM modelos WHERE ativo = 1 AND fipe_modelo IS NOT NULL ORDER BY origem = 'frota' DESC, qtd_frota DESC, nome").all();
  const refs = db.prepare('SELECT * FROM fipe_referencias WHERE ativo = 1 ORDER BY categoria, nome').all();
  const vistos = new Set();
  const codigos = [];
  for (const m of frota) {
    vistos.add(m.fipe_modelo);
    const e = ultimoEstudo(db, m.id)?.dados;
    const cs = e?.consenso;
    codigos.push({
      codigo: m.fipe_modelo, nome: m.nome, slug: m.slug, origem: 'frota', categoria: CATEGORIA_DO_COMBUSTIVEL[m.fipe_combustivel] ?? null,
      ...curva(linhasFipe(db, m.fipe_modelo), ipca),
      anuncios: cs ? {
        usados: cs.n_usados, fator_10mil: cs.regressao?.fator_10mil ?? null, fator_ano: cs.regressao?.fator_ano ?? null,
        anuncio_sobre_fipe: cs.anuncio_sobre_fipe, pct_fim: cs.pct_fipe, criterios_ok: cs.criterios.filter(x => x.ok).length,
        premios: cs.regressao?.premios ?? [], base_fonte: cs.regressao?.base_fonte ?? null,
        contagem: cs.contagem, duplicados: cs.duplicados,
      } : null,
    });
  }
  for (const r of refs) {
    if (vistos.has(r.fipe_modelo)) continue;
    codigos.push({ codigo: r.fipe_modelo, nome: r.nome, slug: null, origem: 'referencia', categoria: r.categoria, ...curva(linhasFipe(db, r.fipe_modelo), ipca), anuncios: null });
  }
  const categorias = ORDEM.map(cat => {
    const doCat = codigos.filter(c => c.categoria === cat);
    const r = {};
    for (const m of MESES) {
      const v = doCat.map(c => c.r[m]).filter(Boolean);
      r[m] = v.length ? { p50: mediana(v.map(x => x.p50)), real_p50: mediana(v.map(x => x.real_p50).filter(x => x != null)), n: v.length } : null;
    }
    const comAnuncios = doCat.map(c => c.anuncios).filter(a => a?.fator_10mil != null);
    return {
      categoria: cat, modelos: doCat.length, com_curva: doCat.filter(c => c.r[12]).length, r,
      fator_10mil: comAnuncios.length ? mediana(comAnuncios.map(a => a.fator_10mil)) : null,
      anuncio_sobre_fipe: comAnuncios.length ? mediana(comAnuncios.map(a => a.anuncio_sobre_fipe).filter(x => x != null)) : null,
    };
  }).filter(c => c.modelos);
  return { codigos, categorias, meses: MESES };
}
