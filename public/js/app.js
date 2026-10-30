import { inicio } from './inicio.js';
import { modelo } from './modelo.js';
import { comparar } from './comparar.js';
import { coletores } from './coletores.js';
import { entrar } from './entrar.js';
import { minhaSenha } from './minha-senha.js';
import { usuarios } from './usuarios.js';
import { metodo } from './metodo.js';
import { rvModelos } from './revenda/modelos.js';
import { rvModelo } from './revenda/modelo.js';
import { rvSimulador } from './revenda/simulador.js';
import { rvPremissas } from './revenda/premissas.js';
import { rvVendas } from './revenda/vendas.js';
import { rvAnuncios } from './revenda/anuncios.js';
import { rvEstudo } from './revenda/estudo.js';
import { get, post } from './api.js';
import { esc } from './formato.js';

const ROTAS = [
  [/^\/$/, inicio],
  [/^\/modelo\/([\w-]+)$/, modelo],
  [/^\/comparar$/, comparar],
  [/^\/coletores$/, coletores],
  [/^\/entrar$/, entrar],
  [/^\/minha-senha$/, minhaSenha],
  [/^\/usuarios$/, usuarios],
  [/^\/metodo$/, metodo],
  [/^\/revenda$/, rvModelos],
  [/^\/revenda\/simulador$/, rvSimulador],
  [/^\/revenda\/premissas$/, rvPremissas],
  [/^\/revenda\/vendas$/, rvVendas],
  [/^\/revenda\/anuncios$/, rvAnuncios],
  [/^\/revenda\/estudo$/, rvEstudo],
  [/^\/revenda\/([\w-]+)$/, rvModelo],
];
const DETALHE_REVENDA = /^\/revenda\/(?!simulador$|premissas$|vendas$|anuncios$|estudo$)[\w-]+$/;
let limpar = null;
let seq = 0;
let ultimo = null; // caminho já na tela: redesenho no mesmo lugar não anima
let usuario = null; // quem está logado (null fora)
let google = false; // o servidor tem as chaves do Entrar com Google
let senha = true; // usuário e senha ainda valem (sem Google, ou ENTRAR_COM_SENHA=sim)

const seguro = fn => { try { fn?.(); } catch { /* limpeza não pode travar a navegação */ } };
export const usuarioAtual = () => usuario;
export const googleLigado = () => google;
export const senhaLigada = () => senha;
export const podeEditar = () => usuario?.papel === 'edicao' || usuario?.papel === 'admin';

function marcarAba(a) {
  const alvo = a.getAttribute('href');
  const p = location.pathname;
  const atual = alvo === p || (alvo === '/' && p.startsWith('/modelo/')) || (alvo === '/revenda' && DETALHE_REVENDA.test(p));
  a.setAttribute('aria-current', atual ? 'page' : 'false');
}

// Para onde a tela tem que ir antes de abrir: Entrar sem sessão, Início fora do papel.
function desvio(p) {
  if (!usuario) return p === '/entrar' ? null : `/entrar?volta=${encodeURIComponent(p + location.search)}`;
  if (p === '/entrar' || (p === '/usuarios' && usuario.papel !== 'admin')) return '/';
  return null;
}

export async function ir(caminho, empilhar = true) {
  const meu = ++seq;
  if (empilhar) history.pushState(null, '', caminho);
  const outro = desvio(location.pathname);
  if (outro) { history.replaceState(null, '', outro); return ir(outro, false); }
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
    // Sessão caiu (expirou, papel trocado, desativado, senha nova): relê e desvia.
    if (e.status === 401 || e.status === 403) {
      await atualizarSessao();
      if (desvio(location.pathname)) { ir(location.pathname, false); return; }
    }
    const p = document.createElement('p');
    p.className = 'erro';
    p.textContent = e.message;
    tela.replaceChildren(p);
  }
}

const ICONE_SAIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/></svg>';
const ICONE_CHAVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3"/><path d="m16 7 3 3"/></svg>';
const ICONE_PESSOAS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18.5 14.5a6.5 6.5 0 0 1 3 5.5"/></svg>';
const PAPEL = { leitura: 'Leitura', edicao: 'Edição', admin: 'Admin' };

function menuUsuario(u) {
  const primeiro = u.nome.split(/\s+/)[0];
  return `<div class="usuario-menu">
    <button type="button" class="usuario-botao" id="usuario-botao" aria-haspopup="menu" aria-expanded="false">
      <span class="inicial" aria-hidden="true">${esc(primeiro.charAt(0).toUpperCase())}</span><span class="usuario-nome">${esc(primeiro)}</span>
    </button>
    <div class="usuario-lista" id="usuario-lista" role="menu" hidden>
      <div class="usuario-quem"><strong>${esc(u.nome)}</strong><span>${esc(u.usuario)} · ${esc(PAPEL[u.papel] ?? u.papel)}</span></div>
      ${senha ? `<a role="menuitem" href="/minha-senha" data-link>${ICONE_CHAVE}Minha senha</a>` : ''}
      ${u.papel === 'admin' ? `<a role="menuitem" href="/usuarios" data-link>${ICONE_PESSOAS}Usuários</a>` : ''}
      <button role="menuitem" type="button" id="sair">${ICONE_SAIR}Sair</button>
    </div>
  </div>`;
}

export async function atualizarSessao() {
  const s = await get('/api/sessao').catch(() => ({ logado: false }));
  usuario = s.logado ? s.usuario : null;
  google = s.google === true;
  senha = s.senha !== false;
  document.body.dataset.papel = usuario?.papel ?? '';
  const navegar = !!usuario;
  document.querySelectorAll('.abas').forEach(n => { n.hidden = !navegar; });
  const el = document.getElementById('sessao');
  el.innerHTML = usuario ? menuUsuario(usuario) : '';
  const botao = el.querySelector('#usuario-botao');
  const lista = el.querySelector('#usuario-lista');
  const abrir = sim => { lista.hidden = !sim; botao.setAttribute('aria-expanded', String(sim)); };
  botao?.addEventListener('click', e => { e.stopPropagation(); abrir(lista.hidden); });
  lista?.addEventListener('click', () => abrir(false));
  el.querySelector('#sair')?.addEventListener('click', async () => {
    try { await post('/api/sair'); } catch { /* segue e relê a sessão */ }
    await atualizarSessao();
    ir('/entrar', false);
  });
  return !!usuario;
}

document.addEventListener('click', e => {
  const lista = document.getElementById('usuario-lista');
  if (lista && !lista.hidden && !e.target.closest('.usuario-menu')) {
    lista.hidden = true;
    document.getElementById('usuario-botao')?.setAttribute('aria-expanded', 'false');
  }
  const a = e.target.closest('a[data-link]');
  if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || a.target) return;
  e.preventDefault();
  const alvo = a.getAttribute('href');
  ir(alvo, alvo !== location.pathname);
});
document.addEventListener('keydown', e => {
  const lista = document.getElementById('usuario-lista');
  if (e.key === 'Escape' && lista && !lista.hidden) {
    lista.hidden = true;
    document.getElementById('usuario-botao')?.focus();
  }
});
addEventListener('popstate', () => ir(location.pathname, false));
atualizarSessao().then(() => ir(location.pathname, false));
