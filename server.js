// Servidor Express — API REST + serve o frontend estático.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Auto-cadastro inicial: se não houver veículos, insere a frota base.
// Útil no primeiro deploy na nuvem (banco novo e vazio).
const { n } = db.prepare('SELECT COUNT(*) AS n FROM veiculos').get();
if (n === 0) {
  const ins = db.prepare(
    'INSERT INTO veiculos (montadora, modelo, versao, ano, apelido) VALUES (?, ?, ?, ?, ?)'
  );
  ins.run('Volkswagen', 'Tera',            '1.0 MPI',        null, 'Tera');
  ins.run('GAC',        'Aion ES Plus',    null,             null, 'Aion ES Plus');
  ins.run('Fiat',       'Argo Drive',      '1.0',            null, 'Argo Drive');
  ins.run('Chevrolet',  'Onix Sedan Plus', '1.0 12V Mec.',   null, 'Onix Sedan Plus');
  ins.run('BYD',        'Dolphin',         'EV GS',          null, 'Dolphin');
  ins.run('BYD',        'King',            'GL 1.5 DM-i',     null, 'King');
  console.log('Frota base cadastrada (6 veículos).');
}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── Veículos ──────────────────────────────────────────────
app.get('/api/veiculos', (req, res) => {
  const rows = db.prepare('SELECT * FROM veiculos ORDER BY montadora, modelo').all();
  res.json(rows);
});

app.post('/api/veiculos', (req, res) => {
  const { montadora, modelo, versao, ano, apelido } = req.body;
  if (!montadora || !modelo) {
    return res.status(400).json({ erro: 'montadora e modelo são obrigatórios' });
  }
  const r = db.prepare(
    'INSERT INTO veiculos (montadora, modelo, versao, ano, apelido) VALUES (?, ?, ?, ?, ?)'
  ).run(montadora, modelo, versao ?? null, ano ?? null, apelido ?? null);
  res.status(201).json({ id: r.lastInsertRowid });
});

app.delete('/api/veiculos/:id', (req, res) => {
  db.prepare('DELETE FROM veiculos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Preços ────────────────────────────────────────────────
// Lista o histórico completo, opcionalmente filtrado por veículo.
app.get('/api/precos', (req, res) => {
  const { veiculo_id } = req.query;
  const sql = veiculo_id
    ? 'SELECT * FROM precos WHERE veiculo_id = ? ORDER BY revisao, data_coleta'
    : 'SELECT * FROM precos ORDER BY data_coleta DESC';
  const rows = veiculo_id
    ? db.prepare(sql).all(veiculo_id)
    : db.prepare(sql).all();
  res.json(rows);
});

app.post('/api/precos', (req, res) => {
  const { veiculo_id, revisao, data_coleta, valor, fonte, obs } = req.body;
  if (!veiculo_id || !revisao || !data_coleta || valor == null) {
    return res.status(400).json({ erro: 'veiculo_id, revisao, data_coleta e valor são obrigatórios' });
  }
  const r = db.prepare(
    `INSERT INTO precos (veiculo_id, revisao, data_coleta, valor, fonte, obs)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(veiculo_id, revisao, data_coleta, Number(valor), fonte ?? 'manual', obs ?? null);
  res.status(201).json({ id: r.lastInsertRowid });
});

app.delete('/api/precos/:id', (req, res) => {
  db.prepare('DELETE FROM precos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Resumo p/ dashboard: último preço por (veículo, revisão) ──
app.get('/api/resumo', (req, res) => {
  const rows = db.prepare(`
    SELECT p.veiculo_id, v.montadora, v.modelo, v.apelido, v.ano,
           p.revisao, p.valor, p.data_coleta
    FROM precos p
    JOIN veiculos v ON v.id = p.veiculo_id
    WHERE p.id IN (
      SELECT id FROM precos p2
      WHERE p2.veiculo_id = p.veiculo_id AND p2.revisao = p.revisao
      ORDER BY data_coleta DESC, id DESC
      LIMIT 1
    )
    ORDER BY v.montadora, v.modelo, p.revisao
  `).all();
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Frota Revisões → http://localhost:${PORT}\n`);
});
