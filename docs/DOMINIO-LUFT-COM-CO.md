# Paso a luft.com.co

LUFT funciona hoy en `luft.restaurar.co`. El servidor ya está preparado para pasar a `luft.com.co` sin intervención: un temporizador (`luft-dominio.timer`, cada 15 minutos) ejecuta `/usr/local/sbin/luft-activar-dominio`, que al detectar que el dominio llega al servidor emite el certificado, instala el sitio definitivo de Nginx, actualiza `.env`, redespliega y se desactiva. El registro queda en `/var/log/luft-dominio.log`.

## Lo único que hay que hacer en Cloudflare

Zona `luft.com.co` (cuando los NS ya apunten a la cuenta):

| Tipo | Nombre | Valor | Proxy |
| --- | --- | --- | --- |
| A | `luft.com.co` (`@`) | `82.223.109.156` | **Solo DNS** (nube gris) para la primera activación |
| CNAME | `www` | `luft.com.co` | Solo DNS |

Después de la activación se puede encender el proxy naranja con SSL en modo **Full (strict)**. Con el proxy encendido desde el principio, el modo debe ser **Full** (no strict) hasta que exista el certificado.

Correo (Resend, dominio ya creado en la cuenta; región `us-east-1`):

| Tipo | Nombre | Valor | Prioridad |
| --- | --- | --- | --- |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDo3PRK1ABF+6O5VNPjERnuAFRmX77MIX4yyDnLtABjT6RUlupmssk1A5CrVtQoPaw4e4Acr55pUyYPeKP3t3K3L7ar2bUo3XFERe6DVT8M/5JbUd48aqQ2kgyf+qJ0Q1JUXLxa8EEi6XoDXP4FAWK9PWDf5/dbWYu7K/XU2cWJ5QIDAQAB` | — |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |

Los tres van en **Solo DNS**. El activador pide la verificación a Resend; hasta que el dominio quede verificado, los correos fallan con error del proveedor (no se simulan).

## Qué cambia al activarse

- `APP_URL`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `EMAIL_FROM` y `VAPID_SUBJECT` pasan a `luft.com.co`.
- `luft.restaurar.co` redirige al dominio nuevo (los webhooks bajo `/api/webhooks/` siguen respondiendo en el anterior).
- Las sesiones abiertas en el dominio anterior no se conservan (la cookie es por dominio): hay que volver a entrar.
- Las llaves de acceso (passkeys) quedan ligadas al dominio en que se crearon: las registradas en `luft.restaurar.co` dejan de servir y se vuelven a registrar desde Perfil → Mi cuenta. La contraseña no cambia.
- Los webhooks de proveedores deben registrarse con `https://luft.com.co/api/webhooks/...`.

## Operación manual

- Forzar la comprobación: `systemctl start luft-dominio.service && tail -30 /var/log/luft-dominio.log`.
- Estado: `systemctl list-timers luft-dominio.timer`; marca de activación en `/var/lib/luft-dominio/activado`.
- Archivos: `deploy/activar-dominio.sh`, `deploy/nginx-luft.com.co.pre.conf` (antes), `deploy/nginx-luft.com.co.conf` (después), `deploy/proxy-luft.inc`, `deploy/luft-dominio.{service,timer}`.
