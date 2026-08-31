# Automatizaciones LUFT

Las automatizaciones críticas no dependen únicamente de n8n: el worker de BullMQ agenda vencimientos diarios, reporte mensual, reintentos e idempotencia. n8n recibe eventos firmados para coordinación comercial y tareas humanas.

Webhooks preparados:

- `luft-credit-review`: abre la tarea de análisis para riesgo.
- `luft-payment-reminder`: coordina recordatorios por etapa.
- `luft-notifications`: registra y distribuye novedades transaccionales.

Hasta cargar las credenciales de n8n, Resend, Evolution y SMS, cada canal queda en `configuration_required`; nunca se marca una comunicación como enviada sin confirmación real del proveedor.
