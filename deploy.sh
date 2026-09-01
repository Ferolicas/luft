#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/luft"
cd "$APP_DIR"

git fetch origin main
git reset --hard origin/main

export NVM_DIR="/root/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true
corepack enable
corepack prepare pnpm@11.5.2 --activate

set -a
. "$APP_DIR/.env"
. "$APP_DIR/.env.migrate"
set +a

pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm build

python3 -m venv services/scoring/.venv
services/scoring/.venv/bin/pip install --disable-pip-version-check -r services/scoring/requirements.txt

mkdir -p "$PRIVATE_STORAGE_PATH"
chmod 700 "$PRIVATE_STORAGE_PATH"

install -o root -g root -m 700 scripts/backup-production.sh /usr/local/sbin/luft-backup
install -o root -g root -m 600 deploy/luft-backup.cron /etc/cron.d/luft-backup

pm2 startOrReload ecosystem.config.cjs --update-env
# PM2's startOrReload can retain values that already existed in a process.
# Force API and worker environment refreshes so newly installed provider
# credentials and operational flags take effect on every deployment.
pm2 restart luft-api luft-worker --update-env
pm2 save

for attempt in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1:4003/api/health >/dev/null && curl -fsS http://127.0.0.1:4002/ >/dev/null; then
    echo "Deploy LUFT OK"
    exit 0
  fi
  sleep 3
done

pm2 logs luft-api --lines 80 --nostream || true
pm2 logs luft-web --lines 80 --nostream || true
exit 1
