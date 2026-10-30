// Ensaio: migra uma cópia do banco e roda só a coleta da NaPista nela, sem tocar em produção.
// Uso: node --experimental-sqlite ferramentas/ensaio-napista.mjs <cópia.db> [AAAA-MM-DD]
import { abrir } from '../src/db.js';
import { migrar } from '../src/migracoes/index.js';
import * as napista from '../src/revenda/napista.js';
import { coletarAnuncios } from '../src/revenda/coleta.js';
import { novaColeta, fecharColeta } from '../src/coletas.js';

const [arquivo, data = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())] = process.argv.slice(2);
if (!arquivo || /revisoes\.db$/.test(arquivo)) throw new Error('passe uma cópia do banco, nunca o de produção');
const db = abrir(arquivo);
console.log('schema', migrar(db));
const inicio = Date.now();
const id = novaColeta(db, 'napista', 'manual');
const r = await coletarAnuncios(db, napista, 'napista', { data, coletaId: id });
fecharColeta(db, id, { status: r.erros.length ? (r.modelos_ok ? 'parcial' : 'falha') : 'ok', modelos_ok: r.modelos_ok, itens: r.itens, erro: r.erros.join(' | ') || null });
console.log(`${r.itens} anúncios em ${Math.round((Date.now() - inicio) / 1000)} s`, r.erros);
console.table(db.prepare(`SELECT m.nome, a.fonte, COUNT(*) n, MIN(a.ano_modelo) de, MAX(a.ano_modelo) ate, ROUND(AVG(a.km)) km_medio, ROUND(AVG(a.preco)) preco_medio,
  SUM(a.tipo_vendedor = 'locadora') locadora
  FROM anuncios a JOIN modelos m ON m.id = a.modelo_id GROUP BY m.nome, a.fonte ORDER BY m.nome, a.fonte`).all());
