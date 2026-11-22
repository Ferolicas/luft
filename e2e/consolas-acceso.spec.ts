import { expect, type Page, test } from "@playwright/test";

/**
 * Acceso a las consolas (panel de operación y portales de entidad y aliado).
 * Estas pruebas no necesitan la API: la sesión se simula interceptando
 * `GET /api/auth/me`, que es lo único que decide a qué consola pertenece una cuenta.
 */

const account = (role: string) => ({
  user: { id: "00000000-0000-4000-8000-000000000001", email: "cuenta@example.com", username: "cuenta", fullName: "Cuenta De Prueba", stratum: 3, role, status: "ACTIVE" },
});

async function mockSession(page: Page, role: string | null) {
  await page.route("**/api/auth/me", (route) =>
    role === null
      ? route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ statusCode: 401, message: "Unauthorized" }) })
      : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(account(role)) }),
  );
}

for (const path of ["/admin", "/admin/credito/solicitudes", "/entidad", "/aliado"]) {
  test(`sin sesión, ${path} redirige a /login sin mostrar contenido`, async ({ page }) => {
    await mockSession(page, null);
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Resumen de la operación")).toHaveCount(0);
  });
}

test("una cuenta de entidad que abre el panel va a su portal y ve el aviso de vínculo pendiente", async ({ page }) => {
  await mockSession(page, "INSTITUTION");
  await page.route("**/api/institution/**", (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "institution_link_required", message: "Tu cuenta no está vinculada a una entidad." }) }),
  );
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/entidad$/);
  await expect(page.getByRole("heading", { name: /aún no está vinculada a una entidad financiera/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cerrar sesión/i })).toBeVisible();
});

test("una cuenta de aliado que abre el portal de entidad va al suyo y ve el aviso de vínculo pendiente", async ({ page }) => {
  await mockSession(page, "ALLY");
  await page.route("**/api/ally/**", (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "ally_link_required", message: "Tu cuenta no está vinculada a un aliado." }) }),
  );
  await page.goto("/entidad");
  await expect(page).toHaveURL(/\/aliado$/);
  await expect(page.getByRole("heading", { name: /aún no está vinculada a un aliado/i })).toBeVisible();
});

test("una persona usuaria no entra a las consolas: va a su app", async ({ page }) => {
  await mockSession(page, "USER");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/app$/);
});

test("el panel solo abre las secciones que el rol puede usar", async ({ page }) => {
  await mockSession(page, "SUPPORT");
  let analyticsCalls = 0;
  await page.route("**/api/admin/analytics/**", (route) => { analyticsCalls += 1; return route.fulfill({ status: 401, contentType: "application/json", body: "{}" }); });
  await page.goto("/admin/analitica/cosechas");
  await expect(page.getByRole("heading", { name: "Esta sección no está disponible para tu rol" })).toBeVisible();
  await expect(page.getByText("Cosechas de cartera")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Volver al resumen" })).toHaveAttribute("href", "/admin");
  expect(analyticsCalls).toBe(0);
});
