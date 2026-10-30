// Leilão pela descrição do anúncio: 1 quando fala de leilão, 0 quando nega ("não é de leilão",
// "sem passagem por leilão", "nunca foi a leilão"), null quando não fala.
const LEILAO = /leil[aã]o/i;
const NEGA = /\b(n[aã]o|sem|nunca|nenhuma?)\b[^.;!?\n]{0,30}leil[aã]o/i;

export function leilaoNaDescricao(texto) {
  const t = String(texto ?? '');
  if (!LEILAO.test(t)) return null;
  // Uma frase que nega e outra que afirma ("não é de leilão... carro de leilão") fica como leilão.
  const semNegacoes = t.replace(new RegExp(NEGA.source, 'gi'), '');
  return LEILAO.test(semNegacoes) ? 1 : 0;
}

// Valor de uma coluna "leilão" de planilha: sim/não, 1/0, true/false, x. Vazio ou outra coisa: null.
export function leilaoNaColuna(v) {
  const t = String(v ?? '').trim().toLowerCase();
  if (['sim', 's', '1', 'true', 'x', 'yes', 'y'].includes(t)) return 1;
  if (['não', 'nao', 'n', '0', 'false', 'no'].includes(t)) return 0;
  return null;
}
