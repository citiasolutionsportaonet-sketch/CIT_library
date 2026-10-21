// Configuração da CLI do Prisma 7. A CLI não lê .env sozinha: carregamos
// explicitamente. Migrações usam MIGRATION_DATABASE_URL (dono do schema);
// o aplicativo usa DATABASE_URL (papel restrito, ver scripts/db-grants.ts).
import "dotenv/config";
import { defineConfig } from "prisma/config";

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  datasource: {
    // Comandos offline (validate/generate) funcionam sem URL; migrate exige.
    url: url ?? "postgresql://invalid:invalid@127.0.0.1:1/invalid",
  },
});
