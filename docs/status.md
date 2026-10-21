# Status por fase

## Correções de segurança — 21/10/2026

- Markup restrito a quem tem `costs:read`, tanto na interface quanto na API e no CSV. O preço de venda continua visível. Se o percentual já for conhecido externamente, ainda é possível estimar o custo a partir do preço.
- Pesquisa: bloqueio de IPv4 mapeado em IPv6 e faixas especiais; conexão HTTP usa os endereços DNS validados, com validação de cada redirecionamento e TLS preservado.
- Validação Linux/Node 22.23.3/PostgreSQL 17.11: 158 unitários e 39 de integração passaram; lint, tipos, build e auditoria de dependências de produção passaram. Dos 7 cenários E2E, 6 passaram na primeira execução; o seletor ambíguo de Brave foi corrigido e o cenário restante passou ao ser repetido.
- Pendências da análise: mediana deve considerar a observação vigente de cada anúncio, e restauração deve reprovar divergência na contagem de mídias. Organização/revisão do catálogo continua pendente. Nenhuma classificação foi aplicada aos dados reais nesta correção.

## Fase 0 — fundação · **verificada** (PostgreSQL local sem Docker)
Pronto: scaffold Next 16.4.2, TS estrito, Tailwind 4, Prisma 7.10.1 (`prisma.config.ts`, adaptador pg), Compose PostgreSQL 17.11 com digest e healthcheck em loopback, `.env.example`, migração inicial, `/api/health` (só status; 503 sem banco), scripts do contrato.
Banco local em `var/pgdata` (`npm run db:local:start`); migração aplicada; health ok. Docker Compose continua disponível como alternativa.

## Fase 1 — produtos e fotos · **verificada com banco real**, falta bootstrap e segundo Mac
Implementado: login/logout (Better Auth, sem cadastro público, rate limit por IP e conta em PostgreSQL), bootstrap interativo, convites com link único, membros (papel/ativação, último OWNER protegido), RBAC no servidor, isolamento por tenant (contexto obrigatório + FKs compostas), produtos (criar, editar com versão otimista, duplicar, arquivar/restaurar, busca/filtros/paginação/ordenação na URL, grade e tabela), fotos (múltiplas, arrastar, progresso, capa, reordenar, alt, remover; MIME por conteúdo, Sharp, EXIF removido, HEIC recusado com instrução, storage privado, download autenticado), auditoria append-only, backup/restauração com manifesto e hashes, reconciliação de mídia, reset de senha local.
Verificado: integração 21/21, E2E 4/4, persistência após reinício, backup → restore com app sobre a cópia, acesso por IP/`.local`. Ver docs/validacao.md.
Não verificado: acesso a partir de um segundo Mac físico.

## Pendências reais
- Rodar `npm run bootstrap` no banco real (usuário digita a própria senha).
- Testar de um segundo Mac.
- Ao migrar para o servidor definitivo: backup aqui → restore lá (docs/backup-restauracao.md).
- HTTPS local (Caddy) para uso contínuo; launchd para app e backup; rotação de backups; criptografia do backup.
- Gestão de marcas/categorias (desativar, hierarquia na UI) — fase 2.
- Fases 2–4 não iniciadas (preços, importação, worker, PDF, kits, compatibilidades, API, S3).
- Layout Intelbras: nenhum arquivo real recebido.


---

# Implantação "inteligência de produtos" (pedido de 21/10/2026)

## Etapa A — dados, banco e catálogo · **concluída e verificada**
2.971 produtos importados com custo do distribuidor (2.088 com custo, 883 sem); preço CIT = custo × (1 + markup), markup configurável 0–45% (inicial 45%); mediana de ofertas aceitas, referência comercial = mediana × 1,15 (rotulada como cálculo, não preço anunciado), diferença CIT × mediana; custos ocultos para VIEWER e para a API sem `costs:read`; telas: catálogo com preços, produto com as duas metodologias e evidências, Importações, Pesquisa, Configurações.

## Etapa B — pesquisa real com 10 produtos · **executada, resultado parcial**
Motor, fila persistente, worker, verificação de imagem/PDF e revisão funcionando. Com apenas o site oficial: 9 imagens válidas para os 5 pilotos, 1 ficha técnica quebrada detectada, 5 produtos sem página conhecida. **Preços: nenhum**, por falta de credencial (Mercado Livre/Brave). O site da Intelbras bloqueou acesso automatizado (403).

## Etapa C — 2.971 produtos · **bloqueada por decisão/credencial**
Pronta no código (lote com teto de chamadas/custo, pausa automática). Depende de: credenciais de provedor licenciado e aprovação do orçamento.

## Etapa D — API para outros sistemas · **disponível (leitura)**
`/api/v1` com credencial por organização (hash), escopos, limite por minuto, OpenAPI. Pendente: escrita com Idempotency-Key, webhooks.

## Organização do catálogo (21/10/2026) · **pronto; aplicação aguarda revisão**
- Tela **Organizar** (`/cit/catalogo`): categorias propostas por regras de palavra-chave (2.745 de 2.971 produtos, 26 grupos em hierarquia), marcas só quando citadas no nome (Intelbras 107, DJI 90, Wide Voice 70, Novacomm 14, Twibi 4), sugestão de modelo (campo separado), cadastros de categorias (hierarquia, mover, desativar, sem ciclos), marcas e tags.
- Catálogo: filtros "sem categoria/sem marca", categoria-mãe inclui subcategorias, **edição em massa** auditada (categoria, marca, tag, status — ativar exige marca e modelo; total confirmado), **exportação CSV** (custo só com permissão; fórmulas neutralizadas).
- Nada foi aplicado aos dados reais: a classificação é aplicada pelo usuário na tela.
