# Login, tempo grátis e pagamento Pix

O painel exige login com Google. Cada conta tem 1 minuto grátis de acompanhamento. Depois, um popup oferece o acesso até o fim da apuração por R$ 5,00, pago uma única vez no Pix pelo Mercado Pago.

## Fluxo

1. `/` sem cookie de sessão redireciona para `/login` (`src/proxy.ts`). A página também valida a assinatura do cookie.
2. "Entrar com Google" usa o fluxo Authorization Code com PKCE (`/api/auth/google` → Google → `/api/auth/google/callback`). Só contas com e-mail verificado entram. A sessão é um cookie `HttpOnly` assinado com HMAC (`SESSION_SECRET`), válido por 30 dias.
3. O tempo grátis é contado **no servidor**, por conta. Cada requisição às APIs de resultado (`/api/election/president/*`) e o batimento do painel (`POST /api/access`, a cada 15 s com a aba visível) somam o intervalo desde a requisição anterior, limitado a 20 s. Assim, vários painéis abertos ao mesmo tempo não contam em dobro, e uma ausência longa conta no máximo 20 s. Sair e entrar de novo não reinicia o tempo.
4. Quando o tempo acaba, as APIs de resultado respondem **402**, o HTML deixa de trazer os dados e o painel mostra o popup (`src/features/access/access-gate.tsx`), que não pode ser fechado.
5. "Pagar com Pix" cria uma cobrança no Mercado Pago (`POST /api/billing/pix`) e mostra o QR Code e o código copia e cola, válidos por 30 minutos. Uma cobrança pendente é reaproveitada enquanto ainda faltarem pelo menos 2 minutos para vencer.
6. A confirmação chega por dois caminhos, e qualquer um libera o acesso:
   - o **webhook** do Mercado Pago (`POST /api/billing/webhook`);
   - a **consulta** que o popup faz a cada 4 s (`GET /api/billing/status`), que pergunta ao Mercado Pago pelo pagamento pendente. Esse caminho também funciona em `localhost`, onde o webhook não chega.
7. O acesso só é liberado quando o Mercado Pago informa o pagamento como `approved`, em BRL, com valor maior ou igual ao preço e com `external_reference` igual à conta que abriu a cobrança. O corpo do webhook nunca é usado diretamente: o pagamento é sempre consultado de volta na API do Mercado Pago.
8. O acesso pago vale até `PAID_ACCESS_ENDS_AT` (padrão: 31/10/2026, 23h59 de Brasília).

Rotas públicas, sem verificação de acesso: `/login`, `/api/election/geography`, `/api/election/photo/*` (geografia e fotos não são resultados).

## Configuração

Variáveis em `.env.example`:

| Variável                                   | Para quê                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`                                 | Endereço público. Base do retorno do Google e do webhook do Pix.                                                                  |
| `SESSION_SECRET`                           | Assina o cookie de login. Obrigatória em produção, com no mínimo 32 caracteres aleatórios.                                        |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Login com Google.                                                                                                                 |
| `MP_ACCESS_TOKEN`                          | Access Token de produção do Mercado Pago.                                                                                         |
| `MP_WEBHOOK_SECRET`                        | Assinatura secreta dos webhooks. Opcional, mas recomendada: com ela, avisos sem assinatura válida são recusados.                  |
| `DATABASE_URL`                             | Postgres (Neon, Supabase etc.). Obrigatória na Vercel. As tabelas `access_users` e `access_payments` são criadas no primeiro uso. |
| `FREE_SECONDS`                             | Tempo grátis por conta, em segundos. Padrão: 60.                                                                                  |
| `ACCESS_PRICE_BRL`                         | Preço. Padrão: 5.00.                                                                                                              |
| `PAID_ACCESS_ENDS_AT`                      | Fim do acesso pago (ISO 8601).                                                                                                    |

Gere um `SESSION_SECRET` com:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Google

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto e configure a **tela de consentimento OAuth** (tipo externo; escopos `openid`, `email`, `profile`).
2. Em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**, escolha **Aplicativo da Web**.
3. Em **URIs de redirecionamento autorizados**, adicione `<SITE_URL>/api/auth/google/callback` para cada endereço usado, por exemplo:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://seu-dominio/api/auth/google/callback`
4. Copie o ID e a chave secreta para `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.

O login sempre volta para o endereço de `SITE_URL`. Localmente, acesse o painel pelo mesmo endereço configurado ali (por exemplo, `http://localhost:3000`).

### Mercado Pago

1. A conta precisa ter uma **chave Pix cadastrada** para receber pagamentos Pix.
2. Em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app), crie uma aplicação (produto: pagamentos online, Checkout Transparente) e copie o **Access Token de produção** para `MP_ACCESS_TOKEN`.
3. Em **Webhooks**, cadastre `<SITE_URL>/api/billing/webhook` no modo produção, com o evento **Pagamentos**, e copie a **assinatura secreta** para `MP_WEBHOOK_SECRET`.

O webhook só é enviado ao Mercado Pago quando `SITE_URL` começa com `https://`.

### Banco de dados

Sem `DATABASE_URL`, contas e pagamentos ficam em `.data/access.json`, o que serve apenas para uso local com um único processo. Na Vercel o disco não persiste, então a aplicação se recusa a rodar sem `DATABASE_URL`. Pela Vercel, o caminho mais curto é **Storage → Neon (Postgres)**, que preenche `DATABASE_URL` sozinho.

## Desenvolvimento local

Com `npm run dev` e sem as credenciais:

- sem `GOOGLE_CLIENT_ID`, a página de login mostra **Entrar como visitante de teste**;
- sem `MP_ACCESS_TOKEN`, o popup gera um **Pix simulado** com o botão **Simular pagamento aprovado**.

Os dois atalhos existem só em `next dev` (`NODE_ENV=development`) e desaparecem sozinhos quando a credencial correspondente é configurada. Para testar o popup rapidamente, rode com `FREE_SECONDS=30`. Para recomeçar do zero, pare o servidor e apague `.data/`.

Os testes de navegador (`npm run test:e2e`) entram com o login de teste. Rode o servidor com `FREE_SECONDS=86400` para o tempo grátis não acabar durante a bateria.

## Arquivos

- `src/lib/access/`: configuração, sessão assinada, contagem do tempo, armazenamento (arquivo local e Postgres), Google, Mercado Pago, cobrança e proteção das rotas.
- `src/app/login/`: página de login, com uma prévia ilustrativa e desfocada do painel ao fundo (mapa real dos estados, sem resultados).
- `src/app/api/auth/*`, `src/app/api/access`, `src/app/api/billing/*`: rotas de login, batimento e pagamento.
- `src/features/access/`: contador, selo e popup do Pix.
- `src/proxy.ts`: redirecionamento de visitantes sem sessão.
- `tests/access.test.ts`: testes de unidade. A parte de Postgres roda quando `TEST_DATABASE_URL` aponta para um banco de teste.
- `tests/e2e/global-setup.ts`, `tests/e2e/access.spec.ts`: login dos testes de navegador e verificação do bloqueio sem sessão.

## Limites

- O controle é por conta Google. Quem criar outra conta ganha outro minuto grátis.
- Reembolsos e estornos não removem o acesso automaticamente. Um pagamento estornado aparece como `cancelled` na tabela `access_payments`.
- Não há emissão de nota fiscal nem recibo além do comprovante do próprio Mercado Pago.
