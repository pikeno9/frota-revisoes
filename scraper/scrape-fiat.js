// Coletor de preços de revisão da Fiat.
//
// O site servicos.fiat.com.br/revisao.html é um SPA Vue pesado (e instável p/
// automação de UI), mas por trás usa microserviços REST que respondem headless,
// SEM bloqueio anti-bot. O endpoint de preço é:
//   GET maintenance-service.k8s.fcalatam.com.br/v3/maintenance
//       ?brand=FIAT&market=pt-BR&modelYear=2026&mvsCode=358ATS1&dealer=919654
// Retorna um array de serviços (DF01..DF05) com o campo `totalPrice`.
//
// Preços da Fiat são POR CONCESSIONÁRIA → usamos um dealer fixo em São Paulo
// (919654), consistente com a localização da frota. O `mvsCode` identifica o
// modelo+versão (descoberto via o fluxo do site; estável por modelo).
//
// Uso:
//   node scrape-fiat.js          → coleta e envia para API_URL
//   node scrape-fiat.js --dry    → coleta e só imprime

import { enviar } from './ingest.js';

const BASE = 'https://maintenance-service.k8s.fcalatam.com.br/v3/maintenance';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Concessionária de referência em São Paulo/SP (define o preço).
const DEALER = '919654';

// Modelos da frota na Fiat. `mvsCode`/`modelYear` casam com a API;
// `appModelo` é como está no nosso banco.
const ALVOS = [
  { mvsCode: '358ATS1', modelYear: 2026, appModelo: 'Argo Drive' },
];

async function coletarModelo(alvo) {
  const url = `${BASE}?brand=FIAT&market=pt-BR&modelYear=${alvo.modelYear}&mvsCode=${encodeURIComponent(alvo.mvsCode)}&dealer=${DEALER}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ao consultar ${alvo.appModelo}`);
  const arr = await r.json();
  const base = arr
    .filter(it => it.totalPrice != null)
    .sort((a, b) => a.km - b.km)
    .map(it => it.totalPrice);
  if (!base.length) return [];
  // A Fiat publica só 5 revisões, que se repetem em ciclo (a 6ª = a 1ª, etc.).
  // Projetamos 10 revisões para igualar a visualização dos demais modelos.
  return Array.from({ length: 10 }, (_, i) => ({
    ordem: i + 1,
    km: (i + 1) * 10000,
    valor: base[i % base.length],
  }));
}

async function coletar() {
  const itens = [];
  for (const alvo of ALVOS) {
    try {
      const revs = await coletarModelo(alvo);
      console.log(`✓ ${alvo.appModelo}: ${revs.length} revisões`);
      for (const r of revs) {
        itens.push({
          montadora: 'Fiat',
          modelo: alvo.appModelo,
          revisao: `${r.ordem}ª revisão (${r.km.toLocaleString('pt-BR')} km)`,
          valor: r.valor,
        });
      }
    } catch (e) {
      console.warn(`✗ ${alvo.appModelo}: ${e.message}`);
    }
  }
  return itens;
}

async function main() {
  const itens = await coletar();
  console.log(`\nTotal: ${itens.length} preços coletados.`);
  if (process.argv.includes('--dry')) { console.log(JSON.stringify(itens, null, 2)); return; }
  console.log('API:', await enviar(itens, 'scraper-fiat'));
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
