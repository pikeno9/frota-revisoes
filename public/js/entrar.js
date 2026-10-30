import { post } from './api.js';
import { ir, atualizarSessao, googleLigado, senhaLigada } from './app.js';

const ICONE_GOOGLE = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
const ERRO_GOOGLE = { 'sem-acesso': 'Esta conta Google não tem acesso', falhou: 'Não deu para entrar com o Google' };

// Volta para onde estava; Entrar e Minha senha não contam (depois do login, cai no Início).
const voltaDaUrl = () => {
  const volta = new URLSearchParams(location.search).get('volta');
  return volta && /^\/(?!\/)[\w/-]*(\?[\w=&%-]*)?$/.test(volta) && !/^\/(entrar|minha-senha)/.test(volta) ? volta : '/';
};

export async function entrar(tela) {
  // Site só da equipe: com o Google ligado e a senha desligada, a entrada é um botão só.
  if (googleLigado() && !senhaLigada()) {
    tela.innerHTML = `<div class="entrar entrar-so-google">
      <img class="entrar-logo" src="/img/ocn-logo.png" alt="OCN">
      <h1>Preços</h1>
      <a class="btn btn-entrar-google" href="/api/google/entrar?volta=${encodeURIComponent(voltaDaUrl())}">${ICONE_GOOGLE}Entrar</a>
      <p class="erro" id="e-entrar" role="alert" hidden></p>
    </div>`;
    const erro = tela.querySelector('#e-entrar');
    const motivo = ERRO_GOOGLE[new URLSearchParams(location.search).get('google')];
    if (motivo) { erro.textContent = motivo; erro.hidden = false; }
    return;
  }
  const google = googleLigado()
    ? `<div class="entrar-ou" aria-hidden="true">ou</div>
    <a class="btn sec btn-google" href="/api/google/entrar?volta=${encodeURIComponent(voltaDaUrl())}">${ICONE_GOOGLE}Entrar com Google</a>`
    : '';
  tela.innerHTML = `<form class="entrar" id="f-entrar">
    <img class="entrar-logo" src="/img/ocn-logo.png" alt="OCN">
    <h1>Preços</h1>
    <label>Usuário<input name="usuario" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></label>
    <label>Senha<input type="password" name="senha" autocomplete="current-password" required></label>
    <button class="btn" type="submit">Entrar</button>
    ${google}
    <p class="erro" id="e-entrar" role="alert" hidden></p>
  </form>`;
  const erro = tela.querySelector('#e-entrar');
  const motivo = ERRO_GOOGLE[new URLSearchParams(location.search).get('google')];
  if (motivo) { erro.textContent = motivo; erro.hidden = false; }
  tela.querySelector('#f-entrar').addEventListener('submit', async e => {
    e.preventDefault();
    const botao = e.target.querySelector('button');
    erro.hidden = true;
    botao.disabled = true;
    try {
      await post('/api/entrar', { usuario: e.target.usuario.value, senha: e.target.senha.value });
      await atualizarSessao();
      ir(voltaDaUrl());
    } catch (x) {
      erro.textContent = x.message;
      erro.hidden = false;
      botao.disabled = false;
    }
  });
}
