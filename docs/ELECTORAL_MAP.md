# Mapa eleitoral — entrega de 04/10/2026

## Arquivos

Criados: `data/geography/br-ufs.geojson`, `ufs.json`, `README.md`; `scripts/generate-map.mjs`; `src/features/election/map/geometry.json`, `election-map.tsx`, `map.css`; `src/lib/tse/map-geography.json`, `map-types.ts`, `map-normalizers.ts`, `map-coordinator.ts`, `map-service.ts`; `src/app/api/election/president/map/route.ts`; `tests/map.test.ts`, `tests/e2e/map.spec.ts`; este relatório.

Alterados: `src/features/election/dashboard.tsx` (seção e seleção estadual), `src/lib/tse/client.ts` (consulta do cache sem HTTP), `src/lib/tse/schemas.ts` (horários opcionais do EA14), `tests/e2e/dashboard.spec.ts` (recarregamento aceita avanço real da apuração, sem regressão), `README.md`.

## Cartografia e interface

As 27 UFs são polígonos reais da API de Malhas v3 do IBGE, qualidade mínima, incorporados ao repositório. A transformação reproduzível gera SVG local de aproximadamente 71 KB, sem biblioteca cartográfica ou consulta geográfica em runtime. Veja `data/geography/README.md` para URLs e projeção. Os nomes e regiões também vêm do IBGE.

O mapa ocupa aproximadamente 62% da composição desktop. Mobile empilha mapa, legenda e detalhes. Todas as UFs aceitam foco, Enter/espaço e seleção. Estados pequenos têm chamadas externas e botões adicionais de pelo menos 44×44 px. O DF é desenhado por último para não ser encoberto por Goiás. Detalhes ficam em um painel fixo no fluxo da página, evitando tooltip fora da tela. O clique usa o filtro estadual existente. A transição de preenchimento dura 300 ms e respeita redução de movimento.

O líder é o candidato com maior `vap` absoluto; empate positivo e zero ficam neutros. Cores são registradas por ID oficial e preservadas quando muda o ranking. A legenda inclui todos os candidatos conhecidos e ordena pela quantidade de UFs lideradas. Liderança não é projeção de vitória. Horários estaduais, intervalo dos arquivos e horário nacional são exibidos separadamente: os arquivos do TSE não constituem um snapshot atômico.

### Ajuste solicitado de fotos e cores

As fotos do TSE são exibidas sem o filtro CSS de escala de cinza. A referência compartilhada `src/lib/tse/candidate-colors.ts` substitui a paleta arbitrária por tons representativos da identidade partidária: PL azul, PT vermelho, PSD verde, AVANTE/NOVO laranja e MISSÃO amarelo. Lista de candidatos, mapa, legenda e regiões usam a mesma função; o ranking não altera a cor. As tonalidades são escolhas de apresentação baseadas na identidade partidária, não um campo de cor fornecido pelo arquivo de resultados do TSE. Fontes: [marca do PL](https://plmulher.org.br/wp-content/uploads/2025/09/Manual_de_aplicacao_da_marca_PL_Mulher.pdf), [loja oficial do PT](https://loja.pt.org.br/produtos/), [material do NOVO](https://novo.org.br/material-oficial/), [marcas do AVANTE](https://avante70.org.br/marcas-avante/), [MISSÃO](https://missao.org.br/) e [PSD](https://psd.org.br/).

## Dados, atualização e cache

O navegador consulta uma única API agregada, `/api/election/president/map`, a cada 3 segundos, além do polling nacional/filtro já existente. Não faz 27 consultas estaduais. A API tem ETag; 304 não chama `setData`, conservando os elementos SVG. A aba oculta pausa o polling. Falhas conservam o último mapa e mostram indisponibilidade.

O coordenador usa o mesmo `TseClient`, normalização, cache em memória/disco, ETag/Last-Modified, single-flight, espaçamento e backoff existentes. Concorrência entre visitantes é deduplicada por agregado e URL dentro do processo. As leituras estaduais são enfileiradas uma por vez, permitindo que filtros interativos usem o próximo slot entre consultas do mapa. Na carga fria consulta até 27 resultados estaduais, além do acompanhamento EA14 e do nacional reutilizado. Depois, EA14 indica quais UFs precisam ser revalidadas. Há revalidação de segurança a cada 60 segundos por UF, para correções e diferenças de publicação no CDN. Ausência de sinal também usa essa revalidação de segurança. Um indicador mais novo que o arquivo estadual mantém a UF elegível para nova tentativa no próximo ciclo, respeitando o intervalo do cliente.

Portanto existem novas requisições oficiais: acompanhamento EA14 e UFs ainda não consultadas/alteradas, não uma nova sequência de 27 por visitante ou por ciclo. O limite de coordenação continua sendo um processo Node persistente; múltiplas réplicas precisam do cache e lock distribuídos já indicados no README.

## Regiões

Os percentuais são calculados por soma dos votos absolutos destinados a `Válido`, dividida pela soma de `v.vv` das UFs da região. Não há média de percentuais estaduais. Anulados não entram. Ausência de UF, destino desconhecido positivo ou diferença entre soma dos candidatos válidos e denominador oficial suspende os percentuais e informa inconsistência. A evolução de seções usa totais absolutos ponderados. Exterior não integra as cinco regiões.

## Verificação

Os 36 testes originais foram preservados. Sete novos testes unitários cobrem geometria/27 UFs, troca PB 100×90 → 110×115, cores, empate/zero/ausência, horários, agregação regional, votos anulados, inconsistência, deduplicação e acompanhamento sem sinal. Três novos testes de navegador cobrem dados oficiais, 27 UFs, integração do filtro, teclado, toque real no mobile, troca de liderança sem refresh, 304 sem mutação do SVG e falha preservando o último líder.

Capturas: `outputs/map-{375,390,430,768,1024,1280,1440}.png`. A verificação testa ausência de overflow em todas essas larguras. Capturas e interações usam dados oficiais reais; o teste de troca de liderança intercepta somente a API no navegador e não altera os dados de produção.

Resultado final: lint e typecheck aprovados; 43 testes unitários aprovados; 5 testes de navegador aprovados em 31,5 segundos, incluindo os dois existentes; build de produção concluído. Capturas revisadas visualmente nas sete larguras. A rodada final de navegador usa o build de produção local. Algumas capturas exibem indisponibilidade porque há arquivos estaduais com horário antigo; o painel conserva as cores e mostra esses horários, sem ocultar a defasagem oficial.

