# Chat ao vivo

Sala única para todos que estão no painel. Quem está no tempo grátis lê; quem pagou (ou é da equipe) escreve.

## Como funciona

- **Conexão:** `GET /api/chat/stream` mantém uma conexão Server-Sent Events. Ao conectar, chegam as últimas 100 mensagens e quantas pessoas estão no chat; depois, cada mensagem nova, cada mensagem apagada e, a cada 20 s, a contagem de pessoas e a permissão de escrever. Um comentário a cada 20 s mantém a conexão viva atrás de proxies.
- **Envio:** `POST /api/chat/messages` com `{ "text": "..." }`. Só para contas pagas ou da equipe (402 para o tempo grátis).
- **Denúncia:** `POST /api/chat/messages/:id/report`, uma por pessoa por mensagem, guardada para a moderação.
- **Sessão única e tempo grátis:** a conexão confere a sessão a cada 20 s. Se a conta entrou em outro aparelho, chega o evento `end` com `replaced` e o painel volta ao login; se o tempo grátis acabou, a conexão fecha.
- **Privacidade:** as mensagens públicas levam só nome de usuário, lado (13, 22 ou nenhum), texto e horário. O ID da conta e o e-mail nunca saem do servidor.

## Regras das mensagens (`src/lib/chat/text.ts`)

- Até 280 caracteres, uma linha; caracteres invisíveis e de inversão de texto são removidos.
- **Modo lento:** uma mensagem a cada 5 s por pessoa, controlado no servidor (vale entre servidores via Redis). Mensagens recusadas não gastam a vez.
- **Limite da sala:** no máximo 10 mensagens por segundo no total (`ROOM_PER_SECOND`). Acima disso, quem envia recebe 429 ("O chat está muito movimentado") e espera a vez do modo lento.
- **Envio em lotes:** as mensagens novas são agrupadas a cada 1,5 s e codificadas uma única vez para todas as conexões abertas (`connectStream`).
- **Links proibidos:** endereços (`http`, `www.`, domínios comuns), `wa.me`, `t.me`.
- Palavrões listados viram asteriscos (palavra inteira; "computador" e "disputa" não são afetados).
- Repetição de um mesmo caractere 10 vezes ou mais é recusada.

## Interface (`src/features/chat/`)

- **Botão "Chat"** dentro do selo flutuante, com contador de mensagens novas.
- **Telas a partir de 1600 px:** o chat abre sozinho numa coluna fixa à direita e o painel se ajusta ao espaço restante.
- **Telas menores:** o chat abre por cima da coluna da direita; o selo vai para a esquerda dele.
- **Celular:** tela cheia, ajustada à área visível, para o teclado não cobrir o campo.
- A lista acompanha as mensagens novas só se a pessoa estiver no fim; se estiver lendo as antigas, aparece "N novas mensagens ↓".
- **Tempo grátis:** no lugar do campo de texto, o botão "Liberar para escrever" abre o pagamento; essa janela pode ser fechada, e depois do pagamento o campo aparece na hora.

## Infraestrutura

| Variável       | Sem ela                                                             | Com ela                                                                                                        |
| -------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `REDIS_URL`    | Mensagens, modo lento e contagem só no processo atual (um servidor) | Pub/sub entre todos os servidores, modo lento compartilhado (`SET NX PX`) e soma das conexões de cada servidor |
| `DATABASE_URL` | Histórico em memória (some ao reiniciar)                            | Tabelas `chat_messages` e `chat_reports` no Postgres, criadas no primeiro uso                                  |

Cada servidor guarda em memória sua cópia das últimas 100 mensagens e a mantém atualizada pelo Redis, então uma conexão nova não consulta o banco. Atrás do balanceador da DigitalOcean, a rota envia `X-Accel-Buffering: no` e `Cache-Control: no-transform` para o stream não ser bufferizado.

## Testes

`tests/chat.test.ts`: texto, modo lento, histórico, denúncias e exclusão. Com `TEST_REDIS_URL`, testa dois servidores trocando mensagens pelo Redis; com `TEST_DATABASE_URL`, o histórico no Postgres.

## Próximos passos

- Área de administração: apagar mensagens (`deleteMessage` já distribui a exclusão para todos), ver denúncias, pausar e excluir usuários.
- Figurinhas na conversa (Fase 2).

## Foto de perfil

- No topo do chat fica a sua foto com um **+**. Ao tocar, a câmera abre na hora (a frontal, no celular). A pessoa tira a foto, vê a prévia e escolhe entre "Usar esta foto" e "Tirar outra". Se a câmera não abrir (sem permissão ou sem câmera), dá para escolher uma foto da galeria.
- O navegador recorta o quadrado central e envia 512 px. O servidor (`POST /api/profile/photo`) decodifica a imagem com `sharp`, recorta em 256×256 e salva como JPEG novo. Metadados como localização e qualquer conteúdo que não seja imagem não passam. O limite é de 8 MB, com uma troca a cada 5 s.
- O endereço da foto (`/api/chat/photo/<chave>.<versão>`) usa uma chave derivada do id da conta com o `SESSION_SECRET`. Ele não revela o id e não dá para adivinhar o de outra pessoa. Cada foto nova muda a versão, e as mensagens antigas também passam a mostrar a foto atual.
- Sem foto (ou se ela for removida), aparece a inicial do nome na cor do partido.
- Armazenamento: tabela `profile_photos` no Postgres (Supabase), com cerca de 15 KB por foto. Em desenvolvimento, fica em `.data/photos/`.
- Quem está no tempo grátis também pode pôr foto. A moderação remove fotos pela área `/admin`, e excluir a conta apaga a foto.

## Figurinhas

- No lugar do botão de voz fica o botão **Figurinha**. Ele aparece com o campo vazio e vira "Enviar" quando a pessoa digita. Ao tocar, abre o pacote grátis (12 figurinhas, sem rosto de candidatos). Tocar numa figurinha envia na hora.
- A lista fica em `src/lib/chat/stickers.ts`. O servidor só aceita figurinhas dessa lista, e o modo lento vale igual ao das mensagens.
- Pacotes pagos, doação e indicação ficam para a fase 2.
