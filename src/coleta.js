// Uma rodada: frota do Ativos, depois cada fonte com os seus modelos ativos,
// depois os alertas. Uma fonte que falha não impede as outras.
import { transacao } from './db.js';
import { gravarModelo } from './gravar.js';
import { aplicarFrota } from './frota.js';
import { hojeSP } from './datas.js';

let rodando = false;
export const emAndamento = () => rodando;

const novaColeta = (db, fonte, origem) =>
  Number(db.prepare("INSERT INTO coletas (fonte, inicio, origem) VALUES (?, datetime('now'), ?)").run(fonte, origem).lastInsertRowid);

function fecharColeta(db, id, c) {
  db.prepare("UPDATE coletas SET fim = datetime('now'), status = ?, modelos_ok = ?, itens = ?, mudancas = ?, erro = ? WHERE id = ?")
    .run(c.status, c.modelos_ok ?? 0, c.itens ?? 0, c.mudancas ?? 0, c.erro ?? null, id);
}

async function rodarFrota(db, buscarFrota, origem) {
  const id = novaColeta(db, 'ativos', origem);
  try {
    const contagem = await buscarFrota();
    const r = transacao(db, () => aplicarFrota(db, contagem, id));
    fecharColeta(db, id, { status: 'ok', modelos_ok: r.modelos, itens: Object.keys(contagem).length });
    return { status: 'ok', ...r };
  } catch (e) {
    db.prepare("INSERT INTO alertas (coleta_id, tipo, texto) VALUES (?, 'falha', ?)").run(id, `Ativos: ${e.message}`);
    fecharColeta(db, id, { status: 'falha', erro: e.message });
    return { status: 'falha', erro: e.message };
  }
}

async function rodarFonte(db, fonte, modelos, coletor, data, origem) {
  const id = novaColeta(db, fonte, origem);
  let ok = 0, itens = 0, mudancas = 0;
  const erros = [];
  for (const m of modelos) {
    try {
      if (!coletor) throw new Error(`coletor desconhecido: ${fonte}`);
      const lista = await coletor.coletar(JSON.parse(m.parametros));
      const r = transacao(db, () => gravarModelo(db, { modeloId: m.id, itens: lista, coletaId: id, data }));
      if (r.erro) { erros.push(`${m.nome}: ${r.erro}`); continue; }
      ok++; itens += r.itens; mudancas += r.mudancas;
    } catch (e) {
      erros.push(`${m.nome}: ${e.message}`);
      db.prepare("INSERT INTO alertas (coleta_id, tipo, modelo_id, texto) VALUES (?, 'falha', ?, ?)").run(id, m.id, e.message);
    }
  }
  const status = ok === modelos.length ? 'ok' : ok > 0 ? 'parcial' : 'falha';
  fecharColeta(db, id, { status, modelos_ok: ok, itens, mudancas, erro: erros.join(' | ') || null });
  return { status, modelos_ok: ok, itens, mudancas, erros };
}

export async function rodarColeta(db, { coletores, buscarFrota = null, enviar = null, data = hojeSP(), origem = 'agenda' }) {
  if (rodando) throw new Error('já existe uma coleta em andamento');
  rodando = true;
  try {
    const resumo = { data, frota: null, fontes: {}, alertas: null };
    if (buscarFrota) resumo.frota = await rodarFrota(db, buscarFrota, origem);
    const modelos = db.prepare('SELECT * FROM modelos WHERE ativo = 1 ORDER BY id').all();
    for (const [fonte, lista] of Map.groupBy(modelos, m => m.coletor)) {
      resumo.fontes[fonte] = await rodarFonte(db, fonte, lista, coletores[fonte], data, origem);
    }
    if (enviar) resumo.alertas = await enviar(db, { data });
    return resumo;
  } finally {
    rodando = false;
  }
}
