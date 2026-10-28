import { COLETORES } from './coletores/index.js';
import { buscarFrota } from './frota.js';
import { enviarPendentes } from './alertas.js';
import * as fipe from './revenda/fipe.js';
import * as mobiauto from './revenda/mobiauto.js';
import * as ipca from './revenda/ipca.js';

export function dependencias(env) {
  return {
    coletores: COLETORES,
    buscarFrota: env.ATIVOS_URL && env.ATIVOS_TOKEN ? () => buscarFrota({ url: env.ATIVOS_URL, token: env.ATIVOS_TOKEN }) : null,
    enviar: (db, opcoes) => enviarPendentes(db, { env, ...opcoes }),
    revenda: { fipe, mobiauto, ipca },
  };
}
