// Ida e volta do Entrar com Google. A sessão é a mesma do login por senha.
import { Router } from 'express';
import { cookieSessao, lerCookie } from '../auth.js';
import { registrarAcesso } from '../usuarios.js';
import {
  COOKIE_GOOGLE, googleLigado, enderecoRetorno, voltaSegura, novaIda, lerIda, urlDoGoogle, conferirIdToken, trocarCodigo, contaDoGoogle,
} from '../google.js';

const cookieIda = (req, valor, maxAge) =>
  `${COOKIE_GOOGLE}=${valor}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`;

export function rotasGoogle(db, env, { fetchGoogle = fetch } = {}) {
  const r = Router();

  r.get('/api/google/entrar', (req, res) => {
    if (!googleLigado(env)) return res.redirect(302, '/entrar');
    const { ida, cookie } = novaIda({ volta: req.query.volta, auto: req.query.auto === '1' }, env.SESSION_SECRET);
    res.setHeader('Set-Cookie', cookieIda(req, cookie, 600));
    res.redirect(302, urlDoGoogle(ida, env, enderecoRetorno(req, env)));
  });

  r.get('/api/google/retorno', async (req, res, next) => {
    if (!googleLigado(env)) return res.redirect(302, '/entrar');
    const cookies = [cookieIda(req, '', 0)];
    const ida = lerIda(lerCookie(req, COOKIE_GOOGLE), env.SESSION_SECRET);
    // Entrada automática (vinda do Hub) que não deu certo cai na tela Entrar sem mensagem.
    const recusar = motivo => {
      res.setHeader('Set-Cookie', cookies);
      if (ida?.auto) return res.redirect(302, ida.volta === '/' ? '/entrar' : `/entrar?volta=${encodeURIComponent(ida.volta)}`);
      res.redirect(302, `/entrar?google=${motivo}`);
    };
    try {
      if (!ida || typeof req.query.state !== 'string' || req.query.state !== ida.state || typeof req.query.code !== 'string') return recusar('falhou');
      const idToken = await trocarCodigo(fetchGoogle, { code: req.query.code, verificador: ida.verificador, retorno: enderecoRetorno(req, env), env });
      if (!idToken) return recusar('falhou');
      const email = conferirIdToken(idToken, env.GOOGLE_CLIENT_ID, ida.nonce);
      const u = email ? contaDoGoogle(db, email) : null;
      if (!u) { console.warn('google: entrada recusada (sem conta ativa ou fora do domínio)'); return recusar('sem-acesso'); }
      registrarAcesso(db, u);
      res.setHeader('Set-Cookie', [...cookies, cookieSessao(req, u, env)]);
      res.redirect(302, voltaSegura(ida.volta));
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'TypeError') { console.warn('google: falha ao falar com o Google'); return recusar('falhou'); }
      next(e);
    }
  });
  return r;
}
