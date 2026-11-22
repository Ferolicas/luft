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

## Frente "matching" (V2): políticas, matching, portales y analítica

Módulos `apps/api/src/matching` (`MatchingModule`) y `apps/api/src/analytics` (`AnalyticsModule`). Todas las tablas viven en el esquema `scoring` (migración `202611220002_matching_analytics`); `identity` solo gana los roles `ALLY` e `INSTITUTION` (migración `202611220001_partner_roles`). Sin llaves foráneas entre esquemas.

### Modelos (`scoring`)

| Modelo | Propósito |
| --- | --- |
| `Institution`, `FinancialProduct` | Entidad financiera y sus productos (montos, plazos, tasa referencial, garantías, documentos, canal, comisión, convenio). |
| `PolicyVersion`, `PolicyRule`, `PolicyVersionEvent` | Política versionada por producto (`BORRADOR → REVISION → APROBADA → VIGENTE → SUSTITUIDA \| SUSPENDIDA`), sus reglas y su historial. Un índice único parcial impide dos versiones `VIGENTE` por producto. |
| `MatchingSupplement` | Datos que la persona declara para el matching (nacimiento, ciudad, inicio de actividad), cifrados. |
| `MatchRun`, `MatchResult` | Ejecución con la instantánea de hechos cifrada + hash, y un resultado por producto con la versión de política, copia de sus reglas, % de encaje, estado y explicación (sin valores de la persona). |
| `MatchPresentation` | Autorización expresa (texto, hash, IP con hash, agente) y seguimiento `AUTORIZADA → PRESENTADA → APROBADA \| RECHAZADA \| DESISTIDA` (+ `REVOCADA`). La copia de datos autorizados va cifrada. |
| `Ally`, `InstitutionUser`, `AllyUser`, `AllyReferral` | Aliados, vínculo cuenta↔entidad/aliado y `referredByAllyId`. |
| `Cohort`, `Outcome`, `BacktestRun` | Cortes congelados de cosechas, resultados reales observados (préstamos y decisiones de entidades) y backtests con parámetros, reglas y resultado. |

### Reglas puras (sin base de datos, con pruebas)

- `matching/fact-catalog.ts`: catálogo de hechos y operadores que la consola usa para armar formularios. Las políticas viven en BD; el código solo declara qué hechos existen.
- `matching/rule-engine.ts`: hechos + reglas → resultado determinista. Un hecho desconocido nunca cuenta como cumplido (brecha "dato faltante"). `REQUISITO`, `EXCLUSION` (causal de rechazo) y `PREFERENCIA` (peso). Las reglas `internal` se muestran al usuario como "Criterio interno de la entidad".
- `matching/policy-lifecycle.ts`, `matching/presentation.ts`, `matching/facts.ts`: transiciones, aprobación independiente, alcance de la autorización, visibilidad de la entidad, embudo del aliado y constructor de hechos.
- `analytics/cohorts.ts`, `analytics/effectiveness.ts`, `analytics/backtest.ts`: cosechas (mora 30/60/90 por mes en libros, pagos a tiempo, prepagos, castigos), puntaje inicial vs. final, lecciones vs. pago, estabilidad del arquetipo y backtesting.

### Endpoints

- Usuario (`USER` y staff; nunca `ALLY`/`INSTITUTION`): `GET /matching`, `GET /matching/readiness`, `GET|PUT /matching/profile`, `POST /matching/run`, `GET /matching/history`, `GET /matching/runs/:id`, `GET /matching/presentations`, `GET /matching/results/:id/authorization`, `POST /matching/results/:id/authorize`, `POST /matching/results/:id/revoke`.
- Consola (`/admin/matching`, lectura `RISK`/`COMMERCIAL`/`SUPERADMIN`, escritura `RISK`/`SUPERADMIN`): `catalog`, `institutions`, `products`, `products/:id/versions`, `versions/:id` (+ `clone`, `transition`, `history`, `simulate`, `rules`), `rules/:id`, `presentations` (+ `present`, `decision`), `runs` (+ `verify`). Solo `SUPERADMIN`: `allies`, `allies/:id/users`, `allies/:id/referrals`, `institutions/:id/users`, `institution-users/:id`, `ally-users/:id`, `ally-referrals/:id`.
- Portal de entidad (`INSTITUTION` + vínculo activo): `GET /institution/me`, `GET /institution/presentations`, `GET /institution/presentations/:id`, `POST /institution/presentations/:id/decision`.
- Portal de aliado (`ALLY` + vínculo activo): `GET /ally/me`, `GET /ally/funnel`.
- Analítica (`RISK`/`FINANCE`/`SUPERADMIN`): `GET /admin/analytics/cohorts`, `GET|POST /admin/analytics/cohorts/snapshots`, `GET /admin/analytics/effectiveness`, `GET|POST /admin/analytics/backtests`, `GET /admin/analytics/backtests/:id`.

### Flujos

1. Riesgo crea entidad, producto y una versión en borrador con reglas; la envía a revisión; otra persona la aprueba (queda registrado quién y con qué independencia) y se activa. Activar sustituye la versión vigente anterior. Solo un borrador es editable: para cambiar una política se clona.
2. La persona ejecuta el matching (exige consentimiento de tratamiento vigente, arquetipo y secciones trabajo/ingresos/deudas; si falta algo la respuesta lo lista). Cada resultado guarda la versión y una copia de las reglas, así una versión posterior no altera la historia; `POST /admin/matching/runs/:id/verify` re-ejecuta la instantánea y confirma que el resultado es reproducible.
3. La persona autoriza presentar sus datos a UNA entidad (solo contacto + hechos que evalúa esa política + resultado). Puede revocar antes de la presentación (se destruye la copia) o desistir después.
4. Una persona de LUFT marca "presentada" (no hay integración bancaria ni envíos simulados). La entidad, en su portal, ve únicamente los casos presentados a ella con los datos autorizados y registra aprobación/rechazo, monto, tasa, plazo y producto final. El staff también puede registrar la decisión.
5. Analítica calcula cosechas desde `startif`, efectividad desde `luft` y backtests re-ejecutando reglas sobre las instantáneas de `MatchRun` contra `Outcome`.

### Puntos de extensión e integración pendientes

- **Categoría**: `matching/profile-source.ts` (`PROFILE_SOURCE`) es el único lugar que lee el perfil LUFT. Hoy devuelve `category: null` (las reglas sobre categoría producen "dato faltante") y el arquetipo de `FinancialProfile`. Cuando exista el catálogo de categorías/arquetipos basta con cambiar `LuftProfileSource.signals`/`segments` o enlazar otra clase al token.
- **Referidos**: el registro no captura código de aliado. `AllyReferral` se alimenta desde `POST /admin/matching/allies/:id/referrals`; la captura automática con `Ally.referralCode` en el registro está pendiente.
- **Cierre de cuenta**: `MatchingService.eraseUserData(userId)` borra lo que el módulo guarda de la persona (conserva solo lo ya presentado a una entidad). Falta invocarlo desde `AuthService.closeAccount`.
- **Abonos anticipados de STARTIF**: `AnalyticsService` lee `startif."LoanPrepayment"` de forma tolerante (solo si existe con `loanId` y `amountCOP`); `Loan.productCode`, `defaultedAt` y `writtenOffAt` se usan en cuanto el cliente Prisma los expone.
- **Instantáneas para backtesting**: solo existen las de ejecuciones de matching; no se captura instantánea al originar un crédito.
