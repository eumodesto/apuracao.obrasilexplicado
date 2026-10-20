# Plano — Resultados Brasil, 2º turno (25/10/2026)

Documento de planejamento técnico e de produto. Atualizado em 20/10/2026.

## 1. Decisões tomadas

| Tema                      | Decisão                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| Hospedagem                | DigitalOcean (sai a Vercel)                                                 |
| Banco de dados e arquivos | Supabase: Postgres + Storage (imagens das figurinhas e do compartilhamento) |
| Login                     | Google; administradores com e-mail e senha                                  |
| Pagamento                 | Pix pelo Mercado Pago (já implementado)                                     |
| Tempo grátis              | 1 minuto por conta, contado só depois que a apuração começa                 |
| Chat                      | Só quem pagou escreve; quem está no tempo grátis só lê                      |
| Figurinhas                | Vendidas em pacotes, sem rosto de candidatos, podem ser doadas              |
| Sessão                    | Um aparelho por conta: o login novo derruba o anterior                      |
| Indicação                 | Quem compartilha ganha 10 figurinhas à escolha por indicado que pagar       |

## 2. Problemas corrigidos antes de começar

Já estão na branch `claude/cool-cori-kokztc`:

1. **O site estava preso ao 1º turno (crítico).** A descoberta da eleição exigia a data 04/10/2026 e o código `6257`. No domingo, o painel mostraria os resultados do 1º turno. Agora o sistema segue o turno mais recente publicado pelo TSE para Presidente. `TSE_TURN=1` ou `TSE_TURN=2` fixam um turno, se for preciso.
2. **Resultados do 1º turno misturados no 2º.** A base municipal do 1º turno (8 MB) e os históricos (gráfico e linha do tempo) agora são separados por eleição.
3. **Cabeçalho dizia "1º turno" fixo.** Agora o turno vem dos dados, e o resultado final mostra "ELEITO" no 2º turno.
4. **Cobrança antes de a apuração começar.** O minuto grátis só corre depois que o TSE publica o primeiro resultado da eleição ativa. Antes disso, o selo mostra "começa a contar com a apuração".
5. **Gargalo no pico.** Cada consulta de dados gravava no banco. Agora cada pessoa grava no máximo uma vez a cada 5 segundos, e a contagem do tempo continua exata.
6. **Pix no celular.** O botão "Copiar código Pix" vem em destaque e o QR Code fica recolhido, já que ninguém consegue ler o QR Code da própria tela.
7. **Celular.** O texto de status não invade mais os botões do cabeçalho, as abas do mapa mostram que rolam para o lado e o selo do tempo não cobre o fim da página.

Pendências conhecidas, fora do escopo destas correções:

- **Reiniciar o servidor depois que o TSE publicar o 2º turno.** O mapa por estado se atualiza sozinho, mas o reinício elimina qualquer dado do 1º turno que ainda esteja em memória.
- **Código sem uso:** `src/features/election/dashboard.tsx`, a tela antiga, que não é usada.
- **Vercel:** `vercel.json` e trechos do README falam da Vercel e serão atualizados na migração.

## 3. Infraestrutura na DigitalOcean para 5 mil pessoas simultâneas

### Carga estimada no pico (domingo, das 17h às 21h)

- **Painel:** cada pessoa consulta os dados a cada 3 segundos, em várias rotas. Com as respostas "sem mudança" (304) e o cache em memória, a estimativa é de **1.500 a 5.000 requisições por segundo**.
- **Chat:** 5 mil conexões abertas. Com o modo lento (1 mensagem a cada 5 s por pessoa) e só pagantes escrevendo, calculo **de 50 a 300 mensagens por segundo** distribuídas para todos.
- **Banco:** com o limite de gravação de 5 segundos, ficam cerca de **1.000 gravações por segundo** de atividade, mais as do chat.

### Recomendação

**Atenção:** a DigitalOcean **não tem servidores no Brasil**. O mais próximo é Nova York (`NYC3`), com cerca de 120 ms de latência até São Paulo, o que é aceitável para este uso. Para o servidor e o banco ficarem perto um do outro, o **projeto do Supabase deve ser criado na região us-east-1 (Virgínia)**, e não em São Paulo. Com o banco em São Paulo, cada consulta do servidor pagaria cerca de 120 ms a mais.

| Item                        | Recomendado                                                                                | Custo aproximado  |
| --------------------------- | ------------------------------------------------------------------------------------------ | ----------------- |
| Servidores da aplicação     | **3 Droplets CPU-Optimized de 4 vCPU e 8 GB**, cada um rodando 4 processos Node            | ~US$ 84/mês cada  |
| Balanceador de carga        | **DO Load Balancer**, com conexões persistentes para o chat                                | ~US$ 12/mês       |
| Cache, tempo real e limites | **DO Managed Valkey (Redis), 1 GB**                                                        | ~US$ 15/mês       |
| Coletor do TSE              | 1 Droplet Basic de 1 vCPU e 2 GB, que busca os dados no TSE e distribui para os servidores | ~US$ 12/mês       |
| Banco e arquivos            | **Supabase Pro** + compute Small, com pooler de conexões em modo transação                 | ~US$ 25 + compute |

- **Total se ficar ligado o mês inteiro:** cerca de **US$ 320/mês**.
- **A DigitalOcean cobra por hora.** O plano é subir os servidores na sexta, testar no sábado e desligar o excedente na segunda. Uma semana nessa configuração sai por volta de **US$ 80**.
- **Versão mínima,** se o orçamento apertar: 2 Droplets Basic de 4 vCPU e 8 GB (cerca de US$ 48 cada), sem o coletor separado. Aguenta algo como 2 a 3 mil pessoas com folga menor.

**Os preços são de referência.** Confira na página de preços da DigitalOcean e do Supabase antes de contratar. A capacidade também é uma **estimativa**: no sábado faremos um **teste de carga** (k6) simulando 5 mil pessoas, e só ele confirma o tamanho.

### Por que essa arquitetura

- **Um coletor só para o TSE.** Hoje cada servidor busca no TSE por conta própria. Com 3 servidores seriam 3 vezes mais requisições, e o TSE bloqueia temporariamente quem insiste demais (403/429), como o próprio README avisa. O coletor busca uma vez e entrega para todos pelo Valkey.
- **Chat pelos nossos servidores.** As mensagens chegam por SSE, uma conexão que o servidor mantém aberta. O Valkey distribui entre os servidores, e o Supabase guarda o histórico. Isso fica mais barato e mais controlável do que o tempo real do Supabase, que cobra por conexão simultânea.
- **Valkey também para** a sessão única (consulta rápida, sem ir ao banco a cada requisição), o modo lento do chat e o limite de tentativas no login de administrador.
- **Implantação:** imagem Docker, health check (`/api/health`), variáveis de ambiente no painel da DigitalOcean e reinício sem derrubar o site (rolling restart).

## 4. Funcionalidades

### 4.1 Sessão única (anticompartilhamento)

- Cada login gera um identificador de sessão, gravado no banco e no Valkey.
- Toda requisição de dados e do chat confere esse identificador. Se a conta entrou em outro aparelho, o anterior recebe _"Sua conta foi conectada em outro aparelho"_ e volta para o login.
- O último login vale. Quem trocou do computador para o celular não fica preso.
- Fica registrado quantas vezes cada conta trocou de aparelho, para identificar compartilhamento na área de administração.

### 4.2 Cadastro depois do login

- **Nome de usuário único:**
  - de 3 a 20 caracteres (letras, números, `_` e `.`);
  - maiúsculas e minúsculas contam como iguais;
  - nomes reservados (`admin`, `tse`, `moderador` e outros) e filtro de palavrões;
  - aviso "disponível ✓" enquanto a pessoa digita.
- **Partido que apoia:** lista com sigla, número e cor, mais a opção "Prefiro não informar".
- **Consentimento LGPD:** opinião política é dado sensível (art. 11), então a pessoa marca uma caixa específica autorizando o uso do partido para o selo no chat. Ela pode trocar o partido ou apagar a conta depois.
- **O tempo grátis não corre durante o cadastro.**

### 4.3 Chat

- Uma sala geral, com mensagens de até 280 caracteres. Cada mensagem mostra o nome de usuário com o **selo colorido do partido**.
- Ao abrir, mostra as últimas 100 mensagens. A rolagem acompanha as novas, a não ser que a pessoa esteja lendo as antigas (nesse caso aparece o aviso "Novas mensagens ↓").
- **Só quem pagou escreve.** Quem está no tempo grátis vê o chat e o botão "Liberar o chat por R$ 5".
- **Modo lento:** 1 mensagem a cada 5 segundos por pessoa, com limite também no servidor pelo Valkey.
- **Moderação:**
  - filtro de palavrões e bloqueio de links;
  - botão "Denunciar";
  - uma mensagem apagada pela administração some ao vivo para todos;
  - pausar um usuário bloqueia o envio na hora.
- **Figurinhas** aparecem grandes na conversa (Fase 2).

### 4.4 Figurinhas (Fase 2)

- **Sem rosto de candidatos.** As artes são simbólicas: cores e números dos partidos, bordões ("Virou!", "Apurando…", "Confia!"), mascotes, urna e mapa. Quem cria e aprova as artes é você. Eu crio **exemplos em SVG** para testar o fluxo.
- **Gaveta ao lado do campo de mensagem** (no celular, abre acima do teclado), com as abas:
  - **Minhas:** as figurinhas que a pessoa tem;
  - **Loja:** pacotes à venda, pagos no Pix pelo mesmo fluxo do acesso;
  - **Presentes:** figurinhas recebidas de outras pessoas.
- **Doar:** a pessoa escolhe uma figurinha que tem e o nome de usuário de quem vai receber. A figurinha sai do estoque de quem doa e entra no de quem recebe, numa única operação no banco, sem risco de duplicar. A pessoa recebe o aviso "@fulano te deu uma figurinha".
- **Administração:** subir as artes para o Supabase Storage, montar pacotes, definir preço e ativar ou desativar.

### 4.5 Compartilhar no WhatsApp com imagem

- **Botão "Chamar a galera":** gera uma imagem do placar no momento, com o nome de quem convida ("@fulano te chamou para acompanhar a apuração"), e um link pessoal `site/?ref=fulano`.
- **No celular** (Android e iPhone), o botão usa o compartilhamento nativo do aparelho, que **envia a imagem e o texto juntos** para o WhatsApp.
- **No computador,** onde o compartilhamento nativo não envia arquivos, o botão abre o WhatsApp Web com o texto e o link. A **prévia do link** no WhatsApp mostra a mesma imagem, gerada no servidor para cada pessoa que convida.
- **A imagem não traz números da apuração.** Ela mostra só o convite e a marca, para não vazar o resultado pago e não ficar desatualizada no grupo.

### 4.6 Indicações

- **Registro:** o `ref` do link fica guardado por 7 dias no aparelho de quem clicou e é associado à conta no primeiro login.
- **Quando conta:** só quando o indicado **paga**. Vale uma vez por indicado, ninguém indica a si mesmo e contas pausadas não contam.
- **Recompensa:** a cada indicação paga, quem indicou ganha **10 créditos** e escolhe as 10 figurinhas na loja.
- **Painel "Suas indicações":** quantas pessoas clicaram, entraram e pagaram, e quantos créditos a pessoa tem.

### 4.7 Área de administração (`/admin`)

- **Entrada pelo Google, sem senha:** só os e-mails da lista `ADMIN_EMAILS` (os e-mails que você indicar, configurados no servidor) abrem `/admin`. O Google só autentica e-mails verificados, então não há senha para vazar nem para trocar. Esses e-mails também ficam em `STAFF_EMAILS`, com acesso liberado ao painel.
- **Usuários:**
  - busca por nome de usuário, e-mail ou ID, mostrando partido, situação do pagamento, indicações e trocas de aparelho;
  - **Pausar:** bloqueia na hora o chat e o painel, com o motivo registrado; dá para reativar;
  - **Excluir:** anonimiza a conta (apaga nome, e-mail e partido) e mantém o registro do pagamento, por obrigação fiscal; as mensagens no chat passam a mostrar "usuário removido".
- **Moderação:** fila de mensagens denunciadas e botão para apagar mensagens.
- **Painel geral:** pessoas online, pagamentos do dia, receita, indicações e figurinhas vendidas.
- **Registro de auditoria:** quem fez o quê e quando.

### 4.8 Layout responsivo profissional

- **Computador:**
  - placar à esquerda, mapa no centro e **chat como coluna fixa à direita**, recolhível;
  - o conteúdo de "Por região" passa para uma aba dentro do painel.
- **Celular:**
  - barra inferior com as abas **Placar | Mapa | Chat**, com áreas de toque de pelo menos 44 px;
  - o campo do chat acompanha o teclado (usando `visualViewport`), e a gaveta de figurinhas abre no lugar do teclado, como no WhatsApp.
- **Tablet:** duas colunas, com o mapa e o chat lado a lado.
- **Testes:** em 360, 390, 768, 1024, 1280 e 1440 px, sem rolagem horizontal.

## 5. Melhorias de experiência propostas

1. **Antes da apuração começar,** mostrar uma contagem regressiva: "A apuração começa às 17h · chame a galera".
2. **Popup de pagamento:**
   - mostrar "1.284 pessoas acompanhando agora" e o chat ao vivo desfocado atrás do popup;
   - destacar o que muda com o pagamento: "Libera o chat e o mapa completo".
3. **E-mail de confirmação** do pagamento ("Acesso liberado até 31/10"), que reduz pedidos de estorno. Precisa de um serviço de envio de e-mail.
4. **Aviso de virada:** quando o 2º colocado passar o 1º, aparece um aviso no topo e uma figurinha "Virou!" é sugerida no chat.
5. **Página de status** para quem pagou e está com problema: um botão "Meu acesso" com o comprovante do pagamento.
6. **Acessibilidade:** contraste revisado, navegação por teclado no chat e anúncio de mensagens novas para leitores de tela, com volume limitado.

## 6. Cronograma

O 2º turno é em 5 dias, então o cronograma tem margem pequena. As funções novas param na **sexta à noite**.

| Dia       | Entrega                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Ter 20/10 | ✅ Correções acima e este plano                                                                                                               |
| Qua 21/10 | ✅ Sessão única e cadastro (nome de usuário, lado 13/22, LGPD). Pendente: migração para o Supabase (aguarda credenciais)                      |
| Qui 22/10 | ✅ Chat (SSE + Valkey, modo lento, filtros, denúncia; ver `docs/CHAT.md`). A seguir: área de administração (pausar, excluir, apagar mensagem) |
| Sex 23/10 | Layout responsivo com o chat, compartilhar no WhatsApp com imagem e indicações (registro e contagem). Docker e implantação na DigitalOcean    |
| Sáb 24/10 | Pix e Google reais em produção, teste de carga com 5 mil pessoas, ajustes e reinício depois da publicação do 2º turno                         |
| Dom 25/10 | Monitoramento durante a apuração; nenhuma mudança de código, salvo correções urgentes                                                         |
| Depois    | **Fase 2:** loja de figurinhas, doação, resgate das recompensas por indicação e melhorias da seção 5                                          |

**Se algo atrasar,** a ordem de corte é: indicações → compartilhar com imagem → chat. A sessão única, a administração e o 2º turno **não podem ser cortados**.

## 7. O que preciso de você

1. **Supabase:** criar o projeto na **região us-east-1** e me passar `DATABASE_URL` (a do pooler, em modo transação), `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` pelas variáveis de ambiente, nunca pelo chat.
2. **DigitalOcean:** criar a conta e um _Personal Access Token_ para a implantação, ou fazer a implantação você mesmo seguindo um guia que eu escrevo.
3. **Google Cloud:** criar o OAuth Client, com os passos de `docs/ACCESS_AND_PAYMENT.md`.
4. **Mercado Pago:** Access Token de produção e segredo do webhook.
5. **Domínio:** qual será o endereço do site.
6. **Artes das figurinhas:** as definitivas, sem rosto de candidatos, para a Fase 2.
7. **Revisão jurídica:** do uso do partido (LGPD), dos termos de uso do chat e da venda de figurinhas com temas eleitorais.
