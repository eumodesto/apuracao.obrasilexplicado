# Área de administração

Endereço: **`/admin`**. Só abre para quem entrou com o Google usando um e-mail da lista `ADMIN_EMAILS`. Para qualquer outra pessoa, a página e as APIs respondem 404: a área não se revela.

```
ADMIN_EMAILS=admin1@example.com,admin2@example.com
```

- Não existe senha. O Google só autentica e-mails verificados.
- Administradores também têm acesso liberado ao painel, como os de `STAFF_EMAILS`.
- Para tirar alguém: remova o e-mail da variável e reinicie o servidor.
- Uma conta de administrador suspensa perde a administração.
- Sem login, `/admin` leva ao login e volta para `/admin` depois de entrar.
- No modo de desenvolvimento, uma conta que não é de administrador vê o que falta (o e-mail usado e o que está em `ADMIN_EMAILS`). Em produção, continua sendo 404.
- Os e-mails reais ficam só no `.env.local` (no seu PC) e nas variáveis de ambiente do servidor. Nunca vão para o repositório.
- No PC sem Google configurado, use o login de teste com o seu e-mail de administrador , e não `teste@localhost`.

## Abas

| Aba             | O que faz                                                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Visão geral** | Atualiza a cada 15 s. Mostra pessoas online no chat, contas, pagantes, receita, contas suspensas e excluídas, contas que trocaram de aparelho (possível conta dividida) e inscritos no "Me avise". Baixa o CSV dos avisos. |
| **Usuários**    | Busca por usuário, e-mail, nome ou id. Permite suspender (com motivo), reativar, remover a foto de perfil ou excluir.                                                                                                      |
| **Moderação**   | Mensagens denunciadas (as mais denunciadas primeiro) e as 150 mais recentes. Apagar remove a mensagem do chat de todo mundo na hora. Clicar no @usuário abre a conta.                                                      |
| **Registro**    | Toda ação fica registrada: quem fez, o quê, contra quem e quando.                                                                                                                                                          |

No próprio chat do painel, administradores veem uma lixeira em cada mensagem para apagar na hora.

## Suspender e excluir

- **Suspender:** a pessoa é desconectada em até ~20 s (chat e painel) e cai em `/login?erro=suspensa`. Ela não consegue entrar de novo até ser reativada. O motivo fica só para a equipe.
- **Excluir:** apaga todas as mensagens da conta no chat (ao vivo, para todos) e remove os dados pessoais: e-mail, nome, usuário e partido. O nome de usuário fica livre. Os registros de pagamento são mantidos para a contabilidade. Se a pessoa entrar de novo com o mesmo Google, a conta continua excluída (`/login?erro=excluida`). Não dá para desfazer.
- Ninguém consegue suspender ou excluir a própria conta, nem a de outro administrador pela tela.

## Segurança

- Ações que mudam algo (`POST`/`DELETE`) só são aceitas quando vêm do próprio site, conferindo `Origin` com o host. Isso bloqueia formulários de outros sites.
- O registro de ações fica na tabela `admin_audit` (Postgres) ou em `.data/audit.json` no desenvolvimento local.

## APIs

Todas exigem sessão de administrador.

| Método e rota                                           | Uso                            |
| ------------------------------------------------------- | ------------------------------ |
| `GET /api/admin/overview`                               | Números da visão geral         |
| `GET /api/admin/users?q=&page=`                         | Busca paginada (25 por página) |
| `POST /api/admin/users/:id` `{action: 'pause', reason}` | Suspender                      |
| `POST /api/admin/users/:id` `{action: 'unpause'}`       | Reativar                       |
| `POST /api/admin/users/:id` `{action: 'remove_photo'}`  | Remover a foto de perfil       |
| `POST /api/admin/users/:id` `{action: 'delete'}`        | Excluir                        |
| `GET /api/admin/reports`                                | Mensagens denunciadas          |
| `GET /api/admin/messages`                               | 150 mensagens mais recentes    |
| `DELETE /api/admin/messages/:id`                        | Apagar uma mensagem para todos |
| `GET /api/admin/notify`                                 | CSV da lista "Me avise"        |
| `GET /api/admin/audit`                                  | Últimas 200 ações              |
