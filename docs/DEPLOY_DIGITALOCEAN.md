# Publicar na DigitalOcean

O sistema foi feito para rodar como **um único processo Node que fica sempre ligado**, com o cache do TSE e o histórico gravados em disco (`.cache/tse`). Por isso o caminho recomendado é uma **Droplet** (servidor virtual) com Docker:

```text
Internet → Caddy (HTTPS automático, portas 80/443) → app Next.js (porta 3000) → Postgres
                                                        └─ volumes: .cache (TSE) e .data
```

Arquivos envolvidos:

| Arquivo                         | Para quê                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `Dockerfile`                    | Gera a imagem de produção (saída `standalone` do Next.js).                   |
| `docker-compose.yml`            | Sobe app, Postgres e Caddy, com volumes persistentes.                        |
| `deploy/Caddyfile`              | HTTPS com certificado Let's Encrypt e redirecionamento do `www`.             |
| `deploy/env.production.example` | Modelo das variáveis de produção.                                            |
| `src/app/api/health/route.ts`   | `GET /api/health`: verificação de saúde que não depende do TSE nem do banco. |

## 1. Criar a Droplet

1. No painel da DigitalOcean: **Create → Droplets**.
2. Região: **New York** ou **San Francisco** costumam ter a menor latência para o Brasil entre as opções da DigitalOcean (não há região no Brasil).
3. Imagem: **Marketplace → Docker on Ubuntu** (já vem com Docker e Compose).
4. Tamanho: no dia da apuração, comece com pelo menos **2 vCPU / 4 GB**. Dá para redimensionar depois (Resize), com uma breve parada.
5. Autenticação: **chave SSH**.
6. Em **Networking → Firewalls**, libere só as portas 22, 80 e 443.

## 2. Apontar o domínio

No seu provedor de DNS, crie um registro **A** de `portaleleicao.com.br` e outro de `www.portaleleicao.com.br` para o IP da Droplet. Espere propagar antes do passo 4: o Caddy só consegue o certificado quando o domínio já aponta para o servidor.

## 3. Enviar o código e configurar

No servidor:

```bash
git clone <url-do-repositorio> /opt/apuracao
```

```bash
cd /opt/apuracao && cp deploy/env.production.example .env.production && nano .env.production
```

Preencha pelo menos `DOMAIN`, `SITE_URL`, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `MP_ACCESS_TOKEN`. Gere senhas e o segredo com:

```bash
openssl rand -base64 32
```

Depois, atualize nos serviços externos:

- **Google Cloud Console** → credencial OAuth → URI de redirecionamento autorizado: `https://portaleleicao.com.br/api/auth/google/callback`.
- **Mercado Pago** → Webhooks → URL: `https://portaleleicao.com.br/api/billing/webhook`.

## 4. Subir

```bash
cd /opt/apuracao && docker compose --env-file .env.production up -d --build
```

Conferir:

```bash
docker compose --env-file .env.production ps
```

```bash
docker compose --env-file .env.production logs -f app
```

Abra `https://portaleleicao.com.br/api/health`: deve responder `{"ok":true}`. As tabelas do banco são criadas sozinhas no primeiro uso.

## 5. Atualizar para uma nova versão

```bash
cd /opt/apuracao && git pull && docker compose --env-file .env.production up -d --build
```

Os volumes (`pg-data`, `tse-cache`, `app-data`, `caddy-data`) são mantidos entre atualizações. A troca do container causa alguns segundos de indisponibilidade; evite atualizar durante o pico da apuração.

## Backup do banco

```bash
docker compose --env-file .env.production exec db pg_dump -U apuracao apuracao > backup-$(date +%F).sql
```

Ative também os **Backups** ou **Snapshots** da Droplet no painel.

## Banco gerenciado (opcional)

Para não cuidar do Postgres, crie um **Databases → PostgreSQL** na DigitalOcean, adicione a Droplet às _trusted sources_ e cole a connection string em `DATABASE_URL` (com `?sslmode=require`). O container `db` continua no Compose, mas deixa de ser usado; pode removê-lo do arquivo.

## Limites

- **Uma réplica só.** O cache do TSE, o single-flight e o chat (sem `REDIS_URL`) vivem no processo. Para escalar, cresça a Droplet na vertical. Várias réplicas exigem a coordenação distribuída descrita no README.
- **App Platform** (o PaaS da DigitalOcean) também roda este `Dockerfile`, mas o disco é apagado a cada deploy: o histórico observado e o cache do TSE se perdem, e é preciso um Postgres gerenciado. Por isso a Droplet é a opção recomendada.
