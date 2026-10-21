# Migrar a CIT Library para outro computador

Tempo estimado: 20–30 minutos. Funciona em Mac (Apple Silicon ou Intel). Os comandos são para o Terminal.

## O que vem no pacote de transferência

| Item | Conteúdo |
|---|---|
| `cit-library-codigo.zip` | Código-fonte completo, documentação, testes e migrações (sem `node_modules`, sem `.env`, sem dados) |
| `backup/cit-backup-…/` | Banco de dados (produtos, custos, categorias, marcas, evidências, usuários, auditoria) + fotos + `manifest.json` com SHA-256 de cada arquivo |
| `planilhas/` | As planilhas originais (`iot valores.xlsx`, `CIT_Library_lote_01_imagens.xlsx`) |
| `MIGRAR.md` | Este guia |
| `SHA256SUMS.txt` | Conferência de integridade do pacote |

> **Dados sensíveis:** o backup contém custos do distribuidor, e-mails e hashes de senha. Transfira por **AirDrop** ou pendrive (de preferência criptografado). Não envie por e-mail nem por link público. Apague as cópias intermediárias depois.

## 0. No computador ANTIGO

1. Não faça mais alterações aqui depois de gerar o pacote (senão elas não vão junto).
2. Pare o app e o worker (Ctrl+C nos terminais).

## 1. Instalar as ferramentas (computador novo)

- **Node.js 22**: baixe o instalador "LTS 22.x" em https://nodejs.org (ou o binário, como foi feito no Mac original). Confira: `node -v` → `v22.…`
- **PostgreSQL 17**, escolha UMA opção:
  - **A) Docker Desktop** (https://www.docker.com/products/docker-desktop/) — mais simples no servidor definitivo.
  - **B) Sem Docker**: binários oficiais em `~/.local/pgsql` (veja "PostgreSQL local" no fim).
- **Git** (já vem com as ferramentas de linha de comando do Xcode: `xcode-select --install`).

## 2. Colocar o código

```bash
mkdir -p ~/Projetos && cd ~/Projetos
unzip ~/Downloads/CIT-Library-transferencia-*/cit-library-codigo.zip -d cit-library
cd ~/Projetos/cit-library
npm ci
```

Ajuste o caminho do `unzip` se a pasta do pacote estiver em outro lugar (ex.: Mesa).

## 3. Configuração (.env novo, senhas novas)

```bash
npm run env:init               # opção A (Docker)
# ou
npm run env:init -- --local-pg # opção B (PostgreSQL local)
```

Gera o `.env` com senhas aleatórias. Não reutilize o `.env` do computador antigo.

## 4. Subir o banco VAZIO

```bash
docker compose up -d db          # opção A
# ou
npm run db:local:start           # opção B
```

**Não rode `npm run db:deploy` antes da restauração** (ele criaria tabelas e a restauração recusaria).

## 5. Restaurar dados e fotos

```bash
mkdir -p imports && cp ~/Downloads/CIT-Library-transferencia-*/planilhas/*.xlsx imports/
npm run restore -- --manifest ~/Downloads/CIT-Library-transferencia-*/backup/cit-backup-*/manifest.json --target cit_library --media-target ./var/media
npm run db:deploy
```

A restauração confere o SHA-256 de todos os arquivos antes de começar, recusa banco com dados, revoga as sessões antigas e confere contagens no final. O `db:deploy` só aplica migrações mais novas (se houver) e os privilégios.

## 6. Ligar e entrar

```bash
npm run dev      # app em http://localhost:3000
npm run worker   # em outro terminal: importações e pesquisas
```

Entre com o **mesmo e-mail e senha** do computador antigo (os usuários vêm no backup). Confira: total de 2.971 produtos, categorias, fotos dos 5 produtos piloto.

## 7. Credenciais de pesquisa (se já tinha)

Não vêm no pacote. Grave de novo no `.env`:
- Brave: `read -s "K?Chave Brave: " && sed -i '' "s|^BRAVE_SEARCH_API_KEY=.*|BRAVE_SEARCH_API_KEY=$K|" .env && unset K`
- Mercado Livre: `npm run ml:auth`

## 8. Continuar com o Claude Code

Abra a pasta `~/Projetos/cit-library` no Claude Code. O contexto está no próprio projeto:
- `CLAUDE.md` — especificação;
- `docs/status.md` — o que está pronto e o que falta;
- `docs/decisoes.md`, `docs/validacao.md`, `docs/pesquisa.md`.

Sugestão de primeira mensagem:

> Leia CLAUDE.md e docs/status.md. Este projeto foi migrado de outro computador com `npm run restore`. Rode `npm run lint`, `npm run typecheck`, `npm test` e `npm run test:integration`, confirme que tudo está verde e me diga o próximo passo pendente.

## Conferência rápida

```bash
npm run lint && npm run typecheck && npm test && npm run test:integration
```

## PostgreSQL local (opção B, sem Docker)

```bash
mkdir -p ~/.local && cd /tmp
curl -fLO https://get.enterprisedb.com/postgresql/postgresql-17.10-1-osx-binaries.zip
unzip -q postgresql-17.10-1-osx-binaries.zip -d pg && mkdir -p ~/.local/pgsql-17.10
cp -R pg/pgsql/bin pg/pgsql/lib pg/pgsql/share pg/pgsql/include ~/.local/pgsql-17.10/
ln -sfn ~/.local/pgsql-17.10 ~/.local/pgsql && ~/.local/pgsql/bin/postgres --version
```

Depois de reiniciar o Mac: `npm run db:local:start` antes do app.
