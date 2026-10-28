import { post } from './api.js';
import { ir, atualizarSessao } from './app.js';

export async function entrar(tela) {
  tela.innerHTML = `<form class="entrar" id="f-entrar">
    <h1>Entrar</h1>
    <input type="password" name="senha" autocomplete="current-password" placeholder="Senha" aria-label="Senha" required autofocus>
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
      await post('/api/entrar', { senha: e.target.senha.value });
      await atualizarSessao();
      const volta = new URLSearchParams(location.search).get('volta');
      ir(volta && /^\/(?!\/)[\w/-]*(\?[\w=&%-]*)?$/.test(volta) ? volta : '/coletores');
    } catch (x) {
      erro.textContent = x.message;
      erro.hidden = false;
      botao.disabled = false;
    }
  });
}
