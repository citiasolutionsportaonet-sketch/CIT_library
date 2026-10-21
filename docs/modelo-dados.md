# Modelo de dados (fases 0–1)

Fonte: `prisma/schema.prisma` + `prisma/migrations/20261020230000_initial/migration.sql` (CHECKs manuais no fim do arquivo).

```text
user 1─* session, account                     (globais, sem tenant)
user 1─* membership *─1 tenant
tenant 1─* invitation, brand, category, tag, product, media_asset, audit_event
category ─(tenantId,parentId)→ category        (pai opcional, CHECK parentId <> id)
product ─(tenantId,brandId)→ brand
product ─(tenantId,categoryId)→ category
product 1─* product_tag *─1 tag                (FKs compostas)
product 1─* product_media *─1 media_asset      (FKs compostas)
product ─(tenantId,id,coverMediaId)→ product_media   (capa é foto vinculada ao mesmo produto)
```

## Constraints principais

| Tabela | Constraint |
|---|---|
| product | `unique(tenantId, normalizedSku)`; `unique(tenantId, brandId, normalizedManufacturerCode)`; CHECK código exige marca; CHECK GTIN 8/12/13/14 dígitos; CHECK `status = ARCHIVED ⇔ archivedAt` preenchido; CHECK `version >= 1`; specs/links JSON array |
| brand, category, tag | `unique(tenantId, normalizedName)`; `unique(tenantId, id)` para FKs compostas |
| membership | `unique(tenantId, userId)` |
| invitation | `tokenHash` único (SHA-256 do token; o token nunca é gravado) |
| media_asset | `storageKey` único; `byteSize > 0` |
| product_media | PK `(productId, mediaId)`; `position >= 0` |
| user / invitation | CHECK e-mail minúsculo e sem espaços |
| audit_event | sem UPDATE/DELETE para `cit_app` (grant) |

Exclusões: todas as FKs de domínio são `RESTRICT` (exceto `product_tag`, que acompanha o produto). Produtos nunca são apagados fisicamente; usuários desativados mantêm autoria.

Tabelas das fases 2–4 (PriceList, PriceEntry, ImportBatch, ImportRow, Kit, KitItem, Compatibility, ApiCredential) ainda **não existem** — entram em migrações próprias.
