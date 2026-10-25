# Área de administração

Endereço: **`/admin`**. Só abre para quem entrou com um e-mail da lista `ADMIN_EMAILS`. Para qualquer outra pessoa, a página e as APIs respondem 404: a área não se revela.

```
ADMIN_EMAILS=admin1@example.com,admin2@example.com
```

- A **primeira conta de administrador** (e-mail em `ADMIN_EMAILS`) e a senha dela são definidas no servidor com `scripts/set-password.mjs` (veja [Acesso da equipe](ACCESS_AND_PAYMENT.md#acesso-da-equipe)). Contas da equipe (`STAFF_EMAILS`) usam o mesmo caminho.
- Administradores também têm acesso liberado ao painel, como os de `STAFF_EMAILS`.
- Para tirar alguém: remova o e-mail da variável e reinicie o servidor.
- Uma conta de administrador suspensa perde a administração.
- Sem login (ou só como visitante), `/admin` leva a `/login?next=/admin`, com formulário de **e-mail e senha** (não o @usuário do painel). Depois de entrar, volta para `/admin`.
- Contas com @usuário do painel não abrem a área: em produção veem 404; use `/login?next=/admin` com o e-mail de `ADMIN_EMAILS`.
- No modo de desenvolvimento, uma conta que não é de administrador vê o que falta (o e-mail usado e o que está em `ADMIN_EMAILS`).
- Os e-mails reais ficam só no `.env.local` (no seu PC) e nas variáveis de ambiente do servidor. Nunca vão para o repositório.
- No PC, em desenvolvimento, use o login de teste com o seu e-mail de administrador , e não `teste@localhost`.

## Cadastrar alguém pelo admin (sem Mercado Pago)

1. Entre em **https://portaleleicao.com.br/admin** com um e-mail de `ADMIN_EMAILS`.
2. Aba **Usuários** → **+ Novo usuário**.
3. Informe **@usuário** e **senha** (mínimo 8) → **Criar conta**.
4. A conta já nasce com **acesso liberado** (`payment_id = admin:grant`): **não gera cobrança** no Mercado Pago, não aparece na receita de PIX/cartão e não precisa pagar o painel.
5. A pessoa entra em `/login` com o @usuário e a senha; na primeira vez completa o partido em `/cadastro`.

Para uma conta que já existe e ainda não pagou: na linha da conta use **Liberar acesso** (mesmo efeito, sem MP).

Contas liberadas pelo admin aparecem com o chip **Liberado** (não “Pago (MP)”). Figurinhas exclusivas também são liberadas sem gastar envios — o checkout do Mercado Pago fica só para quem paga de verdade.

## Abas

| Aba             | O que faz                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Visão geral** | Atualiza a cada 15 s. Mostra pessoas online no chat, contas, pagantes, receita, contas suspensas e excluídas, contas que trocaram de aparelho (possível conta dividida) e inscritos no "Me avise". Baixa o CSV dos avisos.                                                                                                                                 |
| **Usuários**    | **+ Novo usuário** cria @usuário + senha com **acesso liberado sem Mercado Pago**. Contas existentes sem pagamento: **Liberar acesso**. Busca, suspender, reativar, trocar senha, remover foto, excluir. |
| **Moderação**   | Mensagens denunciadas (as mais denunciadas primeiro) e as 150 mais recentes. Apagar remove a mensagem do chat de todo mundo na hora. Clicar no @usuário abre a conta.                                                                                                                                                                                      |
| **Registro**    | Toda ação fica registrada: quem fez, o quê, contra quem e quando.                                                                                                                                                                                                                                                                                          |

No próprio chat do painel, administradores veem uma lixeira em cada mensagem para apagar na hora.

## Suspender e excluir

- **Suspender:** a pessoa é desconectada em até ~20 s (chat e painel) e cai em `/login?erro=suspensa`. Ela não consegue entrar de novo até ser reativada. O motivo fica só para a equipe.
- **Excluir:** apaga todas as mensagens da conta no chat (ao vivo, para todos) e remove os dados pessoais: e-mail, nome, usuário e partido. O nome de usuário fica livre. Os registros de pagamento são mantidos para a contabilidade. O mesmo e-mail não pode ser usado para entrar nem para criar uma conta nova. Não dá para desfazer.
- Ninguém consegue suspender ou excluir a própria conta, nem a de outro administrador pela tela.
- **Trocar senha** funciona para qualquer conta ativa, inclusive administradores e a própria. A troca encerra as sessões abertas daquela conta.

## Segurança

- Ações que mudam algo (`POST`/`DELETE`) só são aceitas quando vêm do próprio site, conferindo `Origin` com o host. Isso bloqueia formulários de outros sites.
- O registro de ações fica na tabela `admin_audit` (Postgres) ou em `.data/audit.json` no desenvolvimento local.

## APIs

Todas exigem sessão de administrador.

| Método e rota                                           | Uso                            |
| ------------------------------------------------------- | ------------------------------ |
| `GET /api/admin/overview`                               | Números da visão geral         |
| `GET /api/admin/users?q=&page=`                         | Busca paginada (25 por página) |
| `POST /api/admin/users` `{username, password}`          | Criar conta (@usuário) com acesso liberado (`admin:grant`, sem MP) |
| `POST /api/admin/users/:id` `{action: 'pause', reason}` | Suspender                      |
| `POST /api/admin/users/:id` `{action: 'unpause'}`       | Reativar                       |
| `POST /api/admin/users/:id` `{action: 'grant_access'}`  | Liberar acesso sem pagamento   |
| `POST /api/admin/users/:id` `{action: 'set_password'}`  | Trocar senha                   |
| `POST /api/admin/users/:id` `{action: 'remove_photo'}`  | Remover a foto de perfil       |
| `POST /api/admin/users/:id` `{action: 'delete'}`        | Excluir                        |
| `GET /api/admin/reports`                                | Mensagens denunciadas          |
| `GET /api/admin/messages`                               | 150 mensagens mais recentes    |
| `DELETE /api/admin/messages/:id`                        | Apagar uma mensagem para todos |
| `GET /api/admin/notify`                                 | CSV da lista "Me avise"        |
| `GET /api/admin/audit`                                  | Últimas 200 ações              |
