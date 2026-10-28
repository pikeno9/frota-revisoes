// FIPE oficial (veiculos.fipe.org.br): histórico livre, uma consulta por preço.
// Sem resultado a FIPE devolve {"codigo":"0","erro":"nadaencontrado"}: vira null, não erro.
import { UA, TEMPO_LIMITE_MS } from '../coletores/http.js';

const BASE = 'https://veiculos.fipe.org.br/api/veiculos';
const NOMES = { janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

// "outubro/2026 " ou "outubro de 2025 " → "2026-10"
export function mesDeTexto(texto) {
  const m = String(texto ?? '').trim().toLowerCase().match(/^([a-zç]+)(?:\/|\s+de\s+)(\d{4})$/);
  if (!m || !NOMES[m[1]]) return null;
  return `${m[2]}-${String(NOMES[m[1]]).padStart(2, '0')}`;
}

// "R$ 77.170,00" → 77170
export function valorEmReais(texto) {
  const m = String(texto ?? '').match(/R\$\s*([\d.]+,\d{2})/);
  return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null;
}

export function lerReferencias(json) {
  if (!Array.isArray(json)) throw new Error('FIPE: lista de referências em formato inesperado');
  return json.map(x => ({ codigo: Number(x.Codigo), mes: mesDeTexto(x.Mes) })).filter(x => x.codigo > 0 && x.mes);
}

export function lerValor(json) {
  if (json?.erro === 'nadaencontrado') return null;
  const valor = valorEmReais(json?.Valor);
  const ano_modelo = Number(json?.AnoModelo);
  const referencia = mesDeTexto(json?.MesReferencia);
  if (valor == null || !Number.isFinite(ano_modelo) || !referencia) throw new Error(`FIPE: resposta inesperada ${JSON.stringify(json).slice(0, 80)}`);
  return { valor, codigo_fipe: json.CodigoFipe ?? null, ano_modelo, referencia };
}

async function postar(buscar, caminho, campos) {
  const r = await buscar(`${BASE}/${caminho}`, {
    method: 'POST',
    headers: {
      'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Referer: 'https://veiculos.fipe.org.br/', 'X-Requested-With': 'XMLHttpRequest',
    },
    body: new URLSearchParams(campos).toString(),
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  });
  if (!r.ok) throw new Error(`FIPE respondeu ${r.status}`);
  return r.json();
}

export async function referencias(buscar = fetch) {
  return lerReferencias(await postar(buscar, 'ConsultarTabelaDeReferencia', {}));
}

// codigoReferencia: 338 = out/2026; ano: 32000 = zero km; combustivel: 5 Flex, 4 Elétrico, 6 Híbrido
export async function valor({ codigoReferencia, marca, modelo, ano, combustivel }, buscar = fetch) {
  return lerValor(await postar(buscar, 'ConsultarValorComTodosParametros', {
    codigoTabelaReferencia: codigoReferencia, codigoMarca: marca, codigoModelo: modelo, codigoTipoVeiculo: 1,
    anoModelo: ano, codigoTipoCombustivel: combustivel, tipoVeiculo: 'carro', modeloCodigoExterno: '', tipoConsulta: 'tradicional',
  }));
}
