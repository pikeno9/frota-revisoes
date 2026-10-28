import { COLETORES } from './coletores/index.js';
import { buscarFrota } from './frota.js';
import { enviarPendentes } from './alertas.js';

export function dependencias(env) {
  return {
    coletores: COLETORES,
    buscarFrota: env.ATIVOS_URL && env.ATIVOS_TOKEN ? () => buscarFrota({ url: env.ATIVOS_URL, token: env.ATIVOS_TOKEN }) : null,
    enviar: (db, opcoes) => enviarPendentes(db, { env, ...opcoes }),
  };
}
