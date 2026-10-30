# Entrar com Google no Preços (piloto) — design

Piloto da regra do Hub v2 (spec `CLAUDE_1/docs/superpowers/specs/2026-10-13-ocn-hub-v2-design.md`, §8).
Depois do Preços, a mesma receita vai para os outros sites, um por vez.

## Regras

1. A tela Entrar ganha o botão "Entrar com Google". Usuário e senha continuam iguais.
2. Só entra conta Google `@onecarnow.com` com e-mail verificado.
3. Só entra quem **já tem conta** no Preços e está ativo. O e-mail Google casa com o `usuario`
   (inteiro) ou, para contas de nome curto, com a parte antes do `@`. O papel é o da conta;
   nada é criado nem alterado.
4. Sem conta correspondente: volta para Entrar com "Esta conta Google não tem acesso".
5. `?entrar=google` em qualquer tela, sem sessão: o login Google começa sozinho (o Hub usa isso).
   Se não der certo, cai na tela Entrar normal, sem mensagem. Com sessão, o parâmetro é ignorado.
6. Sem `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no ambiente, o botão não aparece e as rotas
   devolvem para Entrar. Subir o código sem as chaves não muda nada para ninguém.

## Fluxo

- `GET /api/google/entrar?volta=&auto=` sorteia `state`, `nonce` e o verificador PKCE, guarda num
  cookie assinado com `SESSION_SECRET` (`precos_google`, 10 min, HttpOnly, Path `/api/google`) e
  manda para o Google com `hd=onecarnow.com` e escopo `openid email profile`.
- `GET /api/google/retorno` confere o `state` do cookie, troca o `code` no endpoint de token do
  Google (com o verificador) e lê o `id_token` recebido direto do Google por TLS. Confere `iss`,
  `aud`/`azp`, `exp`, `nonce`, `email_verified` e `hd`. Achou a conta: mesmo cookie de sessão do
  login por senha (`precos_sessao`, 7 dias, `sessao_versao`) e registra o acesso.
- Endereço de retorno: `GOOGLE_RETORNO_URL` ou, sem ela, `https://<host>/api/google/retorno`.
  No Google Cloud: `https://precos.ocnbrasil.com.br/api/google/retorno`.

## Fora do escopo

Desligar a senha de quem é @onecarnow.com e encurtar a sessão ficam para a fase 2, depois que
todos os sites tiverem o botão.
