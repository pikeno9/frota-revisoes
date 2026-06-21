// Coletor de preços de revisão da Chevrolet (ferramenta de serviço da GM).
//
// O simulador (novoservico.gm.com, embutido no site da Chevrolet) carrega TODA
// a base de uma vez, de um JSON estático: json/data_pt-br.json. Cada registro tem
// {make, model, trim, year, mileDisplay, title, price} — onde price é uma string
// tipo "4 x R$ 105". Preço total = parcelas × valor da parcela.
// Então é só baixar o JSON e filtrar os modelos da frota. Headless, sem navegador.
//
// Uso:
//   node scrape-chevrolet.js          → coleta e envia para API_URL
//   node scrape-chevrolet.js --dry    → coleta e só imprime

import { enviar } from './ingest.js';

const DADOS = 'https://novoservico.gm.com/json/data_pt-br.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Modelos da frota na Chevrolet. `model`/`trim`/`year` casam com o JSON da GM;
// `appModelo` é como está no nosso banco.
const ALVOS = [
  { model: 'Onix Plus', year: '2026', trim: /Aspirado/i, appModelo: 'Onix Sedan Plus' },
];

// "4 x R$ 105" → 420 ; "R$ 420,00" → 420
function parsePreco(s) {
  const num = t => Number(t.replace(/\./g, '').replace(',', '.'));
  const parc = String(s).match(/(\d+)\s*x\s*R\$\s*([\d.,]+)/i);
  if (parc) return +(Number(parc[1]) * num(parc[2])).toFixed(2);
  const avista = String(s).match(/R\$\s*([\d.,]+)/);
  return avista ? +num(avista[1]).toFixed(2) : null;
}

async function coletar() {
  const r = await fetch(DADOS, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ao baixar o JSON da GM`);
  const base = await r.json();

  const itens = [];
  for (const alvo of ALVOS) {
    const recs = base
      .filter(x => x.model === alvo.model && String(x.year) === alvo.year && alvo.trim.test(x.trim))
      .sort((a, b) => a.mileDisplay - b.mileDisplay);
    if (!recs.length) { console.warn(`✗ ${alvo.appModelo}: nenhum registro encontrado`); continue; }
    console.log(`✓ ${alvo.appModelo}: ${recs.length} revisões`);
    recs.forEach((x, i) => {
      const valor = parsePreco(x.price);
      if (valor == null) return;
      itens.push({
        montadora: 'Chevrolet',
        modelo: alvo.appModelo,
        revisao: `${i + 1}ª revisão (${x.mileDisplay.toLocaleString('pt-BR')} km)`,
        valor,
      });
    });
  }
  return itens;
}

async function main() {
  const itens = await coletar();
  console.log(`\nTotal: ${itens.length} preços coletados.`);
  if (process.argv.includes('--dry')) { console.log(JSON.stringify(itens, null, 2)); return; }
  console.log('API:', await enviar(itens, 'scraper-chevrolet'));
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
