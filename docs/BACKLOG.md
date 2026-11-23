# Backlog de salida a producción

## P0 — imprescindible

- [x] Monorepo, frontend PWA, API, worker, scoring, PostgreSQL y Redis.
- [x] Autenticación propia, perfiles, roles, paneles y cierre de cuenta.
- [x] Viajes LUFT/StartIF, consentimiento por finalidad, KYC, firma, crédito, pagos, PQR y reporte.
- [x] WebSockets multiinstancia y automatizaciones BullMQ/n8n.
- [x] Adaptadores reales que fallan de forma cerrada cuando falta configuración.
- [x] CI/CD, health checks, migraciones, backups y rollback por Git.
- [x] Dominio público `luft.com.co` con SSL (activo desde el 2026-11-23).
- [ ] Aprobar y publicar privacidad, tratamiento de datos, términos y documentos contractuales. Bloqueado por identidad legal pendiente.
- [ ] Instalar credenciales reales y completar certificación/sandbox de Mercado Pago, Truora, bureaus y comunicaciones.

- [x] LUFT + STARTIF V2: producto de crédito versionado con gradiente geométrico, dos créditos constructores, categorías y arquetipos, paquete familiar, evidencias, formalización tributaria, tarjetas, proyectos de vida, matching con políticas, portales de entidad y aliado, cosechas y backtesting.
- [ ] Cargar la tasa máxima legal vigente (Crédito STARTIF → Tasa legal) antes de la primera aprobación.
- [ ] Contratar e instalar proveedor regulado de Open Finance.

## P1 — activación controlada

- [ ] Validar el contenido pedagógico definitivo con responsable experto.
- [ ] Ejecutar pruebas end-to-end en los sandboxes de cada proveedor.
- [ ] Configurar y verificar dominio remitente de correo, WhatsApp y SMS.
- [ ] Ejecutar piloto interno, revisar PQR, trazabilidad y operación por rol.
- [x] Prueba de concurrencia (2026-11-23, copia aislada con 100.000 cuentas): fluido hasta 1.500 usuarios simultáneos (panel p95 145 ms, 0,02 % de fallos); a 2.000 el panel sube a p95 2,4 s y PM2 reinicia la API por el tope de 768 MB. El límite son los 2 procesos de `luft-api`, no el servidor.

## P2 — crecimiento

- [ ] Calibrar el modelo de scoring con datos autorizados y monitorear sesgo/deriva.
- [ ] Habilitar oportunidades institucionales únicamente con convenios vigentes.
- [ ] Evaluar réplica PostgreSQL, worker adicional y ampliación del VPS con métricas reales.
