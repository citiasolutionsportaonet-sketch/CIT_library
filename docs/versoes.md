# Versões instaladas (validadas em 21/10/2026)

| Componente | Versão |
|---|---|
| Node.js | 22.23.3 (binário oficial, SHA-256 conferido) |
| npm | 10.9.9 |
| PostgreSQL local (Mac de trabalho) | 17.10 — EDB `postgresql-17.10-1-osx-binaries.zip`, SHA-256 `67b32bd5ab4e41dc7d8233c5077001b4b2f3f3c92635e214807c86a22968fe03`, codesign TeamIdentifier 26QKX55P9K |
| Chromium (Playwright) | headless shell 156.0.8078.4 |
| PostgreSQL (imagem) | postgres:17.11@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3 |
| @prisma/adapter-pg | 7.10.1 |
| @prisma/client | 7.10.1 |
| better-auth | 1.7.12 |
| dotenv | 18.0.8 |
| file-type | 22.2.0 |
| next | 16.4.2 |
| pg | 8.23.1 |
| react | 19.3.0 |
| react-dom | 19.3.0 |
| server-only | 0.0.1 |
| sharp | 0.35.5 |
| zod | 4.6.7 |
| @playwright/test | 1.64.1 |
| @tailwindcss/turbopack | 4.3.3 |
| @types/node | 22.20.5 |
| @types/pg | 8.23.1 |
| @types/react | 19.3.0 |
| @types/react-dom | 19.3.0 |
| eslint | 9.39.5 |
| eslint-config-next | 16.4.2 |
| prisma | 7.10.1 |
| tailwindcss | 4.3.3 |
| tsx | 4.23.15 |
| typescript | 5.9.3 |
| vitest | 5.0.5 |

## Auditoria npm

- `npm audit --omit=dev`: 0 vulnerabilidades.
- `npm audit` (com dev): 5 alertas **high** na cadeia `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` (GHSA-vfj7-8cjw-p6xm, DoS por padrões aninhados). Afeta só o lint local; não vai para o build. A correção sugerida (`audit fix --force`) rebaixaria para eslint-config-next 14 — não aplicada. Reavaliar quando o Next publicar atualização.
