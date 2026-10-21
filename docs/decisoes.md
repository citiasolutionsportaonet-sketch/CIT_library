# Decisões e pressupostos

| # | Decisão | Motivo |
|---|---|---|
| 1 | Next.js 16.4.2 com `cacheComponents: false` e `dynamic = "force-dynamic"` no layout raiz | Catálogo privado: nenhuma página é pré-renderizada nem cacheada entre usuários/tenants. |
| 2 | TypeScript 5.9.3 (não 7.x) | create-next-app 16.4.2 fixa `^5`; TS 7 (compilador nativo) ainda não validado com o plugin do Next. |
| 3 | Prisma 7.10.1 (a tag `latest` do npm aponta para 8.0.0-rc) | Política: sem pré-lançamentos. |
| 4 | IDs UUID gerados pelo PostgreSQL (`gen_random_uuid()`); Better Auth com `generateId: "uuid"` | Opacos e uniformes. |
| 5 | FKs compostas `(tenantId, id)` em todas as relações de domínio, inclusive a capa (`Product(tenantId,id,coverMediaId) → ProductMedia`) | Dois registros de tenants diferentes não podem ser relacionados nem por SQL direto. |
| 6 | Código do fabricante **exige marca**; índice único `(tenantId, brandId, normalizedManufacturerCode)` | Prisma 7.10 não modela índice parcial; no PostgreSQL nulos são distintos, então a unicidade só vale com código preenchido. CHECK reforça a regra. |
| 7 | Normalização: texto NFC + trim + espaços colapsados; códigos NFKC + maiúsculas; nomes de marca/categoria/tag sem acento e minúsculos | Deduplicação previsível; zeros à esquerda preservados (sempre string). |
| 8 | Marca, categoria e tag criadas por nome no formulário (upsert normalizado) | Cadastro rápido no primeiro marco. Gestão (desativar, hierarquia de categoria na UI) fica para a fase 2; o schema já tem `parentId` com CHECK contra autorreferência. |
| 9 | Restaurar produto arquivado volta para **Rascunho** | Evita reativar sem revisão. |
| 10 | Duplicar copia dados, tags e vínculos de fotos; não copia código do fabricante, GTIN, preços nem histórico | Código e GTIN identificam o item original. |
| 11 | Observações internas não são enviadas a VIEWER (projeção no servidor) | Conservador até haver custos (fase 2). |
| 12 | Fotos: derivados WebP `display` (≤2048 px) e `thumb` (≤480 px); o original não é guardado | Remove EXIF/GPS com garantia e limita disco. Consequência: não há "baixar original". |
| 13 | Upload: uma foto por requisição, corpo binário cru em `POST /api/t/{slug}/products/{id}/media` | Permite progresso real e limite durante o streaming sem parser multipart. Origin verificada contra lista exata. |
| 14 | Mudanças de galeria (capa, ordem, alt) não incrementam `Product.version` | Evita conflito falso com o formulário aberto na mesma tela. São auditadas. |
| 15 | Remover foto só desfaz o vínculo; asset sem vínculos vira `DELETING` e é apagado por `media:reconcile --apply` após 24 h | Banco e disco não compartilham transação. |
| 16 | Rate limit de login: 10/min por IP (Better Auth, storage customizado) e 10/15 min por e-mail, ambos em PostgreSQL com UPSERT atômico | Persistente e correto com vários processos. |
| 17 | Sem cookie cache de sessão | Logout, revogação e desativação valem na próxima requisição. |
| 18 | Papéis no banco: `cit` (dono, migrações/backup) e `cit_app` (aplicação, sem DDL; `audit_event` só SELECT/INSERT) | Mínimo privilégio; auditoria append-only garantida pelo banco. |
| 19 | Manutenção/backup via advisory lock: mutações tomam lock compartilhado `pg_try_advisory_xact_lock_shared`; backup toma o exclusivo | Quiescência real no banco, não só na UI. Mutações durante o backup recebem 503. |
| 20 | `pg_dump`/`pg_restore` executados dentro do container (`docker compose exec`) | Versão do cliente = servidor; sem senha em argumentos. |
| 21 | CSP com `'unsafe-inline'` em scripts | Next injeta scripts inline sem nonce; nenhuma origem externa é permitida. Endurecer com nonce numa fase posterior. |
| 22 | Fontes do sistema (sem `next/font/google`) | Build e uso offline na rede local. |
| 23 | Telemetria do Better Auth desativada | Dados internos. |
| 24 | `forbidden()` do Next não usado (experimental); páginas mostram aviso e o servidor nega a operação | Sem flags experimentais. |

| 25 | Neste Mac de trabalho: PostgreSQL 17.10 **sem Docker**, binários oficiais EDB (`postgresql-17.10-1-osx-binaries.zip`, assinatura Apple da EnterpriseDB verificada) em `~/.local/pgsql`, dados em `./var/pgdata` | Docker indisponível; ambiente é temporário até o servidor definitivo. `docker-compose.yml` segue válido para o servidor. Backup/restore usam `PG_BIN` quando definido (senha via `PGPASSWORD` no processo filho), senão o container. |
| 26 | E2E usa `.env.test` gerado por `npm run test:e2e:setup` (banco `*_test`, credencial aleatória de teste) | Nunca toca o banco real; config do Playwright recusa banco sem sufixo `_test`. |

| 27 | Leitor XLSX próprio (fflate + fast-xml-parser) em vez de ExcelJS | ExcelJS sem release desde 2023 e com 2 alertas moderados; leitor próprio aplica limites de tamanho/abas/colunas e detecta fórmulas. |
| 28 | Custo zero na planilha = custo ausente | A própria planilha trata 883 zeros como "preços zerados"; R$ 0 geraria Preço CIT R$ 0. |
| 29 | Descrição > 200 caracteres: nome resumido + texto integral em Descrição | Preserva os 131 produtos sem violar o limite de nome. |
| 30 | Vigência do custo importado: 21/10/2026 00:00 (America/Sao_Paulo) | Data em que o custo foi confirmado/enviado; ajustável em nova importação. |
| 31 | Fabricante não preenchido na importação | Planilha marca "a validar"; códigos de 7 dígitos parecem Intelbras, mas não foi presumido. |
| 32 | Preço CIT arredondado a centavos (meio para cima) | 278,50 × 1,45 = 403,825 → R$ 403,83. |
| 33 | Mediana: ofertas ACEITAS, não listagem, últimos 90 dias; mínimo recomendado 3 (abaixo disso é exibida como "abaixo do mínimo") | Regra da aba Configuração da planilha. |
| 34 | Aceite automático de oferta só com correspondência estrita; demais aguardam revisão | Evita mediana com kit/peça/modelo vizinho. |
| 35 | Imagens de pesquisa só entram na galeria após aprovação, pelo pipeline do upload; máx. 3 por produto | Direitos de uso e mesma segurança do upload manual. |
| 36 | Páginas de busca/loja como fonte de preço são marcadas e bloqueadas para a mediana | 14/14 ofertas da planilha piloto eram desse tipo. |
| 37 | Bloqueio anti-robô (403) não é contornado | Respeito à proteção do fabricante; registra nota. |
| 38 | Disparar pesquisa (gasto de API) = OWNER/ADMIN; revisar = EDITOR+; credenciais de API = OWNER | Controle de custo e de acesso externo. |
| 39 | `price_entry` append-only também no banco (sem UPDATE/DELETE para `cit_app`) | Mesmo critério da auditoria. |

| 40 | Classificação por regras de palavra-chave versionadas (`category-rules.ts`), proposta recalculada no servidor ao aplicar, só em produtos sem categoria | Determinística, revisável e auditável; não sobrescreve trabalho manual. |
| 41 | Marca proposta só quando o nome a cita (Intelbras, DJI, Twibi, Novacomm, Wide Voice) | Evita presumir fabricante pelo código. |
| 42 | Edição em massa exige o total visto pelo usuário; limite 5.000 | Impede aplicar a um resultado que mudou entre a visualização e o clique. |
| 43 | CSV com ";" e vírgula decimal, BOM UTF-8, apóstrofo antes de =,+,-,@ | Abre direto no Excel pt-BR sem executar fórmulas (OWASP CSV injection). Excel pode remover zeros à esquerda ao abrir; o arquivo os preserva. |

## Contrato S3 (fase 4, não implementado)

`StorageProvider` (`src/server/storage/types.ts`): `put(key, data)`, `get(key)`, `stat(key)`, `delete(key)`, `list(prefix)`.
Implementação S3: chaves idênticas (`{tenantId}/{xx}/{uuid}/{variante}.webp`), bucket privado com bloqueio de acesso público,
SSE habilitada, `put` com `PutObject` (atômico por objeto), downloads continuam passando pela rota autenticada ou por URL
assinada de curta duração gerada **depois** da autorização.
