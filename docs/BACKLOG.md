# Backlog de salida a producción

## P0 — imprescindible

- [x] Monorepo, frontend PWA, API, worker, scoring, PostgreSQL y Redis.
- [x] Autenticación propia, perfiles, roles, paneles y cierre de cuenta.
- [x] Viajes LUFT/StartIF, consentimiento por finalidad, KYC, firma, crédito, pagos, PQR y reporte.
- [x] WebSockets multiinstancia y automatizaciones BullMQ/n8n.
- [x] Adaptadores reales que fallan de forma cerrada cuando falta configuración.
- [x] CI/CD, health checks, migraciones, backups y rollback por Git.
- [ ] Crear el registro DNS A de `luft.restaurar.co` hacia el VPS y emitir SSL. Bloqueado por acceso al proveedor DNS.
- [ ] Aprobar y publicar privacidad, tratamiento de datos, términos y documentos contractuales. Bloqueado por identidad legal pendiente.
- [ ] Instalar credenciales reales y completar certificación/sandbox de Mercado Pago, Truora, bureaus y comunicaciones.

## P1 — activación controlada

- [ ] Validar el contenido pedagógico definitivo con responsable experto.
- [ ] Ejecutar pruebas end-to-end en los sandboxes de cada proveedor.
- [ ] Configurar y verificar dominio remitente de correo, WhatsApp y SMS.
- [ ] Ejecutar piloto interno, revisar PQR, trazabilidad y operación por rol.
- [ ] Realizar prueba de concurrencia sobre una réplica o ventana controlada y fijar SLO de p95/errores.

## P2 — crecimiento

- [ ] Calibrar el modelo de scoring con datos autorizados y monitorear sesgo/deriva.
- [ ] Habilitar oportunidades institucionales únicamente con convenios vigentes.
- [ ] Evaluar réplica PostgreSQL, worker adicional y ampliación del VPS con métricas reales.
