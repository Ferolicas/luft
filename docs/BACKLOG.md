# Backlog de salida a producción

## P0 — imprescindible

- [x] Monorepo, frontend PWA, API, worker, scoring, PostgreSQL y Redis.
- [x] Autenticación propia, perfiles, roles, paneles y cierre de cuenta.
- [x] Viajes LUFT/StartIF, consentimiento por finalidad, KYC, firma, crédito, pagos, PQR y reporte.
- [x] WebSockets multiinstancia y automatizaciones BullMQ/n8n.
- [x] Adaptadores reales que fallan de forma cerrada cuando falta configuración.
- [x] CI/CD, health checks, migraciones, backups y rollback por Git.
- [x] Dominio público `luft.com.co` con SSL (activo desde el 2026-11-23).
- [x] Privacidad y tratamiento de datos (política de Tureporte S.A.S. en restaurar.co/privacy) y Términos y Condiciones publicados. Los documentos contractuales del crédito siguen en los pendientes de abajo.
- [ ] Instalar credenciales reales y completar certificación/sandbox de Mercado Pago, Truora, bureaus y comunicaciones.

- [x] LUFT + STARTIF V2: producto de crédito versionado con gradiente geométrico, dos créditos constructores, categorías y arquetipos, paquete familiar, evidencias, formalización tributaria, tarjetas, proyectos de vida, matching con políticas, portales de entidad y aliado, cosechas y backtesting.
- [x] Tasa máxima legal vigente: se carga sola desde los datos abiertos de la Superfinanciera (consumo y ordinario, usura = 1,5 × interés bancario corriente). Crédito STARTIF → Tasa legal queda para correcciones.
- [ ] Contratar e instalar proveedor regulado de Open Finance.

## P1 — activación controlada

- [ ] Validar el contenido pedagógico definitivo con responsable experto.
- [ ] Ejecutar pruebas end-to-end en los sandboxes de cada proveedor.
- [x] SMS con LabsMobile (solo para validar el celular en el registro) y correo con Resend desde `luft.com.co` (códigos de firma, recuperación y verificación en dos pasos).
- [ ] WhatsApp: falta la instancia de Evolution.
- [x] Términos y Condiciones de LUFT como marca de Tureporte S.A.S. publicados en `/legal/terminos` (versión 2026-11-23, registrada en la bitácora de cada alta). Registro abierto al público (`REGISTRATION_MODE=public`).
- [ ] Datos de identificación que exige el artículo 50 de la Ley 1480 y que no están publicados: dirección de notificación judicial y teléfono de Tureporte S.A.S. Agregarlos a los términos cuando el propietario los entregue.
- [ ] El pagaré no nombra al acreedor: definir la razón social que otorga el crédito StartIF antes de la primera firma.
- [x] Comunicación previa al reporte negativo (Ley 1266, art. 12): dos avisos por correo en días distintos y reporte solo pasados 20 días calendario desde el último; la evidencia queda en `NegativeReportNotice`.
- [x] Cobranza dentro del horario de la Ley 2300 de 2023 (9:00 a. m. de Colombia, nunca domingos ni festivos), un solo canal y un contacto por persona al día.
- [x] Revisión mensual de que ningún crédito vigente supere la tasa máxima legal, con evidencia en la bitácora y aviso por correo si alguno la supera. El ajuste de la tasa de un crédito sigue siendo manual.
- [x] Autorización expresa de datos biométricos al solicitar crédito y sección propia en los términos. Enlace a la SIC y aviso de medición de visitas publicados.
- [ ] Validación de identidad con Didit: el conector está desplegado (`KYC_PROVIDER=didit`); falta cargar la API key, el Workflow ID y el Webhook secret, probarlo en Sandbox y recargar saldo para validaciones reales.
- [ ] Ejecutar piloto interno, revisar PQR, trazabilidad y operación por rol.
- [x] Prueba de concurrencia (2026-11-23, copia aislada con 100.000 cuentas): fluido hasta 1.500 usuarios simultáneos (panel p95 145 ms, 0,02 % de fallos); a 2.000 el panel sube a p95 2,4 s y PM2 reinicia la API por el tope de 768 MB. El límite son los 2 procesos de `luft-api`, no el servidor.

## P2 — crecimiento

- [ ] Calibrar el modelo de scoring con datos autorizados y monitorear sesgo/deriva.
- [ ] Habilitar oportunidades institucionales únicamente con convenios vigentes.
- [ ] Evaluar réplica PostgreSQL, worker adicional y ampliación del VPS con métricas reales.
