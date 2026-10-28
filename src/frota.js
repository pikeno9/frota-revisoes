// Frota real vem do Ativos (veiculos.ocnbrasil.com.br): carros por modelo,
// pela chave `mo` da planilha (polo, argo, tera...).
import { TEMPO_LIMITE_MS } from './coletores/http.js';

export async function buscarFrota({ url, token }, buscar = fetch) {
  const r = await buscar(`${url.replace(/\/$/, '')}/api/precos/frota`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
  if (!r.ok) throw new Error(`Ativos respondeu ${r.status}`);
  const j = await r.json();
  if (!j || !j.modelos || typeof j.modelos !== 'object') throw new Error('Ativos: resposta sem modelos');
  if (!Object.values(j.modelos).some(n => Number(n) > 0)) throw new Error('Ativos: frota vazia');
  return j.modelos;
}

export function aplicarFrota(db, contagem, coletaId) {
  const modelos = db.prepare('SELECT id, chave_ativos FROM modelos WHERE chave_ativos IS NOT NULL').all();
  const upd = db.prepare("UPDATE modelos SET qtd_frota = ?, origem = CASE WHEN ? > 0 THEN 'frota' ELSE 'candidato' END WHERE id = ?");
  for (const m of modelos) {
    const n = Number(contagem[m.chave_ativos] ?? 0);
    upd.run(n, n, m.id);
  }
  const conhecidas = new Set(modelos.map(m => m.chave_ativos));
  const novas = Object.keys(contagem).filter(k => !conhecidas.has(k) && Number(contagem[k]) > 0);
  const al = db.prepare("INSERT INTO alertas (coleta_id, tipo, texto) VALUES (?, 'frota_sem_modelo', ?)");
  for (const k of novas) al.run(coletaId, `${k}: ${contagem[k]} carros`);
  return { modelos: modelos.length, novas };
}
