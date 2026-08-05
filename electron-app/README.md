# NAPA Courier Admin — Desktop App

A desktop application for managing the NAPA courier delivery location directory.
Built with **Electron + React + Vite + Tailwind CSS**.
Data is stored in a **shared Dropbox folder** — all five admins read and write the same files.
Available for **Windows** (x64) and **macOS** (Intel and Apple Silicon).

---

## How It Works

| File in Dropbox | Purpose |
|---|---|
| `/NAPA Courier Admin/locations-staging.json` | Working copy. Admins edit this. |
| `/NAPA Courier Admin/locations-live.json` | Published copy. Drivers read this. |
| `/NAPA Courier Admin/backups/backup-*.json` | Rolling snapshots, one per edit. Up to 20 kept automatically. |

- Every edit is auto-saved to `locations-staging.json` within ~1 second.
- "Publish" writes `locations-live.json` from the current staging data.
- If two admins edit simultaneously, the second save gets a **conflict warning** and can choose to reload or force-save.

---

## Automated CI Builds (GitHub Actions)

The repository includes GitHub Actions workflows that build and publish installers automatically — **no local Node.js, Xcode, or build tools required**.

| Workflow | Runner | Output |
|---|---|---|
| `.github/workflows/build-windows.yml` | `windows-latest` | Signed `.exe` NSIS installer |
| `.github/workflows/build-macos.yml` | `macos-latest` | Two `.dmg` files — Intel (x64) and Apple Silicon (arm64) |

### How a release build works

1. **Tag the commit** you want to release, using a `v`-prefixed version tag:
   ```
   git tag v1.2.0
   git push origin v1.2.0
   ```
2. GitHub Actions picks up the tag, builds on the appropriate runner, and uploads the installers as **GitHub Release assets**.
3. Download the installer from the **Releases** page of the repository — no build tools needed on your machine.

### Required repository secrets

Go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Platform | Required? | Value |
|---|---|---|---|
| `DROPBOX_APP_KEY` | Both | **Required** | Your Dropbox app key (same one used in `.env`) |
| `WIN_CSC_LINK` | Windows | **Required for signing** | Base64-encoded `.pfx` certificate (see below) |
| `WIN_CSC_KEY_PASSWORD` | Windows | **Required for signing** | Password for the `.pfx` |
| `CSC_LINK` | macOS | **Required for signing** | Base64-encoded Developer ID Application `.p12` certificate (see below) |
| `CSC_KEY_PASSWORD` | macOS | **Required for signing** | Password for the `.p12` |
| `APPLE_ID` | macOS | Optional | Apple ID email (e.g. `you@example.com`) |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS | Optional | App-specific password from [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security |
| `APPLE_TEAM_ID` | macOS | Optional | 10-character Team ID from [developer.apple.com/account](https://developer.apple.com/account) → Membership |

> **Windows signing:** `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` are required to produce a signed installer. Without them the build still succeeds, but the installer will be unsigned and Windows SmartScreen will show **"Windows protected your PC — unrecognized app"** on every install. Set both secrets to eliminate that warning.
>
> **macOS signing:** If `CSC_LINK` / `CSC_KEY_PASSWORD` are not set the build still succeeds, but the `.dmg` will be unsigned and Gatekeeper will show "developer cannot be verified" on first launch. Admins can bypass once with right-click → Open → Open.
>
> **macOS notarization:** If the three `APPLE_*` secrets are not set the build skips notarization. Notarization requires a signed app (`CSC_LINK` + `CSC_KEY_PASSWORD` must also be set). With all five macOS secrets set, the app is fully signed and notarized — no Gatekeeper warning at all.

#### Encoding the .pfx for `WIN_CSC_LINK` (Windows only)

electron-builder accepts a base64-encoded certificate string in CI. To encode your `.pfx`:

**PowerShell (Windows):**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\napa-courier.pfx")) | clip
```
Paste the clipboard contents as the `WIN_CSC_LINK` secret value.

**macOS / Linux:**
```bash
base64 -i napa-courier.pfx | pbcopy   # macOS
base64 -w 0 napa-courier.pfx          # Linux — copy output manually
```

---

## Platform Support

| Platform | Output | How to get the installer |
|---|---|---|
| Windows (x64) | NSIS `.exe` installer | Download from GitHub Releases (built by CI), or build locally on any Windows machine |
| macOS (Intel, x64) | `.dmg` disk image | Download `NAPA Courier Admin-x.y.z.dmg` from GitHub Releases (built by CI) |
| macOS (Apple Silicon, arm64) | `.dmg` disk image | Download `NAPA Courier Admin-x.y.z-arm64.dmg` from GitHub Releases (built by CI) |

**All admins:** download the correct installer from the **Releases** page — no Node.js, Xcode, or build tools needed.
Push a `v`-prefixed git tag to trigger a CI build (see [Automated CI Builds](#automated-ci-builds-github-actions) above).

---

## Prerequisites

> **Just need to install the app?** Download the installer from the GitHub Releases page — no build tools needed. The steps below are only for developers who need to build or run the app from source.

- **Node.js 18 or later** — download from https://nodejs.org (use the LTS version)
- **pnpm** — install with `npm install -g pnpm` after installing Node.js
- A **Dropbox account** that has access to the shared folder
- A Dropbox **App Key** (one-time setup, see below)

---

## Step 1 — Create a Dropbox App (one-time, done by one admin)

1. Go to https://www.dropbox.com/developers/apps and sign in.
2. Click **Create app**.
3. Choose **"Scoped access"** → **"Full Dropbox"**.
4. Give the app any name, e.g. _NAPA Courier Admin_.
5. On the app settings page, under **OAuth 2 → Redirect URIs**, add **all** of these:
   ```
   http://localhost:47291/callback
   http://localhost:47292/callback
   http://localhost:47293/callback
   http://localhost:47294/callback
   http://localhost:47295/callback
   ```
   *(The app tries ports 47291–47295 in order. Adding all five prevents problems if a port is busy.)*
6. Under **Permissions**, enable these scopes:
   - `files.content.read`
   - `files.content.write`
   - `account_info.read`
7. Click **Submit** to save the permissions.
8. Copy the **App key** (NOT the App secret — this app uses PKCE and does not need the secret).
9. Share the App Key with all admins who will build or install the app.

---

## Step 2 — Get the Source Code

Clone the **entire repository** — not just `electron-app/`. The project uses a pnpm workspace
where `electron-app/` dependencies are resolved from the root `pnpm-workspace.yaml` catalog,
so the repo root and `pnpm-lock.yaml` are required for installation.

```bash
git clone https://github.com/your-org/your-repo.git
cd your-repo
```

If the repo is on GitHub you can also download it as a zip (Code → Download ZIP) and extract it.

---

## Step 3 — Set Up the Environment

In the `electron-app/` folder, copy the example env file:

```
copy .env.example .env
```

Open `.env` in Notepad and fill in your App Key:

```
DROPBOX_APP_KEY=your_actual_app_key_here
DROPBOX_FOLDER_PATH=/NAPA Courier Admin
```

`DROPBOX_FOLDER_PATH` must be the **exact Dropbox path** (starting with `/`) where the app will store its data files. All admins must use the same path. The folder will be created automatically on first use.

---

## Step 4 — Copy Shared Components

Run the setup script to copy unchanged components from the web app source.

### Windows (cmd.exe or PowerShell)

Git for Windows ships with bash at a known path. Run it directly — you do **not**
need to open a separate Git Bash window:

```cmd
"C:\Program Files\Git\bin\bash.exe" setup-components.sh
```

If Git is installed somewhere else (e.g. `C:\Program Files (x86)\Git\`), adjust the path accordingly. Or open **Git Bash** from the Start menu and run:

```bash
bash setup-components.sh
```

### macOS / Linux

```bash
bash setup-components.sh
```

This copies shadcn/ui primitives, the location tree, forms, import/export, and other shared code from `../artifacts/napa-courier-admin/src/` into `src/`. It is safe to re-run; it overwrites without prompting.

> **No bash at all?** See the "Manual Component Copy" section at the end of this file for an exact table of files to copy by hand.

---

## Step 5 — Install Dependencies

From the **repository root** (not inside `electron-app/`):

```
pnpm install --frozen-lockfile
```

This downloads ~200 MB of packages into `node_modules/` using the committed `pnpm-lock.yaml`
so you get the exact same versions used to produce the last known-good build.
It only needs to be done once (or after a `pnpm-lock.yaml` update).

> **Run from the repo root**, not from inside `electron-app/` — pnpm must resolve the
> workspace catalog before it can install this package's dependencies.

---

## Step 6 — Build the App

```
pnpm run build
```

This compiles TypeScript and bundles the renderer with Vite. Output goes to `out/`.

To verify the build looks right before packaging (no installer created):

```
# Windows
pnpm run package:dir:win

# macOS
pnpm run package:dir:mac
```

On Windows, the unpackaged app is in `dist-installer/win-unpacked/NAPA Courier Admin.exe`.
On macOS, it's in `dist-installer/mac/NAPA Courier Admin.app` — double-click to test.

---

## Step 7 — Create the Installer

### Windows

```
pnpm run package:win
```

Output: `dist-installer/NAPA Courier Admin Setup 1.0.0.exe`

Distribute this file to Windows admins. They double-click it and follow the wizard —
no Node.js or pnpm needed on their machines.

### macOS

```
pnpm run package:mac
```

Output:
```
dist-installer/
  NAPA Courier Admin-1.0.0.dmg           ← Intel Mac (x64)
  NAPA Courier Admin-1.0.0-arm64.dmg     ← Apple Silicon Mac (M1/M2/M3)
```

Distribute the correct `.dmg` based on the recipient's Mac hardware.
To check: Apple menu → About This Mac → look for "Apple M" (arm64) or "Intel" (x64).

> **Gatekeeper warning:** Without an Apple Developer certificate and notarization,
> macOS will show "cannot be opened because the developer cannot be verified" on the
> first launch. The workaround is: right-click the app → Open → Open (bypasses the warning
> once). See the Troubleshooting section for how to properly notarize for distribution.

---

## Publishing a New Version (Automatic Updates)

Once the app is installed on an admin's machine, **it updates itself automatically** — no manual reinstall needed. Here's how the full cycle works.

### How automatic updates work

1. You publish a new version to GitHub Releases (see steps below).
2. Every running copy of the app checks GitHub on launch.
3. If a newer version is available, it downloads it silently in the background.
4. When the download finishes, the app shows a dialog:
   > *"A new version of NAPA Courier Admin has been downloaded. Restart now to install the update, or it will be installed automatically the next time you quit the app."*
5. The admin clicks **Restart Now** (or the update installs automatically on the next app quit).

No admin needs to visit a website, download a file, or run an installer again.

---

### How to publish a new version

**Every time you want to push an update to all five admins, follow these steps.**

#### Step 1 — Bump the version number

Open `package.json` and increase the `"version"` field:

```json
"version": "1.0.1"
```

Use [semantic versioning](https://semver.org): `1.0.0` → `1.0.1` for a bug fix, `1.1.0` for a new feature, `2.0.0` for a major change.

#### Step 2 — Set your GitHub token in the terminal

You need a GitHub Personal Access Token with **`repo` scope** (or `write:packages` for private repos). Create one at [github.com/settings/tokens](https://github.com/settings/tokens).

> **⚠ Security — read this carefully:**
> The token must **only** exist as a temporary environment variable in your terminal session. Do NOT put it in `.env`, do NOT commit it to git, and do NOT save it to any file. It is a secret that grants write access to the GitHub repository.

Set it in your terminal **for the current session only**:

**Command Prompt (Windows):**
```cmd
set GH_TOKEN=ghp_your_token_here
```

**PowerShell (Windows):**
```powershell
$env:GH_TOKEN = "ghp_your_token_here"
```

**macOS / Linux (Terminal):**
```bash
export GH_TOKEN=ghp_your_token_here
```

The token is gone when you close the terminal window. That's intentional.

#### Step 3 — Build and publish

In the same terminal window where you set `GH_TOKEN`:

**Windows** (run on a Windows machine):
```cmd
pnpm run publish:win
```

**macOS** (run on a Mac):
```bash
pnpm run publish:mac
```

This runs `electron-vite build` followed by `electron-builder --publish always`, which:
1. Builds the app
2. Creates the installer
3. Uploads the installer + a `latest.yml` manifest to the GitHub Releases page under a new release named after the version (e.g. `v1.0.1`)

When the upload finishes, the update is live — all five installed copies will see it on their next launch.

#### Step 4 — Verify

Go to the GitHub repository's **Releases** page. You should see a new release (e.g. `v1.0.1`) with:
- `NAPA Courier Admin Setup 1.0.1.exe` (Windows installer)
- `latest.yml` (the update manifest the app reads to check for updates)

If either file is missing, the auto-updater won't work for that platform.

---

### GitHub token vs. Dropbox App Key — what goes where

| Value | Where it lives | Why |
|---|---|---|
| `DROPBOX_APP_KEY` | `.env` file (checked into git is fine for internal tools) | Embedded in the packaged app at build time — not a secret |
| `GH_TOKEN` | Terminal session only — **never on disk** | Grants write access to the GitHub repo — must not ship in the app |

---

## First Run (for each admin)

1. **Windows:** Open from the Start menu or desktop shortcut.
   **macOS:** Open the `.dmg`, drag the app to Applications, then open it from Launchpad.
2. Click **"Sign in with Dropbox"** — a browser window opens.
3. Sign in with your personal Dropbox account.
4. Grant the app access when prompted.
5. Return to the app — it will show the location list.

> **Note:** The app asks each admin to sign in with their own Dropbox account. This means audit entries show each admin's real name. All admins must have access to the shared Dropbox folder.

Sign-in is remembered for **30 days**. After that, you sign in again.

---

## Changing the Data Folder

If you need to change where data is stored:

1. Click the ⚙ gear icon in the top bar.
2. Edit the **Data Folder Path** field.
3. Click **Save**.
4. Restart the app (close and reopen) for the change to take effect.

All admins must be updated to point to the same folder.

---

## Code Signing (Windows)

Without a code-signing certificate, Windows SmartScreen shows
**"Windows protected your PC — unrecognized app"** every time an admin runs the
installer. They must click **More info → Run anyway**, which looks alarming.
Signing the installer eliminates that warning.

### 1 — Purchase a certificate

| Type | SmartScreen behaviour | Typical cost | Hardware token needed? |
|---|---|---|---|
| **EV** (Extended Validation) | Trusted immediately on first install | $300–500 / yr | Yes — USB key (YubiKey, SafeNet, etc.) |
| **OV** (Organization Validation) | Trusted after ~100–500 installs across users | $100–200 / yr | No |

Recommended vendors: **DigiCert**, **Sectigo**, **GlobalSign**, **SSL.com**.

> For the fastest SmartScreen bypass, choose **EV**. For a lower-cost option
> that works once you've distributed to enough users, choose **OV**.

### 2 — Export the certificate as a .pfx file

After the CA issues your certificate and it is installed on the signing machine:

1. Open **Certificate Manager** (`Win + R` → `certmgr.msc`).
2. Find your certificate under **Personal → Certificates**.
3. Right-click → **All Tasks → Export…**
4. Choose **Yes, export the private key** → **PFX / PKCS #12**.
5. Set a strong password and save the file, e.g. `napa-courier.pfx`.
6. Store it somewhere secure (it is a private key — treat it like a password).

> **EV certificates** are stored on a USB hardware token, not exportable.
> Use the token-based signing flow instead (see your CA's documentation for
> the `signtool.exe` command-line approach, then set `WIN_CSC_LINK` to the
> token path as described by electron-builder's hardware-token docs).

### 3 — Set environment variables before building

electron-builder reads two environment variables at build time. Set them in
your terminal **before** running `pnpm run package:win`:

**Command Prompt:**
```cmd
set WIN_CSC_LINK=C:\path\to\napa-courier.pfx
set WIN_CSC_KEY_PASSWORD=your_pfx_password
pnpm run package:win
```

**PowerShell:**
```powershell
$env:WIN_CSC_LINK     = "C:\path\to\napa-courier.pfx"
$env:WIN_CSC_KEY_PASSWORD = "your_pfx_password"
pnpm run package:win
```

- `WIN_CSC_LINK` — absolute path to your `.pfx` file (or a base64-encoded
  copy of the file, which is useful for CI pipelines).
- `WIN_CSC_KEY_PASSWORD` — the password you chose when exporting the `.pfx`.

If either variable is missing, electron-builder skips signing and the
installer will still trigger SmartScreen. Watch for the line
`"code signing is disabled"` in build output.

### 4 — Verify the signature

After the build, right-click the resulting `.exe` in File Explorer →
**Properties → Digital Signatures tab**. Your organisation name should appear
in the signatures list.

You can also verify from a Command Prompt:
```cmd
signtool verify /pa /v "dist-installer\NAPA Courier Admin Setup 1.0.0.exe"
```

---

## Code Signing (macOS)

Without a Developer ID Application certificate, macOS Gatekeeper shows
**"NAPA Courier Admin cannot be opened because the developer cannot be verified"**
every time an admin opens the `.dmg` for the first time. Adding a certificate
and notarizing the app eliminates that warning entirely.

### 1 — Join the Apple Developer Program

A paid **Apple Developer Program** membership ($99/yr) is required to obtain
a Developer ID Application certificate. Sign up at
[developer.apple.com/programs](https://developer.apple.com/programs).

### 2 — Create a Developer ID Application certificate

1. Go to [developer.apple.com/account](https://developer.apple.com/account) →
   **Certificates, Identifiers & Profiles** → **Certificates** → **+**.
2. Choose **Developer ID Application** (not "Distribution").
3. Follow the prompts to generate a Certificate Signing Request (CSR) from
   Keychain Access, upload it, and download the resulting `.cer` file.
4. Double-click the `.cer` to install it into your Keychain.

### 3 — Export the certificate as a .p12 file

1. Open **Keychain Access** on your Mac.
2. In **My Certificates**, find **"Developer ID Application: Your Name (TEAMID)"**.
3. Right-click → **Export "Developer ID Application: …"**.
4. Choose **Personal Information Exchange (.p12)** format.
5. Set a strong password and save as, e.g., `DeveloperIDApplication.p12`.
6. Store it somewhere secure — it contains your private key.

### 4 — Encode the certificate for CI

GitHub Actions secrets cannot store binary files, so encode the `.p12` as
base64:

**macOS:**
```bash
base64 -i DeveloperIDApplication.p12 | pbcopy   # copies to clipboard
```

**Linux:**
```bash
base64 -w 0 DeveloperIDApplication.p12           # copy the output manually
```

### 5 — Add the GitHub repository secrets

Go to **Settings → Secrets and variables → Actions → New repository secret**
and add all five macOS secrets:

| Secret name | Value |
|---|---|
| `CSC_LINK` | The base64 string from step 4 |
| `CSC_KEY_PASSWORD` | The password you chose when exporting the `.p12` |
| `APPLE_ID` | Your Apple ID email (e.g. `you@example.com`) |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from [appleid.apple.com](https://appleid.apple.com) → Account → Sign-In and Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | 10-character Team ID from [developer.apple.com/account](https://developer.apple.com/account) → Membership Details |

> **Note:** `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` enable
> notarization — the final step that submits the signed app to Apple's servers
> so Gatekeeper trusts it with **no warning at all**, on any Mac.
> Notarization requires a signed app, so all five secrets must be set together.

### 6 — Trigger a build

Push a `v`-prefixed tag (e.g. `git tag v1.0.1 && git push origin v1.0.1`).
The CI workflow picks up `CSC_LINK` / `CSC_KEY_PASSWORD`, signs the `.app`
bundles, then calls the `afterSign` hook (`electron/notarize.cjs`) which
notarizes them with Apple before the `.dmg` files are created.

### 7 — Verify signing and notarization

Download the `.dmg` from the GitHub Releases page and run:

```bash
# Check the .app is signed
codesign --verify --deep --strict --verbose=2 "NAPA Courier Admin.app"

# Check the notarization ticket is stapled
spctl --assess --type exec --verbose "NAPA Courier Admin.app"
```

The second command should print `source=Notarized Developer ID` with exit
code 0 when fully signed and notarized.

---

## Troubleshooting

### "DROPBOX_APP_KEY is not configured"
Open `.env`, confirm your App Key is set, and rebuild.

### "Sign-in failed" / browser doesn't open
Make sure the redirect URI (`http://localhost:47291/callback` etc.) is added in your Dropbox app settings. Also check that your firewall isn't blocking localhost connections.

### "Another admin made changes" conflict dialog
Two admins saved at almost the same time. Choose:
- **Reload from Dropbox** — discards your unsaved changes and loads the other admin's version.
- **Force Save My Changes** — overwrites the other admin's version with yours.

When in doubt, reload. You can get your changes back from **Backup & Restore**.

### App is blank / white screen
Open DevTools and check the Console tab for errors.
- **Windows:** `Ctrl+Shift+I`
- **macOS:** `Cmd+Option+I` (only available in development builds; in production use `View → Toggle Developer Tools` if the menu is present)

Common causes:
- Missing `node_modules/` — run `pnpm install --frozen-lockfile` from the repo root and rebuild.
- `src/` is missing component files — run `setup-components.sh` and rebuild.

### Cmd+C / Cmd+V / Cmd+Z don't work on macOS
This is fixed in the current build (a native Edit menu is wired up in `electron/main.ts`). If you see this on an older build, rebuild from the latest source.

### App is blocked on macOS ("developer cannot be verified")
This is macOS Gatekeeper. For a quick workaround: **right-click** the app → **Open** → **Open**. This bypasses the warning permanently for that machine. For proper distribution without any warning, the app needs to be code-signed and notarized — see the **Code Signing (macOS)** section above for the full setup guide.

### Token is corrupted / won't sign in
Delete the encrypted token file and sign in again.

**Windows:**
```
%APPDATA%\napa-courier-admin\dropbox-token.enc
```
(Paste that path into File Explorer's address bar.)

**macOS:**
```
~/Library/Application Support/napa-courier-admin/dropbox-token.enc
```
(In Finder: Go → Go to Folder… → paste the path.)

---

## Rebuilding After a Web App Update

When the web app source (`artifacts/napa-courier-admin/src/`) is updated with new features:

1. Pull the latest code: `git pull`
2. Run `pnpm install --frozen-lockfile` from the repo root to pick up any dependency changes.
3. Copy updated shared components — Windows: `"C:\Program Files\Git\bin\bash.exe" setup-components.sh` / Mac/Linux: `bash setup-components.sh`
4. Run `pnpm run package:win` (Windows) or `pnpm run package:mac` (Mac) to produce a new installer.
5. Distribute the new installer to all admins.

---

### ⚠️ Regenerating `package-lock.json` — read this before running `npm install`

**Never run `npm install` (or `npm install --package-lock-only`) inside the
`electron-app/` directory while it sits inside the pnpm workspace.**

When you run `npm install` from inside the repo, npm sees the parent
`node_modules/.pnpm` store and writes resolved URLs like
`file:../../../node_modules/.pnpm/...` into `package-lock.json`. Those paths
only exist on your machine. In CI (`npm ci` on a fresh Windows runner) npm
resolves only ~45 packages instead of ~522, `electron-vite` ends up missing
from `PATH`, and the build fails with a cryptic "not recognised" error.

**Safe way — use the helper script (macOS/Linux/WSL):**

```bash
# Run from the repository root
bash scripts/regen-lockfile.sh
```

The script copies `electron-app/package.json` to a clean `/tmp` directory
outside the pnpm workspace, runs `npm install --ignore-scripts` there (so npm
sees no parent store), verifies the result with `npm ci --ignore-scripts`, and
copies the generated `package-lock.json` back into `electron-app/`.

**Safe way — Windows machine (no WSL):**

On a Windows machine that does **not** have the pnpm workspace checked out,
run inside a clean directory:

```cmd
mkdir C:\tmp\lockgen
copy electron-app\package.json C:\tmp\lockgen\
cd C:\tmp\lockgen
npm install --ignore-scripts
copy package-lock.json <repo>\electron-app\package-lock.json
```

**Verify before committing:**

```bash
grep -c 'node_modules/.pnpm' electron-app/package-lock.json
```

The count must be **0**. A non-zero count means the lockfile was generated from
inside the workspace and will break the Windows CI build. The CI workflow also
runs this check automatically and will fail if any pnpm store references are
found.

---

## Manual Component Copy (if bash isn't available)

If `setup-components.sh` won't run, copy these folders manually from
`../artifacts/napa-courier-admin/src/` into `src/`:

| Copy from (web app) | Copy to (electron-app) |
|---|---|
| `components/ui/` | `src/components/ui/` |
| `components/detail/` | `src/components/detail/` |
| `components/form/` | `src/components/form/` |
| `components/import/` | `src/components/import/` |
| `components/tree/` | `src/components/tree/` |
| `components/tutorial/` | **DO NOT COPY** — rewritten for Electron (different prop interfaces and `TOUR_STEPS` export; the correct versions are already in `src/components/tutorial/`) |
| `components/layout/TopBar.tsx` | `src/components/layout/TopBar.tsx` |
| `components/layout/HelpMenu.tsx` | `src/components/layout/HelpMenu.tsx` |
| `hooks/use-toast.ts` | `src/hooks/use-toast.ts` |
| `hooks/use-mobile.tsx` | `src/hooks/use-mobile.tsx` |
| `lib/utils/csv.ts` | `src/lib/utils/csv.ts` |
| `lib/utils/fuzzy.ts` | `src/lib/utils/fuzzy.ts` |
| `index.css` | `src/index.css` |

**Do NOT** copy `BackupRestore.tsx`, `SettingsPanel.tsx`, `use-dropbox-user.ts`,
`store.ts`, `utils.ts`, `AdminDashboard.tsx`, `App.tsx`, `main.tsx`, or `index.html` —
the Electron versions of those are already in `src/`.

---

## Architecture Notes

```
electron-app/
├── electron/
│   ├── main.ts       — Main process: OAuth PKCE, Dropbox API, IPC handlers
│   └── preload.ts    — Context bridge: exposes window.electronAPI to renderer
├── src/
│   ├── App.tsx        — Auth gate: shows LoginScreen or AdminDashboard
│   ├── pages/
│   │   └── AdminDashboard.tsx  — Main UI (conflict dialog, async operations)
│   ├── lib/
│   │   ├── store.ts   — Async React hook, Dropbox-backed data layer
│   │   └── ipc.ts     — (optional) typed wrappers around window.electronAPI
│   ├── components/
│   │   ├── auth/      — LoginScreen
│   │   ├── backup/    — BackupRestore (async handlers)
│   │   └── settings/  — SettingsPanel (IPC, folder path config)
│   └── hooks/
│       └── use-dropbox-user.ts  — Dropbox identity via IPC
├── .env.example
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json
├── setup-components.sh
└── README.md           — this file
```

Token storage:
- Windows: `%APPDATA%\napa-courier-admin\dropbox-token.enc`
- macOS:   `~/Library/Application Support/napa-courier-admin/dropbox-token.enc`

App settings:
- Windows: `%APPDATA%\napa-courier-admin\app-settings.json`
- macOS:   `~/Library/Application Support/napa-courier-admin/app-settings.json`
