# LUFT project map

## Runtime

| Component | Path | Port | Purpose |
| --- | --- | ---: | --- |
| PWA | `apps/web` | 4002 | User and staff interface |
| API | `apps/api` | 4003 | REST, auth, WebSockets and webhooks |
| Worker | `apps/api/src/worker.ts` | none | Scheduled and queued jobs |
| Scoring | `services/scoring` | 4004 | Versioned profile/scoring decisions |

Nginx serves `luft.restaurar.co`, routes `/api/*` and `/socket.io/*` to NestJS, and all other traffic to Next.js.

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

## External adapters

- Mercado Pago Orders API + signed webhook.
- Truora Digital Identity web flow + webhook/result lookup.
- Experian DataCrédito and TransUnion/CIFIN contract-gated adapters.
- Resend email, Evolution WhatsApp, configurable SMS, Web Push and signed n8n webhooks.

Adapters fail closed with `configuration_required` until real credentials and private vendor specifications are installed.

## Identity and access

- Opaque, signed, HTTP-only session cookie with Argon2id passwords.
- Registration and password recovery through OTP; passkeys through WebAuthn.
- Password change revokes every other active session.
- Staff routes enforce `COMMERCIAL`, `LEGAL`, `SUPPORT`, `COLLECTIONS`, `RISK`, `FINANCE`, or `SUPERADMIN` at the API layer.
- Socket.IO connections authenticate the same session and join user/role rooms through Redis.

## Capacity baseline

- Two clustered Next.js processes and two clustered NestJS processes.
- One BullMQ worker process; scoring uses two Uvicorn workers.
- Redis adapter shares Socket.IO rooms between API workers.
- Database pools are capped per schema/process (`DATABASE_POOL_MAX=3`) to protect the shared PostgreSQL server.
- The initial operating target is 1,500 registered users. Re-test concurrency, database saturation and p95 latency before increasing that target or enabling high-volume campaigns.
