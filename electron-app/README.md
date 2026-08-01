# NAPA Courier Admin — Desktop App

A Windows desktop application for managing the NAPA courier delivery location directory.
Built with **Electron + React + Vite + Tailwind CSS**.
Data is stored in a **shared Dropbox folder** — all five admins read and write the same files.

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

## Platform Support

| Platform | Output | Build machine required |
|---|---|---|
| Windows (x64) | NSIS `.exe` installer | Any Windows machine |
| macOS (Intel, x64) | `.dmg` disk image | Must be built on a Mac |
| macOS (Apple Silicon, arm64) | `.dmg` disk image | Must be built on a Mac (M1/M2/M3) |

**Craig and other Mac admins:** build the macOS version on your Mac and distribute the `.dmg`.
**Windows admins:** build on Windows and distribute the `.exe` installer.
There is no cross-compilation — macOS builds cannot be produced on a Windows machine.

---

## Prerequisites

- **Node.js 18 or later** — download from https://nodejs.org (use the LTS version)
- **npm** — included with Node.js
- A **Dropbox account** that has access to the shared folder
- A Dropbox **App Key** (one-time setup, see below)
- **macOS only:** Xcode Command Line Tools — run `xcode-select --install` in Terminal if you haven't already

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

Clone or copy the `electron-app/` folder from the Replit workspace to your Windows machine.
You can download it as a zip from Replit, or use git if the repo is connected to GitHub.

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

Run the setup script to copy unchanged components from the web app source:

```
bash setup-components.sh
```

This copies shadcn/ui primitives, the location tree, forms, import/export, and other shared code from `../artifacts/napa-courier-admin/src/` into `src/`. It is safe to re-run; it overwrites without prompting.

> **Windows users:** Run this in Git Bash, WSL, or any bash-compatible shell.
> If you don't have bash, see the "Manual Component Copy" section at the end of this file.

---

## Step 5 — Install Dependencies

```
npm install
```

This downloads ~200 MB of packages into `node_modules/`. It only needs to be done once (or after a `package.json` update).

---

## Step 6 — Build the App

```
npm run build
```

This compiles TypeScript and bundles the renderer with Vite. Output goes to `out/`.

To verify the build looks right before packaging (no installer created):

```
# Windows
npm run package:dir:win

# macOS
npm run package:dir:mac
```

On Windows, the unpackaged app is in `dist-installer/win-unpacked/NAPA Courier Admin.exe`.
On macOS, it's in `dist-installer/mac/NAPA Courier Admin.app` — double-click to test.

---

## Step 7 — Create the Installer

### Windows

```
npm run package:win
```

Output: `dist-installer/NAPA Courier Admin Setup 1.0.0.exe`

Distribute this file to Windows admins. They double-click it and follow the wizard —
no Node.js or npm needed on their machines.

### macOS

```
npm run package:mac
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
- Missing `node_modules/` — run `npm install` and rebuild.
- `src/` is missing component files — run `setup-components.sh` and rebuild.

### Cmd+C / Cmd+V / Cmd+Z don't work on macOS
This is fixed in the current build (a native Edit menu is wired up in `electron/main.ts`). If you see this on an older build, rebuild from the latest source.

### App is blocked on macOS ("developer cannot be verified")
This is macOS Gatekeeper. For a quick workaround: **right-click** the app → **Open** → **Open**. This bypasses the warning permanently for that machine. For proper distribution without any warning, the app needs to be code-signed and notarized with an Apple Developer account (see Task #8 in the project task list).

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

1. Pull the latest code from Replit.
2. Run `bash setup-components.sh` to copy updated shared components.
3. Run `npm run package` to produce a new installer.
4. Distribute the new installer to all admins.

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
| `components/tutorial/` | `src/components/tutorial/` |
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
