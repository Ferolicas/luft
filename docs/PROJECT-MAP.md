# LUFT project map

Last updated: 2026-11-19.

## Runtime

| Component | Path | Port | Purpose |
| --- | --- | ---: | --- |
| PWA | `apps/web` | 4002 | User and staff interface |
| API | `apps/api` | 4003 | REST, auth, WebSockets and webhooks |
| Worker | `apps/api/src/worker.ts` | none | Scheduled and queued jobs |
| Scoring | `services/scoring` | 4004 | Versioned profile/scoring decisions |

Nginx serves `luft.restaurar.co` over HTTPS, redirects HTTP to HTTPS, routes `/api/*` and `/socket.io/*` to NestJS, and all other traffic to Next.js.

## Data boundaries

- `identity`: users, sessions, OTP challenges, passkeys, staff roles and push subscriptions.
- `luft`: consents, financial profile, goals, archetypes, lessons, progress, streaks and score inquiries.
- `startif`: credit applications, KYC, signatures, loans, installments, payments, tradeline reports, PQR and usury rates.
- `audit`: append-only audit and integration/outbox events.
- `scoring`: decision versions, score results and future model artifacts.

No cross-schema foreign keys are used. A stable user UUID is passed across domain boundaries only after checking consent and role policy.

## Main user journey

1. Welcome and account registration.
2. SMS/date-of-issue verification.
3. LUFT habeas-data consent and initial bureau inquiry.
4. Profile questionnaire and archetype discovery.
5. Personalized home, education, goals and progress.
6. StartIF credit application, separate consent and Truora KYC.
7. Quote, promissory-note signature, Mercado Pago/PSE payment plan and decreasing installments.
8. Monthly positive/negative bureau reporting, notifications and PQR.
9. Final score inquiry and opportunity/bank guidance.

The final score inquiry is queued automatically when the last installment is confirmed as paid and the loan/application are closed.

## PWA screens (LUFT MVP design, 2026-11)

The user-facing PWA follows the "LUFT MVP · Dev Ready" Figma file: mobile-first column, DM Sans, tokens and components in `apps/web/src/app/luft.css` and `apps/web/src/components/luft/` (icons, Lufty mascot, medals and illustrations exported from the design live in `apps/web/public/luft/`). The staff panel (`/admin`) keeps the previous shell and `globals.css`.

Desktop variant (≥1024px): derived from the mobile design, which stays the single reference and must not be edited for desktop needs. All desktop rules live in `apps/web/src/app/luft-desktop.css`, entirely inside `min-width: 1024px` media queries (multi-column dashboards from 1200px), so anything narrower renders the mobile app unchanged. Desktop-only markup is in `apps/web/src/components/luft/desktop.tsx`: `DesktopNav` (sidebar that replaces the bottom tab bar, rendered by `LuftShell` inside `.l-shell`) and `AuthFrame` (brand panel + form, applied by the `layout.tsx` of `/login`, `/registro`, `/recuperar`, `/verificar` and `/empezar`). The four tab screens carry a marker class on `Screen` (`d-home`, `d-progress`, `d-learn`, `d-profile`) that only the desktop stylesheet uses; their grid placement relies on the order of the children of `.l-body`, so reordering those blocks requires updating the matching `nth-child` rules.

| Route | Screen |
| --- | --- |
| `/empezar` | Splash, classification (2 questions, kept in the browser until the account exists) and onboarding carousel |
| `/registro`, `/verificar`, `/login`, `/recuperar` | Three-step sign-up, phone verification, login (password or passkey), recovery |
| `/app` | Home: credit summary, shortcuts, progress, Lufty tips, financial-profile invitation sheet |
| `/app/puntaje` | Score gauge and bureau-inquiry consent/status (`/app/diagnostico` redirects here) |
| `/app/credito` | Five-step offer (quotes from `/startif/quote`), application tracker (KYC, signature), activation and plan |
| `/app/pagar`, `/app/historial` | PSE payment of the next installment; payment history and badges |
| `/app/progreso` | Level, XP, streaks, weekly missions and badge wall |
| `/app/aprender`, `/app/aprender/[slug]`, `/app/aprender/[slug]/[lesson]` | Modules, module detail, lesson story + quiz (content in `apps/web/src/lib/lessons.ts`) |
| `/app/perfil`, `/app/perfil/cuenta` | Profile hub; account data, passkeys, push, password, closure |
| `/app/perfil/financiero/*` | Financial profile: work and income, wealth and debts (with tax-filing orientation), payment habits, documents |
| `/app/renta` | Tax-return preparation request (fails closed, see below) |
| `/app/pqr` | Help and PQR |

### Journey API (`apps/api/src/luft/journey*.ts`)

- `PUT /luft/classification`, `GET /luft/journey`, `GET /luft/financial-profile`, `PUT /luft/financial-profile/:section`.
- `POST /luft/documents/:kind` (raw body, PDF/JPG/PNG up to 10 MB, real type sniffed), `GET /luft/documents/:id/file`, `DELETE /luft/documents/:id`.
- `PUT /luft/tax-return`, `POST /luft/tax-return/dian-connection`, `POST /luft/tax-return/calculation`.
- No new tables: the journey state lives in `FinancialProfile.demographicAnswers` (section answers encrypted with AES-256-GCM; only completion flags and document metadata stay readable). Document files are stored encrypted under `PRIVATE_STORAGE_PATH/documents/<userId>/` and removed when an account is erased.
- `GET /luft/dashboard` now also returns `journey` (completion summary) and `progress` (XP, level, badges, missions), both derived from real lessons, on-time installments and profile completion.
- Tax-filing orientation uses the 2025 reference thresholds (UVT $49.799) and is not tax advice. There is no DIAN channel: the tax-return endpoints record the request and answer `configuration_required` instead of simulating a result.
- Only PSE is offered for payments; Nequi and debit card are shown as "Próximamente".

## External adapters

- Mercado Pago Orders API + signed webhook. Webhook events are resolved against Mercado Pago's authoritative resource, checked against the expected amount and persisted atomically with idempotent duplicate/refund/reconciliation handling.
- Truora Digital Identity web flow + webhook/result lookup.
- Experian DataCrédito and TransUnion/CIFIN contract-gated adapters.
- Resend email, Evolution WhatsApp, configurable SMS, Web Push and signed n8n webhooks.

Adapters fail closed with `configuration_required` until real credentials and private vendor specifications are installed.

## Identity and access

- Opaque, signed, HTTP-only session cookie with Argon2id passwords.
- Registration and password recovery through OTP; passkeys through WebAuthn.
- Tureporte S.A.S., owner of RESTAURAR, is the data controller for LUFT. The canonical privacy and habeas-data policy is published at `https://restaurar.co/privacy`.
- Until the SMS provider credentials are installed, owner acceptance testing uses `REGISTRATION_MODE=invite`: the API requires a private invite code and reveals the one-time verification code only in the successful registration response. Production public mode never reveals OTP values.
- Password change revokes every other active session.
- Account closure requires the current password and an exact destructive confirmation. Accounts without financial records are erased across operational schemas; accounts with financial records are closed, all sessions are revoked and a configurable retention marker is recorded (ten years by default, pending approval of the definitive retention table).
- Staff routes enforce `COMMERCIAL`, `LEGAL`, `SUPPORT`, `COLLECTIONS`, `RISK`, `FINANCE`, or `SUPERADMIN` at the API layer.
- Socket.IO connections authenticate the same session and join user/role rooms through Redis.

## Capacity baseline

- Two clustered Next.js processes and two clustered NestJS processes.
- One BullMQ worker process; scoring uses two Uvicorn workers.
- Redis adapter shares Socket.IO rooms between API workers.
- Database pools are capped per schema/process (`DATABASE_POOL_MAX=3`) to protect the shared PostgreSQL server.
- The initial operating target is 1,500 registered users. Re-test concurrency, database saturation and p95 latency before increasing that target or enabling high-volume campaigns.

## Backups

- Production runs a verified PostgreSQL custom-format backup every day at 03:17 UTC.
- Backups live outside the application checkout in `/var/backups/luft`, are readable only by root and retain 14 days.
- Each backup is checked with `pg_restore --list` before its temporary file becomes the final archive.

## Frente web-correcciones (V2): design corrections on the PWA

Applies the design team's review (`LUFT-PDF-Correcciones.pdf`, 21 pages) to the existing screens of `apps/web`. No new V2 sections were added here. Where this section and "PWA screens" disagree, this one is newer.

### Visual system (`apps/web/src/app/luft.css`)

- `--l-stroke: 1.5px` is the only stroke of inputs, selects, option cards, radios, checkboxes, segmented controls and the secondary button. A focused field changes its border colour only (no outline ring or halo); buttons and links keep the visible focus ring.
- Four shadow tokens: `--l-shadow-card`, `--l-shadow-soft`, `--l-shadow-raised`, `--l-shadow-brand` (primary button). `--l-size-display: 36px` is the amount size of every state of the credit card.
- Disabled buttons use solid colours (`--l-n-200` / `--l-n-400`), never opacity, and `.l-footer` is opaque.
- New shared components in `components/luft/ui.tsx`: `Luft` (inline lowercase logotype, announced as "LUFT"), `Carousel` (position dots that follow the visible card; arrow keys when focused), `Staircase` (installment steps with Lufty on the current one), `Spark`, `ColombiaFlag`; `Lufty` takes `motion` (`hop`, `hop soft`, `cheer`); `Choice multiple` is a square checkbox; `Field` takes `optional` and `prefix`; `Sheet` traps focus and restores it. Every animation is covered by the global `prefers-reduced-motion` rule.
- `components/luft/notifications.tsx`: `NotificationBell` (home header).
- `money()` (`lib/api.ts`) formats without a space after `$`, as the design does for credit amounts; `formatCOP()` keeps the space used in the financial-profile forms.

### Flows that changed

- **Credit offer (`/app/credito`), six steps with a fixed plan**: 1 Abre nuevos caminos · 2 Tu plan LUFT (what the credit finances) · 3 Tu primer crédito · 4 Tu plan de N cuotas · 5 Construye tu historial · 6 Antes de aceptar. The person no longer chooses a term. Every amount, term, rate and date comes from `POST /startif/quote` (body `{ productCode: "BUILDER_1" }`, no amount or term); the application is created with `POST /startif/applications` body `{ productCode: "BUILDER_1" }`. Step 2 reads `GET /luft/plans` (Individual by default) and, if that call fails, explains the service without prices. Nothing about the product is hard-coded in the web app.
- **Notifications on Home (`/app`)**: the bell replaces the help shortcut (help/PQR stays in Profile and in the desktop sidebar). It shows `dashboard.notificationsUnread`, opens a sheet with `GET /luft/notifications` and marks everything read with `POST /luft/notifications/read` (body `{}`). `LuftShell` listens to the `notification:new` socket event (toast, dashboard reload and refresh of an open list). A failed request shows an error with retry; an empty list shows an empty state. No sample data.
- **XP only comes from learning**: celebrations for activating the credit and completing the financial profile, the payment history and the progress screen no longer show XP; a mission whose `xp` is 0 shows no XP chip. Lesson XP is read from the `lesson` mission of the dashboard (fallback `LESSON_XP`).
- **Onboarding (`/empezar`)**: slides also move with swipe (pointer events, `touch-action: pan-y` so vertical scroll is untouched) and with the left/right arrow keys. The flat background circles were removed from `public/luft/onboarding-*.svg` and replaced by a soft glow in CSS.
- **Registration**: labels "Cédula de ciudadanía", "Número de celular" (fixed +57 block with the Colombian flag, no dropdown), "Correo electrónico", "Estrato socioeconómico"; three password requirements on one line (the four API checks are unchanged).
- **Learning**: module detail with the corrected gauge illustration (`public/luft/modulo-score.svg` without the marker), "MÓDULO n · tema" pill and course facts (topic and level per slug in `lib/lessons.ts`), lesson rows with duration and XP; end of lesson is a bottom sheet over the dimmed story; completed lesson has one button plus a text link.
- **Financial profile**: tax-filing orientation rows aligned (label left, value right, full-width bar, limit and tag below). The sheet "Podrías tener que declarar renta" opens on "Guardar sección" when `taxCheck.mayHaveToFile` and from "Ver qué significa"; it leads to `/app/renta` or to uploading the tax return. It is an orientation, never a tax determination.
- **Documents**: an uploaded file shows a preview (thumbnail for images, neutral page for PDFs) and Ver · Reemplazar · Eliminar. "Reemplazar" uploads the new file and then deletes the previous one (deletes first only when the three-file limit is reached). The main button goes to the next missing document.

### Desktop variant

Unchanged contract: the order of the children of `.l-body` on the four tab screens is the same, so the `nth-child` rules of `luft-desktop.css` still apply. Additions there: opaque footer, hidden carousel dots when the three tips are visible at once, `Staircase` height, hover states for the clickable progress card and the bell, and `br.l-br-m` (mobile-only title line breaks) hidden in the public screens.

### Tests

`e2e/public.spec.ts` covers the new labels, the +57 prefix, the three requirements on one line, focus without ring, the solid disabled button, and the onboarding with swipe and arrow keys. Authenticated screens were verified with Playwright against intercepted `/api/**` responses shaped like the contracts (verification scripts only; the app has no mocks).
