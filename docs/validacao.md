# Validação — registro de execução

Ambiente: MacBook Air arm64, macOS 26.6.2, Node 22.23.3, **PostgreSQL 17.10 local sem Docker** (binários oficiais EDB em `~/.local/pgsql`), 21/10/2026.
Banco real `cit_library`: migrado, **vazio** (bootstrap ainda não executado). Todos os testes usaram bancos `*_test` separados.

| Comando / verificação | Resultado | Evidência |
|---|---|---|
| `npm run lint` | ✔ 0 problemas | |
| `npm run typecheck` | ✔ | |
| `npm test` | ✔ 39/39 | normalização, GTIN, schema, RBAC, MIME falso, SVG, HEIC, EXIF, imagem truncada, traversal, symlink |
| `npm run build` | ✔ | 15 rotas dinâmicas |
| `npm run db:local:start` | ✔ | cluster SCRAM em `var/pgdata`, escuta só 127.0.0.1 |
| `npm run db:deploy` | ✔ | migração `20261020230000_initial` + papel `cit_app` |
| `npm run test:integration` | ✔ 21/21 | ver lista abaixo |
| `npm run test:e2e:setup` + `npm run test:e2e` (fluxo) | ✔ 3/3 | Chromium headless |
| Persistência após parar/iniciar PostgreSQL e novo processo do app | ✔ | `tests/e2e/persistencia.spec.ts` |
| `npm run backup` (ambiente de teste) | ✔ | 2 produtos, 6 mídias, 12 arquivos; escritas bloqueadas 0,2 s |
| `npm run restore` em banco novo | ✔ | 13 hashes conferidos; contagens iguais; 0 arquivos faltando; sessões revogadas |
| App aberto sobre a cópia restaurada | ✔ | `persistencia.spec.ts` passou com `DATABASE_URL`/`MEDIA_ROOT` da cópia |
| Restore recusa destino já usado | ✔ | |
| Restore recusa arquivo adulterado (1 byte) | ✔ | "Hash/tamanho não confere" |
| App em `0.0.0.0` responde por IP e `.local` | ✔ | `/api/health` via 192.168.0.112 e `MacBook-Air-de-Andrieli.local` |
| PostgreSQL inacessível pela rede | ✔ | porta 5432 fechada no IP da rede |
| Acesso real de um **segundo Mac** | **não verificado** | não havia segundo Mac nesta sessão; firewall do macOS pode pedir permissão na 1ª vez |
| `npm run bootstrap` no banco real | **pendente** | interativo: a senha deve ser digitada pelo usuário |
| HTTPS (Caddy) | **não montado** | |

## Integração (PostgreSQL real, 21 testes)
SKU com zeros à esquerda; SKU duplicado normalizado → 409 com campo; SKU concorrente (4 simultâneos, 1 vence); mesmo SKU em tenants diferentes; versão otimista → `VERSION_CONFLICT`; código do fabricante único por marca; arquivar/restaurar e busca padrão; busca por SKU/modelo/código; duplicar; VIEWER sem escrita e sem notas internas; tenant A não lê/altera/duplica produto de B; FK composta recusa marca de outro tenant **mesmo via SQL direto**; auditoria sem UPDATE/DELETE para `cit_app`; 3 fotos com capa/reordenar/remover capa; upload HTML-como-JPEG, >10 MB e truncado recusados sem alterar produto; download de foto por outro tenant → 404; VIEWER não envia foto; ADMIN não toca OWNER nem se eleva; dois OWNERs se rebaixando ao mesmo tempo → exatamente um vence; convite de uso único com token só em hash; convite para conta existente exige login; lock de backup → `MAINTENANCE` e libera; rate limit atômico (20 concorrentes, 5 permitidos).

## E2E (Chromium)
Sem sessão: páginas → /login, `/api/media` e upload → 401, health `{"status":"ok"}`. Login errado → mensagem genérica. OWNER: validação por campo, rascunho, 3 fotos com progresso, reordenar, capa, upload inválido recusado, recarregar mantém ordem, busca, arquivar (some da busca padrão), restaurar, logout revoga acesso.

## Bugs encontrados e corrigidos nesta validação
1. **Upload travava**: `WriteStream` com `autoClose: false` nunca emite `close` e o `pipeline` esperava para sempre. Corrigido em `media/service.ts` e `storage/local.ts`.
2. **SKU duplicado sem campo destacado**: Prisma 7 + adapter-pg informa o nome do índice, não os campos. `uniqueViolationTarget` agora entende os dois formatos.

## Incidente corrigido
Dois scripts de depuração ad hoc (usados para investigar os bugs acima) gravaram por engano 2 organizações `probe-*`, 2 usuários, 2 produtos e 1 evento de auditoria no banco **real** `cit_library`. Foram removidos numa transação em 21/10/2026, antes de qualquer dado real existir; banco real conferido vazio. Daqui em diante, depuração usa somente bancos `*_test`.

## Como repetir
```bash
npm run db:local:start
npm run test:integration
npm run test:e2e:setup && npm run build && npm run test:e2e
```

---

# Etapas A–D (21/10/2026, tarde)

| Verificação | Resultado |
|---|---|
| `npm run lint` / `typecheck` | ✔ |
| `npm test` | ✔ 84/84 (inclui preço, mediana, pt-BR, XLSX, robots, SSRF, correspondência de ofertas, extração HTML) |
| `npm run test:integration` | ✔ 33/33 (inclui importação idempotente, conflito de código, preço vigente, append-only de preço, markup ≤ 45%, VIEWER sem custo, listagem fora da mediana, fila sem duplo claim, orçamento pausa execução, API com escopos/tenant/revogação) |
| `npm run test:e2e` | ✔ 7/7 (inclui importação pela tela, painel de pesquisa, markup) |
| `npm run build` | ✔ |
| `npm audit --omit=dev` | ✔ 0 |
| Importação real (2.971 linhas) | ✔ soma dos custos idêntica à planilha (R$ 20.649.083,7557, 2.088 custos) |
| Reenvio do mesmo arquivo | ✔ bloqueado sem justificativa |
| Etapa B (10 produtos, site oficial) | ✔ executada; 9 imagens verificadas, 1 PDF quebrado detectado (404), 0 preços válidos — ver docs/pesquisa.md |

## Bugs encontrados e corrigidos nesta etapa
1. XML com prefixo de namespace (`<x:row>`) seria lido como planilha vazia → `removeNSPrefix`.
2. 131 descrições > 200 caracteres seriam rejeitadas → nome resumido + texto integral em Descrição.
3. Cabeçalho com colunas vazias (vetor esparso) quebrava a importação preliminar → `Array.from`.
4. Unicidade de oferta descartava silenciosamente 5 ofertas com mesma URL e preços diferentes → preço passou a integrar a identidade (migração 3); ofertas recuperadas (14/14).
5. Pesquisa sem achados sobrescrevia pendências preliminares como "sem dados" → situação calculada sobre todas as evidências; 2 produtos corrigidos diretamente no banco (único ajuste manual de dados), teste de regressão adicionado.
6. Servidor `next dev` iniciado antes de uma migração mantém o cliente Prisma antigo → reinicie o servidor após `db:deploy`.

## Não verificado
- Provedores Brave Search e Mercado Livre: **sem credenciais**; código coberto por testes de orçamento, não por chamada real.
- Páginas `www.intelbras.com` passaram a responder 403 (anti-robô) durante a Etapa B; não contornado.

## Imagens (21/10/2026, noite)
- Provedor Brave Imagens + aprovação automática/lote de imagens oficiais: integração 39/39 (inclui CDN que devolve PNG em URL .jpg), unitários 128/128.
- Bug corrigido: aprovação nomeava o arquivo pelo formato da verificação; CDN da Intelbras negocia formato → upload recusado pelo pipeline. Agora usa o formato baixado.
- Dados reais: 3 imagens oficiais aprovadas (MIP 1000 IP, XPE 1013 BIO, VIP 1230 D G5 completa com 3). 3 produtos com galeria. 3 imagens de revendedor aguardam decisão.
- Não verificado: chamada real à Brave (sem chave).
