#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-components.sh
#
# Copies unchanged components from the web app source into this Electron app.
# Run this once from the electron-app/ directory before your first build:
#
#   bash setup-components.sh
#
# What gets copied:
#   • src/components/ui/       — shadcn/ui primitives (unchanged)
#   • src/components/detail/   — LocationDetail, EmptyState (unchanged)
#   • src/components/form/     — LocationForm (unchanged)
#   • src/components/import/   — CsvImport (unchanged)
#   • src/components/tree/     — LocationTree (unchanged)
#   NOT copied (fully rewritten for Electron — different interfaces/exports):
#   • src/components/tutorial/  — useTour.ts, TourOverlay.tsx
#   • src/components/layout/TopBar.tsx — Electron-only (Generate Links,
#     Backfill Addresses, Sync Now, update-progress ring, Dropbox status —
#     none of which exist in the web app version). This file was copied here
#     up through 8/17/2026, which silently overwrote every Electron-only
#     TopBar feature on every CI build without anyone noticing until a
#     released version was missing buttons that definitely existed in
#     electron-app/src/. Do not re-add this to the copy list — if TopBar
#     ever needs to re-sync with the web app, do it as a one-time manual
#     merge, not an automatic overwrite.
#   • src/components/layout/HelpMenu.tsx — genuinely unchanged, still copied below
#   • src/hooks/use-toast.ts   — unchanged
#   • src/hooks/use-mobile.tsx — unchanged
#   • src/lib/utils/           — csv.ts, fuzzy.ts (unchanged)
#   • src/index.css            — Tailwind base + design tokens
#
# Components already written for the Electron version (do NOT copy):
#   • src/pages/AdminDashboard.tsx  — rewritten (async store, conflict dialog)
#   • src/components/backup/        — rewritten (async handlers)
#   • src/components/settings/      — rewritten (IPC instead of API)
#   • src/hooks/use-dropbox-user.ts — rewritten (IPC instead of HTTP)
#   • src/lib/store.ts              — rewritten (Dropbox-backed async)
#   • src/lib/utils.ts              — already present (cn helper)
#   • src/App.tsx                   — already present
#   • src/main.tsx                  — already present
#   • src/index.html                — already present
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/../artifacts/napa-courier-admin/src"
DEST="$SCRIPT_DIR/src"

if [[ ! -d "$SRC" ]]; then
  echo "❌  Cannot find web app source at $SRC"
  echo "    Make sure you run this from the electron-app/ directory and that"
  echo "    artifacts/napa-courier-admin/ exists in the workspace root."
  exit 1
fi

echo "📂  Web app source : $SRC"
echo "📂  Electron dest  : $DEST"
echo ""

# ── Helper: copy a directory, creating destination if needed ─────────────────
copy_dir() {
  local from="$SRC/$1"
  local to="$DEST/$1"
  if [[ ! -d "$from" ]]; then
    echo "⚠   SKIP  $1  (directory not found in web app)"
    return
  fi
  mkdir -p "$to"
  cp -r "$from/." "$to/"
  echo "✓   COPY  $1/"
}

# ── Helper: copy a single file ────────────────────────────────────────────────
copy_file() {
  local from="$SRC/$1"
  local to="$DEST/$1"
  if [[ ! -f "$from" ]]; then
    echo "⚠   SKIP  $1  (file not found in web app)"
    return
  fi
  mkdir -p "$(dirname "$to")"
  cp "$from" "$to"
  echo "✓   COPY  $1"
}

# ─────────────────────────────────────────────────────────────────────────────
echo "── UI Primitives (shadcn/ui) ──────────────────────────────────────────"
copy_dir "components/ui"

echo ""
echo "── Page Components ────────────────────────────────────────────────────"
copy_dir "components/detail"
copy_dir "components/form"
copy_dir "components/import"
copy_dir "components/tree"
# NOTE: components/tutorial/ is intentionally NOT copied.
# Both useTour.ts and TourOverlay.tsx are fully rewritten for the Electron
# version — different prop interfaces, TOUR_STEPS export, IPC hooks.
# The versions already in electron-app/src/components/tutorial/ are correct.

echo ""
echo "── Layout (HelpMenu only — TopBar.tsx is Electron-only, not synced) ────"
copy_file "components/layout/HelpMenu.tsx"
# Note: We do NOT copy TopBar.tsx (diverged — see header comment above) or
# SettingsPanel.tsx — the Electron versions are already present.

echo ""
echo "── Hooks ──────────────────────────────────────────────────────────────"
copy_file "hooks/use-toast.ts"
copy_file "hooks/use-mobile.tsx"

echo ""
echo "── Lib Utilities ──────────────────────────────────────────────────────"
mkdir -p "$DEST/lib/utils"
copy_file "lib/utils/csv.ts"
copy_file "lib/utils/fuzzy.ts"

echo ""
echo "── Styles ─────────────────────────────────────────────────────────────"
copy_file "index.css"

echo ""
echo "────────────────────────────────────────────────────────────────────────"
echo "✅  Done! Component files are in src/."
echo ""
echo "Next steps:"
echo "  1. Create a .env file from .env.example and fill in your DROPBOX_APP_KEY"
echo "  2. pnpm install --frozen-lockfile  (run from the repo root)"
echo "  3. pnpm run build && pnpm run package"
echo "  4. Installer is in dist-installer/"
echo ""
