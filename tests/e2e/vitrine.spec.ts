import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const execute = promisify(execFile);
const slug = process.env.DEFAULT_TENANT_SLUG ?? "cit";

test("vitrine autenticada consulta catálogo e visão do banco sem exibir custos", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill(process.env.E2E_OWNER_EMAIL!);
  await page
    .getByLabel("Senha", { exact: true })
    .fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/produtos`));
  await page.getByRole("link", { name: "Vitrine", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Tecnologia certa/ }),
  ).toBeVisible();
  await expect(page.locator(".cit-store")).not.toContainText(
    "Custo no distribuidor",
  );
  await expect(page.locator(".cit-store")).not.toContainText("Markup");
  await page.getByRole("link", { name: "Visão do banco", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /O banco, em números/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Banco conectado", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByLabel("Buscar na vitrine").fill("NENHUM-PRODUTO-TESTE-XYZ");
  await page.getByRole("button", { name: /Buscar/ }).click();
  await expect(page).toHaveURL(/modo=dados/);
  await expect(page.locator("[data-panel=dados] tbody tr")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("HTML exportado funciona sem recursos externos e trata os dados como texto", async ({
  page,
}, info) => {
  const input = info.outputPath("public-input.json");
  const output = info.outputPath("catalogo.html");
  await fs.mkdir(info.outputDir, { recursive: true });
  const stamp = "2026-10-21T12:00:00.000Z";
  const data = {
    organization: "CIT Teste",
    generatedAt: stamp,
    updatedAt: stamp,
    stats: {
      total: 20,
      withPhoto: 0,
      withPrice: 10,
      withBrand: 2,
      withModel: 2,
      active: 2,
      drafts: 18,
    },
    categories: [
      { id: "cam", name: "Câmeras", count: 1 },
      { id: "tel", name: "Telefonia", count: 1 },
    ],
    brands: [{ id: "b1", name: "Marca de teste" }],
    products: [
      {
        id: "p1",
        sku: "001",
        name: "Telefone de teste",
        brand: "Marca de teste",
        brandId: "b1",
        category: "Telefonia",
        categoryId: "tel",
        model: "T1",
        price: "145.00",
        image: null,
        status: "ACTIVE",
        updatedAt: stamp,
        cost: "CUSTO_PRIVADO_TESTE",
        email: "EMAIL_PRIVADO_TESTE",
      },
      {
        id: "p2",
        sku: "002",
        name: "Câmera </script><script>window.__injected=true</script>",
        brand: null,
        brandId: null,
        category: "Câmeras",
        categoryId: "cam",
        model: null,
        price: null,
        image: null,
        status: "DRAFT",
        updatedAt: stamp,
      },
    ],
    total: 2,
    page: 1,
    pageCount: 1,
    filters: {
      q: "",
      category: "",
      brand: "",
      photo: false,
      sort: "destaques",
    },
    secret: "SEGREDO_PRIVADO_TESTE",
  };
  await fs.writeFile(input, JSON.stringify(data));
  await execute(process.execPath, [
    "--import",
    "tsx",
    "scripts/export-showcase.tsx",
    "--input",
    input,
    "--output",
    output,
  ]);
  const html = await fs.readFile(output, "utf8");
  for (const secret of [
    "CUSTO_PRIVADO_TESTE",
    "EMAIL_PRIVADO_TESTE",
    "SEGREDO_PRIVADO_TESTE",
  ])
    expect(html).not.toContain(secret);
  await page.route("**/offline-showcase-test.html", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().endsWith("/offline-showcase-test.html") &&
      /^https?:/.test(r.url())
    )
      external.push(r.url());
  });
  await page.goto("/offline-showcase-test.html");
  await expect(page.locator("[data-product]:visible")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => (window as Window & { __injected?: boolean }).__injected,
    ),
  ).toBeUndefined();
  await page.getByLabel("Buscar na vitrine").fill("telefone");
  await page.getByRole("button", { name: /Buscar/ }).click();
  await expect(page.locator("[data-product]:visible")).toHaveCount(1);
  await page.locator("[data-product]:visible [data-detail]").click();
  await expect(page.getByRole("dialog")).toContainText("Telefone de teste");
  await page.getByLabel("Fechar detalhes").click();
  await page.getByLabel("Buscar na vitrine").fill("");
  await page.getByRole("button", { name: /Buscar/ }).click();
  await page.locator('[data-category="cam"]').click();
  await expect(page.locator("[data-product]:visible")).toHaveCount(1);
  await page.getByRole("link", { name: "Visão do banco", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Retrato do banco", exact: true }),
  ).toBeVisible();
  expect(external).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
