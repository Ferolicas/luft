# Integration activation runbook

All adapters are present but disabled by default. Add values in the server-only `.env`, enable one provider at a time, run its sandbox/certification suite, and only then activate production mode. Never place private keys in `NEXT_PUBLIC_*` variables or GitHub.

## Mercado Pago / PSE

Official references: [PSE through Orders API](https://www.mercadopago.com.co/developers/es/docs/checkout-api-orders/payment-integration/pse), [Orders integration model](https://www.mercadopago.com.co/developers/es/docs/checkout-api-orders/integration-model), and [signed webhooks](https://www.mercadopago.com.co/developers/es/docs/your-integrations/notifications/webhooks).

- Set `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_PUBLIC_KEY`, and `MERCADOPAGO_WEBHOOK_SECRET`.
- Configure the production webhook as `https://luft.com.co/api/webhooks/mercadopago` for the Orders event.
- The API validates `x-signature`/`x-request-id`, always retrieves the notified order or payment from Mercado Pago, verifies its amount, and claims the state change atomically so concurrent or replayed webhooks cannot credit a quota twice.
- Reused payment attempts return the still-active PSE redirect for 30 minutes. Late duplicate approvals and refunds reopen/reconcile the financial state and emit an operational automation instead of silently changing balances.
- Test approved, rejected, cancelled, duplicate, late, and invalid-signature notifications before setting `MERCADOPAGO_ENABLED=true`.

## Truora Digital Identity

Official references: [developer portal](https://dev.truora.com/), [API integration guide](https://dev.truora.com/guides/api_integration_guide/), and [web integration token guide](https://dev.truora.com/guides/web_integration_token/).

- Set `TRUORA_API_KEY`, `TRUORA_ACCOUNT_ID`, `TRUORA_FLOW_ID`, and `TRUORA_WEBHOOK_SECRET`.
- Confirm the contracted start endpoint in `TRUORA_START_ENDPOINT`; provider product versions can use different process/token paths.
- Configure callbacks to `https://luft.com.co/api/webhooks/truora` and certify the exact signature scheme supplied for the account.
- Keep `TRUORA_ENABLED=false` until the final contracted payload and webhook sample have passed tests.

## DataCrédito Experian and TransUnion/CIFIN

Official entry points: [Experian Global Developer](https://developer.experian.com/) and [TransUnion Colombia business products](https://www.transunion.co/empresas).

The Colombian query and monthly reporting specifications are contract-gated. LUFT therefore exposes configurable base/query/tradeline endpoints and OAuth client credentials without guessing private paths. Load the exact specifications delivered by each account executive into `*_BASE_URL`, `*_REPORT_ENDPOINT`, and `*_TRADELINE_ENDPOINT`, then certify consent evidence, consultation purpose, monthly positive/negative reporting, corrections and final score inquiry before enabling either provider.

## Communications and automations

- Email uses the official [Resend Node.js SDK flow](https://resend.com/docs/send-with-nodejs); verify `luft.com.co`, then set `RESEND_API_KEY` and `EMAIL_FROM`.
- WhatsApp uses the holding's Evolution API and `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, and `EVOLUTION_INSTANCE`.
- SMS is provider-neutral until commercial selection; map the final HTTPS endpoint and bearer key to `SMS_BASE_URL`/`SMS_API_KEY`.
- n8n receives HMAC-SHA256 signed events. Import the JSON files in `automations/n8n`, set the same `N8N_WEBHOOK_SECRET`, verify each workflow, and then set `N8N_ENABLED=true`.
- Web Push is first-party and ships with locally generated VAPID keys stored only in the private server environment.

## Open Finance

Closed until a regulated provider is contracted. The adapter is provider-neutral (OAuth client credentials plus a configurable consent endpoint) and must be adjusted to the final vendor specification.

- Set `OPENFINANCE_BASE_URL`, `OPENFINANCE_CLIENT_ID`, `OPENFINANCE_CLIENT_SECRET`, `OPENFINANCE_WEBHOOK_SECRET` and `OPENFINANCE_CONSENT_ENDPOINT`; `OPENFINANCE_CONSENT_DAYS` defaults to 90.
- Configure the provider callback as `https://luft.com.co/api/webhooks/open-finance` (HMAC signature in `x-openfinance-signature`).
- `OPENFINANCE_ENABLED=true` without every credential stops the API at boot on purpose: there is no partially working mode.
- LUFT never asks for banking passwords. Each connection records its own consent (scope, expiry, revocation); revoking the `OPEN_FINANCE` consent revokes the connections.

## Tax filing (DIAN) and document extraction

There is no contracted channel to file returns or to extract data from an uploaded return. The formalization flow keeps the case, supporting documents and professional review inside LUFT; filing is recorded by staff (form number and date) after it is done outside the platform, and both automated steps answer `configuration_required`.

## Activation gate

For every provider, keep evidence of sandbox approval, webhook replay/idempotency, credential rotation, timeout/retry behavior, data-retention terms, processor/subprocessor agreement, incident contact, and production rollback before switching its `*_ENABLED` flag.
