// Grava o resultado de um coletor para um modelo: faixas de vigência + alertas.
// Síncrona: quem chama envolve em transacao().
import { diaAnterior } from './datas.js';

export const VALOR_MIN = 50;
export const VALOR_MAX = 30000;
export const SALTO_CONFERIR = 0.4;

const centavos = v => Math.round(Number(v) * 100) / 100;

export function validar(itens, qtdAtual) {
  if (!Array.isArray(itens) || itens.length === 0) return 'nenhuma revisão coletada';
  const ordens = new Set();
  for (const it of itens) {
    if (!Number.isInteger(it.ordem) || it.ordem < 1) return `ordem inválida: ${it.ordem}`;
    if (ordens.has(it.ordem)) return `ordem repetida: ${it.ordem}`;
    ordens.add(it.ordem);
    if (!Number.isInteger(it.km) || it.km <= 0) return `km inválido na ${it.ordem}ª`;
    if (!(it.valor >= VALOR_MIN && it.valor <= VALOR_MAX)) return `valor fora da faixa na ${it.ordem}ª: ${it.valor}`;
  }
  if (itens.length < qtdAtual) return `vieram ${itens.length} revisões, havia ${qtdAtual}`;
  return null;
}

export function gravarModelo(db, { modeloId, itens, coletaId, data }) {
  const atuais = db.prepare('SELECT * FROM vigencias WHERE modelo_id = ? AND vigente_ate IS NULL').all(modeloId);
  const alerta = db.prepare('INSERT INTO alertas (coleta_id, tipo, modelo_id, ordem, de, para, texto) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const erro = validar(itens, atuais.length);
  if (erro) {
    alerta.run(coletaId, 'falha', modeloId, null, null, null, erro);
    return { erro, mudancas: 0, itens: 0 };
  }

  const porOrdem = new Map(atuais.map(v => [v.ordem, v]));
  const abrir = db.prepare('INSERT INTO vigencias (modelo_id, ordem, km, meses, valor, vigente_de, visto_em, coleta_id, conferir) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const fechar = db.prepare('UPDATE vigencias SET vigente_ate = ? WHERE id = ?');
  const confirmar = db.prepare('UPDATE vigencias SET visto_em = ?, km = ?, meses = COALESCE(?, meses) WHERE id = ?');
  const corrigir = db.prepare('UPDATE vigencias SET valor = ?, conferir = ?, visto_em = ?, coleta_id = ? WHERE id = ?');

  let mudancas = 0;
  for (const it of itens) {
    const valor = centavos(it.valor);
    const meses = it.meses ?? null;
    const at = porOrdem.get(it.ordem);
    if (!at) {
      abrir.run(modeloId, it.ordem, it.km, meses, valor, data, data, coletaId, 0);
      alerta.run(coletaId, 'nova_revisao', modeloId, it.ordem, null, valor, null);
      mudancas++;
      continue;
    }
    if (centavos(at.valor) === valor) { confirmar.run(data, it.km, meses, at.id); continue; }

    const salto = Math.abs(valor - at.valor) / at.valor > SALTO_CONFERIR ? 1 : 0;
    if (at.vigente_de === data) corrigir.run(valor, salto, data, coletaId, at.id);
    else {
      fechar.run(diaAnterior(data), at.id);
      abrir.run(modeloId, it.ordem, it.km, meses, valor, data, data, coletaId, salto);
    }
    alerta.run(coletaId, 'mudanca', modeloId, it.ordem, at.valor, valor, null);
    if (salto) alerta.run(coletaId, 'conferir', modeloId, it.ordem, at.valor, valor, null);
    mudancas++;
  }

  const vieram = new Set(itens.map(i => i.ordem));
  for (const at of atuais) {
    if (!vieram.has(at.ordem)) alerta.run(coletaId, 'sumiu_revisao', modeloId, at.ordem, at.valor, null, null);
  }
  return { erro: null, mudancas, itens: itens.length };
}
