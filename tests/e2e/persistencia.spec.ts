import { expect, test } from "@playwright/test";

// Rode depois de fluxo-produto e de reiniciar banco e app: só lê o que já existe.
const email = process.env.E2E_OWNER_EMAIL ?? "";
const password = process.env.E2E_OWNER_PASSWORD ?? "";
const slug = process.env.DEFAULT_TENANT_SLUG ?? "cit";

test("produto e 3 fotos persistem após reinício", async ({ page, request }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/produtos`));
  await page.goto(`/${slug}/produtos?q=E2E-`);
  await page.getByText("Produto E2E").first().click();
  const thumbs = page.locator("button[aria-label^='Ver foto'] img");
  await expect(thumbs).toHaveCount(3);
  for (const src of await thumbs.evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src))) {
    const r = await page.request.get(src);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toBe("image/webp");
    expect(r.headers()["x-content-type-options"]).toBe("nosniff");
  }
  // Mesma foto sem sessão: negada.
  const first = await thumbs.first().getAttribute("src");
  expect((await request.get(first!, { headers: { cookie: "" } })).status()).toBe(401);
});
