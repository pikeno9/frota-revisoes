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
let seq = 0;

const seguro = fn => { try { fn?.(); } catch { /* limpeza não pode travar a navegação */ } };

export async function ir(caminho, empilhar = true) {
  const meu = ++seq;
  if (empilhar) history.pushState(null, '', caminho);
  const tela = document.getElementById('tela');
  const anterior = limpar;
  limpar = null;
  seguro(anterior);
  for (const a of document.querySelectorAll('.abas a')) {
    const alvo = a.getAttribute('href');
    a.setAttribute('aria-current', alvo === location.pathname || (alvo === '/' && location.pathname.startsWith('/modelo/')) ? 'page' : 'false');
  }
  const rota = ROTAS.find(([re]) => re.test(location.pathname));
  if (!rota) { tela.innerHTML = '<p class="vazio">Página não encontrada</p>'; return; }
  try {
    const fim = (await rota[1](tela, ...location.pathname.match(rota[0]).slice(1))) ?? null;
    if (meu !== seq) { seguro(fim); return; }
    limpar = fim;
    tela.focus({ preventScroll: true });
  } catch (e) {
    if (meu !== seq) return;
    const p = document.createElement('p');
    p.className = 'erro';
    p.textContent = e.message;
    tela.replaceChildren(p);
  }
}

export async function atualizarSessao() {
  const { logado } = await get('/api/sessao').catch(() => ({ logado: false }));
  const el = document.getElementById('sessao');
  el.innerHTML = logado ? '<button type="button" id="sair">Sair</button>' : '<a href="/entrar" data-link>Entrar</a>';
  el.querySelector('#sair')?.addEventListener('click', async () => {
    try { await post('/api/sair'); } catch { /* segue e relê a sessão */ }
    await atualizarSessao();
    ir(location.pathname, false);
  });
  return logado;
}

document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || a.target) return;
  e.preventDefault();
  const alvo = a.getAttribute('href');
  ir(alvo, alvo !== location.pathname);
});
addEventListener('popstate', () => ir(location.pathname, false));
atualizarSessao();
ir(location.pathname, false);
