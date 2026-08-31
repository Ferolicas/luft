# LUFT + StartIF

LUFT is a Colombian financial education and credit-history platform. It combines a guided PWA, explainable profiling, a separate StartIF credit domain, real-time operations, own authentication and contract-ready adapters for identity, payments and credit bureaus.

## What is included

- Responsive Next.js 16 PWA matching the supplied LUFT visual direction.
- Own authentication with Argon2id, signed opaque sessions, OTP recovery and WebAuthn passkeys.
- Registration with identity, address and Colombian socioeconomic stratum.
- Financial diagnostic, archetypes, score history, goals, learning modules and streaks.
- StartIF application, separate consents, Truora KYC, forensic electronic signature and six decreasing installments.
- Mercado Pago Orders/PSE adapter with signed, idempotent webhooks.
- DataCrédito and TransUnion query/report adapters that stay closed until contractual endpoints and credentials are present.
- Role panels for commercial, legal, support, collections, risk, finance and superadministration.
- PQR, immutable chained audit log, BullMQ automations, web push, email, WhatsApp, SMS and signed n8n hooks.
- Socket.IO real-time updates backed by Redis.
- Isolated PostgreSQL schemas and credentials for identity, LUFT, StartIF, audit and scoring.

Third-party operations never simulate success. Missing credentials return `configuration_required` and retain the pending workflow.

## Local verification

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

The internal scoring service is tested separately:

```bash
python3 -m venv services/scoring/.venv
services/scoring/.venv/bin/pip install -r services/scoring/requirements.txt
PYTHONPATH=services/scoring services/scoring/.venv/bin/pytest services/scoring/tests
```

## Configuration

Copy `.env.example` to `.env`, load private values only outside Git, then run the five migrations with `pnpm db:migrate`. Integration setup and exact callback URLs live in [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). The architecture and ownership map live in [docs/PROJECT-MAP.md](docs/PROJECT-MAP.md).

## Production

Production is designed for `/var/www/luft` on the SSH alias `restaurar`, behind Nginx and PM2. Ports are 4002 (web), 4003 (API/WebSockets), and 4004 (internal scoring). `deploy.sh` installs locked dependencies, migrates, builds, updates PM2 and performs health checks.

Legal notices are intentionally not fabricated: the controller identity, NIT, address and privacy/PQR contact must be approved before those public documents are published.
