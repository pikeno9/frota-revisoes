import { post } from './api.js';
import { ir, atualizarSessao } from './app.js';

export async function minhaSenha(tela) {
  tela.innerHTML = `<form class="entrar" id="f-senha">
    <h1>Minha senha</h1>
    <label>Senha atual<input type="password" name="atual" autocomplete="current-password" required autofocus></label>
    <label>Senha nova<input type="password" name="nova" autocomplete="new-password" minlength="8" required></label>
    <label>Repita a senha nova<input type="password" name="repetida" autocomplete="new-password" minlength="8" required></label>
    <button class="btn" type="submit">Salvar</button>
    <p class="erro" id="e-senha" role="alert" hidden></p>
  </form>`;
  const form = tela.querySelector('#f-senha');
  const erro = tela.querySelector('#e-senha');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    erro.hidden = true;
    if (form.nova.value !== form.repetida.value) {
      erro.textContent = 'as duas senhas novas não são iguais';
      erro.hidden = false;
      return;
    }
    const botao = form.querySelector('button');
    botao.disabled = true;
    try {
      await post('/api/minha-senha', { atual: form.atual.value, nova: form.nova.value });
      await atualizarSessao();
      ir('/');
    } catch (x) {
      erro.textContent = x.message;
      erro.hidden = false;
      botao.disabled = false;
    }
  });
}
