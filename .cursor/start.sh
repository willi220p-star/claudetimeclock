#!/usr/bin/env bash
# Per-boot startup for DGK Clock: Docker daemon + local Supabase stack + .env.local.
# Idempotent and restart-tolerant: safe to run on every boot. It reaches a clear
# success/failure and returns; the dev server itself runs as a terminal.
set -euo pipefail

cd "$(dirname "$0")/.."

log() { echo "start.sh: $*"; }

# 1. Docker daemon. No systemd in the VM, so start dockerd manually with the
#    nested-container-friendly fuse-overlayfs storage driver (overlay2 is unavailable
#    on the overlay rootfs). iptables (legacy) stays enabled so Docker's embedded DNS
#    works and Supabase containers can reach each other.
if ! docker info >/dev/null 2>&1; then
  log "starting dockerd"
  sudo update-alternatives --set iptables /usr/sbin/iptables-legacy >/dev/null 2>&1 || true
  sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy >/dev/null 2>&1 || true
  sudo bash -c 'nohup dockerd --storage-driver=fuse-overlayfs >/tmp/dockerd.log 2>&1 &'
  for i in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  docker info >/dev/null 2>&1 || { log "dockerd failed to start"; tail -20 /tmp/dockerd.log || true; exit 1; }
fi
log "docker ready"

# 2. Local Supabase stack (Postgres, Auth, Storage, Realtime, Edge). Idempotent: a
#    no-op when already running.
supabase start

# 3. Guarantee the schema + seed are loaded. Reset only when the seed is missing so
#    reboots stay fast and don't clobber local data unnecessarily.
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
if ! docker exec supabase_db_claudetimeclock psql -U postgres -d postgres -tAc \
      "select to_regclass('public.daymark_profiles') is not null and (select count(*) from daymark_profiles) > 0" 2>/dev/null | grep -q t; then
  log "seeding database (supabase db reset)"
  supabase db reset
fi

# 4. Point the app at the local stack. The publishable key is read from the running
#    stack so it always matches (never the live project in .env.example).
PUBLISHABLE_KEY="$(supabase status -o env 2>/dev/null | sed -n 's/^PUBLISHABLE_KEY="\(.*\)"$/\1/p')"
API_URL="$(supabase status -o env 2>/dev/null | sed -n 's/^API_URL="\(.*\)"$/\1/p')"
cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=${API_URL:-http://127.0.0.1:54321}
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}
EOF
log ".env.local written (SUPABASE_URL=${API_URL:-http://127.0.0.1:54321})"

log "done"
