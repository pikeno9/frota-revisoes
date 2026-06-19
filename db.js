// Camada de banco de dados — SQLite nativo do Node (sem dependências externas).
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Em produção (Railway) apontamos DB_PATH para o volume permanente,
// ex: /data/revisoes.db. Localmente, fica na própria pasta do projeto.
const DB_PATH = process.env.DB_PATH || join(__dirname, 'revisoes.db');
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;'); // remover veículo apaga seus preços (cascade)

// Esquema:
//  veiculos  → cada modelo da frota que acompanhamos
//  precos    → histórico de preços de revisão (uma linha por coleta)
//
// O histórico nasce de várias linhas em `precos` para o mesmo
// (veiculo_id, revisao) ao longo do tempo. O preço "atual" é a
// coleta mais recente.
db.exec(`
  CREATE TABLE IF NOT EXISTS veiculos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    montadora TEXT NOT NULL,
    modelo    TEXT NOT NULL,
    versao    TEXT,
    ano       TEXT,                         -- ex: "26/26"
    apelido   TEXT,
    criado_em TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS precos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    veiculo_id  INTEGER NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
    revisao     TEXT NOT NULL,              -- ex: "1ª revisão (10.000 km / 12 meses)"
    data_coleta TEXT NOT NULL,              -- YYYY-MM-DD em que o preço foi observado
    valor       REAL NOT NULL,              -- em R$
    fonte       TEXT DEFAULT 'manual',      -- manual | scraper
    obs         TEXT,
    criado_em   TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_precos_veiculo ON precos(veiculo_id);
`);
