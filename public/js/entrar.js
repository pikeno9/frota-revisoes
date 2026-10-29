import { post } from './api.js';
import { ir, atualizarSessao } from './app.js';

export async function entrar(tela) {
  tela.innerHTML = `<form class="entrar" id="f-entrar">
    <img class="entrar-logo" src="/img/ocn-logo.png" alt="OCN">
    <h1>Preços</h1>
    <label>Usuário<input name="usuario" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></label>
    <label>Senha<input type="password" name="senha" autocomplete="current-password" required></label>
    <button class="btn" type="submit">Entrar</button>
    <p class="erro" id="e-entrar" role="alert" hidden></p>
  </form>`;
  tela.querySelector('#f-entrar').addEventListener('submit', async e => {
    e.preventDefault();
    const botao = e.target.querySelector('button');
    const erro = tela.querySelector('#e-entrar');
    erro.hidden = true;
    botao.disabled = true;
    try {
      const r = await post('/api/entrar', { usuario: e.target.usuario.value, senha: e.target.senha.value });
      await atualizarSessao();
      const volta = new URLSearchParams(location.search).get('volta');
      ir(r.trocar_senha ? '/minha-senha' : volta && /^\/(?!\/)[\w/-]*(\?[\w=&%-]*)?$/.test(volta) && !volta.startsWith('/entrar') ? volta : '/');
    } catch (x) {
      erro.textContent = x.message;
      erro.hidden = false;
      botao.disabled = false;
    }
  });
}
