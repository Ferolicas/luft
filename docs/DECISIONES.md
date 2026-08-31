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

## Decisiones pendientes del propietario

- Identidad legal exacta de LUFT/StartIF, NIT, domicilio y correos oficiales de privacidad/PQR.
- Confirmación de si el servicio se limitará jurídicamente a Colombia.
- Credenciales, contratos, endpoints privados y ambientes otorgados por cada proveedor.
