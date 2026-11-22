import { expect, test, type Page } from "@playwright/test";

/*
 * Pantallas de usuario V2. Ninguna prueba depende de la API: las respuestas se
 * simulan en el navegador con `page.route` (o se deja que falten, para el estado de error).
 */

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const consent = { kind: "HOUSEHOLD_SHARING", version: "2026-11-22", text: "Acepto participar en este hogar LUFT. Mi perfil es independiente." };
const metricLabels = { routeProgress: "Avance de mi ruta", archetype: "Mi categoría y arquetipo", learning: "Mis lecciones y módulos", credit: "El estado de mi crédito constructor", score: "Mi puntaje" };
const invitation = { status: "PENDING", householdName: "Familia Prueba", inviterFirstName: "Ana", role: "BENEFICIARY", seatAssigned: true, expiresAt: "2030-01-10T12:00:00.000Z", consent, metricLabels, shareLevels: ["NONE", "BENEFICIARIES", "ALL"] };
const noSession = (page: Page) => page.route("**/api/auth/me", (route) => route.fulfill(json({ statusCode: 401, message: "Unauthorized" }, 401)));

test("la invitación inexistente muestra un estado de error claro", async ({ page }) => {
  await page.goto("/invitacion/token-inexistente");
  await expect(page.getByRole("heading", { name: /No (encontramos esta|pudimos abrir la) invitación/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");
});

test("la invitación pendiente se presenta sin sesión y ofrece crear cuenta o entrar", async ({ page }) => {
  await noSession(page);
  await page.route("**/api/luft/invitations/abc123", (route) => route.fulfill(json(invitation)));
  await page.goto("/invitacion/abc123");
  await expect(page.getByRole("heading", { name: "Te invitaron a un hogar LUFT" })).toBeVisible();
  await expect(page.getByText(/Se comparten apoyos y metas, no tu identidad financiera/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Crear mi cuenta/ })).toHaveAttribute("href", "/empezar");
  await page.getByRole("button", { name: "Ya tengo cuenta" }).click();
  await expect(page.getByLabel("Correo o usuario")).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("luft_pending_invitation"))).toBe("abc123");
});

test("aceptar una invitación exige leer el consentimiento y deja todo privado por defecto", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill(json({ user: { id: "u1", fullName: "Beto Prueba", username: "beto", role: "USER" } })));
  await page.route("**/api/luft/invitations/abc123", (route) => route.fulfill(json(invitation)));
  let accepted: Record<string, unknown> | null = null;
  await page.route("**/api/luft/invitations/abc123/accept", (route) => { accepted = route.request().postDataJSON() as Record<string, unknown>; return route.fulfill(json({}, 201)); });
  await page.goto("/invitacion/abc123");
  await expect(page.getByRole("heading", { name: "Únete a Familia Prueba" })).toBeVisible();
  const button = page.getByRole("button", { name: "Aceptar e ingresar al hogar" });
  await expect(button).toBeDisabled();
  await page.getByRole("group", { name: /Avance de mi ruta/ }).getByRole("button", { name: "Todos" }).click();
  await page.getByText(/Leí y acepto esta autorización/).click();
  await button.click();
  await expect(page.getByText("Invitación aceptada")).toBeVisible();
  expect(accepted).toEqual({ accepted: true, version: "2026-11-22", permissions: { routeProgress: "ALL", archetype: "NONE", learning: "NONE", credit: "NONE", score: "NONE" } });
});

test("una invitación vencida no ofrece aceptarla", async ({ page }) => {
  await noSession(page);
  await page.route("**/api/luft/invitations/vieja", (route) => route.fulfill(json({ ...invitation, status: "EXPIRED" })));
  await page.goto("/invitacion/vieja");
  await expect(page.getByRole("heading", { name: "Esta invitación venció" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Aceptar/ })).toHaveCount(0);
});

for (const path of ["/app/ruta", "/app/formalizacion", "/app/familia", "/app/finanzas", "/app/finanzas/tarjetas", "/app/finanzas/creditos", "/app/finanzas/conexiones", "/app/proyectos", "/app/oportunidades", "/app/oportunidades/datos", "/app/perfil/privacidad"]) {
  test(`${path} exige sesión`, async ({ page }) => {
    await noSession(page);
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  });
}
