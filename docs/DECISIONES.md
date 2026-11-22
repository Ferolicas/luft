# Decisiones aprobadas de LUFT

Fecha de consolidación: 2026-09-01. Alcance aprobado por el propietario al indicar “adelante”.

## Producto y público

- Mercado inicial: Colombia.
- Público principal: jóvenes de 18 a 25 años, especialmente sin historial crediticio.
- LUFT es la experiencia de diagnóstico, educación, metas y oportunidades; StartIF es el dominio financiero separado dentro de la misma PWA.
- La aplicación es mobile-first, en español y sigue el sistema visual suministrado en `LUFTDESIGN`.
- El registro incluye nombre, documento y fecha de expedición, teléfono, correo, dirección, usuario, contraseña y estrato socioeconómico del 1 al 6.

## Identidad y permisos

- Autenticación propia por persona, sin cuentas compartidas.
- Contraseñas Argon2id, sesiones opacas firmadas, OTP, recuperación, passkeys WebAuthn y revocación de sesiones.
- Roles: usuario, comercial, legal, soporte, cartera, riesgo, finanzas y superadministración.
- Identidad, LUFT, StartIF, auditoría y scoring usan esquemas y credenciales PostgreSQL separados.

## Crédito y proveedores

- Referencia de producto: aproximadamente COP 500.000, seis meses y cuota decreciente; la tasa nunca puede superar la tasa de usura vigente verificada por operación.
- Pagos PSE mediante Mercado Pago Orders y confirmación por webhook autenticado más consulta autoritativa al proveedor.
- KYC mediante Truora. Consulta y reporte mediante adaptadores contractuales para DataCrédito/Experian y TransUnion/CIFIN.
- Ningún proveedor externo simula éxito. Sin credenciales, la operación queda en `configuration_required`.
- El reporte final y la segunda consulta de score se programan cuando queda confirmada la última cuota.
- Los soportes financieros usan provisionalmente una retención configurable de diez años, alineada con el artículo 28 de la Ley 962 de 2005; la tabla definitiva requiere validación jurídica antes del alta pública.

## Operación e infraestructura

- Objetivo inicial: 1.500 usuarios registrados; se repetirá la prueba de carga antes de superar ese nivel o lanzar campañas de alta concurrencia.
- Despliegue en el VPS accesible por alias SSH `restaurar`, con PM2, Nginx, PostgreSQL, Redis y copias diarias.
- Dominio público: `luft.restaurar.co`.
- Repositorio canónico público: `Ferolicas/luft`, rama `main`, con verificación y despliegue continuos.

## LUFT + STARTIF V2 (2026-11-22)

Instrucciones del propietario del 20 de noviembre de 2026 y entrega "LUFT_STARTIF_V2_FINAL_DESARROLLO".

- Amortización: gradiente geométrico decreciente. Crédito constructor 1 ("Servicio LUFT") fijo en $600.000, 6 cuotas mensuales, 1 % mensual vencido y reducción del 20 % mensual (cuotas 167.320 · 133.856 · 107.085 · 85.668 · 68.534 · 54.827). La persona no elige monto ni plazo; las condiciones viven en un producto versionado y se cambian desde administración.
- Las solicitudes del flujo anterior que no habían firmado pagaré pasaron a esas condiciones (lo cotizado antes queda guardado).
- Dos créditos constructores: el segundo ("Consolidación") solo se origina con comportamiento del primero, finalidad válida, capacidad disponible y sin sobreendeudamiento, y lo decide Riesgo. Nunca se aprueba para subir el puntaje.
- Categoría (Joven · LUFT Impulso, Adulto · LUFT Avanza, Familia · LUFT Juntos) y arquetipo son niveles distintos; el arquetipo es dinámico, versionado y explicado. Ambos se administran sin desplegar código.
- Planes Individual, Dúo y Familia sobre un precio base de $600.000 por identidad. El paquete familiar no fusiona expedientes: cada integrante acepta sus propios términos y decide qué comparte.
- La XP se gana solo con cursos; pagos y perfil dan insignias.
- La formalización tributaria es una orientación con reglas versionadas por año y revisión profesional; la presentación ante la DIAN se registra, no se automatiza.
- Matching explicable y reproducible con políticas de entidades versionadas; la persona autoriza expresamente cada presentación. Ningún texto promete aprobación ni aumento de puntaje.
- Roles nuevos: entidad financiera y aliado, cada uno con su portal y solo con vínculo.
- `/app/renta` lleva al asistente de formalización, que cubre la preparación guiada.

## Decisiones pendientes del propietario

- Identidad legal exacta de LUFT/StartIF, NIT, domicilio y correos oficiales de privacidad/PQR.
- Confirmación de si el servicio se limitará jurídicamente a Colombia.
- Credenciales, contratos, endpoints privados y ambientes otorgados por cada proveedor.
- Crédito 2: monto o rango, plazo, tasa y tope de endeudamiento (está en borrador hasta definirlos).
- Descuento de los planes Dúo y Familia (sembrado en 0 %).
- Días de mora para pasar un préstamo a incumplimiento (30 por defecto) y vigencia de evidencias (180 días buró, 90 documentos).
- Pantalla del paso 2 del flujo de crédito ("Tu plan LUFT") y pantallas nuevas de "DEV READY": pendientes de contrastar con Figma.
