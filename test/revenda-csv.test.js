import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerCsv, coluna } from '../public/js/revenda/csv.js';

test('lerCsv: ponto e vírgula do Excel, BOM, aspas com separador e quebra de linha, nomes de coluna com acento', () => {
  const r = lerCsv('﻿Modelo;Versão;Ano;Km;Preço;Descrição;Coluna X\r\nPolo Track;"Track; 1.0";2025;45.000;R$ 76.000;"carro de\nleilão";x\r\n\r\nArgo Drive;Drive;2024;70000;69900;;\r\n');
  assert.deepEqual(r.colunas, ['modelo', 'versao', 'ano_modelo', 'km', 'preco', 'descricao']);
  assert.deepEqual(r.ignoradas, ['Coluna X']);
  assert.equal(r.anuncios.length, 2);
  assert.deepEqual(r.anuncios[0], { modelo: 'Polo Track', versao: 'Track; 1.0', ano_modelo: '2025', km: '45.000', preco: 'R$ 76.000', descricao: 'carro de\nleilão' });
});

test('lerCsv: vírgula e tabulação também servem', () => {
  assert.equal(lerCsv('modelo,ano,km,preco\nPolo Track,2025,1,"75,5"').anuncios[0].preco, '75,5');
  assert.equal(lerCsv('modelo\tano\tkm\tvalor\nPolo Track\t2025\t1\t75000').anuncios[0].preco, '75000');
});

test('coluna: apelidos', () => {
  assert.equal(coluna('Quilometragem'), 'km');
  assert.equal(coluna(' Link '), 'url');
  assert.equal(coluna('Data da coleta'), 'data');
  assert.equal(coluna('Anunciante'), 'vendedor');
  assert.equal(coluna('cor'), null);
});
