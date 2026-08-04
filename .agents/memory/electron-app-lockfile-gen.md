---
name: electron-app lockfile generation
description: Correct method to regenerate electron-app/package-lock.json so npm ci passes on Windows
---

# electron-app/package-lock.json regeneration

## The rule
Always use `npm install --ignore-scripts` (full install) — NOT `npm install --package-lock-only` — when regenerating the lockfile in a clean /tmp directory.

**Why:** `--package-lock-only` skips full dependency tree resolution for optional platform packages. It leaves `resolved` URLs empty for packages like `@emnapi/core` (nested under `@tailwindcss/oxide-wasm32-wasi`). When `npm ci` runs on Windows it hits "Missing: @emnapi/core@x.y.z from lock file" and aborts.

**How to apply:** Every time `electron-app/package-lock.json` must be regenerated:

```bash
rm -rf /tmp/lockgen /tmp/locktest
mkdir /tmp/lockgen
cp electron-app/package.json /tmp/lockgen/package.json
# Full install (not --package-lock-only):
cd /tmp/lockgen && npm install --ignore-scripts --registry https://registry.npmjs.org

# Verify before copying back:
mkdir /tmp/locktest
cp /tmp/lockgen/package.json /tmp/locktest/
cp /tmp/lockgen/package-lock.json /tmp/locktest/
cd /tmp/locktest && npm ci --ignore-scripts   # must pass with zero "Missing:" errors

cp /tmp/lockgen/package-lock.json electron-app/package-lock.json
```

Then run `npm run build` in `electron-app` as a second confirmation before committing.

## Additional constraints
- Never run `npm install` inside the pnpm workspace root — it writes pnpm store paths (`../node_modules/.pnpm/...`) as `resolved` URLs, which break `npm ci` on Windows.
- The lockgen /tmp directory must be completely fresh each time (no leftover lockfile from a previous run).
- `--registry https://registry.npmjs.org` must be specified to bypass any Replit package firewall.
