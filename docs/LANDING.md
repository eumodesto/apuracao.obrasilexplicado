# Contagem regressiva e resultado do 1º turno

## Página inicial antes da apuração

Até `COUNT_STARTS_AT` (padrão: 25/10/2026, 17h de Brasília), `/` mostra a contagem regressiva (`src/features/landing/`), sem exigir login:

- "2º turno · domingo, 25 de outubro" e "A apuração do 2º turno abre aqui no dia 25.", com a data tirada de `COUNT_STARTS_AT`.
- Relógio "5 dias · 00:56:03", calculado no navegador. Quando chega a zero, a página recarrega e o servidor passa a mostrar o painel (login, cadastro, tempo grátis).
- Mapa do Brasil com cadeado; no celular, menor e acima do cartão.
- **"Me avise":** `POST /api/notify` guarda o e-mail uma vez só (tabela `notify_signups` no Postgres, ou `.data/notify.json` localmente), com limite de uma tentativa a cada 3 s por IP.
- A equipe (`STAFF_EMAILS`) continua vendo o painel antes do horário, entrando por `/login`. Quem não é da equipe e entrar antes vê a contagem.

**O envio dos e-mails ainda não está feito:** a lista é guardada, mas mandar o aviso no dia 25 precisa de um serviço de e-mail (por exemplo, Resend ou Amazon SES), com remetente e domínio verificados. A coluna `notified_at` já existe para marcar quem recebeu.

## Faixa do resultado do 1º turno na página inicial

Acima da contagem regressiva, uma faixa com o resultado oficial do 1º turno (`src/features/landing/round-band*.tsx`), lida do arquivo nacional do TSE (um arquivo só, consultado no máximo a cada 30 min). Ela carrega à parte (Suspense), então a contagem nunca espera o TSE; se o TSE não responder, a faixa simplesmente não aparece.

- **Computador:** fotos oficiais do TSE nas pontas (por `/api/election/photo/:id`, que agora aceita também os candidatos do 1º turno), nomes com partido e número, a frase "Flávio Bolsonaro e Lula vão ao 2º turno" (o mais votado primeiro, com o selo "2º turno" vindo do TSE), uma barra com o percentual dos votos válidos de cada lado e a marca de 50%, "100% apurado" e a linha verde de progresso.
- **Celular (até 900 px):** cartão sem fotos com "Brasil", "2º turno · definido às 20:55" (horário oficial da totalização), seções apuradas, a frase, os dois percentuais e a barra dividida.
- O 13 fica à esquerda (vermelho) e o 22 à direita (azul), como nos cartões do cadastro. Os nomes ganham acento só na exibição ("FLAVIO" vira "Flávio").

## Resultado do 1º turno (`/resultado-1-turno`)

Página pública com o resultado oficial do 1º turno, lido do TSE com o mesmo cliente, cache e limites do painel:

- A configuração do TSE lista todos os turnos publicados (`rounds`); `roundConfig(config, '1')` monta a do 1º turno a partir da configuração ativa. Os arquivos do 1º turno têm código próprio (`6257`) e não se misturam com os do 2º.
- Lê Brasil, os 27 estados e o exterior (29 arquivos, um de cada vez, consultados no máximo a cada 30 min).
- Mostra os votos válidos de todas as candidaturas (com o selo "2º turno" vindo do TSE), comparecimento, abstenção, brancos e nulos; o mapa colorido pelo mais votado em cada estado (cor mais forte para vantagem maior) e a tabela por estado.
- Se o TSE não responder, mostra um aviso para tentar de novo.

A primeira visita depois de reiniciar o servidor pode levar alguns segundos (os 29 arquivos são buscados em sequência); as seguintes usam o cache.

## Testes

`tests/landing.test.ts`: formato da contagem, validação e gravação dos e-mails, escolha da configuração do 1º turno e leitura dos 29 arquivos do 1º turno (com o TSE simulado a partir dos arquivos oficiais de exemplo), sem tocar em nenhum arquivo do 2º.
