# Login, tempo grátis e pagamento Pix

O painel exige login com e-mail (ou nome de usuário) e senha. Cada conta tem 1 minuto grátis de acompanhamento. Depois, um popup oferece o acesso até o fim da apuração por R$ 5,00, pago uma única vez no Pix pelo Mercado Pago.

## Fluxo

1. `/` sem cookie de sessão redireciona para `/login` (`src/proxy.ts`). A página também valida a assinatura do cookie.
2. Em `/login`, a aba **Criar conta** pede e-mail e senha (mínimo de 8 caracteres, repetida); a aba **Entrar** aceita o e-mail ou o nome de usuário e a senha (`POST /api/auth/password`). Cada e-mail é uma conta (`email:<e-mail>`). As senhas ficam só como hash scrypt, na tabela `access_passwords`, separada da conta. Erros de login têm sempre a mesma mensagem, e uma conta inexistente leva o mesmo tempo para responder, para não revelar quais e-mails existem. Limite de tentativas: 60 por minuto por IP e 8 a cada 5 minutos por conta. O e-mail não é confirmado, por isso os e-mails da equipe e da administração não podem ser cadastrados pelo site (veja abaixo). Não há "esqueci a senha": a equipe troca a senha no servidor com `scripts/set-password.mjs`. A sessão é um cookie `HttpOnly` assinado com HMAC (`SESSION_SECRET`), válido por 30 dias.
3. **Sessão única.** Cada login gera um identificador de sessão gravado na conta; só o mais recente vale. Se a mesma conta entrar em outro aparelho, o anterior recebe 401 (`code: "replaced"`) na próxima requisição e o batimento do painel (a cada 10 s, inclusive para quem pagou) leva para `/login?erro=outro-aparelho`. Entrar de novo derruba o outro aparelho. As trocas ficam contadas em `session_changes`, para a administração identificar contas compartilhadas.
4. **Cadastro** (`/cadastro`), obrigatório no primeiro login: nome de usuário único (sem diferenciar maiúsculas; reservados e palavrões recusados; ver `src/lib/profile/username.ts`) e partido que apoia (`src/lib/profile/parties.ts`), com a opção "Prefiro não informar". Se a pessoa indicar um partido, o consentimento LGPD é obrigatório e fica gravado com data. O tempo do formulário não conta como tempo grátis. Sem cadastro, as APIs de resultado respondem 403 (`code: "onboarding"`).
5. O tempo grátis é contado **no servidor**, por conta. Cada requisição às APIs de resultado (`/api/election/president/*`) e o batimento do painel (`POST /api/access`, a cada 10 s com a aba visível) somam o intervalo desde a requisição anterior, limitado a 20 s. Assim, vários painéis abertos ao mesmo tempo não contam em dobro, e uma ausência longa conta no máximo 20 s. Sair e entrar de novo não reinicia o tempo. Enquanto o TSE não publica o primeiro resultado da eleição ativa, o tempo grátis não corre (o selo mostra "começa a contar com a apuração"). Para aguentar o pico, cada pessoa grava no banco no máximo uma vez a cada 5 s; a contagem continua exata porque mede o intervalo desde a última gravação.
6. Quando o tempo acaba, as APIs de resultado respondem **402**, o HTML deixa de trazer os dados e o painel mostra o popup (`src/features/access/access-gate.tsx`), que não pode ser fechado.
7. "Pagar com Pix" cria uma cobrança no Mercado Pago (`POST /api/billing/pix`) e mostra o QR Code e o código copia e cola, válidos por 30 minutos. Uma cobrança pendente é reaproveitada enquanto ainda faltarem pelo menos 2 minutos para vencer.
8. A confirmação chega por dois caminhos, e qualquer um libera o acesso:
   - o **webhook** do Mercado Pago (`POST /api/billing/webhook`);
   - a **consulta** que o popup faz a cada 4 s (`GET /api/billing/status`), que pergunta ao Mercado Pago pelo pagamento pendente. Esse caminho também funciona em `localhost`, onde o webhook não chega.
9. O acesso só é liberado quando o Mercado Pago informa o pagamento como `approved`, em BRL, com valor maior ou igual ao preço e com `external_reference` igual à conta que abriu a cobrança. O corpo do webhook nunca é usado diretamente: o pagamento é sempre consultado de volta na API do Mercado Pago.
10. O pagamento fica ligado à conta, não ao aparelho. Quem já pagou entra com a mesma conta em qualquer aparelho e o acesso é liberado na hora; a tela de login lembra isso em "Já pagou?". Não há envio de e-mail.
11. O acesso pago vale até `PAID_ACCESS_ENDS_AT` (padrão: 31/10/2026, 23h59 de Brasília).

Rotas públicas, sem verificação de acesso: `/login`, `/api/election/geography`, `/api/election/photo/*` (geografia e fotos não são resultados).

## Acesso da equipe

E-mails listados em `STAFF_EMAILS` (separados por vírgula, sem diferenciar maiúsculas) entram sempre com acesso completo: sem tempo grátis, sem popup e sem pagamento. O selo mostra "Acesso da equipe". Esses e-mails (e os de `ADMIN_EMAILS`) **não podem ser cadastrados pelo site**: a senha deles é definida só no servidor, por quem tem acesso a ele:

```sh
docker compose --env-file .env.production exec app node scripts/set-password.mjs pessoa@exemplo.com
```

O comando pede a senha duas vezes (sem mostrar), cria a conta se ainda não existir e desconecta a conta de todos os aparelhos. O mesmo comando troca a senha de qualquer pessoa que tenha esquecido a sua. Para tirar alguém da equipe, remova o e-mail da variável e reinicie o servidor.

Localmente, crie um arquivo `.env.local` (não vai para o Git) com, por exemplo:

```sh
STAFF_EMAILS=admin1@example.com,admin2@example.com
```

e entre no login de teste com um desses e-mails.

## Configuração

Variáveis em `.env.example`:

| Variável              | Para quê                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`            | Endereço público. Base do webhook do Pix.                                                                                         |
| `SESSION_SECRET`      | Assina o cookie de login. Obrigatória em produção, com no mínimo 32 caracteres aleatórios.                                        |
| `MP_ACCESS_TOKEN`     | Access Token de produção do Mercado Pago.                                                                                         |
| `MP_WEBHOOK_SECRET`   | Assinatura secreta dos webhooks. Opcional, mas recomendada: com ela, avisos sem assinatura válida são recusados.                  |
| `DATABASE_URL`        | Postgres (Neon, Supabase etc.). Obrigatória na Vercel. As tabelas `access_users` e `access_payments` são criadas no primeiro uso. |
| `FREE_SECONDS`        | Tempo grátis por conta, em segundos. Padrão: 60.                                                                                  |
| `ACCESS_PRICE_BRL`    | Preço. Padrão: 5.00.                                                                                                              |
| `PAID_ACCESS_ENDS_AT` | Fim do acesso pago (ISO 8601).                                                                                                    |

Gere um `SESSION_SECRET` com:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Mercado Pago

1. A conta precisa ter uma **chave Pix cadastrada** para receber pagamentos Pix.
2. Em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app), crie uma aplicação (produto: pagamentos online, Checkout Transparente) e copie o **Access Token de produção** para `MP_ACCESS_TOKEN`.
3. Em **Webhooks**, cadastre `<SITE_URL>/api/billing/webhook` no modo produção, com o evento **Pagamentos**, e copie a **assinatura secreta** para `MP_WEBHOOK_SECRET`.

O webhook só é enviado ao Mercado Pago quando `SITE_URL` começa com `https://`.

### Banco de dados

Sem `DATABASE_URL`, contas e pagamentos ficam em `.data/access.json`, o que serve apenas para uso local com um único processo. Na Vercel o disco não persiste, então a aplicação se recusa a rodar sem `DATABASE_URL`. Pela Vercel, o caminho mais curto é **Storage → Neon (Postgres)**, que preenche `DATABASE_URL` sozinho.

## Desenvolvimento local

Com `npm run dev` e sem as credenciais:

- a página de login mostra também **Entrar como visitante de teste**, sem senha, com um campo de e-mail: cada e-mail é uma conta diferente (útil para testar quem já pagou e volta em outro aparelho);
- sem `MP_ACCESS_TOKEN`, o popup gera um **Pix simulado** com o botão **Simular pagamento aprovado**.

Os dois atalhos existem só em `next dev` (`NODE_ENV=development`) e desaparecem sozinhos quando a credencial correspondente é configurada. Para testar o popup rapidamente, rode com `FREE_SECONDS=30`. Para recomeçar do zero, pare o servidor e apague `.data/`.

Os testes de navegador (`npm run test:e2e`) entram com o login de teste. Rode o servidor com `FREE_SECONDS=86400` para o tempo grátis não acabar durante a bateria.

## Arquivos

- `src/lib/access/`: configuração, sessão assinada, contagem do tempo, armazenamento (arquivo local e Postgres), senhas (`password.ts`, `credentials.ts`), Mercado Pago, cobrança e proteção das rotas.
- `src/app/cadastro/`, `src/app/api/profile/*`, `src/lib/profile/`: cadastro (nome de usuário, partido, consentimento).
- `src/lib/access/auth.ts`: login com sessão única.
- `src/app/login/`: página de login, com uma prévia ilustrativa e desfocada do painel ao fundo (mapa real dos estados, sem resultados).
- `src/app/api/auth/*`, `src/app/api/access`, `src/app/api/billing/*`: rotas de login, batimento e pagamento.
- `src/features/access/`: contador, selo e popup do Pix.
- `src/proxy.ts`: redirecionamento de visitantes sem sessão.
- `tests/access.test.ts`: testes de unidade. A parte de Postgres roda quando `TEST_DATABASE_URL` aponta para um banco de teste.
- `tests/e2e/global-setup.ts`, `tests/e2e/access.spec.ts`: login dos testes de navegador e verificação do bloqueio sem sessão.

## Limites

- O controle é por conta. Quem criar outra conta, com outro e-mail, ganha outro minuto grátis.
- Reembolsos e estornos não removem o acesso automaticamente. Um pagamento estornado aparece como `cancelled` na tabela `access_payments`.
- Não há emissão de nota fiscal nem recibo além do comprovante do próprio Mercado Pago.
