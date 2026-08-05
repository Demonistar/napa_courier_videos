---
name: electron-app lockfile generation and CI build
description: How to correctly generate package-lock.json for the electron-app and build the Windows installer in CI
---

# electron-app lockfile and Windows CI build

## Lockfile generation rule
The `electron-app/package-lock.json` must be generated OUTSIDE the pnpm workspace (in a clean /tmp directory with a copy of just electron-app/package.json). If generated inside the workspace, npm resolves ~45 packages via the pnpm store instead of ~522 standalone, and electron-vite goes missing.

**Why:** pnpm's store reuse causes npm to resolve packages differently when a pnpm-managed node_modules tree is present.

**How to apply:** Run `scripts/regen-lockfile.sh` from repo root, or manually: copy `electron-app/package.json` to a temp dir, run `npm install --ignore-scripts`, verify with `npm ci --ignore-scripts`, then copy back. See `electron-app/README.md` Rebuilding section.

## Windows CI: use npm ci, NOT pnpm install

**Rule:** In `.github/workflows/build-windows.yml`, install electron-app deps with `npm ci --ignore-scripts` inside the `electron-app/` directory — NOT `pnpm install` from the workspace root.

**Why:** `pnpm-lock.yaml` is generated on Linux and marks Windows-specific optional native binaries (e.g. `@rollup/rollup-win32-x64-msvc`) as excluded (`'-'`). Even without `--frozen-lockfile`, pnpm respects these exclusions on the Windows runner, causing electron-vite build to fail with "Cannot find module @rollup/rollup-win32-x64-msvc". npm ci correctly installs platform-specific optional natives for the current runner OS.

**How to apply:** The step should be `working-directory: electron-app` and run `npm ci --ignore-scripts`.

## electron-builder config auto-discovery on Windows

**Rule:** Always pass `--config electron-builder.config.js` explicitly when invoking electron-builder in CI.

**Why:** On Windows runners, `npx electron-builder` does not always auto-discover `electron-builder.config.js`. Without it, electron-builder uses defaults (`dist/` output, `oneClick: true`, etc.) instead of the project's configured settings.

**How to apply:** `npx electron-builder --win --publish never --config electron-builder.config.js`

## electron-builder v26 schema changes

**Rule:** `signingHashAlgorithms` is NOT a valid field in `WindowsConfiguration` for electron-builder v26+. It was valid in v25.

**Why:** The field was removed/renamed in v26. Passing it causes a schema validation error: "Invalid configuration object — configuration.win should be one of these: null". Use `signtoolOptions` for signing algorithm config in v26.

**How to apply:** Remove `signingHashAlgorithms` from the `win` config block in `electron-builder.config.js`. If you need SHA256, check `signtoolOptions` docs.
