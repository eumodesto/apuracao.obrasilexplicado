# Relatório de implementação

1. **Produto:** painel presidencial de 2026 com identidade própria, apuração, lista completa de candidatos, fotos oficiais, situação oficial, participação, filtros geográficos, estados de espera/erro/final e atualização automática. Aviso de independência visível.
2. **Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS 4 e CSS próprio, Zod 4, Vitest e Playwright. A pasta original continha apenas `.git`.
3. **Integração:** descoberta EA11 → geografia EA12 → resultado EA20 → adapter validado → cache → API → navegador. EA14/EA15 foram consultados e seus schemas testados; não são dependência do polling do resultado principal.
4. **Arquivos criados:** `src/lib/tse/{types,schemas,config,urls,normalizers,cache,client,service}.ts`; rotas em `src/app/api/election`; `src/features/election/dashboard.tsx`; `src/app/{layout,page,loading,error,opengraph-image}.tsx`; `globals.css`, `favicon.ico`, `apple-icon.png`; testes, fixtures e documentação.
5. **Arquivos anteriores alterados:** nenhum arquivo de aplicação preexistia. Arquivos de configuração, manifesto e lockfile foram criados para este projeto.
6. **Fontes oficiais:** configuração `https://resultados.tse.jus.br/oficial/comum/config/ele-c.json`; catálogo `/oficial/ele2026/6257/config/mun-e006257-cm.json`; resultados `/oficial/ele2026/6257/dados/{uf}/{uf}{municipio-opcional}-c0001-e006257-u.json`; fotos `/oficial/ele2026/6257/fotos/br/{sqcand}.jpeg`. Caminho nacional `dados/br/br-c0001-e006257-u.json`. URLs reais verificadas constam na proveniência das fixtures.
7. **API interna:** `/api/election/president`, `/api/election/geography`, `/api/election/photo/[id]`. Filtros documentados no README; usa códigos TSE de cinco dígitos.
8. **Cache:** memória compartilhada entre requisições de um processo, single-flight por URL e persistência local atômica de respostas válidas. Interface desacoplada para outro storage. Dados persistidos são novamente validados na restauração.
9. **Atualização:** mínimo padrão de 3 s no recurso solicitado, configurável por `TSE_POLL_INTERVAL_MS`. Polling no navegador suspenso quando a aba está oculta. Backoff é respeitado no servidor. Não há consulta do navegador aos JSONs do TSE.
10. **ETag/304:** suporta ETag/If-None-Match e Last-Modified/If-Modified-Since na origem; 304 mantém o mesmo snapshot normalizado. API interna emite ETag e 304. Falhas de disponibilidade mudam o ETag para que o aviso chegue ao cliente.
11. **Erros:** 400/404: backoff inicial de 5 min; 429/403: 610 s ou Retry-After maior; 5xx, timeout, reset de conexão, JSON/schema inválidos: 10 s iniciais, exponencial. Snapshot anterior preservado; arquivo nunca publicado deixa estado de espera/indisponibilidade sem números inventados.
12. **Brasil:** consulta direta do resultado nacional oficial, incluindo exterior. Zero oficial preservado.
13. **UF:** todas as UFs descobertas no EA12; fluxo real validado com Paraíba.
14. **Municípios:** catálogo dinâmico, validação de pertencimento à UF e resultado municipal EA20; João Pessoa/PB (20516) validado ao vivo.
15. **Exterior:** ZZ e localidades do catálogo; total ZZ e ABIDJÃ (29254) validados ao vivo. Não há lista manual de países.
16. **Lint:** passou sem erros ou avisos após correções.
17. **Typecheck:** passou com TypeScript strict.
18. **Testes:** 36 testes de dados passaram; 2 fluxos Playwright passaram. Cobertura inclui 0/parcial/100%, situações oficiais, quatro abrangências, ordenação, validação, 200/304/400/404/429/5xx, timeout/reset, JSON/schema inválidos, recuperação e 1.000 chamadas concorrentes. Navegador validou filtros reais, refresh, 304, teclado, ausência de erro JavaScript e sete larguras sem overflow: 375, 390, 430, 768, 1024, 1280 e 1440 px. Capturas adicionais de estados controlados possuem faixa de teste.
19. **Build:** build de produção final passou sem avisos, após os últimos ajustes.
20. **Limitações:** implantação pública não realizada; é necessário definir domínio e infraestrutura. Deduplicação e limite são por processo; múltiplas réplicas exigem lock, cache e controle de requisições distribuídos. Persistência depende de volume gravável. Não foi feito teste de carga distribuída nem auditoria formal de acessibilidade. Apuração ativa e final foram exercitadas em testes isolados, pois a amostra oficial acessada estava aguardando totalização. O projeto é dedicado ao 1º turno solicitado. Restam alertas de dependências de desenvolvimento na cadeia `eslint-config-next → fast-glob → micromatch → braces`, sem correção compatível indicada pelo npm; a dependência Vitest foi atualizada para eliminar seus alertas. A auditoria final `npm audit --omit=dev` retornou zero vulnerabilidades.

## Precisão semântica

O campo `e=s` também pode indicar segundo turno; nunca é usado sozinho para exibir “Eleito”. A situação exibida é `st`. Finalização depende de `and=f`, não de inferência por votos ou percentual. `pvap` é o percentual oficial de votos computados em relação a votáveis concorrentes; por isso a interface usa “Percentuais publicados pelo TSE”. A API nunca estima votos nem resultados.
