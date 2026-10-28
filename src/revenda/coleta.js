// Parte da rodada semanal que alimenta a Revenda: IPCA, FIPE, anúncios e estudos.
// Cada fonte vira uma linha em coletas; falha vira alerta e não impede as outras.
import { transacao } from '../db.js';
import { novaColeta, fecharColeta, alertaFalha } from '../coletas.js';
import { somarMeses } from './estudo.js';
import {
  anoDe, codigosFipe, ultimaReferencia, gravarFipe, gravarAnuncios, gravarIpca, ultimoIpca, recalcularEstudos,
} from './dados.js';

export const REFERENCIAS_INICIAIS = 36;
// A FIPE limita (429) depois de umas centenas de consultas seguidas: 1,5 s entre uma e outra.
export const PAUSA_FIPE_MS = 1500;
const espera = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());
const curto = e => String(e?.message ?? e).slice(0, 140);

async function comRetentativa(fn, pausaMs) {
  try {
    return await fn();
  } catch (e) {
    // Erro HTTP já passou pela espera crescente do leitor (429/5xx) ou não adianta repetir (403, 404).
    if (e?.status) throw e;
    await espera(pausaMs * 5);
    return await fn();
  }
}

// Baixa a série desde o último mês salvo quando ele é anterior ao mês passado.
export async function coletarIpca(db, ipca, { data }) {
  const ultimo = ultimoIpca(db);
  if (ultimo && ultimo >= somarMeses(data.slice(0, 7), -1)) return { itens: 0, modelos_ok: 1, total: 1, erros: [] };
  const serie = await ipca.serie(ultimo ?? `${anoDe(data) - 4}-01`);
  transacao(db, () => gravarIpca(db, serie));
  return { itens: serie.length, modelos_ok: 1, total: 1, erros: [] };
}

// Para cada código: as referências mais novas que a última salva (na primeira vez, as 36 últimas),
// da mais antiga para a mais nova, anos de (ano da referência − 3) a (+1) e o zero km.
// Uma consulta por pausaMs; cada referência é gravada inteira numa transação.
export async function coletarFipe(db, fipe, { pausaMs = PAUSA_FIPE_MS, iniciais = REFERENCIAS_INICIAIS, coletaId }) {
  const refs = (await fipe.referencias()).sort((a, b) => a.mes.localeCompare(b.mes)).slice(-iniciais);
  if (!refs.length) throw new Error('FIPE sem tabelas de referência');
  const codigos = codigosFipe(db);
  // Código que a rodada anterior deixou sem nenhum preço: não repete a carga das 36 referências, só pede a mais nova.
  const vaziosAntes = codigosSemDados(db, coletaId);
  let itens = 0, ok = 0;
  const erros = [], vazios = [];
  for (const cod of codigos) {
    const ultima = ultimaReferencia(db, cod.modelo);
    try {
      const novas = refs.filter(r => !ultima || r.mes > ultima);
      for (const ref of !ultima && vaziosAntes.has(cod.modelo) ? novas.slice(-1) : novas) {
        const Y = anoDe(ref.mes);
        const linhas = [];
        for (const ano of [Y - 3, Y - 2, Y - 1, Y, Y + 1, 32000]) {
          await espera(pausaMs);
          const v = await comRetentativa(() => fipe.valor({ codigoReferencia: ref.codigo, marca: cod.marca, modelo: cod.modelo, ano, combustivel: cod.combustivel }), pausaMs);
          if (v) linhas.push({ fipe_marca: cod.marca, fipe_modelo: cod.modelo, ano_modelo: ano, referencia: ref.mes, valor: v.valor, codigo_fipe: v.codigo_fipe });
        }
        itens += transacao(db, () => gravarFipe(db, linhas));
      }
      ok++;
      if (ultimaReferencia(db, cod.modelo) == null) vazios.push(cod.modelo);
    } catch (e) {
      erros.push(`${cod.modelo}: ${curto(e)}`);
      alertaFalha(db, coletaId, `FIPE ${cod.modelo}: ${curto(e)}`);
    }
  }
  return { itens, modelos_ok: ok, total: codigos.length, erros, vazios };
}

// Códigos que a última rodada da FIPE (antes desta) registrou como "sem dados: 123,456" em coletas.erro.
function codigosSemDados(db, coletaId) {
  const ant = db.prepare("SELECT erro FROM coletas WHERE fonte = 'fipe' AND fim IS NOT NULL AND id < ? ORDER BY id DESC LIMIT 1").get(coletaId ?? Number.MAX_SAFE_INTEGER);
  const m = String(ant?.erro ?? '').match(/sem dados: ([\d,]+)/);
  return new Set(m ? m[1].split(',').filter(Boolean).map(Number) : []);
}

export async function coletarAnuncios(db, mobiauto, { data, pausaMs = 2000, maxPaginas = 40, coletaId }) {
  const modelos = db.prepare('SELECT * FROM modelos WHERE ativo = 1 AND mobiauto_caminho IS NOT NULL ORDER BY id').all();
  let itens = 0, ok = 0;
  const erros = [];
  for (const [i, m] of modelos.entries()) {
    if (i > 0) await espera(pausaMs);
    try {
      const lista = await mobiauto.anuncios({ caminho: m.mobiauto_caminho, versao: m.mobiauto_versao, anoMin: anoDe(data) - 3, maxPaginas, pausaMs });
      itens += transacao(db, () => gravarAnuncios(db, m.id, lista, data));
      ok++;
    } catch (e) {
      erros.push(`${m.nome}: ${curto(e)}`);
      alertaFalha(db, coletaId, `Mobiauto: ${curto(e)}`, m.id);
    }
  }
  return { itens, modelos_ok: ok, total: modelos.length, erros };
}

const ROTULO = { ipca: 'IPCA', fipe: 'FIPE', mobiauto: 'Mobiauto' };

async function umaFonte(db, fonte, origem, fn) {
  let id = null;
  try {
    id = novaColeta(db, fonte, origem);
    const r = await fn(id);
    const status = !r.erros.length ? 'ok' : r.modelos_ok > 0 ? 'parcial' : 'falha';
    const notas = [...r.erros, ...(r.vazios?.length ? [`sem dados: ${r.vazios.join(',')}`] : [])];
    fecharColeta(db, id, { status, modelos_ok: r.modelos_ok, itens: r.itens, erro: notas.join(' | ') || null });
    return { status, ...r };
  } catch (e) {
    // Um erro do próprio banco aqui não pode derrubar as outras fontes.
    try {
      alertaFalha(db, id, `${ROTULO[fonte]}: ${curto(e)}`);
      if (id != null) fecharColeta(db, id, { status: 'falha', erro: curto(e) });
    } catch { /* a rodada segue; o resumo leva o erro */ }
    return { status: 'falha', erro: curto(e) };
  }
}

// referenciasIniciais: quantas referências baixar na primeira vez (36; só os ensaios usam menos).
export async function rodarRevenda(db, {
  fipe = null, mobiauto = null, ipca = null, data, origem = 'agenda',
  pausaFipeMs = PAUSA_FIPE_MS, pausaPaginaMs = 2000, referenciasIniciais = REFERENCIAS_INICIAIS,
}) {
  const resumo = { ipca: null, fipe: null, mobiauto: null, estudos: 0 };
  if (ipca) resumo.ipca = await umaFonte(db, 'ipca', origem, () => coletarIpca(db, ipca, { data }));
  if (fipe) resumo.fipe = await umaFonte(db, 'fipe', origem, id => coletarFipe(db, fipe, { pausaMs: pausaFipeMs, iniciais: referenciasIniciais, coletaId: id }));
  if (mobiauto) resumo.mobiauto = await umaFonte(db, 'mobiauto', origem, id => coletarAnuncios(db, mobiauto, { data, pausaMs: pausaPaginaMs, coletaId: id }));
  try {
    resumo.estudos = transacao(db, () => recalcularEstudos(db, data));
  } catch (e) {
    resumo.erro_estudo = curto(e);
    try { alertaFalha(db, null, `Estudo: ${curto(e)}`); } catch { /* o resumo já leva o erro */ }
  }
  return resumo;
}
