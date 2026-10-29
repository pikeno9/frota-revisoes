import { get, post, patch } from './api.js';
import { esc, dia } from './formato.js';
import { usuarioAtual } from './app.js';

const PAPEIS = [['leitura', 'Leitura'], ['edicao', 'Edição'], ['admin', 'Admin']];

export async function usuarios(tela) {
  const lista = await get('/api/usuarios');
  const eu = usuarioAtual()?.id;
  tela.innerHTML = `<div class="usuarios">
    <section>
      <h2>Novo usuário</h2>
      <form class="form" id="f-usuario">
        <label>Nome<input name="nome" maxlength="80" required></label>
        <label>Usuário ou e-mail<input name="usuario" autocapitalize="none" spellcheck="false" maxlength="64" required></label>
        <label>Papel<select name="papel">${PAPEIS.map(([v, r]) => `<option value="${v}">${r}</option>`).join('')}</select></label>
        <div class="acoes"><button class="btn" type="submit">Cadastrar</button></div>
        <p class="erro" id="e-usuario" role="alert" hidden></p>
      </form>
      <div class="provisoria" id="provisoria" hidden></div>
    </section>
    <section>
      <h2>Usuários</h2>
      <div class="tabela-rolagem"><table class="tabela" id="t-usuarios">
        <thead><tr><th>Nome</th><th>Usuário</th><th>Papel</th><th>Ativo</th><th>Último acesso</th><th></th></tr></thead>
        <tbody>${lista.map(u => linha(u, eu)).join('')}</tbody>
      </table></div>
      <p class="erro" id="e-lista" role="alert" hidden></p>
    </section>
  </div>`;

  const caixa = tela.querySelector('#provisoria');
  const mostrarSenha = (quem, senha) => {
    caixa.innerHTML = `<span>Senha provisória de <strong>${esc(quem)}</strong></span>
      <code>${esc(senha)}</code>
      <button type="button" class="btn sec" id="copiar">Copiar</button>`;
    caixa.hidden = false;
    caixa.querySelector('#copiar').addEventListener('click', async e => {
      try { await navigator.clipboard.writeText(senha); e.target.textContent = 'Copiada'; } catch { /* sem área de transferência: a senha segue na tela */ }
    });
  };

  const form = tela.querySelector('#f-usuario');
  const erroForm = tela.querySelector('#e-usuario');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    erroForm.hidden = true;
    const botao = form.querySelector('button');
    botao.disabled = true;
    try {
      const r = await post('/api/usuarios', { nome: form.nome.value, usuario: form.usuario.value, papel: form.papel.value });
      tela.querySelector('#t-usuarios tbody').insertAdjacentHTML('beforeend', linha(r.usuario, eu));
      mostrarSenha(r.usuario.usuario, r.senha_provisoria);
      form.reset();
    } catch (x) {
      erroForm.textContent = x.message;
      erroForm.hidden = false;
    }
    botao.disabled = false;
  });

  const erroLista = tela.querySelector('#e-lista');
  const tabela = tela.querySelector('#t-usuarios');
  const salvar = async (tr, corpo) => {
    erroLista.hidden = true;
    try {
      const u = await patch(`/api/usuarios/${tr.dataset.id}`, corpo);
      tr.outerHTML = linha(u, eu);
    } catch (x) {
      erroLista.textContent = `${tr.cells[1].textContent}: ${x.message}`;
      erroLista.hidden = false;
    }
  };
  tabela.addEventListener('change', e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    if (e.target.name === 'papel') salvar(tr, { papel: e.target.value });
    if (e.target.name === 'ativo') salvar(tr, { ativo: e.target.checked });
  });
  tabela.addEventListener('click', async e => {
    const b = e.target.closest('button[data-senha]');
    if (!b || b.disabled) return;
    const tr = b.closest('tr');
    b.disabled = true;
    erroLista.hidden = true;
    try {
      const r = await post(`/api/usuarios/${tr.dataset.id}/senha`);
      mostrarSenha(tr.cells[1].textContent, r.senha_provisoria);
    } catch (x) {
      erroLista.textContent = x.message;
      erroLista.hidden = false;
    }
    b.disabled = false;
  });
}

function linha(u, eu) {
  const euMesmo = u.id === eu;
  const trava = euMesmo ? ' disabled' : '';
  return `<tr data-id="${esc(u.id)}"${u.ativo ? '' : ' class="inativo"'}>
    <td>${esc(u.nome)}${u.trocar_senha ? ' <span class="conferir">provisória</span>' : ''}</td>
    <td>${esc(u.usuario)}</td>
    <td><select name="papel" aria-label="Papel"${trava}>${PAPEIS.map(([v, r]) => `<option value="${v}"${u.papel === v ? ' selected' : ''}>${r}</option>`).join('')}</select></td>
    <td><input type="checkbox" name="ativo" aria-label="Ativo"${u.ativo ? ' checked' : ''}${trava}></td>
    <td>${u.ultimo_acesso ? esc(dia(u.ultimo_acesso.slice(0, 10))) : ''}</td>
    <td>${euMesmo ? '' : '<button type="button" class="btn sec" data-senha>Nova senha</button>'}</td>
  </tr>`;
}
