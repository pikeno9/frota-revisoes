// Rodada de coleta pela linha de comando. No Coolify: tarefa agendada "0 12 * * 1"
// com o comando "npm run coletar". --sem-alerta não manda WhatsApp.
import { abrir } from '../src/db.js';
import { migrar } from '../src/migracoes/index.js';
import { rodarColeta } from '../src/coleta.js';
import { dependencias } from '../src/dependencias.js';

const env = process.env;
const db = abrir(env.DB_PATH || 'revisoes.db');
migrar(db);
const deps = dependencias(env);
if (process.argv.includes('--sem-alerta')) deps.enviar = null;
try {
  const r = await rodarColeta(db, { ...deps, origem: process.argv.includes('--manual') ? 'manual' : 'agenda' });
  console.log(JSON.stringify(r, null, 2));
  // Falha total das Revisões ou, quando a Revenda rodou, de todas as fontes dela.
  const revisoesCaiu = Object.values(r.fontes).every(f => f.status === 'falha');
  const fontesRevenda = r.revenda ? ['ipca', 'fipe', 'mobiauto'].map(k => r.revenda[k]).filter(Boolean) : [];
  const revendaCaiu = !!r.revenda && (r.revenda.erro != null || (fontesRevenda.length > 0 && fontesRevenda.every(f => f.status === 'falha')));
  process.exitCode = revisoesCaiu || revendaCaiu ? 1 : 0;
} finally {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* segue para fechar */ }
  db.close();
}
