// Planilha CSV → lista de objetos com os nomes de coluna que a importação entende.
// Aceita ponto e vírgula, vírgula ou tabulação (o que aparecer mais no cabeçalho), aspas e quebra de linha dentro de aspas.

const SEM_ACENTO = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const APELIDOS = {
  modelo: 'modelo', versao: 'versao', ano: 'ano_modelo', ano_modelo: 'ano_modelo', 'ano modelo': 'ano_modelo',
  km: 'km', quilometragem: 'km', preco: 'preco', valor: 'preco', vendedor: 'vendedor', loja: 'vendedor', anunciante: 'vendedor',
  tipo: 'tipo_vendedor', tipo_vendedor: 'tipo_vendedor', 'tipo de vendedor': 'tipo_vendedor', cidade: 'cidade',
  link: 'url', url: 'url', leilao: 'leilao', descricao: 'descricao', data: 'data', 'data da coleta': 'data', id: 'id',
};
export const coluna = nome => APELIDOS[SEM_ACENTO(String(nome).trim().toLowerCase())] ?? null;

function separador(primeira) {
  const conta = c => primeira.split(c).length - 1;
  return [';', ',', '\t'].sort((a, b) => conta(b) - conta(a))[0];
}

export function lerCsv(texto) {
  const t = String(texto).replace(/^﻿/, '');
  const sep = separador(t.split(/\r?\n/, 1)[0]);
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some(v => v.trim() !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some(v => v.trim() !== '')) linhas.push(linha);
  if (!linhas.length) return { colunas: [], ignoradas: [], anuncios: [] };
  const cab = linhas[0].map(coluna);
  return {
    colunas: [...new Set(cab.filter(Boolean))],
    ignoradas: linhas[0].filter((_, i) => !cab[i]).map(s => s.trim()).filter(Boolean),
    anuncios: linhas.slice(1).map(l => Object.fromEntries(cab.map((k, i) => [k, l[i]?.trim() ?? '']).filter(([k]) => k))),
  };
}
