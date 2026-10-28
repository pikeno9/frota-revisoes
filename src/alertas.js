// Uma mensagem de WhatsApp por rodada, pelo Evolution que roda na VPS com o Central.
import { hojeSP } from './datas.js';

const n = v => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const diaMes = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function linha(a) {
  switch (a.tipo) {
    case 'mudanca': {
      const p = (a.para - a.de) / a.de * 100;
      const sinal = p > 0 ? '+' : p < 0 ? '−' : '';
      return `${a.nome} ${a.ordem}ª ${n(a.de)} → ${n(a.para)} (${sinal}${Math.abs(p).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)`;
    }
    case 'nova_revisao': return `${a.nome} ${a.ordem}ª nova: ${n(a.para)}`;
    case 'sumiu_revisao': return `${a.nome} ${a.ordem}ª não veio na coleta`;
    case 'falha': return `Falha ${a.nome ?? ''}: ${a.texto}`.replace('Falha : ', 'Falha: ');
    case 'frota_sem_modelo': return `Frota sem modelo cadastrado: ${a.texto}`;
    default: return null;
  }
}

export function montarMensagem(alertas, data = hojeSP()) {
  const conferir = new Set(alertas.filter(a => a.tipo === 'conferir').map(a => `${a.modelo_id}|${a.ordem}`));
  const linhas = alertas.filter(a => a.tipo !== 'conferir').map(a => {
    const l = linha(a);
    return a.tipo === 'mudanca' && conferir.has(`${a.modelo_id}|${a.ordem}`) ? `${l} conferir` : l;
  }).filter(Boolean);
  return linhas.length ? [`Preços de revisão ${diaMes(data)}`, ...linhas].join('\n') : null;
}

export function pendentes(db) {
  return db.prepare('SELECT a.*, m.nome FROM alertas a LEFT JOIN modelos m ON m.id = a.modelo_id WHERE a.enviado_em IS NULL ORDER BY a.id').all();
}

export async function enviarPendentes(db, { env = process.env, buscar = fetch, data = hojeSP() } = {}) {
  const lista = pendentes(db);
  const texto = montarMensagem(lista, data);
  if (!texto) return { enviados: 0, motivo: 'nada' };
  const { EVOLUTION_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCIA, ALERTA_WHATSAPP } = env;
  if (!EVOLUTION_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCIA || !ALERTA_WHATSAPP) return { enviados: 0, motivo: 'sem configuração' };
  try {
    const r = await buscar(`${EVOLUTION_URL.replace(/\/$/, '')}/message/sendText/${EVOLUTION_INSTANCIA}`, {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ number: ALERTA_WHATSAPP, text: texto }),
    });
    if (!r.ok) return { enviados: 0, motivo: `Evolution respondeu ${r.status}` };
  } catch (e) {
    return { enviados: 0, motivo: e.message };
  }
  const ids = lista.map(a => a.id);
  db.prepare(`UPDATE alertas SET enviado_em = datetime('now') WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  return { enviados: ids.length, motivo: null };
}
