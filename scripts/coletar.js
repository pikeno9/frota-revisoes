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
const r = await rodarColeta(db, { ...deps, origem: process.argv.includes('--manual') ? 'manual' : 'agenda' });
console.log(JSON.stringify(r, null, 2));
process.exitCode = Object.values(r.fontes).every(f => f.status === 'falha') ? 1 : 0;
