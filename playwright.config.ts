import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

// E2E contra o build de produção, usando SOMENTE o ambiente de teste gerado por
// `npm run test:e2e:setup` (.env.test → banco *_test, mídia var/test-media).
const testEnv = dotenv.config({ path: process.env.E2E_ENV_FILE ?? ".env.test", quiet: true }).parsed ?? {};
if (!/_test(\?|$)/.test(new URL(testEnv.DATABASE_URL ?? "postgresql://x/x").pathname)) {
  throw new Error("Rode `npm run test:e2e:setup` antes: o E2E só usa banco *_test.");
}
Object.assign(process.env, testEnv);
const port = Number(testEnv.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: `npx next start -H 127.0.0.1 -p ${port}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: testEnv,
  },
});
