# Cartografia municipal e exploração

Revisão de 05/10/2026 restrita ao mapa, interação e tooltip. Layout, header, placar, painel direito, timeline, rotas, integração TSE, cache, snapshots e regras eleitorais não foram reestruturados. As únicas mudanças no contêiner conectam o registry existente ao tooltip, reaproveitam os municípios já recebidos e corrigem o modo dos links `candidate=13/22`.

## Resultado e limites

Atualização de cobertura: [5.571 resultados oficiais nas 27 UFs](MUNICIPAL_DATA_COVERAGE.md), coletados sem falhas e com base validada incluída na publicação. Capturas completas: outputs/municipal-complete-1366x768.png, outputs/municipal-complete-1440x900.png e outputs/municipal-complete-390x844.png.

O modo Municípios desenha efetivamente **5.571 polígonos no Brasil inteiro a 1×**. Estados mantém 27 preenchimentos estaduais. Vantagem, Apurado e Candidato usam a malha municipal, com dados de cada município; não herdam a cor da UF.

A carga municipal foi concluída: 5.571 de 5.571 resultados recebidos. Cada polígono usa seu próprio resultado oficial; respostas indisponíveis preservam o último dado validado. A coleta usou o rate limiter, parser e backoff existentes.

O tooltip usa os dois mais votados no território, fotos pelo endpoint já existente, nomes, partido/número, totalização, diferença e votos válidos. Há fallback de iniciais quando as fotos estão indisponíveis. Comparação com 2022 é omitida por ausência de dados confiáveis integrados.

## Tecnologia e geometria

Canvas 2D com Path2D compilados uma vez por geometria; bitmap base reaproveitado no hover; índice espacial para identificar o polígono sob o cursor. Preenchimento, bordas municipais, bordas estaduais, rótulos, seleção, hover e tooltip são camadas distintas. Não há 5.571 componentes React nem reconstrução das geometrias em mousemove.

Fonte: malhas municipais oficiais do IBGE, API v3, arquivos por UF `public/maps/{uf}.json`, `qualidade=minima`, projeção equiretangular com correção pela latitude central. Auditoria atual: **5.571 associações TSE, 141.037 vértices, 3.168.707 bytes**. Mato Grosso usa a malha oficial 2024 atualizada, simplificada em 0,01 grau, incluindo Boa Esperança do Norte; as demais UFs mantêm a malha da API v3. Coordenadas projetadas arredondadas a três casas.

A malha é a versão simplificada oficial, não uma malha de máxima resolução. Os níveis de detalhe desta rodada controlam visualização, espessuras, rótulos e culling; não representam três fontes geométricas de resoluções diferentes. Arquivos por UF são carregados conforme viewport, em grupos de três, com timeout de 15 segundos. A auditoria detalhada está em `outputs/municipal-geometry-audit.json`.

Rótulos usam seleção, votos válidos quando disponíveis e área projetada como prioridade genérica, com supressão de colisões. Não há lista de cidades exemplificadas hardcoded. Zoom livre e pan não selecionam território nem alteram URL. Clique mantém o drill-down e enquadramento animado existentes (340–480 ms), respeitando movimento reduzido. Seleção persistente tem contorno mais forte que hover. Atualizações não reenquadram a câmera.

No modo candidato, a escala vai de 0 a 100% do voto daquele candidato, independentemente de quem lidera. A legenda explicita que a contagem de lideranças considera apenas os resultados recebidos. Vantagem representa diferença em pontos percentuais, e Apurado representa seções totalizadas.

## Performance e testes

Edge headless, 1440×900, desenvolvimento, 120 frames durante pan/wheel com **5.570 polígonos visíveis**: aproximadamente **54,4 FPS**, intervalo p95 40 ms e desenho máximo 12,5 ms. Não é garantia de 60 FPS constantes ou desempenho equivalente em celulares. Medição: `outputs/map-national-performance.json`; reprodução: `node scripts/verify-map-performance.mjs --national`.

Lint, typecheck, **68 testes unitários**, **12 cenários de navegador** e build aprovados. Cobertura completa validada em 1366×768, 1440×900 e 390×844.

Cobertura: 27 estados versus 5.571 municípios; zoom 1×/2×/4×; pan sem seleção; hover BA/SP/PB e João Pessoa; tooltip nas quatro bordas; clique UF/município; candidato 13/22; Apurado; Vantagem; movimento reduzido; zona selecionada; seleção/zoom preservados em 304 e falhas.

## Entrega visual

Todos em 1440×900, gerados pelo navegador:

| Captura | Arquivo |
|---|---|
| Brasil / Estados | `outputs/cartography-brasil-estados.png` |
| Brasil / Municípios | `outputs/cartography-brasil-municipios.png` |
| Nordeste 2× | `outputs/cartography-nordeste-2x.png` |
| Nordeste 4× | `outputs/cartography-nordeste-4x.png` |
| Hover estadual | `outputs/cartography-hover-estadual.png` |
| Hover municipal | `outputs/cartography-hover-municipal.png` |
| Candidato Flávio | `outputs/cartography-candidato-flavio.png` |
| Candidato Lula | `outputs/cartography-candidato-lula.png` |
| Apurado | `outputs/cartography-apurado.png` |
| Vantagem | `outputs/cartography-vantagem.png` |

Galeria e comparação com os anexos: `outputs/cartography-comparison.html`. Validação reproduzível: `node scripts/verify-multiscale-map.mjs`, com limite de 80 segundos e relatório em `outputs/cartography-validation.json`.
