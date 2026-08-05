#!/usr/bin/env bash
# scripts/regen-lockfile.sh
#
# Regenerate electron-app/package-lock.json OUTSIDE the pnpm workspace so
# that npm does not see the parent node_modules/.pnpm store and write pnpm
# store paths into the lockfile.
#
# Run from the repository root:
#   bash scripts/regen-lockfile.sh
#
# Requirements: Node.js + npm on PATH (no pnpm needed).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON_APP="$REPO_ROOT/electron-app"
WORK_DIR="$(mktemp -d /tmp/regen-lockfile-XXXXXX)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "==> Working directory: $WORK_DIR"

# ── 1. Copy package.json to a clean directory outside the pnpm workspace ────
cp "$ELECTRON_APP/package.json" "$WORK_DIR/package.json"

# ── 2. Generate the lockfile with npm (no pnpm store in sight) ──────────────
echo "==> Running npm install --ignore-scripts (this may take a minute)…"
cd "$WORK_DIR"
npm install --ignore-scripts --prefer-offline 2>&1

# ── 3. Sanity-check: no pnpm store references should appear ─────────────────
echo "==> Verifying the lockfile contains no pnpm store references…"
count=$(grep -c 'node_modules/.pnpm' "$WORK_DIR/package-lock.json" || true)
if [ "$count" -gt 0 ]; then
  echo "ERROR: $count pnpm store reference(s) found in the generated lockfile." >&2
  echo "This should not happen when running outside the workspace." >&2
  echo "Check that no parent pnpm store is visible from $WORK_DIR." >&2
  exit 1
fi
echo "✓ Lockfile is clean ($count pnpm store references)"

# ── 4. Verify with npm ci (simulates what CI does) ──────────────────────────
echo "==> Verifying with npm ci --ignore-scripts…"
VERIFY_DIR="$(mktemp -d /tmp/regen-verify-XXXXXX)"
trap 'rm -rf "$WORK_DIR" "$VERIFY_DIR"' EXIT
cp "$WORK_DIR/package.json" "$VERIFY_DIR/package.json"
cp "$WORK_DIR/package-lock.json" "$VERIFY_DIR/package-lock.json"
cd "$VERIFY_DIR"
npm ci --ignore-scripts 2>&1

PKG_COUNT=$(find "$VERIFY_DIR/node_modules" -maxdepth 1 -mindepth 1 -type d | wc -l)
echo "✓ npm ci resolved $PKG_COUNT top-level packages"

if [ "$PKG_COUNT" -lt 100 ]; then
  echo "WARNING: only $PKG_COUNT packages resolved — expected ~500+." >&2
  echo "Something may be wrong with the lockfile. Aborting." >&2
  exit 1
fi

# ── 5. Copy the verified lockfile back ──────────────────────────────────────
cp "$WORK_DIR/package-lock.json" "$ELECTRON_APP/package-lock.json"
echo ""
echo "✓ electron-app/package-lock.json updated successfully."
echo ""
echo "Next steps:"
echo "  git diff electron-app/package-lock.json   # review the changes"
echo "  git add electron-app/package-lock.json"
echo "  git commit -m 'chore: regenerate electron-app lockfile'"
