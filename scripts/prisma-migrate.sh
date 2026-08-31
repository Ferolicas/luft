#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL is required for migrations}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/apps/api"

for domain in identity luft startif audit scoring; do
  PRISMA_DOMAIN="$domain" pnpm exec prisma migrate deploy \
    --schema "prisma/${domain}/schema.prisma" \
    --config "prisma/${domain}/prisma.config.ts"
done

