import path from "node:path";
import { expect, test } from "@playwright/test";

const email = process.env.E2E_OWNER_EMAIL ?? "";
const password = process.env.E2E_OWNER_PASSWORD ?? "";
const slug = process.env.DEFAULT_TENANT_SLUG ?? "cit";

test.skip(!email || !password, "Rode npm run test:e2e:setup antes.");

test("sem sessão: páginas redirecionam e APIs negam", async ({ request, page }) => {
  await page.goto(`/${slug}/produtos`);
  await expect(page).toHaveURL(/\/login$/);
  const media = await request.get("/api/media/00000000-0000-0000-0000-000000000000");
  expect(media.status()).toBe(401);
  const up = await request.post(`/api/t/${slug}/products/00000000-0000-0000-0000-000000000000/media`, {
    headers: { origin: process.env.APP_ORIGIN ?? "" },
    data: Buffer.from("x"),
  });
  expect(up.status()).toBe(401);
  const health = await request.get("/api/health");
  expect(await health.json()).toEqual({ status: "ok" });
});

test("login errado mostra mensagem genérica", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("senha-errada-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha inválidos.")).toBeVisible();
});

test("OWNER: cadastro, 3 fotos, capa, reordenar, busca, arquivar/restaurar, logout", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/produtos`));

  const sku = `E2E-${Date.now()}`;
  await page.getByRole("link", { name: "Cadastrar produto" }).first().click();
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByText("Informe o nome.")).toBeVisible(); // validação por campo
  await page.getByLabel(/^Nome/).fill("Produto E2E");
  await page.getByLabel(/^SKU interno/).fill(sku);
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByText("Rascunho salvo")).toBeVisible();

  const img = path.resolve("tests/fixtures/foto-teste.png");
  await page.getByTestId("photo-input").setInputFiles([img, img, img]);
  const thumbs = page.locator("section:has(h2:text-is('Fotos')) li img");
  await expect(thumbs).toHaveCount(3, { timeout: 30_000 });
  const ids = async () => (await thumbs.evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src)));
  const before = await ids();

  await page.getByRole("button", { name: "Mover foto 1 para a direita" }).click();
  await expect.poll(ids).toEqual([before[1], before[0], before[2]]);
  await page.getByRole("button", { name: "Definir capa" }).last().click();
  await expect(page.locator("section:has(h2:text-is('Fotos')) li").last().getByText("Capa")).toBeVisible();

  // Upload inválido é recusado sem afetar o produto.
  await page.getByTestId("photo-input").setInputFiles({ name: "falso.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<html></html>") });
  await expect(page.getByText(/Formato não aceito/)).toBeVisible();
  await expect(thumbs).toHaveCount(3);

  // Persistência: recarregar mantém ordem e capa.
  await page.reload();
  await expect.poll(ids).toEqual([before[1], before[0], before[2]]);

  await page.goto(`/${slug}/produtos?q=${encodeURIComponent(sku)}`);
  await expect(page.getByText("Produto E2E")).toBeVisible();
  await page.getByText("Produto E2E").click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Arquivar" }).click();
  await expect(page.getByText(/Produto arquivado em/)).toBeVisible();
  await page.goto(`/${slug}/produtos?q=${encodeURIComponent(sku)}`);
  await expect(page.getByText("Nenhum produto corresponde aos filtros.")).toBeVisible();
  await page.goto(`/${slug}/produtos?q=${encodeURIComponent(sku)}&status=ARCHIVED`);
  await page.getByText("Produto E2E").click();
  await page.getByRole("button", { name: "Restaurar" }).click();
  await expect(page.getByRole("link", { name: "Editar" })).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(`/${slug}/produtos`);
  await expect(page).toHaveURL(/\/login$/);
});
