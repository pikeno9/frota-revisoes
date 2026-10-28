// Rotas antigas, só leitura, no formato que o KPIs (ocn-kpis-site/lib/revisoes.js) lê.
// A projeção em ciclo da Fiat (6ª a 10ª) existe só aqui, para o UE não mudar.
import { Router } from 'express';

const idCompat = m => m.legado_veiculo_id ?? 1000 + m.id;

export function veiculosCompat(db) {
  return db.prepare('SELECT * FROM modelos WHERE ativo = 1 ORDER BY montadora, nome').all().map(m => ({
    id: idCompat(m), montadora: m.montadora, modelo: m.nome, versao: m.versao, ano: null, apelido: m.nome, criado_em: m.criado_em,
  }));
}

const texto = (ordem, km) => `${ordem}ª revisão (${km.toLocaleString('pt-BR')} km)`;

export function precosCompat(db, veiculoId = null) {
  const linhas = [];
  for (const m of db.prepare('SELECT * FROM modelos WHERE ativo = 1').all()) {
    const vid = idCompat(m);
    if (veiculoId != null && vid !== Number(veiculoId)) continue;
    const vigs = db.prepare('SELECT * FROM vigencias WHERE modelo_id = ? ORDER BY ordem, vigente_de').all(m.id);
    for (const v of vigs) linhas.push({ id: v.id, veiculo_id: vid, revisao: texto(v.ordem, v.km), data_coleta: v.vigente_de, valor: v.valor, fonte: 'scraper', obs: null });
    if (m.projetar_ciclo) {
      const atuais = vigs.filter(v => !v.vigente_ate).sort((a, b) => a.ordem - b.ordem);
      const n = atuais.length;
      const ultima = atuais.reduce((d, v) => (v.vigente_de > d ? v.vigente_de : d), '');
      for (let o = n + 1; n > 0 && o <= 10; o++) {
        const base = atuais[(o - 1) % n];
        linhas.push({ id: -(m.id * 100 + o), veiculo_id: vid, revisao: texto(o, o * atuais[0].km), data_coleta: ultima, valor: base.valor, fonte: 'projecao', obs: null });
      }
    }
  }
  return linhas.sort((a, b) => b.data_coleta.localeCompare(a.data_coleta) || b.id - a.id);
}

export function rotasCompat(db) {
  const r = Router();
  r.get('/api/veiculos', (req, res) => res.json(veiculosCompat(db)));
  r.get('/api/precos', (req, res) => res.json(precosCompat(db, req.query.veiculo_id ?? null)));
  return r;
}
