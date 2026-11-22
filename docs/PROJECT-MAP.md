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
