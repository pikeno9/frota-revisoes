// v2: modelos parametrizados, preços em faixas de vigência, coletas e alertas.
// As tabelas antigas (veiculos, precos) ficam intactas e congeladas.
import { diaAnterior } from '../datas.js';

// A Fiat publica 5 revisões; no legado a 6ª a 10ª eram cópia do ciclo.
export const FIAT_PUBLICADAS = 5;

// Chave = "montadora|modelo" do legado, em minúsculas.
export const CONHECIDOS = {
  'volkswagen|polo track': { slug: 'polo-track', montadora: 'Volkswagen', nome: 'Polo Track', versao: '1.0', ano_modelo: 2026, origem: 'frota', chave_ativos: 'polo', coletor: 'vw', parametros: { modelo: 'Polo Track', versao: '1.0 MPI', ano: 2026 } },
  'volkswagen|tera': { slug: 'tera', montadora: 'Volkswagen', nome: 'Tera', versao: '1.0 MPI', ano_modelo: 2026, origem: 'frota', chave_ativos: 'tera', coletor: 'vw', parametros: { modelo: 'Tera', versao: '1.0 MPI', ano: 2026 } },
  'fiat|argo drive': { slug: 'argo-drive', montadora: 'Fiat', nome: 'Argo Drive', versao: '1.0', ano_modelo: 2026, origem: 'frota', chave_ativos: 'argo', coletor: 'fiat', parametros: { mvsCode: '358ATS1', modelYear: 2026, dealer: '919654' }, projetar_ciclo: 1 },
  'chevrolet|onix sedan plus': { slug: 'onix-sedan-plus', montadora: 'Chevrolet', nome: 'Onix Sedan Plus', versao: '1.0 12V Mec.', ano_modelo: 2026, origem: 'candidato', coletor: 'gm', parametros: { model: 'Onix Plus', year: '2026', trim: 'Aspirado' } },
  'byd|dolphin': { slug: 'byd-dolphin', montadora: 'BYD', nome: 'Dolphin', versao: 'GS', ano_modelo: 2026, origem: 'candidato', coletor: 'byd', parametros: { nome: 'BYD Dolphin / Dolphin Plus' } },
  'byd|king': { slug: 'byd-king', montadora: 'BYD', nome: 'King', versao: 'GL 1.5 DM-i', ano_modelo: 2026, origem: 'candidato', coletor: 'byd', parametros: { nome: 'BYD King' } },
};

const SQL = `
  CREATE TABLE modelos (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    montadora TEXT NOT NULL,
    nome TEXT NOT NULL,
    versao TEXT, ano_modelo INTEGER,
    origem TEXT NOT NULL CHECK (origem IN ('frota','candidato')),
    chave_ativos TEXT UNIQUE,
    qtd_frota INTEGER NOT NULL DEFAULT 0,
    coletor TEXT NOT NULL CHECK (coletor IN ('byd','vw','gm','fiat')),
    parametros TEXT NOT NULL,
    legado_veiculo_id INTEGER,
    projetar_ciclo INTEGER NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE coletas (
    id INTEGER PRIMARY KEY,
    fonte TEXT NOT NULL,
    inicio TEXT NOT NULL, fim TEXT,
    status TEXT CHECK (status IN ('ok','parcial','falha')),
    modelos_ok INTEGER DEFAULT 0, itens INTEGER DEFAULT 0, mudancas INTEGER DEFAULT 0,
    erro TEXT, origem TEXT NOT NULL DEFAULT 'agenda'
  );
  CREATE TABLE vigencias (
    id INTEGER PRIMARY KEY,
    modelo_id INTEGER NOT NULL REFERENCES modelos(id),
    ordem INTEGER NOT NULL,
    km INTEGER NOT NULL,
    meses INTEGER,
    valor REAL NOT NULL,
    vigente_de TEXT NOT NULL,
    vigente_ate TEXT,
    visto_em TEXT NOT NULL,
    coleta_id INTEGER REFERENCES coletas(id),
    conferir INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX vig_atual ON vigencias(modelo_id, ordem) WHERE vigente_ate IS NULL;
  CREATE INDEX vig_modelo ON vigencias(modelo_id);
  CREATE TABLE alertas (
    id INTEGER PRIMARY KEY,
    coleta_id INTEGER REFERENCES coletas(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('mudanca','nova_revisao','sumiu_revisao','falha','conferir','frota_sem_modelo')),
    modelo_id INTEGER, ordem INTEGER, de REAL, para REAL, texto TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    enviado_em TEXT
  );
`;

export function lerRevisaoLegada(texto) {
  const n = String(texto).match(/^\s*(\d+)/);
  const k = String(texto).match(/\(([\d.]+)\s*km/i);
  return n ? { ordem: +n[1], km: k ? +k[1].replace(/\./g, '') : null } : null;
}

function inserirModelo(db, d, legadoId) {
  const r = db.prepare(`INSERT INTO modelos (slug, montadora, nome, versao, ano_modelo, origem, chave_ativos, coletor, parametros, legado_veiculo_id, projetar_ciclo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.slug, d.montadora, d.nome, d.versao ?? null, d.ano_modelo ?? null, d.origem,
    d.chave_ativos ?? null, d.coletor, JSON.stringify(d.parametros), legadoId ?? null, d.projetar_ciclo ?? 0);
  return Number(r.lastInsertRowid);
}

// Cada (modelo, ordem, mês) do legado tem que dar o mesmo valor na vigência.
function conferir(db, grupos) {
  const q = db.prepare('SELECT valor FROM vigencias WHERE modelo_id = ? AND ordem = ? AND vigente_de <= ? AND (vigente_ate IS NULL OR vigente_ate >= ?)');
  for (const g of grupos) {
    for (const [mes, valor] of g.meses) {
      const d = `${mes}-01`;
      const r = q.all(g.modeloId, g.ordem, d, d);
      if (r.length !== 1 || r[0].valor !== valor) throw new Error(`conferência falhou: modelo ${g.modeloId}, ${g.ordem}ª, ${mes}`);
    }
  }
}

export default {
  versao: 2,
  aplicar(db) {
    db.exec(SQL);

    // 1) veículos antigos → modelos
    const idPorLegado = new Map();
    const ciclo = new Set();
    for (const v of db.prepare('SELECT * FROM veiculos ORDER BY id').all()) {
      const c = CONHECIDOS[`${v.montadora}|${v.modelo}`.toLowerCase()];
      if (!c) throw new Error(`veículo legado sem mapeamento: ${v.montadora} ${v.modelo}`);
      const id = inserirModelo(db, c, v.id);
      idPorLegado.set(v.id, id);
      if (c.projetar_ciclo) ciclo.add(id);
    }
    for (const c of Object.values(CONHECIDOS)) {
      if (!db.prepare('SELECT 1 FROM modelos WHERE slug = ?').get(c.slug)) inserirModelo(db, c, null);
    }

    // 2) preços antigos agrupados por (modelo, ordem), um valor por mês
    const coletaId = Number(db.prepare("INSERT INTO coletas (fonte, inicio, fim, status, origem) VALUES ('legado', datetime('now'), datetime('now'), 'ok', 'migracao')").run().lastInsertRowid);
    const grupos = new Map();
    for (const p of db.prepare('SELECT veiculo_id, revisao, data_coleta, valor FROM precos ORDER BY data_coleta, id').all()) {
      const modeloId = idPorLegado.get(p.veiculo_id);
      const rev = lerRevisaoLegada(p.revisao);
      if (!modeloId || !rev || !rev.km) throw new Error(`preço legado ilegível: veículo ${p.veiculo_id}, "${p.revisao}"`);
      if (ciclo.has(modeloId) && rev.ordem > FIAT_PUBLICADAS) continue;
      const k = `${modeloId}|${rev.ordem}`;
      if (!grupos.has(k)) grupos.set(k, { modeloId, ordem: rev.ordem, km: rev.km, meses: new Map() });
      grupos.get(k).meses.set(String(p.data_coleta).slice(0, 7), Number(p.valor));
    }

    // 3) meses seguidos de mesmo valor viram uma faixa
    const ins = db.prepare('INSERT INTO vigencias (modelo_id, ordem, km, valor, vigente_de, vigente_ate, visto_em, coleta_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const alerta = db.prepare("INSERT INTO alertas (coleta_id, tipo, modelo_id, ordem, de, para, criado_em, enviado_em) VALUES (?, 'mudanca', ?, ?, ?, ?, ?, datetime('now'))");
    let itens = 0;
    for (const g of grupos.values()) {
      const faixas = [];
      for (const mes of [...g.meses.keys()].sort()) {
        const valor = g.meses.get(mes);
        const ult = faixas.at(-1);
        if (ult && ult.valor === valor) ult.ate = mes;
        else faixas.push({ valor, de: mes, ate: mes });
      }
      faixas.forEach((f, i) => {
        const prox = faixas[i + 1];
        ins.run(g.modeloId, g.ordem, g.km, f.valor, `${f.de}-01`, prox ? diaAnterior(`${prox.de}-01`) : null, `${f.ate}-01`, coletaId);
        if (i > 0) alerta.run(coletaId, g.modeloId, g.ordem, faixas[i - 1].valor, f.valor, `${f.de}-01 12:00:00`);
        itens++;
      });
    }
    db.prepare('UPDATE coletas SET itens = ? WHERE id = ?').run(itens, coletaId);

    conferir(db, grupos.values());
  },
};
