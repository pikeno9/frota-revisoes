// Para a tela Método: de onde vem cada número, com o endereço público para conferir.
import { estadoColetas } from './consultas.js';
import { urlPagina } from './revenda/mobiauto.js';
import { URL_BCB } from './revenda/ipca.js';
import { ultimoEstudo, lerPremissas } from './revenda/dados.js';

// Páginas que qualquer pessoa abre no navegador (o coletor lê os mesmos dados por trás).
export const PAGINAS_REVISAO = {
  vw: 'https://www.vwbr.com.br/revisao',
  byd: 'https://www.byd.com/br/plano-de-manutencao',
  gm: 'https://novoservico.gm.com/',
  fiat: 'https://servicos.fiat.com.br/revisao.html',
};
export const FIPE = 'https://veiculos.fipe.org.br/';
export const IPCA_12M = `${URL_BCB}/ultimos/12?formato=json`;
export const ATIVOS = 'https://veiculos.ocnbrasil.com.br';

// O que escolher no site da montadora para ver o mesmo plano.
function comoAchar(coletor, p) {
  if (coletor === 'vw') return [p.modelo, p.versao, p.ano].filter(Boolean).join(' · ');
  if (coletor === 'gm') return [p.model, p.trim, p.year].filter(Boolean).join(' · ');
  if (coletor === 'byd') return p.nome ?? '';
  if (coletor === 'fiat') return `ano ${p.modelYear} · concessionária de São Paulo (${p.dealer})`;
  return '';
}

// Busca da NaPista sem o ano (o coletor lê ano a ano).
const napista = (db, id) => {
  const c = db.prepare("SELECT caminho FROM fontes_modelo WHERE modelo_id = ? AND fonte = 'napista'").get(id)?.caminho;
  return c ? `https://napista.com.br/busca/${c}` : null;
};

const codigoFipe = (db, modelo) => (modelo == null ? null
  : db.prepare('SELECT codigo_fipe FROM fipe_precos WHERE fipe_modelo = ? AND codigo_fipe IS NOT NULL ORDER BY referencia DESC LIMIT 1').get(modelo)?.codigo_fipe ?? null);

export function fontes(db) {
  const modelos = db.prepare("SELECT * FROM modelos WHERE ativo = 1 ORDER BY origem = 'frota' DESC, qtd_frota DESC, nome").all();
  const ultimas = new Map(estadoColetas(db).fontes.map(f => [f.fonte, { fim: f.fim, status: f.status }]));
  return {
    revisoes: modelos.map(m => {
      const vigentes = db.prepare('SELECT COUNT(*) n, MAX(km) km FROM vigencias WHERE modelo_id = ? AND vigente_ate IS NULL').get(m.id);
      return {
        slug: m.slug, nome: m.nome, montadora: m.montadora, origem: m.origem, qtd_frota: m.qtd_frota,
        pagina: PAGINAS_REVISAO[m.coletor] ?? null, como_achar: comoAchar(m.coletor, JSON.parse(m.parametros)),
        revisoes: vigentes.n, km_max: vigentes.km, projetar: !!m.projetar_ciclo, ultima_coleta: ultimas.get(m.coletor) ?? null,
      };
    }),
    revenda: modelos.filter(m => m.fipe_modelo != null).map(m => {
      const d = ultimoEstudo(db, m.id)?.dados;
      const apoio = m.fipe_modelo_ref == null ? null : modelos.find(x => x.fipe_modelo === m.fipe_modelo_ref);
      return {
        slug: m.slug, nome: m.nome,
        codigo_fipe: codigoFipe(db, m.fipe_modelo),
        apoio: m.fipe_modelo_ref == null ? null : { codigo_fipe: codigoFipe(db, m.fipe_modelo_ref), nome: apoio?.nome ?? null },
        mobiauto: m.mobiauto_caminho ? urlPagina(m.mobiauto_caminho, 1) : null, filtro_versao: m.mobiauto_versao,
        napista: napista(db, m.id), filtro_napista: db.prepare("SELECT versao FROM fontes_modelo WHERE modelo_id = ? AND fonte = 'napista'").get(m.id)?.versao ?? null,
        anuncios: d?.consenso?.n_usados ?? d?.km?.n ?? 0,
        descartados: d?.consenso ? Object.values(d.consenso.contagem).reduce((t, c) => t + c.fora, 0) : d?.km?.descartados ?? 0,
        leilao: d?.consenso ? Object.values(d.consenso.contagem).reduce((t, c) => t + c.leilao + c.possivel_leilao, 0) : 0,
        repetidos: d?.consenso?.duplicados ?? 0,
        origem_r12: d?.r?.[12]?.emprestado ?? null, km_emprestado: !!d?.km_emprestado,
      };
    }),
    links: { fipe: FIPE, ipca: IPCA_12M, ativos: ATIVOS },
    coletas: Object.fromEntries(ultimas),
    premissas: lerPremissas(db),
  };
}
