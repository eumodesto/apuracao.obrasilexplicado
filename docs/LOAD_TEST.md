# Teste de carga

`scripts/load-test.mjs` simula pessoas logadas com o painel e o chat abertos contra um servidor real. Cada pessoa:

- mantém o chat aberto (`/api/chat/stream`) e mede o atraso de entrega das mensagens;
- consulta `/api/election/president` no intervalo que o servidor pede (`X-Poll-After`), com ETag;
- consulta o mapa a cada 20 s e manda o batimento (`POST /api/access`) a cada 20 s, como o painel;
- 30% acompanham os municípios de um estado (a cada 20 s);
- 20% escrevem no chat (uma mensagem a cada 5 a 60 s).

As contas de teste têm id `load:N` e nome de usuário `cargaN`, já pagas e com cadastro feito.

## Passo a passo (na máquina de entrada, `apuracao`)

```bash
cd /opt/apuracao && docker run --rm -v "$PWD/scripts:/s:ro" node:24-bookworm-slim node /s/load-test.mjs seed --users 5000 | docker compose -p apuracao -f deploy/cluster/edge.yml --env-file .env.production exec -T db psql -q -U apuracao
```

Rode o teste de **outra máquina** (o próprio gerador consome CPU), por exemplo uma Droplet temporária na mesma região. Use o `SESSION_SECRET` do servidor para assinar os cookies de teste:

```bash
node scripts/load-test.mjs run --base https://portaleleicao.com.br --users 5000 --ramp 300 --duration 900 --secret "SESSION_SECRET_DO_SERVIDOR"
```

Um processo gerador simula bem até ~1.250 pessoas. Rode vários em paralelo, cada um com sua faixa de contas: `--users 1250 --offset 0`, `--users 1250 --offset 1250` etc. Uma máquina de 8 vCPU roda 8 deles (10.000 pessoas).

Opções: `--writers 0.2`, `--municipal 0.3`, `--ramp` (segundos para abrir todas as conexões), `--duration` (segundos no total).

A cada 10 s o relatório mostra pessoas, conexões de chat abertas, requisições por segundo, tempos p50/p95/p99 e códigos de resposta por rota, e o atraso das mensagens do chat.

Ao terminar, apague as contas e mensagens de teste:

```bash
cd /opt/apuracao && docker run --rm -v "$PWD/scripts:/s:ro" node:24-bookworm-slim node /s/load-test.mjs cleanup | docker compose -p apuracao -f deploy/cluster/edge.yml --env-file .env.production exec -T db psql -q -U apuracao
```

## Como ler

- **Bom:** chat aberto igual ao número de pessoas, sem falhas de stream; p95 abaixo de 1 s nas rotas; atraso do chat abaixo de 2 s; nenhum `timeout` ou 5xx.
- **429 em `chat-post`** é esperado quando a sala passa de 10 mensagens por segundo.
- Acompanhe no servidor: `docker stats` (CPU do container `app` perto de 100% indica o limite de um processo).

## Resultados (21/10/2026, 3 máquinas de 8 vCPU)

| Pessoas | Tempo típico | 95% abaixo de | Erros | Atraso do chat |
| ------- | ------------ | ------------- | ----- | -------------- |
| 5.000   | 0,1 s        | 0,3 s         | 0     | 1,0 s          |
| 10.000  | 0,025 s      | 0,27 s        | 0     | 0,9 s          |

Com 10.000 pessoas, a máquina de entrada usou ~2 de 8 núcleos (Caddy ~1,6; Postgres ~0,2). Um dos workers (`gota8v`) perdeu 20–28% da CPU para vizinhos da DigitalOcean (coluna `st` do `vmstat`) e ficou com pouca folga; o outro, com 0–6%, ficou ~60% ocioso.
