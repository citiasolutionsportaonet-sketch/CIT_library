# API v1 (consumo por CIT Projects, CitCondo, CITGuard, SysGuard)

- Base: `/api/v1` · Contrato: `GET /api/v1/openapi.json`
- Autenticação: `Authorization: Bearer cit_<prefixo>_<segredo>`; credencial criada em **Configurações → API** (somente proprietário). Só o hash é guardado; o segredo aparece uma vez.
- Organização vem **só** da credencial; nada no corpo ou cabeçalho escolhe outro tenant.
- Escopos: `catalog:read` (obrigatório), `prices:read` (Preço CIT e mercado), `costs:read` (custo do distribuidor — só para sistemas internos).
- Limite: `API_RATE_PER_MINUTE` por credencial (429). Decimais como string. Notas internas nunca saem pela API.
- `markupPercent` e `distributorCost` só são retornados com `costs:read`. Sem esse escopo, o preço de venda continua disponível com `prices:read`, mas esses dois campos são omitidos. Na interface e no CSV, o markup também acompanha a permissão de leitura de custos.
- Essa restrição evita divulgar o percentual interno pela API. Se o markup for conhecido por outro meio, o preço calculado ainda permite estimar o custo por divisão; não é uma garantia de sigilo matemático do custo.

| Rota | Escopo |
|---|---|
| `GET /products?q=&sku=&status=&page=&pageSize=` | catalog:read (+ pricing com prices:read) |
| `GET /products/{id}` | catalog:read |
| `GET /products/{id}/prices` | prices:read |
| `GET /media/{id}?v=display\|thumb` | catalog:read |

```bash
curl -H "Authorization: Bearer $TOKEN" http://SERVIDOR:3000/api/v1/products?sku=4570045
```

Pendente (fase 4): rotas de escrita com `Idempotency-Key`, webhooks.
