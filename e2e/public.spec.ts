import { expect, test, type Page } from "@playwright/test";

test("landing presents the LUFT route", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Tu futuro merece/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Crear mi ruta/i })).toHaveAttribute("href", "/empezar");
  await expect(page.locator("img").first()).toBeVisible();
});

/** Answers the two classification questions and lands on the first onboarding slide. */
async function reachOnboarding(page: Page) {
  await page.goto("/empezar");
  await expect(page.getByRole("heading", { name: /Cuéntanos qué te trae a LUFT/i })).toBeVisible();
  await page.getByRole("button", { name: /Empecemos/i }).click();
  await expect(page.getByRole("heading", { name: /Qué te gustaría lograr con LUFT/i })).toBeVisible();
  await page.getByRole("radio", { name: /Empezar mi vida financiera/i }).click();
  await expect(page.getByRole("heading", { name: /créditos a tu nombre/i })).toBeVisible();
  await page.getByRole("radio", { name: /nunca he tenido/i }).click();
  await expect(page.getByRole("heading", { name: /fortalecer tu puntaje/i })).toBeVisible();
}

test("guided start asks two questions before the onboarding", async ({ page }) => {
  await reachOnboarding(page);
  await expect(page.getByRole("link", { name: "Saltar" })).toHaveAttribute("href", "/registro");
  // The brand inside the titles is the inline "luft" logotype, announced as LUFT.
  await page.goto("/empezar");
  await expect(page.getByRole("heading", { name: /Cuéntanos/i }).getByRole("img", { name: "LUFT" })).toBeVisible();
});

test("onboarding slides move with swipe and arrow keys", async ({ page }) => {
  await reachOnboarding(page);
  const carousel = page.locator(".l-onboard");
  const activeDot = () => page.locator(".l-onboard .l-dots i").evaluateAll((dots) => dots.findIndex((dot) => dot.classList.contains("on")));

  // The first slide keeps its chip on one line, inside the screen.
  const chip = page.getByText("Con datos de Datacrédito y TransUnion");
  await expect(chip).toBeVisible();
  const fits = await chip.evaluate((node) => { const box = node.getBoundingClientRect(); return node.scrollWidth <= node.clientWidth && box.left >= 0 && box.right <= window.innerWidth && box.height < 44; });
  expect(fits).toBe(true);
  // Horizontal gestures are ours; vertical scrolling stays with the browser.
  await expect(carousel).toHaveCSS("touch-action", "pan-y");
  expect(await activeDot()).toBe(0);

  const box = (await carousel.boundingBox())!;
  const swipe = async (from: number, to: number) => {
    await page.mouse.move(box.x + box.width * from, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to, box.y + box.height / 2 + 6, { steps: 6 });
    await page.mouse.up();
  };
  await swipe(0.8, 0.2);
  await expect(page.getByRole("heading", { name: "Construye un mejor historial" })).toBeVisible();
  expect(await activeDot()).toBe(1);
  await swipe(0.2, 0.8);
  await expect(page.getByRole("heading", { name: /fortalecer tu puntaje/i })).toBeVisible();

  // A mostly vertical drag is a scroll, not a slide change.
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + 240, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("heading", { name: /fortalecer tu puntaje/i })).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "Construye un mejor historial" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "Abre nuevas oportunidades" })).toBeVisible();
  expect(await activeDot()).toBe(2);
  // Arrow keys never leave the slides; the button does.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "Abre nuevas oportunidades" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("heading", { name: "Construye un mejor historial" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: /Empieza ya/i }).click();
  await expect(page).toHaveURL(/\/registro$/);
});

test("registration runs in three steps with identity, contact and consent", async ({ page }) => {
  await page.goto("/registro");
  await expect(page.getByRole("heading", { name: "Comencemos por conocerte" })).toBeVisible();
  await page.getByLabel("Nombre completo").fill("Dueño de Pruebas");
  await page.getByLabel("Cédula de ciudadanía").fill("1234567890");
  await page.getByLabel("Fecha de expedición").fill("2020-01-01");

  // A focused field shows its state with the border colour only: no outline ring or halo on top.
  const name = page.getByLabel("Nombre completo");
  await name.focus();
  await expect(name).toHaveCSS("outline-style", "none");
  await expect(name).toHaveCSS("box-shadow", "none");
  // 1.5px stroke (browsers snap it to the device pixel grid), not the old 3px.
  expect(await name.evaluate((node) => parseFloat(getComputedStyle(node).borderTopWidth))).toBeLessThanOrEqual(1.5);

  await page.getByRole("button", { name: /Continuar/i }).click();
  await expect(page.getByRole("heading", { name: /Cómo te contactamos/i })).toBeVisible();
  // Colombian prefix as a fixed block (no dropdown) beside the phone field.
  const prefix = page.locator(".l-prefix");
  await expect(prefix).toHaveText("+57");
  await expect(prefix.locator("svg")).toBeVisible();
  await expect(page.locator(".l-phone select")).toHaveCount(0);
  await page.getByLabel("Número de celular").fill("3001234567");
  await page.getByLabel("Correo electrónico").fill("owner@example.com");
  await page.getByLabel("Dirección de residencia").fill("Calle 10 # 20-30");
  await page.getByLabel("Estrato socioeconómico").selectOption("3");
  await page.getByRole("button", { name: /Continuar/i }).click();

  await expect(page.getByRole("heading", { name: "Protege tu cuenta" })).toBeVisible();
  await expect(page.getByText(/Tureporte S\.A\.S\./i)).toBeVisible();
  // Three password requirements, all on a single line, without overflowing the card.
  const rules = page.locator(".l-rules > span");
  await expect(rules).toHaveText(["12+ caracteres", "Un número", "Mayúscula y minúscula"]);
  const layout = await page.locator(".l-rules").evaluate((node) => ({ tops: new Set(Array.from(node.children, (child) => Math.round(child.getBoundingClientRect().top))).size, fits: node.scrollWidth <= node.clientWidth }));
  expect(layout).toEqual({ tops: 1, fits: true });
  await page.locator('input[name="password"]').fill("Clave12345");
  await expect(rules.nth(0)).not.toHaveClass(/ok/);
  await expect(rules.nth(1)).toHaveClass(/ok/);
  await expect(rules.nth(2)).toHaveClass(/ok/);

  // Disabled state of the button: solid colours, never see-through.
  const submit = page.getByRole("button", { name: /Crear mi cuenta/i });
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveCSS("opacity", "1");
  await expect(submit).toHaveCSS("background-color", "rgb(229, 234, 242)");
  await expect(page.locator(".l-footer")).toHaveCSS("background-color", "rgb(248, 250, 252)");
  const terms = page.getByRole("checkbox", { name: /Acepto los/ });
  // The page scrolls smoothly: jump instantly so the click does not land mid-animation under the sticky footer.
  await terms.evaluate((node) => node.scrollIntoView({ block: "center", behavior: "instant" }));
  await terms.check({ force: true });
  await expect(submit).toBeEnabled();
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
