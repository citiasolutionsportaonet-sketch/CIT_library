# CIT Library — instruções de construção para Claude Code

Documento de execução • português brasileiro • 20/10/2026

> Estado atual da implementação: veja `docs/status.md`. Decisões tomadas: `docs/decisoes.md`.
> Comandos operacionais: `README.md`. Esta especificação é a fonte dos requisitos.

## 1. Missão e modo de trabalho

Construa do zero uma biblioteca web de produtos chamada **CIT Library**, utilizável por uma equipe entre Macs na mesma rede. A primeira entrega precisa permitir login, cadastro real de produtos, upload de fotos, edição, busca e consulta persistentes. Entregue software funcional, não apenas telas, mocks ou planejamento.

Este arquivo é a especificação de trabalho. Leia-o integralmente antes de alterar o projeto. Inspecione o repositório e preserve trabalho existente. Trabalhe em fases na ordem abaixo, verificando cada fase. Não espere a implementação de importação, kits ou compatibilidades para liberar o cadastro manual.

Use julgamento para escolhas reversíveis; registre pressupostos em `docs/decisoes.md`. Pergunte apenas quando faltar um dado que impeça execução segura. Nunca invente arquivos Intelbras, dados técnicos oficiais, preços, credenciais ou compatibilidades. Dados de demonstração devem estar identificados e separados do ambiente real. Não declare um comando ou teste executado sem evidência. Ao encerrar cada fase informe o que funciona, como acessar, verificações feitas e pendências reais. Não apresente etapas futuras como concluídas.

### Contexto e decisões assumidas

O contexto recuperado confirma desenvolvimento entre Macs e uso no mesmo Wi-Fi. As decisões deste documento são uma especificação proposta, não transcrição de acordos anteriores. CIT é o nome do sistema; não presumir razão social, domínio, identidade visual ou significado da sigla.

Decisões iniciais: aplicação privada, catálogo interno, BRL, fuso de exibição America/Sao_Paulo, instantes armazenados em UTC, interface pt-BR, uma organização CIT no início, isolamento multi-tenant desde a primeira migração. Sem estoque, vendas, emissão fiscal, e-commerce ou ERP nesta entrega. Compatibilidades entram depois do núcleo e não podem ser inferidas apenas por marca ou família.

## 2. Ordem de entrega obrigatória

| Fase | Resultado verificável | Prioridade |
|---|---|---|
| 0 | Projeto, banco, configuração, healthcheck e migração | Imediata |
| 1 | Login, organização inicial, permissões, produtos e fotos reais | Imediata; primeiro marco utilizável |
| 2 | Catálogo refinado, preços e importação Intelbras com prévia | Após aceite da fase 1 |
| 3 | Kits e compatibilidades manuais fundamentadas | Após fase 2 |
| 4 | API externa, storage S3 e operação expandida | Evolução documentada |

Construa o isolamento, autenticação e backup básico junto com a fase 1. API externa é futura; a camada de serviços e contratos deve estar preparada desde agora.

## 3. Stack e política de versões

- Next.js com App Router; TypeScript estrito; React; Tailwind CSS; runtime Node para banco, importação e arquivos.
- PostgreSQL 17 em Docker Compose inicialmente; Prisma ORM 7, CLI, client e adaptador PostgreSQL na mesma versão compatível.
- Node.js 22 LTS; fixar patch validado em `.nvmrc` e `engines`.
- npm com `package-lock.json` versionado. Fixar versões diretas; usar `npm ci` nas demais máquinas.
- Better Auth para sessões e login por e-mail/senha. Não implementar criptografia ou gestão de sessão próprias.
- Zod; React Hook Form só se simplificar; Sharp para imagens; parser CSV robusto; ExcelJS para XLSX após validar manutenção.
- Vitest para regras e integração; Playwright para fluxos críticos. ESLint e `tsc --noEmit` separados do build.

Antes de instalar, conferir documentação oficial, versões estáveis e alertas de segurança. Não usar releases canary. Registrar versões em `docs/versoes.md`. Prisma 7 usa `prisma.config.ts`, client gerado com caminho explícito e `@prisma/adapter-pg`. Ler `.env` explicitamente nos scripts fora do Next.js.

## 4. Arquitetura

Monólito modular: um aplicativo Next.js, um PostgreSQL e storage privado. Sem microserviços, Redis obrigatório ou Kubernetes.

```text
src/app/(auth)/login/  src/app/(private)/[tenantSlug]/{produtos,catalogo,importacoes,kits,configuracoes}/
src/app/api/{auth/[...all],media/[id],health}/route.ts
src/modules/{auth,tenants,products,media,pricing,imports,kits,compatibility}/
src/server/{db,auth,tenant-context,permissions,errors,audit}.ts  src/server/{storage,jobs}/
prisma/{schema.prisma,migrations/,seed.ts}  scripts/  tests/{unit,integration,e2e}/  docs/
var/media/   # privado, ignorado no Git
```

Componentes de servidor para consultas; cliente só onde há interação. Server Actions e Route Handlers chamam os mesmos serviços de domínio. Toda entrada passa por autenticação, contexto de tenant, autorização, validação e serviço. Módulos sensíveis `server-only`. Nunca importar Prisma ou segredos em componentes de cliente.

Erros de domínio padronizados: código, mensagem pt-BR, campos inválidos e requestId. 401 sem sessão, 403 proibido, 404 inexistente ou de outro tenant, 409 conflito, 422 validação, 429 limite. Não expor stack traces, SQL ou caminho físico.

## 5. Experiência e requisitos funcionais

### Primeiro uso
1. Operador configura `.env` e sobe PostgreSQL.
2. Migração cria estrutura; bootstrap solicita nome/e-mail/senha do primeiro administrador sem exibir senha ou gravá-la em histórico.
3. Cria organização CIT e membership OWNER em transação. Se já houver dono, não substituir nem resetar senha.
4. Login abre produtos com estado vazio e botão “Cadastrar produto”. Sem cadastro público.

### Produtos
Mínimo para rascunho: nome e SKU interno único na organização. Marca, modelo, código do fabricante, categoria, descrição, unidade, EAN/GTIN, tags, características técnicas, links oficiais, observações internas, status e fotos podem vir depois. Para ativar: nome, SKU, marca e modelo; foto recomendada (pendência, sem bloquear).

Criar, consultar, editar, duplicar como rascunho com novo SKU sem copiar histórico de preços, arquivar e restaurar. Não excluir fisicamente produto referenciado. Arquivado sai da busca padrão. Mostrar autoria, atualização e versão. Editar versão antiga: detectar conflito e pedir recarregamento.

Formulário com “Salvar rascunho” visível, validação por campo, estado de envio, proteção contra duplo clique e aviso de alterações não salvas. Duplicidade retorna mensagem útil. Características em JSON validado (chave, valor, unidade); sem EAV.

### Catálogo
Grade e tabela; miniatura, nome, marca, modelo, SKU, categoria e status. Busca por nome, SKU, modelo e código do fabricante; filtros por marca, categoria, tags e status; paginação no servidor, ordenação estável e estado na URL; debounce. Detalhe com galeria, especificações, anexos, preços conforme permissão e kits relacionados. Projeção no servidor para não enviar custos a quem não pode vê-los. Catálogo privado por padrão.

### Cadastros auxiliares
Marcas, categorias e tags por tenant; sem duplicatas normalizadas. Categoria com pai opcional e prevenção de ciclos. Impedir exclusão de item usado; permitir desativação. Seed idempotente pode criar marca Intelbras, sem inventar produtos.

## 6. Modelo de dados e invariantes

IDs UUID. Datas `timestamptz`, dinheiro `Decimal(18,4)` + moeda ISO 4217; nunca float; decimais como string na API. Quantidades de kit `Decimal(12,3)`. Campos normalizados separados; preservar zeros à esquerda. `tenantId` obrigatório em toda tabela de domínio; modelos de auth sem tenant.

| Entidade | Campos e restrições essenciais |
|---|---|
| User | modelo da auth, nome, e-mail normalizado único, ativo |
| Session / Account / Verification | modelos oficiais da auth |
| Tenant | id, name, slug único, status, timezone, createdAt |
| Membership | tenantId, userId, role, active; unique(tenantId,userId) |
| Invitation | tenantId, email, role, tokenHash único, expiresAt, acceptedAt; uso único |
| Brand | tenantId, name, normalizedName; unique(tenantId,normalizedName) |
| Category | tenantId, name, parentId; índice por pai, sem ciclos |
| Product | tenantId, sku, normalizedSku, name, brandId?, categoryId?, model?, manufacturerCode?, normalizedManufacturerCode?, gtin?, description?, unit, status DRAFT/ACTIVE/ARCHIVED, specs JSON, internalNotes?, version, createdById, updatedById, createdAt, updatedAt, archivedAt? |
| Tag / ProductTag | tenantId, nome normalizado; vínculo único |
| MediaAsset | tenantId, storageKey único, originalName, detectedMime, byteSize, sha256, width?, height?, kind IMAGE/PDF, state PENDING/READY/FAILED/DELETING, createdById, createdAt |
| ProductMedia | tenantId, productId, mediaId, position, altText; capa = Product.coverMediaId validada |
| PriceList | tenantId, name, supplier?, currency, kind COST/SALE/REFERENCE |
| PriceEntry | tenantId, productId, priceListId, amount, effectiveAt, recordedAt, source MANUAL/IMPORT, importRowId?, supersedesId?, createdById; append-only |
| ImportBatch | tenantId, supplier, fileMediaId, sha256, mapping JSON, parserVersion, status, counters, createdById, startedAt?, completedAt?, leaseUntil?, heartbeatAt? |
| ImportRow | tenantId, batchId, rowNumber, raw, normalized, errors, status, matchedProductId?, appliedAt?; unique(batchId,rowNumber) |
| Kit / KitItem | sku único por tenant; quantity > 0; unique(kitId,productId) |
| Compatibility | productA/B, relationType, direction, status VERIFIED/UNVERIFIED/INCOMPATIBLE, evidência, verificador |
| AuditEvent | tenantId, actorId?, action, entityType, entityId, sanitizedDiff, requestId, createdAt; append-only |
| ApiCredential (fase 4) | tenantId, name, tokenHash, scopes, expiresAt?, revokedAt?, lastUsedAt? |

Integridade: unique(tenantId, normalizedSku); código do fabricante único por tenant+marca; nunca mesclar por nome parecido. FKs compostas (tenantId, id). Índices iniciando por tenantId. CHECK amount >= 0, quantity > 0. Exclusão restrita em referências históricas. Capa pertence ao mesmo produto/tenant e está READY. Concorrência por `version` (UPDATE condicionado; 409). Preço vigente: maior effectiveAt <= instante, desempate recordedAt e id. Correção de preço cria nova entrada com referência de substituição.

## 7. Autenticação, RBAC e tenants

Cookies HttpOnly, SameSite, Secure em HTTPS. Hashes/APIs da biblioteca. Login com erro genérico, limite por IP e conta, expiração, logout com revogação, bloqueio de inativo. Membership ativa verificada em cada operação.

| Capacidade | OWNER | ADMIN | EDITOR | VIEWER |
|---|---|---|---|---|
| Catálogo e anexos | Sim | Sim | Sim | Sim |
| Custos e histórico de preços | Sim | Sim | Sim | Não |
| Produtos, fotos, categorias e kits | Sim | Sim | Sim | Não |
| Importar e alterar preços | Sim | Sim | Sim | Não |
| Convidar e alterar membros comuns | Sim | Sim | Não | Não |
| Alterar OWNER, encerrar tenant, credenciais API | Sim | Não | Não | Não |
| Auditoria e backup | Sim | Sim | Não | Não |

ADMIN não concede OWNER, não altera OWNER nem eleva a si mesmo. Nunca remover o último OWNER. Convites com TTL, token aleatório por hash, ligados a organização e e-mail; sem SMTP, link mostrado uma vez. Recuperação sem SMTP por comando local auditado. Tenant = slug da rota + membership; body/header não são autoridade. Testar acesso cruzado. Usuário de banco da aplicação sem privilégios administrativos.

## 8. Upload, fotos e documentos

Seleção múltipla, arrastar/soltar, progresso, miniaturas, reordenar, capa, texto alternativo, remover vínculo. JPEG/PNG/WebP, 10 MB, 20 fotos por produto, 40 megapixels. HEIC recusado com instrução. PDF (20 MB) na fase 2. Sem SVG, HTML, executáveis, ZIP ou URL remota. Limite no streaming, MIME por conteúdo, decodificação real, reencode Sharp, orientação, sem EXIF/GPS, miniatura e exibição. Nome físico UUID. Storage privado fora de `public/`, rota autenticada com tenant + RBAC, `nosniff`. Interface `StorageProvider` (put/get/delete/stat), local agora, S3 documentado. Temporário → validar → derivados → estado → rename atômico; compensação e reconciliação; órfãos só após carência. Quotas configuráveis.

## 9. Importação Intelbras CSV/XLSX e preços (fase 2)

Sem layout oficial assumido. Adaptador configurável e fixture sintética rotulada. Fluxo: upload privado com limites → hash e lote → encoding/delimitador/aba → mapeamento salvo por perfil → normalização sem escrita → prévia paginada → matching exato (marca + código, ou SKU mapeado) → confirmação com política de atualização (vazio não apaga; criado = DRAFT; ausentes não são arquivados) → worker durável (`npm run worker`, fila PostgreSQL, SKIP LOCKED, lease, heartbeat, retries, retomada). Valores pt-BR estritos, negativo erro, vazio ≠ zero, datas no fuso do tenant. Histórico append-only; reimportação idempotente. Exportação CSV neutraliza fórmulas. Homologação só com arquivo real autorizado.

## 10. Kits e compatibilidades (fase 3)

Kit com SKU próprio, componentes do mesmo tenant, quantidade positiva, sem aninhamento. Arquivados com alerta. Total com Decimal, parcial com faltantes listados (nunca zero). Compatibilidade manual com direção, evidência, responsável e data; “não verificado” ≠ “incompatível”; sem autorrelação; nada presumido por marca.

## 11. Contrato de API futura (fase 4)

`/api/v1` com OpenAPI, credenciais por tenant com hash, scopes, expiração, revogação, rate limit, auditoria, Idempotency-Key. Sem reutilizar cookie de usuário.

## 12. Segurança transversal

Zod no servidor com allowlist. Limites: nome 1–200, SKU 1–80, modelo/código 1–120, descrição 20 mil, notas 10 mil, 30 tags, 100 specs. GTIN com dígito verificador. Links só http/https. Texto simples. Queries parametrizadas. CSRF/origem; sem CORS `*`. TLS fora de dev isolado. Segredos fora do Git. Logs estruturados com requestId e redação. CSP e headers. Rate limit persistente. Auditar mudanças relevantes.

## 13–14. Fases executáveis e scripts

Scripts obrigatórios: `dev`, `dev:lan`, `build`, `start`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `db:generate`, `db:migrate`, `db:deploy`, `db:seed`, `bootstrap`, `worker` (fase 2), `backup`, `restore -- --manifest CAMINHO --target BANCO_NOVO`, `media:reconcile -- --dry-run`. Nunca `prisma migrate reset`, `db push` ou `docker compose down -v` com dados reais.

Aceite do primeiro marco: OWNER entra e cadastra produto sem preço; anexa 3 fotos, escolhe capa, reordena e reabre após reiniciar app e banco; outro usuário vê no segundo Mac; VIEWER só consulta (escrita negada no servidor); EDITOR não administra membros; tenant B inacessível incluindo foto por ID; upload inválido recusado sem perder produto; SKU duplicado e edição concorrente com mensagens úteis; backup restaurado em ambiente isolado recupera produto e fotos.

## 15. Macs na mesma rede

Um Mac servidor hospeda app, worker, PostgreSQL e arquivos; os demais usam o navegador numa URL canônica. Desenvolvimento em dois Macs: código por Git, bancos separados; nunca copiar banco vivo, node_modules, volume Docker ou `.env`. HTTP local só em rede confiável para teste; uso contínuo com HTTPS (ex.: Caddy) e cookies Secure. PostgreSQL só em loopback. Troca de servidor via backup/restauração.

## 16. Backup e operação

Banco + mídias = um conjunto. Quiescência real (lock no banco), dump custom, cópia de mídia, manifesto com hashes. Restauração em destino novo, valida hashes, revoga sessões. Política inicial: diário, 7 diários + 4 semanais, 3-2-1. Metas RPO 24 h / RTO 4 h só valem após simulação medida.

## 17. Testes

Unitários (normalização, GTIN, dinheiro, datas, preço vigente, RBAC, kits, importação), integração em PostgreSQL real (constraints entre tenants, SKU concorrente, versão, último OWNER, append-only, idempotência, worker, compensação de upload), E2E (login, produto com fotos, edição, busca, arquivar, VIEWER, acesso cruzado, persistência). Registrar em `docs/validacao.md` o que rodou e o que não rodou.

## 18–19. Definição de pronto

Pronto = integrado ao banco e storage persistentes, autorizado no servidor, validado, utilizável, verificado e documentado. Sem botões ativos para ações não implementadas. Não declarar homologação Intelbras sem arquivo real.
