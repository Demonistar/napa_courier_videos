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

## Prerequisites

- **Node.js 18 or later** — download from https://nodejs.org (use the LTS version)
- **npm** — included with Node.js
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

To verify the build looks right before packaging:

```
npm run package:dir
```

This creates an unpackaged app in `dist-installer/win-unpacked/`. Double-click `NAPA Courier Admin.exe` to test it. No installer is created yet.

---

## Step 7 — Create the Windows Installer

```
npm run package
```

This creates a `.exe` NSIS installer in `dist-installer/`:

```
dist-installer/
  NAPA Courier Admin Setup 1.0.0.exe
```

Distribute this file to the other admins. They double-click it and follow the installer wizard — no Node.js or npm needed on their machines.

---

## First Run (for each admin)

1. Open **NAPA Courier Admin** from the Start menu or desktop shortcut.
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
Open DevTools (**Ctrl+Shift+I**) and check the Console tab for errors. Common causes:
- Missing `node_modules/` — run `npm install` and rebuild.
- `src/` is missing component files — run `setup-components.sh` and rebuild.

### Token is corrupted / won't sign in
Delete the encrypted token file and sign in again:

```
%APPDATA%\napa-courier-admin\dropbox-token.enc
```

(Paste that path into File Explorer's address bar.)

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

Token storage: `%APPDATA%\napa-courier-admin\dropbox-token.enc`
App settings: `%APPDATA%\napa-courier-admin\app-settings.json`
