// A base de anúncios: uma linha por anúncio por coleta, com filtros, página e CSV para baixar.
import { ErroRevenda } from './consultas.js';

export const POR_PAGINA = 100;
export const CATEGORIAS = { combustao: [5], eletrico: [4], hibrido: [6] };
export const CATEGORIA_DO_COMBUSTIVEL = { 5: 'combustao', 4: 'eletrico', 6: 'hibrido' };
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// Filtros da query: modelo (slug), fonte, categoria, leilao (sim | nao | sem_info), de e ate (data da coleta).
function onde(q) {
  const cond = [], args = [];
  if (q.modelo) { cond.push('m.slug = ?'); args.push(String(q.modelo)); }
  if (q.fonte) { cond.push('a.fonte = ?'); args.push(String(q.fonte)); }
  if (q.categoria) {
    const c = CATEGORIAS[q.categoria];
    if (!c) throw new ErroRevenda(400, 'categoria deve ser combustao, eletrico ou hibrido');
    cond.push(`m.fipe_combustivel IN (${c.join(',')})`);
  }
  if (q.leilao) {
    const l = { sim: 'a.leilao = 1', nao: 'a.leilao = 0', sem_info: 'a.leilao IS NULL' }[q.leilao];
    if (!l) throw new ErroRevenda(400, 'leilão deve ser sim, nao ou sem_info');
    cond.push(l);
  }
  for (const [k, op] of [['de', '>='], ['ate', '<=']]) {
    if (!q[k]) continue;
    if (!DATA.test(String(q[k]))) throw new ErroRevenda(400, `${k}: data no formato AAAA-MM-DD`);
    cond.push(`l.data ${op} ?`); args.push(String(q[k]));
  }
  return { sql: cond.length ? `WHERE ${cond.join(' AND ')}` : '', args };
}

const BASE = `FROM anuncio_leituras l JOIN anuncios a ON a.id_externo = l.id_externo JOIN modelos m ON m.id = a.modelo_id`;
const COLUNAS = `l.data, a.fonte, m.slug, m.nome AS modelo, m.fipe_combustivel, a.versao, a.ano_modelo, l.km, l.preco,
  a.loja AS vendedor, a.tipo_vendedor, a.leilao, a.leilao_por, a.cidade, a.url, a.id_externo`;

const linha = r => ({
  data: r.data, fonte: r.fonte, slug: r.slug, modelo: r.modelo, categoria: CATEGORIA_DO_COMBUSTIVEL[r.fipe_combustivel] ?? null,
  versao: r.versao, ano_modelo: r.ano_modelo, km: r.km, preco: r.preco, vendedor: r.vendedor, tipo_vendedor: r.tipo_vendedor,
  leilao: r.leilao, leilao_por: r.leilao_por, cidade: r.cidade, url: r.url, id: r.id_externo,
});

export function listarAnuncios(db, q = {}) {
  const { sql, args } = onde(q);
  const pagina = Math.max(1, Number.parseInt(q.pagina, 10) || 1);
  const total = db.prepare(`SELECT COUNT(*) n ${BASE} ${sql}`).get(...args).n;
  const linhas = db.prepare(`SELECT ${COLUNAS} ${BASE} ${sql} ORDER BY l.data DESC, m.nome, l.preco LIMIT ? OFFSET ?`)
    .all(...args, POR_PAGINA, (pagina - 1) * POR_PAGINA).map(linha);
  const porFonte = db.prepare(`SELECT a.fonte, COUNT(*) n, COUNT(DISTINCT a.id_externo) anuncios, MAX(l.data) ultima ${BASE} ${sql} GROUP BY a.fonte ORDER BY n DESC`).all(...args).map(r => ({ ...r }));
  return {
    total, pagina, por_pagina: POR_PAGINA, linhas, por_fonte: porFonte,
    fontes: db.prepare('SELECT DISTINCT fonte FROM anuncios WHERE fonte IS NOT NULL ORDER BY fonte').all().map(r => r.fonte),
  };
}

// CSV que o Excel em português abre direto: BOM, ponto e vírgula, vírgula decimal, aspas quando precisa.
const CABECALHO = ['Data da coleta', 'Fonte', 'Modelo', 'Categoria', 'Versão', 'Ano', 'Km', 'Preço', 'Vendedor', 'Tipo de vendedor', 'Leilão', 'Cidade', 'Link', 'Id'];
const ROTULO_CATEGORIA = { combustao: 'Combustão', eletrico: 'Elétrico', hibrido: 'Híbrido' };
const celula = v => {
  if (v == null) return '';
  const t = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function csvAnuncios(db, q = {}) {
  const { sql, args } = onde(q);
  const linhas = db.prepare(`SELECT ${COLUNAS} ${BASE} ${sql} ORDER BY l.data DESC, m.nome, l.preco`).all(...args).map(linha);
  const corpo = linhas.map(r => [
    r.data, r.fonte, r.modelo, ROTULO_CATEGORIA[r.categoria] ?? '', r.versao, r.ano_modelo, r.km, r.preco, r.vendedor, r.tipo_vendedor,
    r.leilao == null ? '' : r.leilao ? 'Sim' : 'Não', r.cidade, r.url, r.id,
  ].map(celula).join(';'));
  return `﻿${[CABECALHO.join(';'), ...corpo].join('\r\n')}\r\n`;
}
