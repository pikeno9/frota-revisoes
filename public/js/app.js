import { inicio } from './inicio.js';
import { modelo } from './modelo.js';
import { comparar } from './comparar.js';
import { coletores } from './coletores.js';
import { entrar } from './entrar.js';
import { rvModelos } from './revenda/modelos.js';
import { rvModelo } from './revenda/modelo.js';
import { rvSimulador } from './revenda/simulador.js';
import { rvPremissas } from './revenda/premissas.js';
import { rvVendas } from './revenda/vendas.js';
import { get, post } from './api.js';

const ROTAS = [
  [/^\/$/, inicio],
  [/^\/modelo\/([\w-]+)$/, modelo],
  [/^\/comparar$/, comparar],
  [/^\/coletores$/, coletores],
  [/^\/entrar$/, entrar],
  [/^\/revenda$/, rvModelos],
  [/^\/revenda\/simulador$/, rvSimulador],
  [/^\/revenda\/premissas$/, rvPremissas],
  [/^\/revenda\/vendas$/, rvVendas],
  [/^\/revenda\/([\w-]+)$/, rvModelo],
];
const DETALHE_REVENDA = /^\/revenda\/(?!simulador$|premissas$|vendas$)[\w-]+$/;
let limpar = null;
let seq = 0;
let ultimo = null; // caminho já na tela: redesenho no mesmo lugar não anima

const seguro = fn => { try { fn?.(); } catch { /* limpeza não pode travar a navegação */ } };

function marcarAba(a) {
  const alvo = a.getAttribute('href');
  const p = location.pathname;
  const atual = alvo === p || (alvo === '/' && p.startsWith('/modelo/')) || (alvo === '/revenda' && DETALHE_REVENDA.test(p));
  a.setAttribute('aria-current', atual ? 'page' : 'false');
}

export async function ir(caminho, empilhar = true) {
  const meu = ++seq;
  if (empilhar) history.pushState(null, '', caminho);
  const tela = document.getElementById('tela');
  const anterior = limpar;
  limpar = null;
  seguro(anterior);
  document.querySelectorAll('.abas a').forEach(marcarAba);
  const rota = ROTAS.find(([re]) => re.test(location.pathname));
  if (!rota) { tela.innerHTML = '<p class="vazio">Página não encontrada</p>'; return; }
  try {
    const fim = (await rota[1](tela, ...location.pathname.match(rota[0]).slice(1))) ?? null;
    if (meu !== seq) { seguro(fim); return; }
    limpar = fim;
    if (location.pathname !== ultimo) tela.firstElementChild?.classList.add('entra');
    ultimo = location.pathname;
    tela.focus({ preventScroll: true });
  } catch (e) {
    if (meu !== seq) return;
    // Revenda é só logado: sem sessão, vai para Entrar e volta depois (troca a entrada, o Voltar não cai em laço).
    if (e.status === 401 && location.pathname.startsWith('/revenda')) {
      const destino = `/entrar?volta=${encodeURIComponent(location.pathname + location.search)}`;
      history.replaceState(null, '', destino);
      ir(destino, false);
      return;
    }
    const p = document.createElement('p');
    p.className = 'erro';
    p.textContent = e.message;
    tela.replaceChildren(p);
  }
}

export async function atualizarSessao() {
  const { logado } = await get('/api/sessao').catch(() => ({ logado: false }));
  const el = document.getElementById('sessao');
  el.innerHTML = logado ? `<button type="button" class="sair" id="sair"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/></svg>Sair</button>` : `<a class="entrar" href="/entrar" data-link><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l5-5-5-5"/><path d="M15 12H4"/></svg>Entrar</a>`;
  document.getElementById('nav-revenda').hidden = !logado;
  el.querySelector('#sair')?.addEventListener('click', async () => {
    try { await post('/api/sair'); } catch { /* segue e relê a sessão */ }
    await atualizarSessao();
    ir(location.pathname.startsWith('/revenda') ? '/' : location.pathname, location.pathname.startsWith('/revenda'));
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
