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
