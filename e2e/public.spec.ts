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
  await expect(page.getByLabel("Cédula")).toBeVisible();
  await expect(page.getByLabel("Estrato")).toBeVisible();
  await expect(page.getByRole("button", { name: /Continuar/i })).toBeVisible();
});

test("login and recovery entry points are connected", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Qué bueno verte/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Olvidaste tu contraseña/i })).toHaveAttribute("href", "/recuperar");
});

test("legal routes explain the activation gate instead of returning 404", async ({ page }) => {
  await page.goto("/legal/privacidad");
  await expect(page.getByRole("heading", { name: "Política de privacidad pendiente" })).toBeVisible();
  await expect(page.getByText(/registro público permanecerá cerrado/i)).toBeVisible();
});
