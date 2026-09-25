#!/usr/bin/env bash
# Repository bootstrap for DGK Clock. Runs after checkout; must be idempotent and terminate.
# System packages (Docker, Supabase CLI, fuse-overlayfs) live in the base snapshot, not here.
set -euo pipefail

cd "$(dirname "$0")/.."

# Install Node dependencies from the lockfile.
npm ci

# Generate Next.js route types so `npm run typecheck` (next typegen && tsc --noEmit) is ready.
npx --no-install next typegen || true

echo "install.sh: done"
