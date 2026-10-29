# Login por usuário no site de Preços (aprovado em 29/10/2026)

## Objetivo
O site inteiro fica atrás de login com usuário e senha, um por pessoa. Hoje só a Revenda e as escritas pedem a senha única do admin.

## Papéis
| Papel | Pode |
|---|---|
| leitura | ver Revisões e Revenda, usar o Simulador |
| edicao | + salvar premissas e fontes, registrar vendas, cadastrar e editar modelos, testar coletor, coletar agora, reenviar alertas |
| admin | + criar, desativar, trocar papel e gerar senha provisória de usuários |

## Dados (migração 004)
- `usuarios (id, usuario único sem caixa, nome, papel, senha_hash scrypt, trocar_senha, ativo, sessao_versao, criado_em, ultimo_acesso)`.
- `vendas.usuario_id` e `premissas.usuario_id`: quem registrou ou mudou por último.
- O primeiro admin (`enrico`, com o hash de `ADMIN_SENHA_HASH`) entra ao subir o app quando a tabela está vazia; depois a variável não é mais lida.

## Sessão
- Cookie assinado (HMAC, `SESSION_SECRET`) com id do usuário, versão da sessão e validade de 7 dias.
- A cada pedido o usuário é relido: desativado, papel trocado ou senha trocada (versão da sessão sobe) derruba a sessão na hora.
- Com `trocar_senha = 1` só valem sessão, sair e trocar a senha.

## Rotas
- `POST /api/entrar {usuario, senha}`: 5 falhas em 15 min bloqueiam, contadas por IP e por usuário.
- `GET /api/sessao` devolve o usuário (nome, papel, trocar_senha).
- `POST /api/minha-senha {atual, nova}`: nova com 8+ caracteres; zera `trocar_senha`, sobe a versão e renova o cookie.
- Admin: `GET/POST /api/usuarios`, `PATCH /api/usuarios/:id`, `POST /api/usuarios/:id/senha`. A senha provisória volta uma vez na resposta. O admin não se desativa nem perde o papel de admin.
- Todas as outras rotas `/api` pedem login; escritas pedem edicao.
- Leitura entre sistemas: `/api/veiculos`, `/api/precos` e `/api/revenda/projecao` aceitam `Authorization: Bearer REVENDA_TOKEN` (o token que o KPIs já tem).

## Telas
- Entrar: usuário e senha. Sem sessão, toda tela vai para Entrar e volta depois.
- Menu do usuário no topo (inicial do nome): Minha senha, Usuários (admin), Sair.
- Usuários (admin): lista com papel, ativo, último acesso, nova senha; cadastro com nome, usuário e papel.
- Minha senha: atual, nova, repetir. No primeiro acesso é obrigatória.
- Controles de escrita somem para leitura (o servidor recusa de qualquer jeito).

## Implantação
1. KPIs passa a mandar o token ao ler `/api/veiculos` e `/api/precos` (antes de fechar o Preços).
2. Backup do banco (VACUUM INTO), merge, migração 004 no boot.
3. Conferir: KPIs com dados, site pedindo login.
