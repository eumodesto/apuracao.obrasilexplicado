# Composição cartográfica — 5 de outubro de 2026

Rodada exclusiva de UI. Componentes alterados: cockpit.tsx, cockpit.css e map.tsx. Integração TSE, parsers, cache, histórico, dados e regras eleitorais mantidos.

O canvas central foi ampliado e as faixas estruturais foram substituídas por sobreposições: modos, breadcrumb, legenda contextual, zoom, atribuição e timeline. O select territorial permanente foi recolhido em navegação opcional acessível; mapa, busca e contexto seguem disponíveis. Todas as legendas e modos permanecem acessíveis. Placar horizontal com percentuais maiores, barra de 9px e maioria compacta. Regiões exibem totalização, avatar/representação do líder, partido, percentual, vantagem e mini barra de dados reais. Feed compacto.

Duas iterações visuais corrigiram escala e sobreposição dos controles ao extremo norte.

Medições:

| Viewport | Header | Canvas | Geometria / altura canvas | Timeline | Laterais / gap / margens |
| --- | --- | --- | --- | --- | --- |
| 1366×768 | 52px | 745×682 | 87% | 42px | 290 / 265 / 17 / 16px |
| 1440×900 | 52px | 819×814 | 87% | 42px | 290 / 265 / 17 / 16px |
| 1920×1080 | 52px | 1289×994 | 87% | 42px | 295 / 270 / 17 / 16px |

Sem overflow horizontal ou erros JavaScript nas três resoluções. Gráfico e timeline inteiros. Testes de navegador validaram nove larguras, toque, modos, filtros, exterior, busca, deep links, replay, 304 e preservação do mapa/zoom durante indisponibilidade. Sete cenários aprovados; duas falhas de sincronização inicial foram corrigidas e passaram na repetição. Testes editoriais adicionais de tamanho do header, área do mapa e navegação recolhida aprovados. Lint, TypeScript e build aprovados.

Capturas finais: outputs/cartographic-1366x768.png, outputs/cartographic-1440x900.png e outputs/cartographic-1920x1080.png. Comparação simultânea das três referências disponíveis e das capturas: outputs/comparacao-composicao.html. As referências anexadas disponíveis são da interface clara anterior; a composição escura segue as proporções e hierarquia do pedido textual, sem alegação de identidade pixel a pixel com uma referência escura ausente.

Fotos nas capturas headless exibem o fallback quando a rota não recebe a imagem. A aplicação aberta no navegador mantém os retratos coloridos originais recebidos. A rota de fotos não foi alterada.
