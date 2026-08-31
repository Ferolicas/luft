#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/luft"
BACKUP_DIR="/var/backups/luft"

set -a
. "$APP_DIR/.env.migrate"
set +a

install -d -o root -g root -m 700 "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$BACKUP_DIR/.luft-$stamp.dump.tmp"
destination="$BACKUP_DIR/luft-$stamp.dump"

cleanup() {
  rm -f "$temporary"
}
trap cleanup EXIT

pg_dump --format=custom --compress=9 --file="$temporary" "$DATABASE_ADMIN_URL"
pg_restore --list "$temporary" >/dev/null
mv "$temporary" "$destination"
chmod 600 "$destination"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'luft-*.dump' -mtime +14 -delete

trap - EXIT
echo "LUFT backup verified: $destination"
