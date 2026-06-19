// Pré-cadastra os veículos iniciais da frota.
// Rode uma vez: npm run seed
import { db } from './db.js';

const veiculos = [
  { montadora: 'Volkswagen', modelo: 'Tera',            versao: '1.0 MPI',      ano: null, apelido: 'Tera' },
  { montadora: 'Volkswagen', modelo: 'Polo Track',      versao: '1.0',          ano: null, apelido: 'Polo Track' },
  { montadora: 'Fiat',       modelo: 'Argo Drive',      versao: '1.0',          ano: null, apelido: 'Argo Drive' },
  { montadora: 'Chevrolet',  modelo: 'Onix Sedan Plus', versao: '1.0 12V Mec.', ano: null, apelido: 'Onix Sedan Plus' },
  { montadora: 'BYD',        modelo: 'Dolphin',         versao: 'EV GS',        ano: null, apelido: 'Dolphin' },
  { montadora: 'BYD',        modelo: 'King',            versao: 'GL 1.5 DM-i',  ano: null, apelido: 'King' },
];

const existe = db.prepare(
  'SELECT 1 FROM veiculos WHERE montadora = ? AND modelo = ? AND ano = ?'
);
const insere = db.prepare(
  'INSERT INTO veiculos (montadora, modelo, versao, ano, apelido) VALUES (?, ?, ?, ?, ?)'
);

let novos = 0;
for (const v of veiculos) {
  if (existe.get(v.montadora, v.modelo, v.ano)) {
    console.log(`• já existe: ${v.montadora} ${v.modelo} ${v.ano}`);
    continue;
  }
  insere.run(v.montadora, v.modelo, v.versao, v.ano, v.apelido);
  novos++;
  console.log(`✓ cadastrado: ${v.montadora} ${v.modelo} ${v.ano}`);
}
console.log(`\n${novos} veículo(s) novo(s).`);
