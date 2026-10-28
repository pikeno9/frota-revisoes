// Coletor de preços de revisão da BYD.
//
// A página /br/plano-de-manutencao traz os preços no próprio HTML, então basta
// baixá-la e ler a tabela.
//
// Uso:
//   node scrape-byd.js                      → coleta ao vivo e envia para API_URL
//   node scrape-byd.js --dry                → coleta ao vivo mas só imprime (não envia)

import { enviar } from './ingest.js';

const PAGINA = 'https://www.byd.com/br/plano-de-manutencao';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// A página passou a trazer os preços no próprio HTML (out/2026), como objetos
// {"n":"BYD King","img":..,"km":[..],"p":[..]}. Não há mais PDF.
const ALVOS_HTML = [
  { modelo: 'Dolphin', nome: 'BYD Dolphin / Dolphin Plus' },
  { modelo: 'King',    nome: 'BYD King' },
];
const RE_BYD = /\{"n":"([^"]+)"[^{}]*?"km":\[([^\]]*)\],"p":\[([^\]]*)\]/g;

async function baixar(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ao baixar ${url}`);
  return r.text();
}

async function coletar() {
  const html = await baixar(PAGINA);
  const lista = [...html.matchAll(RE_BYD)].map(m => ({ nome: m[1], km: m[2].split(',').map(Number), p: m[3].split(',').map(Number) }));
  if (!lista.length) throw new Error('tabela de preços não encontrada na página');
  const itens = [];
  for (const alvo of ALVOS_HTML) {
    const t = lista.find(x => x.nome === alvo.nome);
    if (!t) { console.warn(`✗ ${alvo.modelo} não está na página`); continue; }
    console.log(`✓ ${alvo.modelo}: ${t.p.length} revisões`);
    t.p.forEach((valor, i) => itens.push({ montadora: 'BYD', modelo: alvo.modelo, revisao: `${i + 1}ª revisão (${t.km[i].toLocaleString('pt-BR')} km)`, valor }));
  }
  return itens;
}

async function main() {
  const args = process.argv.slice(2);
  const itens = await coletar();
  console.log(`\nTotal: ${itens.length} preços coletados.`);
  if (args.includes('--dry')) { console.log(JSON.stringify(itens, null, 2)); return; }
  console.log('API:', await enviar(itens, 'scraper-byd'));
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
