import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "./env";

const globalForPrisma = globalThis as unknown as { citPrisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: getEnv().DATABASE_URL });
  return new PrismaClient({ adapter });
}

/** Cliente Prisma único por processo (reaproveitado no hot reload do dev). */
export function getDb(): PrismaClient {
  if (!globalForPrisma.citPrisma) globalForPrisma.citPrisma = createClient();
  return globalForPrisma.citPrisma;
}

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
