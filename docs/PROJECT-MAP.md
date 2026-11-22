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
