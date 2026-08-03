# macOS Signing Gate — Test Procedure

## What this tests

`build-macos.yml` step 7 ("Verify code signature") is designed to fail the
workflow whenever `CSC_LINK`/`CSC_KEY_PASSWORD` are absent or mis-configured,
so unsigned DMGs can never reach GitHub Releases.  Because electron-builder
silently skips signing and exits 0 when no certificate is supplied, the gate
step is the only thing standing between an unsigned build and admins.

This document describes how that gate is verified.

---

## Automated test (CI job triggered on demand)

**Workflow:** `.github/workflows/test-macos-signing-gate.yml`  
**Trigger:** Actions → "Test macOS signing gate" → **Run workflow**

### What the job does

| Step | Action |
|------|--------|
| 1 | Checks out the repository |
| 2 | Creates two minimal unsigned `.app` bundles inside the paths that `build-macos.yml` expects (`dist-installer/mac/` and `dist-installer/mac-arm64/`) |
| 3 | Runs the **exact** gate script from `build-macos.yml` step 7 (`codesign --verify --deep --strict`) with `continue-on-error: true` |
| 4 | Asserts the gate step exited **non-zero** — if it exited 0 the test fails loudly |
| 5 | Records that step 8 (upload) is unreachable after a gate failure |

### Interpreting results

| Job result | Meaning |
|------------|---------|
| ✅ Green | `codesign --verify` correctly rejected the unsigned bundle; the gate works |
| ❌ Red (step 4) | `codesign --verify` returned 0 for an unsigned bundle — the gate is broken and needs investigation |

---

## Why codesign rejects unsigned bundles

`codesign --verify --deep --strict` requires:

1. A **code directory** (`_CodeSignature/`) embedded in the bundle by a
   proper signing operation.
2. That the signing chain traces back to a trusted Apple CA (or, on CI, to
   any valid identity that was used to sign).

A bundle created without calling `codesign -s` has no code directory at all.
macOS returns exit code **1** and prints:

```
NAPA Courier Admin.app: code object is not signed at all
```

This is the signal that step 7 catches.

---

## Why the upload step is unreachable after a gate failure

Step 8 ("Publish to GitHub Releases") in `build-macos.yml` is a plain
sequential step — it has **no `if:` condition**.  GitHub Actions marks the
entire job as failed as soon as any step exits non-zero and skips all
remaining steps unconditionally.  No special configuration is required.

```
step 6 — Build and package   (exit 0 — unsigned, but electron-builder is silent)
step 7 — Verify code signature  ← exits 1  ← job marked FAILED here
step 8 — Publish to GitHub Releases  ← SKIPPED automatically
```

---

## Manual verification procedure

If you prefer to verify by hand without running the automated job:

```bash
# 1. On any Mac with Xcode Command Line Tools installed:
APP_DIR=$(mktemp -d)/unsigned.app
mkdir -p "${APP_DIR}/Contents/MacOS"
printf '#!/bin/sh\n' > "${APP_DIR}/Contents/MacOS/test"
chmod +x "${APP_DIR}/Contents/MacOS/test"

# 2. Run the same command used in build-macos.yml step 7:
codesign --verify --deep --strict "${APP_DIR}"

# Expected output:
#   /var/folders/.../unsigned.app: code object is not signed at all
#   (exit code 1)

echo "Exit code: $?"   # should print: Exit code: 1
```

An exit code of 1 confirms the gate would catch the failure mode.

---

## Relationship to `build-macos.yml`

```
build-macos.yml
  step 6: Build and package   ← sets CSC_LINK / CSC_KEY_PASSWORD from secrets
                                 if secrets are absent, electron-builder exits 0
                                 with unsigned .app (this is the silent failure)
  step 7: Verify code signature  ← THIS IS THE GATE
                                    codesign --verify --deep --strict
                                    exits 1 if app is unsigned → job fails
  step 8: Publish to GitHub Releases  ← only reachable if step 7 passes
```

The automated test in `test-macos-signing-gate.yml` exercises the step 7
→ step 8 boundary directly, without needing real signing credentials.
