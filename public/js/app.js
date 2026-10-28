import { inicio } from './inicio.js';
import { modelo } from './modelo.js';
import { comparar } from './comparar.js';
import { coletores } from './coletores.js';
import { entrar } from './entrar.js';
import { get, post } from './api.js';

const ROTAS = [
  [/^\/$/, inicio],
  [/^\/modelo\/([\w-]+)$/, modelo],
  [/^\/comparar$/, comparar],
  [/^\/coletores$/, coletores],
  [/^\/entrar$/, entrar],
];
let limpar = null;

export async function ir(caminho, empilhar = true) {
  if (empilhar) history.pushState(null, '', caminho);
  const tela = document.getElementById('tela');
  limpar?.(); limpar = null;
  for (const a of document.querySelectorAll('.abas a')) {
    const alvo = a.getAttribute('href');
    a.setAttribute('aria-current', alvo === location.pathname || (alvo === '/' && location.pathname.startsWith('/modelo/')) ? 'page' : 'false');
  }
  const rota = ROTAS.find(([re]) => re.test(location.pathname));
  if (!rota) { tela.innerHTML = '<p class="vazio">Página não encontrada</p>'; return; }
  try {
    limpar = (await rota[1](tela, ...location.pathname.match(rota[0]).slice(1))) ?? null;
  } catch (e) {
    tela.innerHTML = `<p class="erro">${e.message}</p>`;
  }
}

export async function atualizarSessao() {
  const { logado } = await get('/api/sessao').catch(() => ({ logado: false }));
  const el = document.getElementById('sessao');
  el.innerHTML = logado ? '<button type="button" id="sair">Sair</button>' : '<a href="/entrar" data-link>Entrar</a>';
  el.querySelector('#sair')?.addEventListener('click', async () => { await post('/api/sair'); await atualizarSessao(); ir(location.pathname, false); });
  return logado;
}

document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  ir(a.getAttribute('href'));
});
addEventListener('popstate', () => ir(location.pathname, false));
atualizarSessao();
ir(location.pathname, false);
