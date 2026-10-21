export const dynamic = "force-static";

// Contrato público da API v1 (sem dados). Versionado junto com o código.
const money = { type: "string", pattern: "^-?\\d+\\.\\d{2}$", nullable: true, description: "Decimal em string (BRL)" };
const spec = {
  openapi: "3.1.0",
  info: { title: "CIT Library API", version: "1.0.0", description: "Consulta de catálogo e preços para CIT Projects, CitCondo, CITGuard e SysGuard. Autenticação: Authorization: Bearer cit_<prefixo>_<segredo>. Valores monetários em string. Custo do distribuidor só com o escopo costs:read." },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Credencial criada em Configurações → API (somente proprietário)." } },
    schemas: {
      Pricing: {
        type: "object",
        properties: {
          currency: { type: "string", example: "BRL" },
          citPrice: money,
          markupPercent: { type: "string", description: "Somente com escopo costs:read" },
          market: { type: "object", properties: { median: money, acceptedOffers: { type: "integer" }, sufficient: { type: "boolean" }, commercialReference: { ...money, description: "Mediana × 1,15 — referência calculada, NÃO é preço anunciado" }, commercialReferenceNote: { type: "string" } } },
          citVsMarket: { type: "object", properties: { difference: money, percent: { type: "string", nullable: true } } },
          distributorCost: { ...money, description: "Somente com escopo costs:read" },
        },
      },
      Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, fields: { type: "object" }, requestId: { type: "string" } } } } },
    },
  },
  security: [{ bearer: [] }],
  paths: {
    "/products": {
      get: {
        summary: "Lista produtos (paginado)",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "sku", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["DRAFT", "ACTIVE"] } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
        ],
        responses: { "200": { description: "OK" }, "401": { description: "Sem credencial válida", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }, "429": { description: "Limite de requisições" } },
      },
    },
    "/products/{id}": { get: { summary: "Detalhe com especificações, imagens e documentos aprovados", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "OK" }, "404": { description: "Inexistente ou de outra organização" } } } },
    "/products/{id}/prices": { get: { summary: "Preço CIT, mediana de mercado e cotações aceitas (escopo prices:read)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "OK" }, "403": { description: "Sem escopo prices:read" } } } },
    "/media/{id}": { get: { summary: "Imagem aprovada (WebP)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }, { name: "v", in: "query", schema: { type: "string", enum: ["display", "thumb"] } }], responses: { "200": { description: "image/webp" } } } },
  },
};

export function GET() {
  return Response.json(spec, { headers: { "cache-control": "public, max-age=300" } });
}
