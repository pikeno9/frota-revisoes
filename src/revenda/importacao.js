// Importação de anúncios de qualquer fonte (Webmotors, planilha montada à mão, coletor do PC).
// Cada linha válida entra como um anúncio da fonte com uma leitura na data dela; a linha inválida
// volta com o número e o motivo, sem impedir as outras.
import { createHash } from 'node:crypto';
import { transacao } from '../db.js';
import { novaColeta, fecharColeta } from '../coletas.js';
import { gravarAnuncios, recalcularEstudos } from './dados.js';
import { leilaoNaColuna, leilaoNaDescricao } from './leilao.js';
import { tipoVendedor } from './vendedor.js';
import { ErroRevenda } from './consultas.js';

export const MAX_LINHAS = 20000;
const FONTE = /^[a-z0-9][a-z0-9-]{1,29}$/;
const TIPOS = ['loja', 'particular', 'locadora'];

// "R$ 75.900,50" → 75900.5; "45.000 km" → 45000; número passa direto.
export function numeroBr(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const texto = (v, max) => {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

// O modelo pela slug ou pelo nome, sem diferenciar maiúsculas.
function achaModelo(modelos, v) {
  const t = String(v ?? '').trim().toLowerCase();
  return t ? modelos.find(m => m.slug === t || m.nome.toLowerCase() === t) ?? null : null;
}

// Uma linha → anúncio, ou { erro }. hoje: AAAA-MM-DD; a data da linha não pode passar dele.
export function lerLinha(l, { fonte, modelos, hoje }) {
  const m = achaModelo(modelos, l.modelo);
  if (!m) return { erro: 'modelo não encontrado' };
  const ano = numeroBr(l.ano_modelo ?? l.ano);
  const fab = numeroBr(l.ano_fabricacao);
  if (fab != null && !(Number.isInteger(fab) && fab >= ano - 1 && fab <= ano)) return { erro: 'ano de fabricação inválido' };
  if (!Number.isInteger(ano) || ano < 2000 || ano > Number(hoje.slice(0, 4)) + 1) return { erro: 'ano inválido' };
  const km = numeroBr(l.km);
  if (km == null || km < 0 || km > 500000) return { erro: 'km inválido' };
  const preco = numeroBr(l.preco ?? l.preço);
  if (preco == null || preco < 1000 || preco > 2000000) return { erro: 'preço inválido' };
  const data = String(l.data ?? '').trim() || hoje;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data > hoje) return { erro: 'data inválida (use AAAA-MM-DD)' };
  const tipo = String(l.tipo_vendedor ?? '').trim().toLowerCase();
  const url = texto(l.url ?? l.link, 500);
  if (url && !/^https?:\/\//i.test(url)) return { erro: 'link inválido' };
  const coluna = leilaoNaColuna(l.leilao ?? l.leilão);
  const descrito = coluna == null ? leilaoNaDescricao(l.descricao ?? l.descrição) : null;
  const versao = texto(l.versao ?? l.versão, 120);
  // Sem id na planilha, o mesmo carro importado de novo cai no mesmo id: modelo, versão, ano, km, preço e link.
  const id = texto(l.id, 80) ?? createHash('sha1').update([m.slug, versao, ano, Math.round(km), preco, url].join('|')).digest('hex').slice(0, 16);
  return {
    modelo_id: m.id, data,
    anuncio: {
      id_externo: `${fonte}:${id}`, fonte, versao, ano_modelo: ano, ano_fabricacao: fab, km: Math.round(km), preco,
      loja: texto(l.vendedor ?? l.loja, 120), tipo_vendedor: TIPOS.includes(tipo) ? tipo : tipoVendedor(texto(l.vendedor ?? l.loja, 120), null),
      cidade: texto(l.cidade, 80), url,
      leilao: coluna ?? descrito, leilao_por: coluna != null ? 'fonte' : descrito != null ? 'descricao' : null,
    },
  };
}

// corpo: { fonte, anuncios: [ { modelo, versao, ano_modelo, km, preco, vendedor, tipo_vendedor, cidade, url, leilao, descricao, data, id } ] }
export function importarAnuncios(db, corpo, { hoje, origem = 'importacao' }) {
  const fonte = String(corpo?.fonte ?? '').trim().toLowerCase();
  if (!FONTE.test(fonte)) throw new ErroRevenda(400, 'fonte: letras minúsculas, números e hífen (2 a 30)');
  const linhas = corpo?.anuncios;
  if (!Array.isArray(linhas) || !linhas.length) throw new ErroRevenda(400, 'nenhum anúncio enviado');
  if (linhas.length > MAX_LINHAS) throw new ErroRevenda(400, `no máximo ${MAX_LINHAS} anúncios por envio`);
  const modelos = db.prepare('SELECT id, slug, nome FROM modelos').all();
  const erros = [];
  const porGrupo = new Map();
  linhas.forEach((l, i) => {
    const r = lerLinha(l ?? {}, { fonte, modelos, hoje });
    if (r.erro) { erros.push({ linha: i + 1, erro: r.erro }); return; }
    const chave = `${r.modelo_id}|${r.data}`;
    if (!porGrupo.has(chave)) porGrupo.set(chave, { modelo_id: r.modelo_id, data: r.data, lista: [] });
    porGrupo.get(chave).lista.push(r.anuncio);
  });
  const id = novaColeta(db, fonte, origem);
  let itens = 0;
  transacao(db, () => {
    // A data mais nova por último: o último visto do anúncio fica com ela.
    for (const g of [...porGrupo.values()].sort((a, b) => a.data.localeCompare(b.data))) itens += gravarAnuncios(db, g.modelo_id, g.lista, g.data);
  });
  const modelosOk = new Set([...porGrupo.values()].map(g => g.modelo_id)).size;
  fecharColeta(db, id, {
    status: !erros.length ? 'ok' : itens ? 'parcial' : 'falha', modelos_ok: modelosOk, itens,
    erro: erros.length ? `${erros.length} linha(s) recusada(s)` : null,
  });
  // Os anúncios novos entram no consenso já: o estudo é refeito com a data de hoje.
  if (itens) transacao(db, () => recalcularEstudos(db, hoje));
  return { fonte, importados: itens, recusados: erros.length, erros: erros.slice(0, 50) };
}
