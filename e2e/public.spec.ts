import { expect, test } from "@playwright/test";

test("landing presents the LUFT route", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Tu futuro merece/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Crear mi ruta/i })).toHaveAttribute("href", "/registro");
  await expect(page.locator("img").first()).toBeVisible();
});

test("registration starts with identity and stratum fields", async ({ page }) => {
  await page.goto("/registro");
  await expect(page.getByRole("heading", { name: "Crea tu cuenta LUFT" })).toBeVisible();
  await page.getByLabel("Nombre completo").fill("Dueño de Pruebas");
  await page.getByLabel("Cédula").fill("1234567890");
  await page.getByLabel("Fecha de expedición").fill("2020-01-01");
  await page.getByLabel("Celular").fill("+573001234567");
  await page.getByLabel("Correo").fill("owner@example.com");
  await page.getByLabel("Dirección de residencia").fill("Calle 10 # 20-30");
  await page.getByLabel("Estrato").selectOption("3");
  await page.getByRole("button", { name: /Continuar/i }).click();
  await expect(page.getByLabel("Código de acceso para pruebas")).toBeVisible();
  await expect(page.getByText(/Tureporte S\.A\.S\./i)).toBeVisible();
});

test("login and recovery entry points are connected", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Qué bueno verte/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Olvidaste tu contraseña/i })).toHaveAttribute("href", "/recuperar");
});

test("legal routes use Restaurar as the canonical controller", async ({ page }) => {
  const privacy = await page.request.get("/legal/privacidad", {
    maxRedirects: 0,
  });
  expect(privacy.status()).toBe(307);
  expect(privacy.headers().location).toBe("https://restaurar.co/privacy");

  await page.goto("/legal/terminos");
  await expect(page.getByText(/Tureporte S\.A\.S\./i)).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Ver política de RESTAURAR/i }),
  ).toHaveAttribute("href", "https://restaurar.co/privacy");
});
