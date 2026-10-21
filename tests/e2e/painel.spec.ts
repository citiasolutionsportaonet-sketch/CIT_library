import path from "node:path";
import { expect, test } from "@playwright/test";

const email = process.env.E2E_OWNER_EMAIL ?? "";
const password = process.env.E2E_OWNER_PASSWORD ?? "";
const slug = process.env.DEFAULT_TENANT_SLUG ?? "cit";

test.skip(!email || !password, "Rode npm run test:e2e:setup antes.");

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/produtos`));
});

test("importação pela tela: prévia não grava; confirmação enfileira", async ({ page }) => {
  await page.getByRole("link", { name: "Importações" }).click();
  await page.locator('input[name="file"]').setInputFiles(path.resolve("tests/fixtures/distribuidor-sintetico.xlsx"));
  await page.locator('input[name="supplier"]').fill("Distribuidor E2E");
  await page.getByRole("button", { name: "Gerar prévia" }).click();
  await expect(page.getByRole("heading", { name: "distribuidor-sintetico.xlsx" })).toBeVisible();
  await expect(page.getByText("Prévia (não aplicado)")).toBeVisible();
  await expect(page.getByText("Custo zero tratado como ausente")).toBeVisible();
  await page.goto(`/${slug}/produtos?q=0009001`);
  await expect(page.getByText("Nenhum produto")).toBeVisible(); // nada gravado na prévia
  await page.goBack();
  await page.locator('input[type="date"]').fill("2026-10-21");
  await page.getByRole("button", { name: "Confirmar e aplicar" }).click();
  await expect(page.getByText(/Confirmado, na fila/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar e aplicar" })).toHaveCount(0); // não confirma duas vezes
});

test("painel de pesquisa e markup", async ({ page }) => {
  await page.getByRole("link", { name: "Pesquisa" }).click();
  await expect(page.getByText("Total de produtos")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Brave Search API" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Brave Search API \(sem credencial\)/ })).toBeDisabled();
  await page.getByRole("link", { name: "Configurações" }).click();
  // Acima de 45%: o próprio navegador bloqueia o envio (o servidor também recusa; ver integração).
  await page.getByLabel("Markup em %").fill("46");
  await expect(page.locator('input[aria-label="Markup em %"]:invalid')).toHaveCount(1);
  await page.getByLabel("Markup em %").fill("30");
  await page.getByRole("button", { name: "Salvar" }).first().click();
  await expect(page.getByText("Markup atualizado")).toBeVisible();
});

test("API: openapi público; dados exigem credencial", async ({ request }) => {
  expect((await request.get("/api/v1/openapi.json")).status()).toBe(200);
  const r = await request.get("/api/v1/products");
  expect(r.status()).toBe(401);
});
