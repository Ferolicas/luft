# LUFT project memory

## Stack

- Monorepo with pnpm workspaces and Turborepo.
- `apps/web`: Next.js 16 App Router PWA, React 19, TypeScript, custom CSS.
- `apps/api`: NestJS 11 REST API, WebSockets, BullMQ, Prisma 7.
- `services/scoring`: FastAPI explainable rules/model service.
- PostgreSQL 16 with isolated `identity`, `luft`, `startif`, `audit`, and `scoring` schemas.
- Redis database 5, with every key prefixed `luft:`.
- Production runs under PM2 behind Nginx on the SSH host alias `restaurar`.

## Commands

- `pnpm install`: install the workspace.
- `pnpm db:generate`: regenerate every Prisma client.
- `pnpm build`: build web and API.
- `pnpm lint`: lint the workspace.
- `pnpm test`: unit tests.
- `pnpm test:e2e`: browser journeys.
- `bash deploy.sh`: production deploy; only run on `/var/www/luft`.

## Hard rules

- Never commit `.env`, `.env.migrate`, personal data, credentials, generated KYC media, or signed documents.
- Keep StartIF data out of the LUFT schema. Cross-domain exchange happens through explicit services and recorded consent.
- Do not fake successful third-party calls. When credentials are absent, return `configuration_required` and preserve the pending workflow.
- Financial amounts use integer COP values; rates use Decimal, never floating-point persistence.
- Every mutation affecting consent, identity, credit, payments, reports, roles, or contracts emits an immutable audit event.
- `GET /api/health` must stay unauthenticated and return status for web, DB, Redis, queues, and integrations without revealing secrets.
- Keep `docs/PROJECT-MAP.md` updated when routes, modules, models, integrations, or flows change.
