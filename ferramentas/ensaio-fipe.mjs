// Ensaio: migra uma cópia do banco e roda só a coleta da FIPE nela (os códigos novos baixam 36 meses).
// Uso: node --experimental-sqlite ferramentas/ensaio-fipe.mjs <cópia.db> [minutos de prazo]
import { abrir } from '../src/db.js';
import { migrar } from '../src/migracoes/index.js';
import * as fipe from '../src/revenda/fipe.js';
import { coletarFipe } from '../src/revenda/coleta.js';
import { novaColeta, fecharColeta } from '../src/coletas.js';

const [arquivo, minutos = '120'] = process.argv.slice(2);
if (!arquivo || /revisoes\.db$/.test(arquivo)) throw new Error('passe uma cópia do banco, nunca o de produção');
const db = abrir(arquivo);
console.log('schema', migrar(db));
const inicio = Date.now();
const id = novaColeta(db, 'fipe', 'manual');
const r = await coletarFipe(db, fipe, { coletaId: id, prazoMs: Number(minutos) * 60000 });
fecharColeta(db, id, { status: r.erros.length ? (r.modelos_ok ? 'parcial' : 'falha') : 'ok', modelos_ok: r.modelos_ok, itens: r.itens, erro: r.erros.join(' | ') || null });
console.log(`${r.itens} preços em ${Math.round((Date.now() - inicio) / 60000)} min`, r.erros, r.vazios);
