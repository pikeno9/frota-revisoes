// Usuários do site: cadastro, senha provisória e troca de senha. As rotas ficam em rotas/usuarios.js.
import { randomInt } from 'node:crypto';
import { gerarHash } from './auth.js';

export const PAPEIS = ['leitura', 'edicao', 'admin'];
export const SENHA_MIN = 8;
// Nome curto (joao.silva) ou e-mail (joao@ocnbrasil.com.br).
const USUARIO_VALIDO = /^(?:[a-z0-9._-]{3,32}|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})$/;

export class ErroUsuario extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

// Senha provisória legível para repassar por mensagem: três palavras e um número.
const PALAVRAS = ['Cobalto', 'Pistao', 'Farol', 'Rodovia', 'Volante', 'Turbo', 'Cambio', 'Ignicao', 'Radiador', 'Chassi', 'Embreagem', 'Retrovisor', 'Pneu', 'Freio', 'Motor', 'Garagem', 'Painel', 'Bancada', 'Oficina', 'Estrada'];
export function senhaProvisoria() {
  const p = () => PALAVRAS[randomInt(PALAVRAS.length)];
  return `${p()}-${p()}-${randomInt(1000, 10000)}-${p()}`;
}

const publico = u => ({
  id: u.id, usuario: u.usuario, nome: u.nome, papel: u.papel, ativo: u.ativo === 1,
  trocar_senha: u.trocar_senha === 1, criado_em: u.criado_em, ultimo_acesso: u.ultimo_acesso,
});
export const usuarioPublico = publico;

export const porId = (db, id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(id));
export const porLogin = (db, usuario) => db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(String(usuario ?? '').trim());

// Primeiro admin: com a tabela vazia, o Enrico entra com a senha de ADMIN_SENHA_HASH (a mesma de antes).
export function garantirAdmin(db, env) {
  if (!env.ADMIN_SENHA_HASH) return false;
  if (db.prepare('SELECT COUNT(*) n FROM usuarios').get().n > 0) return false;
  db.prepare("INSERT INTO usuarios (usuario, nome, papel, senha_hash) VALUES ('enrico', 'Enrico', 'admin', ?)").run(env.ADMIN_SENHA_HASH);
  return true;
}

export function listar(db) {
  return db.prepare('SELECT * FROM usuarios ORDER BY ativo DESC, nome COLLATE NOCASE').all().map(publico);
}

function validarPapel(papel) {
  if (!PAPEIS.includes(papel)) throw new ErroUsuario(400, 'papel deve ser leitura, edicao ou admin');
}

export function criar(db, { nome, usuario, papel } = {}) {
  const login = String(usuario ?? '').trim().toLowerCase();
  const nomeLimpo = String(nome ?? '').trim();
  if (login.length > 64 || !USUARIO_VALIDO.test(login)) throw new ErroUsuario(400, 'usuário: e-mail ou 3 a 32 letras, números, ponto, hífen ou sublinhado');
  if (!nomeLimpo || nomeLimpo.length > 80) throw new ErroUsuario(400, 'nome obrigatório');
  validarPapel(papel);
  if (porLogin(db, login)) throw new ErroUsuario(409, 'usuário já existe');
  const senha = senhaProvisoria();
  const r = db.prepare('INSERT INTO usuarios (usuario, nome, papel, senha_hash, trocar_senha) VALUES (?, ?, ?, ?, 1)').run(login, nomeLimpo, papel, gerarHash(senha));
  return { usuario: publico(porId(db, r.lastInsertRowid)), senha_provisoria: senha };
}

// Papel ou ativo mudou: a versão da sessão sobe e quem estava logado sai na hora.
export function atualizar(db, id, corpo = {}, quem) {
  const u = porId(db, id);
  if (!u) throw new ErroUsuario(404, 'usuário não encontrado');
  const papel = corpo.papel ?? u.papel;
  validarPapel(papel);
  const ativo = corpo.ativo == null ? u.ativo : (corpo.ativo ? 1 : 0);
  const nome = corpo.nome == null ? u.nome : String(corpo.nome).trim();
  if (!nome || nome.length > 80) throw new ErroUsuario(400, 'nome obrigatório');
  if (u.id === quem.id && (papel !== 'admin' || !ativo)) throw new ErroUsuario(400, 'você não pode tirar o seu próprio acesso de admin');
  const derruba = papel !== u.papel || ativo !== u.ativo;
  db.prepare('UPDATE usuarios SET nome = ?, papel = ?, ativo = ?, sessao_versao = sessao_versao + ? WHERE id = ?').run(nome, papel, ativo, derruba ? 1 : 0, u.id);
  return publico(porId(db, u.id));
}

export function gerarNovaSenha(db, id, quem) {
  const u = porId(db, id);
  if (!u) throw new ErroUsuario(404, 'usuário não encontrado');
  if (u.id === quem.id) throw new ErroUsuario(400, 'use Minha senha para trocar a sua');
  const senha = senhaProvisoria();
  db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, sessao_versao = sessao_versao + 1 WHERE id = ?').run(gerarHash(senha), u.id);
  return { senha_provisoria: senha };
}

// A versão sobe: outras sessões abertas com a senha antiga saem; quem trocou recebe cookie novo.
export function trocarSenha(db, u, nova) {
  db.prepare('UPDATE usuarios SET senha_hash = ?, trocar_senha = 0, sessao_versao = sessao_versao + 1 WHERE id = ?').run(gerarHash(nova), u.id);
  return porId(db, u.id);
}

export function registrarAcesso(db, u) {
  db.prepare("UPDATE usuarios SET ultimo_acesso = datetime('now') WHERE id = ?").run(u.id);
}
