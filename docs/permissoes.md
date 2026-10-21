# Permissões

Fonte única: `src/server/permissions.ts`. Toda operação resolve `TenantContext` (sessão válida no banco + usuário ativo + tenant pelo slug da rota + membership ativa) e o serviço chama `assertCan`.

| Capacidade | OWNER | ADMIN | EDITOR | VIEWER |
|---|---|---|---|---|
| `catalog:read` ver produtos e fotos | ✔ | ✔ | ✔ | ✔ |
| `products:write` criar/editar/arquivar/fotos | ✔ | ✔ | ✔ | — |
| `prices:read` / `prices:write` / `imports:write` (fase 2) | ✔ | ✔ | ✔ | — |
| `members:manage` convidar, alterar papel, desativar | ✔ | ✔ (exceto OWNER) | — | — |
| `owner:manage` | ✔ | — | — | — |
| `audit:read`, `backup:run` | ✔ | ✔ | — | — |

Regras extras: ninguém altera o próprio acesso pela UI; ADMIN não concede nem altera OWNER; o último OWNER ativo não pode ser rebaixado nem desativado (lock `FOR UPDATE` nos owners). Observações internas não são enviadas a VIEWER. Recurso de outro tenant responde 404, igual a inexistente. Desativar membership vale na próxima requisição (não há cache de sessão).

## Capacidades adicionadas (preços, pesquisa, API)

| Capacidade | OWNER | ADMIN | EDITOR | VIEWER |
|---|---|---|---|---|
| `costs:read` ver custo do distribuidor | ✔ | ✔ | ✔ | — |
| `pricing:configure` alterar markup | ✔ | ✔ | — | — |
| `research:review` aprovar/rejeitar evidências e ofertas | ✔ | ✔ | ✔ | — |
| `research:run` iniciar/pausar/cancelar pesquisa (gasto de API) | ✔ | ✔ | — | — |
| `api:manage` criar/revogar credenciais da API | ✔ | — | — | — |

VIEWER vê Preço CIT e mercado, nunca o custo. A API só devolve custo com o escopo `costs:read`.
