#!/usr/bin/env bash
# luft-activar-dominio — pasa LUFT a luft.com.co en cuanto el dominio apunte a
# este servidor. Lo ejecuta un temporizador de systemd cada 15 minutos y se
# desactiva solo al terminar. Es seguro repetirlo: cada paso comprueba su estado.
#
#   1. Comprueba que http://luft.com.co llega a este servidor (con o sin el
#      proxy de Cloudflare) leyendo una marca que solo existe aquí.
#   2. Emite el certificado de luft.com.co (y www si también apunta).
#   3. Instala el sitio definitivo de Nginx; luft.restaurar.co redirige al nuevo.
#   4. Actualiza .env (APP_URL, llaves de acceso, remitente de correo) y redespliega.
#   5. Verifica https://luft.com.co/api/health y se desactiva.
set -euo pipefail

DOMAIN="luft.com.co"
OLD_DOMAIN="luft.restaurar.co"
APP_DIR="/var/www/luft"
WEBROOT="/var/www/luft-acme"
STATE_DIR="/var/lib/luft-dominio"
LOG() { echo "[$(date -u +%FT%TZ)] $*"; }

mkdir -p "$STATE_DIR" "$WEBROOT/.well-known/luft" "$WEBROOT/.well-known/acme-challenge"
if [ -f "$STATE_DIR/activado" ]; then LOG "ya activado"; exit 0; fi
[ -s "$STATE_DIR/marca" ] || head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' > "$STATE_DIR/marca"
cp "$STATE_DIR/marca" "$WEBROOT/.well-known/luft/check"

llega() { [ "$(curl -fsSL -m 15 "http://$1/.well-known/luft/check" 2>/dev/null || true)" = "$(cat "$STATE_DIR/marca")" ]; }

if ! llega "$DOMAIN"; then LOG "$DOMAIN todavía no apunta a este servidor"; exit 0; fi
LOG "$DOMAIN ya llega a este servidor"

# 2. Certificado
if [ ! -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  nombres=(-d "$DOMAIN")
  if llega "www.$DOMAIN"; then nombres+=(-d "www.$DOMAIN"); fi
  certbot certonly --webroot -w "$WEBROOT" "${nombres[@]}" --cert-name "$DOMAIN" \
    --non-interactive --agree-tos --keep-until-expiring \
    --deploy-hook "systemctl reload nginx"
  LOG "certificado emitido para: ${nombres[*]}"
fi

# 3. Nginx: se instala el candidato y solo se conserva si la configuración completa es válida.
SITES=/etc/nginx/sites-available; ENABLED=/etc/nginx/sites-enabled
install -m 644 "$APP_DIR/deploy/proxy-luft.inc" /etc/nginx/snippets/proxy-luft.inc
install -m 644 "$APP_DIR/deploy/nginx-luft.com.co.conf" "$SITES/luft.com.co.activo"
anterior_nuevo="$(readlink -f "$ENABLED/luft.com.co" 2>/dev/null || true)"
anterior_viejo="$(readlink -f "$ENABLED/$OLD_DOMAIN" 2>/dev/null || true)"
ln -sfn "$SITES/luft.com.co.activo" "$ENABLED/luft.com.co"
rm -f "$ENABLED/$OLD_DOMAIN"
if ! nginx -t 2>"$STATE_DIR/nginx-test.log"; then
  LOG "la configuración nueva de Nginx no es válida; se restaura la anterior"; cat "$STATE_DIR/nginx-test.log"
  [ -n "$anterior_nuevo" ] && ln -sfn "$anterior_nuevo" "$ENABLED/luft.com.co" || rm -f "$ENABLED/luft.com.co"
  [ -n "$anterior_viejo" ] && ln -sfn "$anterior_viejo" "$ENABLED/$OLD_DOMAIN"
  exit 1
fi
systemctl reload nginx
LOG "Nginx sirve $DOMAIN con su certificado"

# 4. Configuración de la app y redespliegue
ENV="$APP_DIR/.env"
poner() { if grep -q "^$1=" "$ENV"; then sed -i "s|^$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }
poner APP_URL "https://$DOMAIN"
poner WEBAUTHN_RP_ID "$DOMAIN"
poner WEBAUTHN_ORIGIN "https://$DOMAIN"
poner EMAIL_FROM "\"LUFT <hola@$DOMAIN>\""
poner VAPID_SUBJECT "mailto:soporte@$DOMAIN"
bash "$APP_DIR/deploy.sh"

# El dominio de correo se verifica en Resend en cuanto existan sus registros DNS.
RESEND_KEY="$(grep -E '^RESEND_API_KEY=' "$ENV" | cut -d= -f2- | tr -d '"')"
if [ -n "$RESEND_KEY" ]; then
  id="$(curl -fsS -m 20 https://api.resend.com/domains -H "Authorization: Bearer $RESEND_KEY" | python3 -c "import sys,json; print(next((d['id'] for d in json.load(sys.stdin).get('data',[]) if d.get('name')=='$DOMAIN'),''))" 2>/dev/null || true)"
  [ -n "$id" ] && curl -fsS -m 20 -X POST "https://api.resend.com/domains/$id/verify" -H "Authorization: Bearer $RESEND_KEY" >/dev/null 2>&1 && LOG "verificación del dominio de correo solicitada a Resend" || true
fi

# 5. Verificación
for intento in 1 2 3 4 5 6; do
  if curl -fsS -m 15 "https://$DOMAIN/api/health" | grep -q '"status":"ok"'; then
    date -u +%FT%TZ > "$STATE_DIR/activado"
    systemctl disable --now luft-dominio.timer >/dev/null 2>&1 || true
    LOG "LUFT quedó activo en https://$DOMAIN"
    exit 0
  fi
  sleep 5
done
LOG "https://$DOMAIN/api/health no respondió bien; se reintentará"
exit 1
