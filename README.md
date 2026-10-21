# Resultados Brasil — Eleições 2026

Painel independente exclusivo para Presidente da República, 1º turno de 2026. Dados e fotos vêm dos arquivos públicos oficiais do TSE, consultados pelo servidor. Não há resultados fictícios na aplicação.

O acesso exige login com Google: cada conta tem 1 minuto grátis e depois paga R$ 5,00 no Pix (Mercado Pago) para acompanhar até o fim da apuração. Veja [Login, tempo grátis e pagamento Pix](docs/ACCESS_AND_PAYMENT.md). Antes do início da apuração, a página inicial é uma contagem regressiva com aviso por e-mail, e `/resultado-1-turno` mostra o resultado oficial do 1º turno; veja [Contagem regressiva e resultado do 1º turno](docs/LANDING.md).

## Executar

Requer Node.js 20.9+ (validado com Node 24).

```sh
npm ci
npm run dev
```

Abra http://127.0.0.1:3000. Sem credenciais do Google e do Mercado Pago, o modo de desenvolvimento oferece um login de teste e um Pix simulado. Para produção: `npm run build` e `npm start`, ou a imagem Docker descrita em [Publicar na DigitalOcean](docs/DEPLOY_DIGITALOCEAN.md). Configure `SITE_URL` com o domínio público e as variáveis de login e pagamento descritas em `.env.example`; nenhuma credencial do TSE é necessária.

## Verificar

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Com o servidor local na porta 3000 (`FREE_SECONDS=86400 npm run dev`) e Microsoft Edge instalado: `npm run test:e2e`. Os testes entram com o login de teste do modo de desenvolvimento. Os testes de navegador verificam dados reais, filtros, 304 e sete larguras. Os estados controlados de apuração/erro/finalização existem apenas na interceptação do navegador de teste e recebem uma faixa explícita de simulação nas capturas. Nunca são servidos pela aplicação.

## Integração

`TSE → fetch server-side → validação Zod → normalização → cache → API interna → interface`

- Descoberta pelo EA11, catálogo geográfico EA12 e resultados EA20.
- Brasil inclui exterior, como publicado pelo TSE. Exterior corresponde à abrangência oficial ZZ.
- Votos em ordem decrescente; empates usam a sequência oficial. Todas as candidaturas permanecem visíveis.
- `e=s` não significa necessariamente eleito. A interface reproduz `st`, e o domínio só marca eleito quando `st=Eleito` e `e=s`.
- O percentual `pvap` é publicado em relação aos votos a votáveis concorrentes. Não é renomeado como percentual de votos válidos nem recalculado. Votos válidos do resumo usam `v.vv`; nulos usam `v.tvn` (inclui nulos técnicos).
- `and=f` define finalização; 100% sozinho não define resultado final.
- `null` aparece como “—”; zero oficial aparece como zero.

## APIs

```text
GET /api/election/president
GET /api/election/president/map
GET /api/election/president?scope=br
GET /api/election/president?state=PB
GET /api/election/president?state=PB&municipality=20516
GET /api/election/president?scope=exterior
GET /api/election/president?scope=exterior&municipality=29254
GET /api/election/geography
GET /api/election/photo/{id-oficial-do-candidato}
```

Municípios/localidades devem pertencer ao catálogo e à UF solicitada. Parâmetros desconhecidos, repetidos ou inválidos retornam 400. Não existe proxy de URL arbitrária. Fotos aceitam somente IDs presentes no resultado presidencial oficial.

## Cache e operação

O padrão é **um processo Node persistente**. O singleton do processo compartilha o cache entre usuários e mantém uma única atualização em andamento por URL. O intervalo mínimo é 3 segundos, sob demanda; sem visitantes não há polling contínuo. As requisições JSON são espaçadas em 250 ms, além do intervalo de cada recurso. Configuração e catálogo têm TTL de uma hora.

Respostas válidas são persistidas atomicamente em `.cache/tse`, permitindo recuperar o último snapshot após reinício. O diretório precisa ser gravável e persistente em produção. Uma falha de disco mantém o cache em memória e registra aviso. Não há fallback para fixtures de teste.

ETag e Last-Modified são enviados nas revalidações. 304 reutiliza o objeto normalizado, sem reprocessamento. A API interna tem ETag próprio, incluindo o estado de disponibilidade. O cliente conserva snapshots por abrangência e não troca resultados de um local pelos de outro.

404/400: pausa inicial de cinco minutos; 429/403: pelo menos 610 segundos e respeito a Retry-After; 5xx, timeout, conexão, JSON/schema inválidos: pausa inicial de dez segundos. Erros repetidos ampliam a pausa até uma hora. 404/429/403 suspendem também outras buscas JSON do processo, evitando insistência contra possível bloqueio. O snapshot válido anterior permanece disponível.

**Antes de usar múltiplas réplicas ou serverless**, implemente armazenamento compartilhado e coordenação distribuída (lock/lease e limite por IP). Trocar somente o armazenamento não distribui o single-flight. A interface `SnapshotCache` desacopla o armazenamento do domínio, mas este repositório não configura Redis nem a infraestrutura de escala. O teste de 1.000 chamadas comprova deduplicação de concorrência dentro de um processo; não é um teste de carga de produção.

## Referências e entrega

Veja [relatório de implementação](docs/IMPLEMENTATION.md) e [proveniência dos arquivos oficiais](tests/fixtures/README.md). As capturas de verificação ficam em `outputs/`.

O mapa vetorial das 27 UFs, a legenda e os resultados regionais estão documentados em [Mapa eleitoral](docs/ELECTORAL_MAP.md). O agregado reutiliza o cache e o cliente existentes, acompanha EA14 e revalida UFs alteradas, com segurança a cada 60 segundos. A cartografia do IBGE está incorporada localmente em `data/geography/`.

A homepage presidencial agora apresenta o resultado nacional primeiro, análise dos 50%, tabela estadual, peso eleitoral e histórico observado. Veja [relatório da homepage](docs/PRESIDENTIAL_HOMEPAGE.md) para métodos, arquivos e limites da persistência na hospedagem atual.
## Site publicado

Produção: https://resultados-brasil-2026.vercel.app — projeto Vercel `resultados-brasil-2026`, publicado em 04/10/2026. Acesso público verificado sem login, com 27 UFs e seleção estadual por toque em viewport 390×844. Captura em `outputs/public-mobile.png`.

Configuração em `vercel.json`: região São Paulo (`gru1`), duração máxima de 60 segundos e cache de arquivos em `/tmp/tse-cache`. Nesse ambiente o disco é temporário e os singletons são por instância; a persistência após reciclagem e a coordenação entre múltiplas instâncias não são garantidas. O desenho de cache distribuído descrito abaixo continua necessário para tráfego em escala. Não há fixtures no deploy; os dados públicos foram conferidos diretamente nas APIs publicadas.

