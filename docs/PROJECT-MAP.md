# LUFT project map

Last updated: 2026-11-23.

## Runtime

| Component | Path | Port | Purpose |
| --- | --- | ---: | --- |
| PWA | `apps/web` | 4002 | User and staff interface |
| API | `apps/api` | 4003 | REST, auth, WebSockets and webhooks |
| Worker | `apps/api/src/worker.ts` | none | Scheduled and queued jobs |
| Scoring | `services/scoring` | 4004 | Versioned profile/scoring decisions |

Nginx serves `luft.com.co` over HTTPS, redirects HTTP to HTTPS, routes `/api/*` and `/socket.io/*` to NestJS, and all other traffic to Next.js.

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
| `/registro`, `/verificar`, `/login`, `/recuperar` | Three-step sign-up, phone verification by SMS (with resend), login (password or passkey, plus email code when two-step is on), recovery by email code |
| `/app` | Home: credit summary, shortcuts, progress, Lufty tips, financial-profile invitation sheet |
| `/app/puntaje` | Score gauge and bureau-inquiry consent/status (`/app/diagnostico` redirects here) |
| `/app/credito` | Five-step offer (quotes from `/startif/quote`), application tracker (KYC, signature), activation and plan |
| `/app/pagar`, `/app/historial` | PSE payment of the next installment; payment history and badges |
| `/app/progreso` | Level, XP, streaks, weekly missions and badge wall |
| `/app/aprender`, `/app/aprender/[slug]`, `/app/aprender/[slug]/[lesson]` | Modules, module detail, lesson story + quiz (content in `apps/web/src/lib/lessons.ts`) |
| `/app/perfil`, `/app/perfil/cuenta` | Profile hub; account data, passkeys, push, two-step sign-in, password, closure |
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
- One-time codes: SMS (LabsMobile) only validates the phone at sign-up; password recovery, promissory-note signature and the optional two-step sign-in send the code to the account email (Resend). Passkeys through WebAuthn skip the second step.
- Two-step sign-in is opt-in from Perfil → Mi cuenta: it is enabled only after confirming a code received by email and disabled with the current password. `POST /auth/login` then answers `next: "two_factor"` without a session and `POST /auth/login/verify` opens it. A login with a phone still pending verification answers `next: "verify_phone"` with a fresh SMS; `POST /auth/verify-phone/resend` issues another one.
- Each account can request 3 codes per purpose in 10 minutes and 10 per day; a used code cannot open a second session.
- Registration is public; the terms at `/legal/terminos` carry a version (`TERMS_VERSION` in `auth.service.ts`, mirrored in the page) that is stored in the `identity.user.registered` audit event.
- The worker checks the LabsMobile balance every 15 minutes and emails `SMS_LOW_BALANCE_ALERT_EMAIL` when it covers `SMS_LOW_BALANCE_THRESHOLD` messages or fewer (once a day while it stays low).
- Tureporte S.A.S., owner of RESTAURAR, is the data controller for LUFT. The canonical privacy and habeas-data policy is published at `https://restaurar.co/privacy`.
- `REGISTRATION_MODE=invite` requires a private invite code; the verification code is revealed in the response only if the SMS provider is not configured. Public mode never reveals OTP values and needs the SMS provider.
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

## Frente "startif" — LUFT + STARTIF V2 (2026-11)

Credit origination and servicing for the two builder credits. Everything lives in `apps/api/src/startif/`, `apps/api/src/admin/`, `apps/api/src/worker.service.ts` and `apps/api/prisma/startif/`.

### Pure rules (no database, no clock; each has a `.spec.ts`)

| File | Responsibility |
| --- | --- |
| `startif/credit-calculator.ts` | Decreasing geometric-gradient amortization (`C_t = C_1·(1−g)^(t−1)`, `C_1 = P / Σ (1−g)^(t−1)/(1+i)^t`), integer COP, due dates counted from an explicit `startDate`; `recalculateAfterPrepayment`. Reproduces the owner's table for $600.000 / 6 months / 1 % / 20 %. |
| `startif/credit-product.ts` | Product input schemas, `activationIssues` (what a version lacks before it can become ACTIVE), `resolvePrincipal` (fixed amount or range). |
| `startif/second-credit.ts` | Eligibility engine of credit 2 (`evaluateSecondCredit`) returning explained `requirements[]`, closed list of purposes, product-2 policy schema, `financialSnapshot`. |
| `startif/credit-lifecycle.ts` | State machine (`canTransition`), mapping to the specification stages (`creditStage`), automatic default (`resolveLoanStatus`), Colombia calendar dates. |
| `startif/prepayment.ts` | `planPrepayment` and `planPrepaymentReversal` (what to write when a prepayment is approved or refunded). |
| `startif/promissory-note.ts` | Text of the promissory note (product, principal, rate, gradient and quoted plan). |

`startif/loan-sync.ts` (`lockLoan`, `syncLoanStatus`) is shared by the payments webhook and the worker; `startif/credit-product.service.ts` owns the product catalogue; `startif/zod-exception.filter.ts` turns invalid input into a 400 on the StartIF and admin controllers.

`startif/legal-rate.ts` and `startif/legal-rate.service.ts` keep the legal maximum rate current: the worker reads the Superfinanciera open-data set `pare-7x5i` (consumo y ordinario) at start-up and every six hours, stores usury as 1.5 × the certified bank rate with its resolution, and never overwrites a rate registered by a person. Approval looks the rate up by Colombian calendar day and queries the source on demand when the period is missing; if the source fails nothing is stored and approval stays blocked.

### Data model (`startif` schema, migration `202611220003_credit_products_v2`)

- `CreditProduct` (new): `code`, `version`, `name`, `purpose`, `sequence` (1|2), `principalCOP` or `minPrincipalCOP`/`maxPrincipalCOP`, `termMonths`, `monthlyRate`, `geometricDecrease`, `disbursementMode` (`SERVICE_FINANCING` | `TRANSFER`), `requirements` (JSON, credit-2 policy), `defaultAfterDays`, `status` (`DRAFT` | `ACTIVE` | `SUSPENDED` | `SUPERSEDED`), `effectiveFrom`/`effectiveTo`, `createdBy`/`activatedBy`/`suspendedBy`, `statusReason`. One ACTIVE version per code (partial unique index). Seeded: `BUILDER_1` "Servicio LUFT" ACTIVE ($600.000, 6 months, 0.010000, 0.200000) and `BUILDER_2` "Consolidación" DRAFT without amounts.
- `CreditApplication` gains `productId`, `productCode`, `productVersion`, `geometricDecrease`, `purposeDescription`. `Loan` gains `productId`, `productCode`, `productVersion`, `purpose`, `defaultAfterDays`, `defaultedAt`, `writtenOffAt`, `writtenOffBy`, `writtenOffReason`; the default of `geometricDecrease` is now 0.200000. Applications and loans keep their own copy of the terms, so a new product version never changes them.
- `Disbursement` (new): one per approved application; `kind`, `status` (`PENDING` | `COMPLETED` | `CANCELLED`), unique `reference`, `disbursedAt`, `registeredBy`.
- `LoanPrepayment` (new): applied prepayment with `previousPlan`/`newPlan` snapshots, `reversedAt`, `reversalMode`.
- `Payment` gains `kind` (`INSTALLMENT` | `PREPAYMENT`), `loanId`, `creditedCOP` (what was really applied; the amount a refund reverts).
- `CreditStatus` gains `WRITTEN_OFF`.
- SQL-only integrity rules (CHECK constraints and the partial unique index) are listed at the top of `prisma/startif/schema.prisma`; keep them when authoring later migrations. New tables receive the same grants the application role already has on `Loan`.

### User endpoints (`/api/startif`, authenticated)

- `POST quote` `{ productCode?, amountCOP? }` → quote of the ACTIVE product (the user does not choose amount or term of a fixed product).
- `POST applications` `{ productCode?, purpose?, purposeDescription?, amountCOP? }`. Returns the resumable application of the same product if one exists (`reused: true`). Errors: `consent_required`, `profile_incomplete`, `product_unavailable`, `application_in_progress`, `product_already_used`, `amount_out_of_range`, and for credit 2 `not_eligible` with `requirements[]`.
- `GET credit` (most recent application/credit) and `GET credits[?purpose=&purposeDescription=&amountCOP=]` → `{ credits, second: { product, eligible, requirements, purposes } }`. Every credit carries `productCode`, `productName`, `purpose`, `stage` and `disbursement`.
- `POST payments/pse` `{ installmentId, bankCode }` or `{ kind: "PREPAYMENT", loanId, amountCOP, bankCode }` (errors `loan_not_current`, `prepayment_exceeds_balance`).

### Staff endpoints (`/api/admin`)

- `GET credit-products`, `POST credit-products/:code/versions`, `POST credit-products/:id/activate`, `POST credit-products/:id/suspend` — RISK, FINANCE, SUPERADMIN.
- `POST applications/:id/decision` — approval defaults to the product rate signed in the promissory note (never above it; usury and `legal_rate_required` checks kept). `GET applications/:id/eligibility` — RISK, SUPERADMIN.
- `GET disbursements` (RISK, FINANCE, SUPERADMIN); `POST disbursements/:id/register`, `POST disbursements/:id/cancel` — FINANCE, SUPERADMIN.
- `GET loans` (RISK, FINANCE, COLLECTIONS, SUPERADMIN); `POST loans/:id/write-off` — FINANCE, SUPERADMIN.

### Flows

- Two-credit strategy: credit 1 finances the LUFT service; credit 2 is blocked at origination unless the product is ACTIVE, credit 1 behaved (by default fully paid, nothing overdue, at most one late payment), the purpose belongs to the closed list (raising the score is not a valid purpose), declared income covers the highest installment, projected debt stays under the product cap and nothing else is in progress. Income, expenses and debts are read from the LUFT financial profile only while the `SCORE_SHARE_WITH_STARTIF` consent is in force. The final decision stays with RISK.
- Stages: `borrador → solicitado → en_estudio → aprobado | rechazado → firmado → desembolsado → vigente → pagado | mora | castigado`. The promissory note is signed before the review, so an approved application is already signed.
- Disbursement: `SERVICE_FINANCING` (credit 1) completes at approval without any money transfer and the loan starts that day. `TRANSFER` (credit 2) leaves the application `APPROVED` with a `PENDING` disbursement; the loan and its plan are created only when finance registers the real reference and date. The platform never orders or simulates a transfer.
- Prepayments: an approved prepayment goes to principal, the open installments are recalculated with the same rate and gradient (same count and dates, lower value) and a prepayment that covers the balance closes the loan. Everything happens inside the webhook transaction with the loan row locked. A refund restores the saved plan when nothing changed since; otherwise the refunded principal returns to the balance and the open installments are recalculated; when there is nowhere to put the debt back the payment is flagged for manual reconciliation.
- Default: the daily job (`daily-overdue`) marks overdue installments using Colombia's calendar day, moves a loan to `DEFAULTED` once an installment is `defaultAfterDays` overdue and back to `ACTIVE` when it has no overdue installment (also immediately when the payment webhook confirms the catch-up). Write-off is manual, with a reason, and audited.

- Migración `202611220004_reprice_unsigned_applications`: las solicitudes del flujo anterior que nunca firmaron pagaré (cotización no vinculante de $1.000.000 a 6–12 meses) pasan a las condiciones del producto vigente `BUILDER_1`; lo cotizado antes queda en `CreditApplication.previousTerms`. Las firmadas, en estudio, decididas o con préstamo no se tocan.

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

## Frente "luft-dominio" (LUFT + STARTIF V2, 2026-11-22)

Everything below lives in the `luft` schema (migration `apps/api/prisma/luft/migrations/202611220001_v2_dominio`, additive only, catalogs seeded with `ON CONFLICT DO NOTHING`). States are stored as text and guarded by `CHECK` constraints; "one active per…" rules are partial unique indexes that exist only in the migration SQL. StartIF data is read by user UUID and never copied.

### Concepts that must not be mixed

- **Category** (`ServiceCategory`): commercial segment, administrable without a deploy. Seeded: `JOVEN` = LUFT Impulso, `ADULTO` = LUFT Avanza, `FAMILIA` = LUFT Juntos. `config` (validated JSON) holds onboarding, modules, required documents, messages and project kinds.
- **Archetype** (`Archetype`, versioned per category): dynamic behavioural profile decided by explainable JSON rules over facts the app collects (`apps/api/src/catalog/archetype-engine.ts`). Twelve seeded, one default per category. Every decision is kept in `ArchetypeAssignment` (version, explanation, encrypted facts, date); the current code is mirrored in `FinancialProfile.archetype`. The codes used before V2 (`INICIADOR`, `CONSTRUCTOR`, `EXPLORADOR`, `ESTRATEGA`) stay valid: they are replaced on the next route sync through `LEGACY_ARCHETYPE_EQUIVALENCE` and kept in `ArchetypeAssignment.legacyCode`.
- **Plan** (`SubscriptionPlan` / `Subscription`): purchase modality. Individual (1 identity), Dúo (2), Familia (3 to 5); base price per identity $600.000 and `discountPercent` 0 until the owner defines it.
- **LUFT Familia** (`Household*`, `SharedGoal`, `Contribution`): support network, goals and contributions. It also exists in the individual plan (support members need no seat).

### Modules (`apps/api/src/`)

| Folder | Purpose |
| --- | --- |
| `catalog/` | Categories, archetypes (engine + staff CRUD with versions) and plans |
| `route/` | `ProfileFactsService` (loads the facts once), `RouteService` (route, archetype, stage, sync), pure machine in `route.ts` and fact builders in `facts.ts` |
| `evidence/` | Pure derivation of evidence, idempotent sync and versioned `FinancialProfileSnapshot` |
| `formalization/` | Tax rule versions, `FormalizationCase` state machine, user flow and professional review queue |
| `household/` | Subscription, household, invitations, permissions, shared goals and contributions; privacy rules in `privacy.ts` |
| `cards/` | Card guidance engine (`cards.ts`), cards, purchases, simulation and recommendations |
| `projects/` | Life projects with savings plan and the cycle aprender → demostrar → acceder → volver a crecer |
| `openfinance/` | Open Finance connections; fails closed (`configuration_required`) |
| `consents/` | Habeas-data list and revocation with effects |
| `notifications/` | Persistent in-app notifications; `notification-catalog.ts` maps realtime events to texts |
| `vault/` | Encrypted storage for tax documents and contribution supports (same directory and envelope as profile documents) |
| `luft/account-data.ts` | `purgeLuftAccountData` / `closeLuftAccountData` for account erasure and closure |
| `luft/zod-exception.filter.ts` | Global filter: zod validation errors answer 400 `validation_error` |

### Route

One active `UserRoute` per person (category, stage, progress). Linear machine that never goes back and only moves with real facts: `REGISTRADO → DIAGNOSTICADO → FORMALIZACION → FORMACION → CREDITO_1 → SEGUIMIENTO → CREDITO_2_OPCIONAL → PERFIL_FINAL → MATCHING → RELACION_CONTINUA`; each step is a `RouteTransition`. The user sees five stages (Conócete, Formalízate, Prepárate, Demuestra, Avanza) with a real checklist and the next recommended step. The category follows the classification suggestion (START→JOVEN, IMPROVE_SCORE→ADULTO, GUIDE_YOUTH→FAMILIA) until the user chooses, and is locked once the builder credit starts. A new route (another life stage or a project) opens after `PERFIL_FINAL`; the previous one is closed and kept. `RouteService.sync` is idempotent and runs when the route, the dashboard or the evidence are read and after profile, lesson, formalization and project events.

### Formalization

`TaxRuleVersion` per taxable year (`DRAFT → APPROVED → ACTIVE → SUPERSEDED`, one active per year; 2025 seeded with the former `TAX_REFERENCE` values). `taxCheck` uses the active version of the last closed taxable year and explains each criterion (value, limit, UVT, rule version); without a rule for the year nothing is evaluated. `FormalizationCase` (one per person and year): `SIN_EVALUAR → NO_REQUIERE | POSIBLE_OBLIGACION → DOCUMENTO_CARGADO | PREPARACION_GUIADA → REVISION → PRESENTADO → VERIFICADO`, with history in `FormalizationEvent`. Phases shown to the user: diagnosis, draft, review, signature/filing, verified evidence. Automatic data extraction and DIAN filing are not available without a provider and answer `configuration_required`; `PRESENTADO` only records the form number and date of a declaration filed through the DIAN's own channels. `/luft/tax-return*` keeps working and feeds the case.

### Privacy of the household

A package never merges files or profiles. Each member accepts their own `HOUSEHOLD_SHARING` consent and decides, per metric (`routeProgress`, `archetype`, `learning`, `credit`, `score`), who sees it: `NONE`, `BENEFICIARIES` (owner and members with a route) or `ALL` (also support). The board aggregates only authorized metrics. Invitations are single-use tokens stored as SHA-256, valid for seven days; the public preview exposes no identifiers or contact data.

### Endpoints

User (session required unless noted): `GET /luft/route`, `PUT /luft/route/category`, `GET /luft/route/archetypes`, `POST /luft/routes`, `GET /luft/categories`, `GET /luft/evidence`, `GET /luft/profile-snapshots`, `GET /luft/plans`, `GET|POST /luft/subscription`, `GET|POST|PATCH /luft/household`, `POST /luft/household/invitations`, `DELETE /luft/household/invitations/:id`, `GET /luft/invitations/:token` (public, throttled), `POST /luft/invitations/:token/accept`, `PUT /luft/household/permissions`, `POST /luft/household/leave`, `DELETE /luft/household/members/:id`, `POST /luft/household/goals`, `PATCH /luft/household/goals/:id`, `POST /luft/household/goals/:id/contributions`, `POST /luft/household/contributions/:id/{confirm,reject,support}`, `GET /luft/household/contributions/:id/support`, `GET /luft/formalization`, `POST /luft/formalization/{diagnose,answer,submit}`, `PUT /luft/formalization/preparation`, `POST /luft/formalization/documents/:kind`, `GET /luft/formalization/documents/:id/file`, `DELETE /luft/formalization/documents/:id`, `GET|POST /luft/cards`, `GET /luft/cards/overview`, `PATCH|DELETE /luft/cards/:id`, `POST /luft/cards/:id/purchases`, `DELETE /luft/cards/:id/purchases/:purchaseId`, `POST /luft/cards/:id/simulate`, `POST /luft/cards/guidance/:id/{accept,dismiss}`, `GET|POST /luft/projects`, `PATCH|DELETE /luft/projects/:id`, `GET /luft/open-finance`, `POST /luft/open-finance/connections`, `POST /luft/open-finance/connections/:id/revoke`, `GET /luft/consents`, `POST /luft/consents/:id/revoke`, `GET /luft/notifications`, `POST /luft/notifications/read`.

Staff: `GET|POST /admin/categories`, `PATCH|DELETE /admin/categories/:id`, `GET /admin/archetypes`, `GET /admin/archetypes/facts`, `POST /admin/archetypes`, `PUT /admin/archetypes/:id`, `POST /admin/archetypes/:id/deactivate`, `GET /admin/plans`, `PATCH /admin/plans/:code`, `GET|POST /admin/tax-rules`, `POST /admin/tax-rules/:id/{approve,activate}`, `GET /admin/formalization/cases`, `GET /admin/formalization/cases/:id`, `GET /admin/formalization/cases/:id/documents/:documentId/file`, `POST /admin/formalization/cases/:id/{observe,approve,filed,verify}`.

Provider callback: `POST /webhooks/open-finance` (HMAC `x-openfinance-signature`).

### Changes to existing behaviour

- `GET /luft/dashboard` adds `route` and `notificationsUnread`; `credit` is the loan with unpaid installments or, failing that, the most recent application.
- XP is earned only with lessons (20) and modules (30). Payments, an active credit and a complete profile keep their badges and missions with `xp: 0`.
- `RealtimeService.toUser` persists a `Notification` and emits `notification:new` for `score:status`, `credit:decision`, `payment:status`, `pqr:status`, `kyc:status`, `household:invitation`, `household:contribution`, `formalization:status` and `cards:guidance`. New informative events without notification: `route:updated`, `openfinance:status`, `formalization:new` (staff roles).
- `ConsentKind` gains `HOUSEHOLD_SHARING`, `OPEN_FINANCE` and `TAX_ASSISTANCE`; `Consent` gains `scope`, `expiresAt` and `revokedReason`. Revoking `DATA_PROCESSING` is only possible by closing the account.
- Integrations status gains `openFinance`. New variables: `OPENFINANCE_ENABLED`, `OPENFINANCE_BASE_URL`, `OPENFINANCE_CLIENT_ID`, `OPENFINANCE_CLIENT_SECRET`, `OPENFINANCE_WEBHOOK_SECRET`, `OPENFINANCE_CONSENT_ENDPOINT`, `OPENFINANCE_CONSENT_DAYS`.

### Screens expected by the links the API returns

`/app/ruta`, `/app/formalizacion`, `/app/familia`, `/app/finanzas`, `/app/proyectos`, `/app/oportunidades`, `/invitacion/[token]`, plus the existing `/app/puntaje`, `/app/perfil/financiero`, `/app/perfil/financiero/documentos`, `/app/aprender`, `/app/credito`, `/app/pagar`, `/app/historial`, `/app/pqr` and `/app/perfil/cuenta`.

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

## Frente "web-v2-usuario" — V2 user screens of the PWA (2026-11-23)

New user-facing screens on top of the V2 API. They only add files: no existing page, component or stylesheet was edited. Mounting points in existing files (home, profile hub, desktop sidebar, `DashboardData` type, post-login redirect) are listed at the end of this section as integration work.

### Files

- `apps/web/src/app/luft-v2.css`: every V2-only rule, prefixed `v2-`. It reuses the `--l-*` tokens and the `l-*` kit; strokes use `var(--l-stroke, 1.5px)` and shadows `var(--l-shadow-*)`. Desktop rules live at the bottom inside `min-width: 1024px` / `1200px` media queries. It is imported by `components/luft/v2/kit.tsx` and `components/luft/v2/index.tsx`, so any page that uses the V2 kit loads it.
- `apps/web/src/lib/v2/types.ts`: API contracts as consumed by the PWA (verified against the running API). `lib/v2/api.ts`: `useResource` (load / reload / replace with honest loading and error states), `useAction`, `send`, `errorCode`, `describeError` (reads `issues[]` of validation errors), `uploadFile` (raw binary body + `X-File-Name`), date/currency formatters and the pending-invitation storage (`luft_pending_invitation`). `lib/v2/labels.ts`: Open Finance connection labels.
- `apps/web/src/components/luft/v2/`: `kit.tsx` (PageState, Empty, SheetHead, ConfirmSheet, Facts, ListRow, Meter, Ring, Steps, FilePicker, ConsentBox, Fold), `index.tsx` (`RouteSummaryCard`, `PendingInvitation`, `V2_LINKS`, `STAGE_ORDER`), `household.tsx`, `cards.tsx`, `matching.tsx` (sheets and cards of each domain).
- `e2e/v2-usuario.spec.ts`: API-free checks (responses mocked with `page.route`): invitation states and session requirement of every V2 route.

### Routes

| Route | Screen | API |
| --- | --- | --- |
| `/app/ruta` | Category and archetype shown separately, why the archetype was assigned, archetype history, the 5 stages with their items and links, next step, evidence list, category picker (until locked), new route when allowed, route transitions. Answers the classification (2 questions) when there is no archetype yet. | `GET /luft/route`, `/luft/evidence`, `/luft/route/archetypes`, `/luft/categories`; `PUT /luft/route/category`; `POST /luft/routes`; `PUT /luft/classification` |
| `/app/formalizacion` | Assisted tax formalization driven by `FormalizationView.actions`: explained diagnosis (value, limit, UVT, rule version, disclaimer), "already filed?" question with the `TAX_ASSISTANCE` authorization, declaration and support uploads, guided preparation, submit for review, timeline with the professional's observations, filed / verified states. Extraction and DIAN show their `configuration_required` message. `/app/renta` is untouched. | `GET /luft/formalization`; `POST .../diagnose`, `/answer`, `/submit`, `/documents/:kind`; `PUT .../preparation`; `DELETE .../documents/:id` |
| `/app/familia` | Without a household: plan picker (seats and price from the API) and household creation with its consent. With a household, three tabs: Hogar (board with authorized metrics only, members and roles, seats, invitations with one-time link and real delivery status), Metas (shared goals, contributions with support file, confirm / reject), Mis permisos (share level per metric, rename, leave / close). | `GET /luft/household`, `/luft/subscription` and every household mutation |
| `/invitacion/[token]` | Public invitation page inside `AuthFrame`: status, inviter first name, household and role only. Without a session it offers sign-up (token kept in `localStorage`) or an inline login that stays on the page; with a session, per-metric sharing choice and acceptance with the invitation's own consent text. | `GET /luft/invitations/:token`, `POST .../accept`, `GET /auth/me`, `POST /auth/login` |
| `/app/finanzas` | Hub with three live summaries. | `GET /luft/cards/overview`, `/startif/credits`, `/luft/open-finance` |
| `/app/finanzas/tarjetas` | Card advisor: register / edit / delete self-declared cards, purchases, limit health (utilization, band, days to statement and payment), purchase simulator by amount and term, contextual recommendations with accept / dismiss, history with effectiveness; the API disclaimer is always visible. | `/luft/cards*` |
| `/app/finanzas/creditos` | Builder credits: credit 1 with progress and schedule, capital prepayment by PSE (shows the provider's real `configuration_required`), credit 2 with each requirement explained, purpose selector (eligibility preview through `GET /startif/credits?purpose=…`) and application when eligible. | `GET /startif/credits`, `POST /startif/applications`, `POST /startif/payments/pse` |
| `/app/finanzas/conexiones` | Open Finance: service status, scopes, authorization with the consent text (never asks for bank credentials), connections and revocation. | `/luft/open-finance*` |
| `/app/proyectos` | Life projects: create / edit / pause / complete / delete, savings plan (required monthly saving vs capacity, gap, suggested date), learn → demonstrate → access → grow cycle, recommended modules, optional new route when `canStartNewRoute`. | `/luft/projects*`, `GET /luft/route` |
| `/app/oportunidades` | Matching: readiness with links, declared data, run with desired amount and term, results per product (fit %, passed rules, gaps with a link to complete them, exclusions, policy version and date), express authorization per institution showing the preview text and scope, revoke / withdraw, presentation tracking with the institution's decision, run history. No approval promises. | `/matching*` |
| `/app/oportunidades/datos` | Declared data: birth date, department, city, start of current activity. | `GET|PUT /matching/profile` |
| `/app/perfil/privacidad` | Consents and habeas data: active and historical, by domain, with purpose, scope and dates; revocation with its effect explained; `DATA_PROCESSING` links to the account. | `GET /luft/consents`, `POST /luft/consents/:id/revoke` |

### Conventions

- Screens that use two columns from 1200px add `v2-wide` to `Screen` and wrap their blocks in `.v2-cols > .v2-main + .v2-side`; below that width they are a single mobile column in source order.
- Dates of calendar type (`YYYY-MM-DD`) are formatted in UTC; instants in the person's time zone. Installment due dates arrive as midnight-UTC instants and are cut to their date part before formatting.
- `configuration_required` (503) is never treated as success: the provider's message is shown and nothing is recorded as done.

### Integration points left for existing files

- Home (`app/app/page.tsx`): render `<RouteSummaryCard route={data.route} />` (and optionally `<PendingInvitation />`) from `@/components/luft/v2`.
- `lib/types.ts`: add `route?: DashboardRoute | null` (type in `@/lib/v2/types`) and `notificationsUnread?: number` to `DashboardData`.
- Profile hub (`app/app/perfil/page.tsx`) and desktop sidebar (`components/luft/desktop.tsx`): list `V2_LINKS`.
- `LoginScreen` / `VerifyScreen` (`components/luft/auth.tsx`): after a successful sign-in, go to `/invitacion/<token>` when `pendingInvitation()` returns one.


## Frente "web-v2-consolas" (LUFT + STARTIF V2, 2026-11-23)

Operation panel and partner portals in `apps/web`. They keep the panel language of `globals.css` (not the mobile PWA system of `luft.css`): every console class is prefixed `cs-` and lives in the last block of `apps/web/src/app/globals.css`. No new npm dependencies.

### Shell, session and roles

- `apps/web/src/components/app-shell.tsx` exports `ConsoleShell({ area: "admin" | "entidad" | "aliado" })`, `AppShell` (admin alias), `useConsole()` (`{ user, notify }`) and `useSessionUser()`. It resolves the session with `GET /api/auth/me` and renders nothing but a loader until the role is known: 401 → `/login`; a role that does not belong to the console → `homeFor(role)` (`/admin` staff, `/entidad` INSTITUTION, `/aliado` ALLY, `/app` USER).
- `apps/web/src/lib/admin/nav.ts` is the single map of areas, routes and roles (`ADMIN_NAV`, `canOpen`, `CAN`). The roles are the ones the API controllers enforce; a route missing from the map is denied. A staff role that opens a section it cannot use sees "Esta sección no está disponible para tu rol" and no request is sent.
- ALLY and INSTITUTION are never offered in the role selector: they are assigned by linking the account to an ally or an institution.

### Routes

| Route | Roles (same as the API) | Purpose |
| --- | --- | --- |
| `/admin` | all staff | Overview (`defaultedLoans`, `writtenOffLoans`, `pendingDisbursements`, integrations) |
| `/admin/personas` | SUPPORT, RISK, SUPERADMIN (role change: SUPERADMIN) | Accounts and internal roles |
| `/admin/pqr` | SUPPORT, LEGAL, COLLECTIONS, SUPERADMIN | PQR management |
| `/admin/auditoria` | LEGAL, RISK, SUPERADMIN | Audit log |
| `/admin/credito/solicitudes` | COMMERCIAL, RISK, FINANCE, LEGAL, SUPERADMIN (decision and eligibility: RISK, SUPERADMIN) | Applications: product, purpose, explained eligibility, instalment plan, signed promissory note, decision `{ decision, reason }` |
| `/admin/credito/productos` | RISK, FINANCE, SUPERADMIN | Credit product versions: create (inherits), activate, suspend |
| `/admin/credito/desembolsos` | RISK, FINANCE, SUPERADMIN (register/cancel: FINANCE, SUPERADMIN) | Disbursement queue |
| `/admin/credito/cartera` | RISK, FINANCE, COLLECTIONS, SUPERADMIN (write-off: FINANCE, SUPERADMIN) | Loans, arrears, write-off |
| `/admin/credito/tasa-legal` | LEGAL, RISK, SUPERADMIN | Usury rate |
| `/admin/catalogo/{categorias,arquetipos,planes}` | all staff read; write COMMERCIAL, RISK, SUPERADMIN (plans: COMMERCIAL, FINANCE, SUPERADMIN) | Categories (form-based config), archetypes (visual rule builder, versions, history), plans |
| `/admin/formalizacion/reglas`, `/admin/formalizacion/casos`, `/admin/formalizacion/casos/[id]` | LEGAL, FINANCE, SUPERADMIN | Tax rule versions and professional review queue |
| `/admin/matching/entidades[/id]`, `/admin/matching/productos[/id]`, `/admin/matching/productos/versiones/[versionId]` | RISK, COMMERCIAL, SUPERADMIN (write: RISK, SUPERADMIN; account links: SUPERADMIN) | Institutions, financial products, policy versions (state machine, rule builder, simulator, clone, history) |
| `/admin/matching/presentaciones[/id]` | COMMERCIAL, RISK, SUPERADMIN | Presentation queue, present, decide |
| `/admin/matching/ejecuciones[/id]` | RISK, SUPERADMIN | Match runs and reproducibility check |
| `/admin/matching/aliados[/id]` | SUPERADMIN | Allies, linked accounts, referrals |
| `/admin/analitica/{cosechas,efectividad,backtesting[/id]}` | RISK, FINANCE, SUPERADMIN | Vintages (with frozen snapshots), effectiveness, backtesting |
| `/entidad`, `/entidad/presentaciones/[id]` | INSTITUTION | Institution portal (`/api/institution`); handles `institution_link_required` |
| `/aliado` | ALLY | Ally portal (`/api/ally`); aggregated funnel with the suppression notice, handles `ally_link_required` |

### Code layout

- `apps/web/src/lib/admin/`: `http.ts` (`problemOf` normalises every API error to code + message + issues, `download`, `query`), `format.ts` (COP, percentages, Bogotá dates), `labels.ts` (Spanish labels and tones of every status code), `nav.ts`, the response types of each domain (`credit-types.ts`, `catalog-types.ts`, `formalization-types.ts`, `matching-types.ts`, `analytics-types.ts`) and `credit-plan.ts` (display copy of the geometric-gradient calculator, covered by `credit-plan.test.ts`).
- `apps/web/src/components/admin/`: `ui.tsx` (tables, pager, modal, confirmation with mandatory reason, fields, `useLoad`/`useAction`), `charts.tsx` (own SVG charts: lines with crosshair, grouped columns, bars, segmented bar, single-hue heat cells), `archetype-rules.tsx` (archetype rule builder), `policy-rule-form.tsx` and `policy-simulator.tsx` (parametrised from `GET /admin/matching/catalog`), `matching.tsx` (explanation view, decision form, linked accounts), `partner-forms.tsx`, `people.tsx` (in-memory account directory to show names next to `userId`), `plan-table.tsx`, `portal.tsx`.
- `e2e/consolas-acceso.spec.ts`: access tests that need no API (the session is mocked on `GET /api/auth/me`).

### Flows worth knowing

- Approving an application never sends a rate: the API uses the rate of the signed product. `legal_rate_required`, `rate_exceeds_legal_limit` and `rate_exceeds_signed_note` are shown with their own text (`lib/admin/http.ts`).
- A credit that pays out money (`TRANSFER`) becomes a loan only when finance registers the real transfer in `/admin/credito/desembolsos`.
- A policy version is edited only in `BORRADOR`; the buttons shown are exactly `allowedTransitions`; returning to draft and suspending require a note; approval by the same person fails with `independent_approval_required` while another RISK/SUPERADMIN account exists.
- Irreversible actions (decision, write-off, activation, disbursement, institution decision) go through a confirmation dialog.
