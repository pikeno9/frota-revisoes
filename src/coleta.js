// Uma rodada: frota do Ativos, depois cada fonte com os seus modelos ativos,
// depois a Revenda (IPCA, FIPE, anúncios, estudos) e por fim os alertas.
// Uma fonte que falha não impede as outras.
import { transacao } from './db.js';
import { gravarModelo } from './gravar.js';
import { aplicarFrota } from './frota.js';
import { hojeSP } from './datas.js';
import { novaColeta, fecharColeta, alertaFalha } from './coletas.js';
import { rodarRevenda } from './revenda/coleta.js';

let rodando = false;
export const emAndamento = () => rodando;

// A carga inicial da Revenda (FIPE, 36 referências) leva de 40 a 90 minutos: a trava entre processos vale por 2 horas.
export const TRAVA_MINUTOS = 120;

// Código de saída do `npm run coletar`: 1 na falha total das Revisões ou, quando a Revenda rodou,
// no erro do estudo (as telas ficariam com os números da semana anterior), no erro da própria
// rodada ou na falha de todas as fontes dela.
export function codigoDeSaida(r) {
  const revisoesCaiu = Object.values(r.fontes).every(f => f.status === 'falha');
  const fontesRevenda = r.revenda ? ['ipca', 'fipe', 'mobiauto', 'napista'].map(k => r.revenda[k]).filter(Boolean) : [];
  const revendaCaiu = !!r.revenda && (r.revenda.erro != null || r.revenda.erro_estudo != null
    || (fontesRevenda.length > 0 && fontesRevenda.every(f => f.status === 'falha')));
  return revisoesCaiu || revendaCaiu ? 1 : 0;
}

async function rodarFrota(db, buscarFrota, origem) {
  const id = novaColeta(db, 'ativos', origem);
  try {
    const contagem = await buscarFrota();
    const r = transacao(db, () => aplicarFrota(db, contagem, id));
    fecharColeta(db, id, { status: 'ok', modelos_ok: r.modelos, itens: Object.keys(contagem).length });
    return { status: 'ok', ...r };
  } catch (e) {
    alertaFalha(db, id, `Ativos: ${e.message}`);
    fecharColeta(db, id, { status: 'falha', erro: e.message });
    return { status: 'falha', erro: e.message };
  }
}

// Uma segunda tentativa depois de uma pausa: os sites das montadoras erram de vez em quando.
async function coletarComRetentativa(coletor, parametros, pausaMs) {
  try {
    return await coletor.coletar(parametros);
  } catch {
    await new Promise(r => setTimeout(r, pausaMs));
    return await coletor.coletar(parametros);
  }
}

async function rodarFonte(db, fonte, modelos, coletor, data, origem, pausaMs) {
  const id = novaColeta(db, fonte, origem);
  let ok = 0, itens = 0, mudancas = 0;
  const erros = [];
  for (const m of modelos) {
    try {
      if (!coletor) throw new Error(`coletor desconhecido: ${fonte}`);
      const lista = await coletarComRetentativa(coletor, JSON.parse(m.parametros), pausaMs);
      const r = transacao(db, () => gravarModelo(db, { modeloId: m.id, itens: lista, coletaId: id, data }));
      if (r.erro) { erros.push(`${m.nome}: ${r.erro}`); continue; }
      ok++; itens += r.itens; mudancas += r.mudancas;
    } catch (e) {
      const texto = String(e.message).slice(0, 160);
      erros.push(`${m.nome}: ${texto}`);
      alertaFalha(db, id, texto, m.id);
    }
  }
  const status = ok === modelos.length ? 'ok' : ok > 0 ? 'parcial' : 'falha';
  fecharColeta(db, id, { status, modelos_ok: ok, itens, mudancas, erro: erros.join(' | ') || null });
  return { status, modelos_ok: ok, itens, mudancas, erros };
}

async function enviarSeguro(db, enviar, data) {
  try {
    return await enviar(db, { data });
  } catch (e) {
    return { enviados: 0, motivo: e.message };
  }
}

export async function rodarColeta(db, { coletores, buscarFrota = null, enviar = null, revenda = null, data = hojeSP(), origem = 'agenda', pausaMs = 5000 }) {
  if (rodando) throw new Error('já existe uma coleta em andamento');
  // Uma rodada morta no meio (processo derrubado) deixa a linha aberta: depois da trava ela é fechada como interrompida.
  db.prepare(`UPDATE coletas SET status = 'falha', erro = 'interrompida', fim = datetime('now')
    WHERE fim IS NULL AND fonte <> 'legado' AND inicio <= datetime('now', '-${TRAVA_MINUTOS} minutes')`).run();
  // Outro processo (a tarefa agendada ou o servidor) pode estar coletando no mesmo arquivo.
  if (db.prepare(`SELECT 1 FROM coletas WHERE fim IS NULL AND fonte <> 'legado' AND inicio > datetime('now', '-${TRAVA_MINUTOS} minutes')`).get()) throw new Error('já existe uma coleta em andamento');
  rodando = true;
  try {
    const resumo = { data, frota: null, fontes: {}, revenda: null, alertas: null };
    if (buscarFrota) resumo.frota = await rodarFrota(db, buscarFrota, origem);
    const modelos = db.prepare('SELECT * FROM modelos WHERE ativo = 1 ORDER BY id').all();
    for (const [fonte, lista] of Map.groupBy(modelos, m => m.coletor)) {
      resumo.fontes[fonte] = await rodarFonte(db, fonte, lista, coletores[fonte], data, origem, pausaMs);
    }
    // Os alertas das Revisões saem antes da Revenda, que pode levar meia hora ou falhar.
    if (enviar) resumo.alertas = await enviarSeguro(db, enviar, data);
    if (revenda) {
      try {
        resumo.revenda = await rodarRevenda(db, { ...revenda, data, origem });
      } catch (e) {
        const texto = String(e?.message ?? e).slice(0, 140);
        try { alertaFalha(db, null, `Revenda: ${texto}`); } catch { /* o resumo ainda leva o erro */ }
        resumo.revenda = { erro: texto };
      }
      if (enviar) resumo.alertas_revenda = await enviarSeguro(db, enviar, data);
    }
    return resumo;
  } finally {
    try { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch { /* o checkpoint é só higiene */ }
    rodando = false;
  }
}
