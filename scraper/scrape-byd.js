// Coletor de preços de revisão da BYD.
//
// A BYD publica os preços em PDFs estáticos (tabela: Revisão / Km / Preço).
// A página /br/plano-de-manutencao traz, no próprio HTML, o caminho atual de cada
// PDF (a pasta muda quando a BYD reajusta, ex: .../updates_02.06.2026/...), então
// descobrimos a URL dinamicamente — não há nada "chumbado".
//
// Tabela em PDF perde a ordem no texto cru, então lemos por COORDENADAS (x,y):
// agrupamos itens por linha (y) e, na linha de preço, juntamos por x e extraímos
// os valores em ordem de coluna.
//
// Uso:
//   node scrape-byd.js                      → coleta ao vivo e envia para API_URL
//   node scrape-byd.js --file caminho.pdf   → só testa o parser num PDF local
//   node scrape-byd.js --dry                → coleta ao vivo mas só imprime (não envia)

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';
import { enviar } from './ingest.js';

const PAGINA = 'https://www.byd.com/br/plano-de-manutencao';
const BASE = 'https://www.byd.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Modelos da frota que queremos coletar na BYD.
// `match` casa com o pdfPath do site; `modelo` é como está no nosso banco.
const ALVOS = [
  { modelo: 'Dolphin', match: /DOLPHIN e DOLPHIN Plus/i },
  { modelo: 'King',    match: /KING DM-i/i },
];

const brParaNumero = s => Number(s.replace(/\./g, '').replace(',', '.')); // "1.292,00" → 1292
const ehKm = s => /^\d{1,3}(\.\d{3})+$/.test(s);                          // "120.000"

// Lê a tabela (km + preços das 10 revisões) das coordenadas do PDF.
export async function parsePdf(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();

  // agrupa itens por linha (y arredondado)
  const linhas = new Map();
  for (const it of tc.items) {
    if (!it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    (linhas.get(y) || linhas.set(y, []).get(y)).push({ x: it.transform[4], s: it.str.trim() });
  }
  const ordenadaPorX = arr => arr.sort((a, b) => a.x - b.x);

  let linhaKm, linhaPreco;
  for (const itens of linhas.values()) {
    const txt = ordenadaPorX(itens).map(i => i.s).join('');
    if (/^Km\d/i.test(txt)) linhaKm = itens;            // "Km20.000..." (não os parágrafos)
    if (/^Pre[çc]o\s*\(R/i.test(txt)) linhaPreco = itens; // a célula "Preço (R$)...", não "Os preços..."
  }
  if (!linhaPreco) throw new Error('linha de preço não encontrada');

  // preços: junta tokens por x e extrai moeda em ordem de coluna
  const precoTxt = linhaPreco.map(i => i.s).join('');
  const precos = (precoTxt.match(/\d[\d.]*,\d{2}/g) || []).map(brParaNumero);
  // km: cada célula é um token limpo
  const kms = linhaKm ? linhaKm.map(i => i.s).filter(ehKm).map(s => Number(s.replace(/\./g, ''))) : [];

  if (!precos.length) throw new Error('nenhum preço reconhecido');
  return precos.map((valor, i) => ({
    ordem: i + 1,
    km: kms[i] ?? null,
    revisao: `${i + 1}ª revisão${kms[i] ? ` (${kms[i].toLocaleString('pt-BR')} km)` : ''}`,
    valor,
  }));
}

async function baixar(url, comoBuffer = false) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ao baixar ${url}`);
  return comoBuffer ? Buffer.from(await r.arrayBuffer()) : r.text();
}

// Descobre, no HTML, o pdfPath de cada modelo-alvo.
async function descobrirPdfs() {
  const html = await baixar(PAGINA);
  // os caminhos vêm entre crases/aspas e PODEM conter espaços e acentos
  // (ex: /material/.../DOLPHIN e DOLPHIN Plus (Todos).pdf)
  const caminhos = [...new Set((html.match(/\/material\/[^"'`\n]+?\.pdf/gi) || []))];
  return ALVOS.map(alvo => {
    const caminho = caminhos.find(c => alvo.match.test(decodeURIComponent(c)));
    return { ...alvo, url: caminho ? BASE + encodeURI(decodeURIComponent(caminho)) : null };
  });
}

async function coletar() {
  const pdfs = await descobrirPdfs();
  const itens = [];
  for (const p of pdfs) {
    if (!p.url) { console.warn(`✗ PDF não encontrado para ${p.modelo}`); continue; }
    const buf = await baixar(p.url, true);
    const revs = await parsePdf(buf);
    console.log(`✓ ${p.modelo}: ${revs.length} revisões`);
    for (const r of revs) itens.push({ montadora: 'BYD', modelo: p.modelo, revisao: r.revisao, valor: r.valor });
  }
  return itens;
}

async function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  if (fileIdx >= 0) {
    const buf = await readFile(args[fileIdx + 1]);
    console.log(JSON.stringify(await parsePdf(buf), null, 2));
    return;
  }
  const itens = await coletar();
  console.log(`\nTotal: ${itens.length} preços coletados.`);
  if (args.includes('--dry')) { console.log(JSON.stringify(itens, null, 2)); return; }
  console.log('API:', await enviar(itens, 'scraper-byd'));
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
