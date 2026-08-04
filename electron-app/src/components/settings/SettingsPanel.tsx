import { useState, useEffect } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  FolderOpen,
  Loader2,
  LogOut,
  Moon,
  Monitor,
  RefreshCw,
  Sun,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DropboxFolderBrowser, type DetectedFolder } from './DropboxFolderBrowser';
import { DropboxUserInfo } from '@/hooks/use-dropbox-user';

interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dropboxUser: DropboxUserInfo;
  onDropboxDisconnect: () => void;
  onDropboxRefresh: () => void;
  currentUser: string;
  onCurrentUserChange: (name: string) => void;
  updateReady?: boolean;
  downloadProgress?: DownloadProgress | null;
}

type Theme = 'light' | 'dark' | 'system';

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
}

/** Strip the last segment from a Dropbox path to get its parent. */
function parentOf(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx > 0 ? p.substring(0, idx) : '';
}

export function SettingsPanel({
  open,
  onOpenChange,
  dropboxUser,
  onDropboxDisconnect,
  currentUser,
  onCurrentUserChange,
  updateReady = false,
  downloadProgress = null,
}: SettingsPanelProps) {
  const [folderPath, setFolderPath] = useState('');
  const [folderSaved, setFolderSaved] = useState(false);
  const [folderTesting, setFolderTesting] = useState(false);
  const [folderTestResult, setFolderTestResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null);
  const [localUser, setLocalUser] = useState(currentUser);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('light');

  // Folder browser + auto-detection state
  const [browserOpen, setBrowserOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectedFolders, setDetectedFolders] = useState<DetectedFolder[]>([]);

  // Platform + uninstall state
  const [osPlatform, setOsPlatform] = useState<string>('');
  const [appBundlePath, setAppBundlePath] = useState<string | null>(null);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [uninstallError, setUninstallError] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState(false);

  // Mismatch-confirmation state
  const [mismatchConfirmOpen, setMismatchConfirmOpen] = useState(false);

  useEffect(() => { setLocalUser(currentUser); }, [currentUser]);

  // Load settings, app version, and platform when panel opens.
  useEffect(() => {
    if (!open) return;
    window.electronAPI.settings.get().then((s) => {
      setFolderPath(s.dropboxFolderPath ?? '');
      if (s.displayNameOverride) setLocalUser(s.displayNameOverride);
      setTheme(s.theme ?? 'light');
    });
    window.electronAPI.app.getVersion().then(setAppVersion);
    window.electronAPI.app.getPlatform().then(({ platform, appBundlePath: bp }) => {
      setOsPlatform(platform);
      setAppBundlePath(bp);
    });
  }, [open]);

  // Auto-detect existing "NAPA Admin Data" folders when connected.
  useEffect(() => {
    if (!open || !dropboxUser.connected) {
      setDetectedFolders([]);
      return;
    }
    setDetecting(true);
    window.electronAPI.dropbox
      .findNapaAdminFolders()
      .then((result) => {
        setDetectedFolders(result.ok && result.folders ? result.folders : []);
      })
      .catch(() => setDetectedFolders([]))
      .finally(() => setDetecting(false));
  }, [open, dropboxUser.connected]);

  // Reset test result whenever the admin edits the path manually.
  const handleFolderPathChange = (value: string) => {
    setFolderPath(value);
    setFolderTestResult(null);
  };

  const testFolderPath = async () => {
    setFolderTesting(true);
    setFolderTestResult(null);
    try {
      const result = await window.electronAPI.dropbox.testFolderPath(folderPath);
      setFolderTestResult(result);
    } catch (err) {
      setFolderTestResult({ ok: false, error: String(err) });
    } finally {
      setFolderTesting(false);
    }
  };

  const commitFolderPath = async () => {
    await window.electronAPI.settings.set({ dropboxFolderPath: folderPath });
    setFolderSaved(true);
    setTimeout(() => setFolderSaved(false), 3000);
  };

  const saveFolderPath = () => {
    // If at least one detected folder exists and the typed path doesn't match
    // any of their parents, require an explicit confirmation before saving.
    if (detectedFolders.length > 0) {
      const typedNorm = folderPath.trim().toLowerCase().replace(/\/+$/, '');
      const matchesDetected = detectedFolders.some(
        (f) => parentOf(f.pathLower).replace(/\/+$/, '') === typedNorm,
      );
      if (!matchesDetected) {
        setMismatchConfirmOpen(true);
        return;
      }
    }
    void commitFolderPath();
  };

  /** Apply a detected "NAPA Admin Data" folder's parent path as the setting. */
  const useDetectedFolder = async (detectedPath: string) => {
    const parent = parentOf(detectedPath);
    setFolderPath(parent);
    await window.electronAPI.settings.set({ dropboxFolderPath: parent });
    setFolderSaved(true);
    setTimeout(() => setFolderSaved(false), 3000);
  };

  const saveDisplayName = async () => {
    const name = localUser.trim() || 'Unknown user';
    onCurrentUserChange(name);
    await window.electronAPI.settings.set({ displayNameOverride: name });
  };

  const changeTheme = async (next: Theme) => {
    setTheme(next);
    applyTheme(next);
    await window.electronAPI.settings.set({ theme: next });
  };

  // ── Uninstall ──────────────────────────────────────────────────────────────

  const handleUninstall = async () => {
    setUninstalling(true);
    setUninstallError(null);
    try {
      const result = await window.electronAPI.app.uninstall();
      if (!result.ok) {
        setUninstallOpen(false);
        setUninstallError(result.error ?? 'Uninstall failed. Please try removing the app via your OS settings.');
      }
      // Windows success: app will quit in ~400 ms — nothing else to do.
      // macOS: this branch is never reached (macOS uses the info-only dialog, no IPC call).
    } catch {
      setUninstallOpen(false);
      setUninstallError('Uninstall failed unexpectedly. Please use Windows Settings → Apps to remove the app.');
    } finally {
      setUninstalling(false);
    }
  };

  const isMac = osPlatform === 'darwin';
  const isWin = osPlatform === 'win32';
  // Only show the uninstall section in packaged builds where it's meaningful.
  // osPlatform is an empty string in the browser/dev context, so the section
  // stays hidden until it has a real platform value.
  const showUninstall = isWin || isMac;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Configure your Dropbox connection and data folder.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* ── Dropbox Account ─────────────────────────────────── */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Dropbox Account</h3>

              {dropboxUser.connected ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 border rounded-md bg-muted/30">
                    <Cloud className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{dropboxUser.name}</p>
                      <p className="text-xs text-muted-foreground">{dropboxUser.email}</p>
                    </div>
                  </div>

                  {dropboxUser.needsReauth && (
                    <div className="p-3 border border-amber-200 bg-amber-50 rounded-md text-xs text-amber-800">
                      Your session will expire soon. Sign out and sign back in to refresh it.
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onDropboxDisconnect}
                    className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign out of Dropbox
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 border rounded-md bg-muted/30">
                  <CloudOff className="w-5 h-5 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Not connected</p>
                </div>
              )}
            </section>

            {/* ── Appearance ──────────────────────────────────────── */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Appearance</h3>
              <p className="text-xs text-muted-foreground">
                Choose how the app looks. <em>System</em> follows your OS preference.
              </p>
              <div className="flex gap-1 p-1 rounded-md bg-muted w-fit">
                {(
                  [
                    { value: 'light',  label: 'Light',  Icon: Sun     },
                    { value: 'system', label: 'System', Icon: Monitor },
                    { value: 'dark',   label: 'Dark',   Icon: Moon    },
                  ] as const
                ).map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    onClick={() => changeTheme(value)}
                    className={[
                      'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
                      theme === value
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </section>

            {/* ── Dropbox Data Folder ──────────────────────────────── */}
            <section className="space-y-2">
              <Label htmlFor="folder-path" className="text-sm font-semibold flex items-center gap-2">
                <FolderOpen className="w-4 h-4" />
                Data Folder Path
              </Label>
              <p className="text-xs text-muted-foreground">
                The Dropbox folder that will <strong>contain</strong> the app's{' '}
                <code className="font-mono text-xs bg-muted px-1 rounded">NAPA Admin Data</code>{' '}
                subfolder. All admins must point to the same folder so everyone
                shares the same data.
              </p>

              {/* Auto-detection results */}
              {detecting && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                  Searching your Dropbox for existing data folders…
                </div>
              )}

              {!detecting && detectedFolders.length === 1 && (
                <div className="p-3 border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 rounded-md space-y-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-green-800 dark:text-green-300">
                        Existing shared data folder found
                      </p>
                      <code className="text-xs font-mono text-green-700 dark:text-green-400 break-all">
                        {parentOf(detectedFolders[0].pathDisplay) || '/ (Dropbox root)'}
                      </code>
                      <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">
                        Use this path to share data with the other admins.
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-green-300 text-green-800 hover:bg-green-100 dark:border-green-700 dark:text-green-300 dark:hover:bg-green-900/40"
                    onClick={() => useDetectedFolder(detectedFolders[0].pathDisplay)}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                    Use This Path
                  </Button>
                </div>
              )}

              {!detecting && detectedFolders.length > 1 && (
                <div className="p-3 border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 rounded-md space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                      Multiple existing data folders found — select the one the other admins use:
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    {detectedFolders.map((f) => (
                      <div
                        key={f.pathLower}
                        className="flex items-center justify-between gap-2 p-2 border border-amber-200 dark:border-amber-700 rounded"
                      >
                        <code className="text-xs font-mono text-amber-700 dark:text-amber-400 truncate flex-1">
                          {parentOf(f.pathDisplay) || '/ (Dropbox root)'}
                        </code>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 h-6 text-xs border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
                          onClick={() => useDetectedFolder(f.pathDisplay)}
                        >
                          Use
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Path input + buttons */}
              <div className="flex gap-2">
                <Input
                  id="folder-path"
                  value={folderPath}
                  onChange={(e) => handleFolderPathChange(e.target.value)}
                  placeholder="/NAPA Courier Admin"
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void testFolderPath()}
                  disabled={!dropboxUser.connected || folderTesting}
                  className="shrink-0 gap-1"
                  title={
                    dropboxUser.connected
                      ? 'Check whether this path exists in your Dropbox'
                      : 'Connect to Dropbox first'
                  }
                >
                  {folderTesting
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : null}
                  Test
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={saveFolderPath}
                  className="shrink-0"
                >
                  {folderSaved ? 'Saved ✓' : 'Save'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBrowserOpen(true)}
                  disabled={!dropboxUser.connected}
                  className="shrink-0 gap-1.5"
                  title={
                    dropboxUser.connected
                      ? 'Browse your Dropbox to pick a folder'
                      : 'Connect to Dropbox first'
                  }
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Browse
                </Button>
              </div>

              {/* Test result */}
              {folderTestResult !== null && (
                <div
                  className={[
                    'flex items-start gap-2 p-2.5 rounded-md text-xs',
                    folderTestResult.ok
                      ? 'border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 text-green-800 dark:text-green-300'
                      : 'border border-destructive/30 bg-destructive/5 text-destructive',
                  ].join(' ')}
                >
                  {folderTestResult.ok
                    ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                  <span>{folderTestResult.ok ? folderTestResult.message : folderTestResult.error}</span>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                The app stores files inside a{' '}
                <code className="font-mono text-xs">NAPA Admin Data/</code> subfolder at
                this path. Changes take effect on next data reload.
              </p>
            </section>

            {/* ── Display Name override ──────────────────────────── */}
            {dropboxUser.connected && (
              <section className="space-y-2">
                <Label htmlFor="display-name" className="text-sm font-semibold">
                  Display Name Override
                </Label>
                <p className="text-xs text-muted-foreground">
                  Your Dropbox name is used in audit entries. Override it here if needed.
                </p>
                <div className="flex gap-2">
                  <Input
                    id="display-name"
                    value={localUser}
                    onChange={(e) => setLocalUser(e.target.value)}
                    placeholder={dropboxUser.name ?? 'Your name'}
                  />
                  <Button variant="outline" size="sm" onClick={saveDisplayName} className="shrink-0">
                    Save
                  </Button>
                </div>
              </section>
            )}

            {/* ── Remove App (platform-specific uninstall) ─────────── */}
            {showUninstall && (
              <section className="space-y-2 pt-2 border-t border-destructive/20">
                <h3 className="text-sm font-semibold text-destructive/80">Remove App</h3>
                <p className="text-xs text-muted-foreground">
                  Removes the application from this {isMac ? 'Mac' : 'PC'}.{' '}
                  <strong>Your Dropbox data is never affected.</strong>
                </p>

                {/* Error from a failed uninstall attempt */}
                {uninstallError && (
                  <div className="flex items-start gap-2 p-3 border border-destructive/30 bg-destructive/5 rounded-md text-xs text-destructive">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="whitespace-pre-line">{uninstallError}</span>
                  </div>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setUninstallError(null); setUninstallOpen(true); }}
                  className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Uninstall App from this {isMac ? 'Mac' : 'PC'}…
                </Button>
              </section>
            )}
          </div>

          {/* ── Download progress ──────────────────────────────────── */}
          {downloadProgress !== null && !updateReady && (
            <div className="space-y-2 p-3 border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 rounded-md">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs text-blue-800 dark:text-blue-300 font-medium">
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  Downloading update…
                </div>
                <span className="text-xs text-blue-700 dark:text-blue-400 tabular-nums">
                  {Math.round(downloadProgress?.percent ?? 0)}%
                </span>
              </div>
              <Progress
                value={downloadProgress?.percent ?? 0}
                className="h-1.5 bg-blue-200 dark:bg-blue-800"
              />
            </div>
          )}

          {/* ── Update-ready notice ────────────────────────────────── */}
          {updateReady && (
            <div className="flex items-center justify-between gap-3 p-3 border border-green-200 bg-green-50 rounded-md">
              <p className="text-xs text-green-800 font-medium">
                Update ready — restart to install
              </p>
              <Button
                size="sm"
                className="gap-1.5 bg-green-600 hover:bg-green-700 text-white shrink-0"
                onClick={() => { onOpenChange(false); window.electronAPI.app.quitAndInstall(); }}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Restart
              </Button>
            </div>
          )}

          {/* ── Version ───────────────────────────────────────────── */}
          <div className="flex items-center justify-between pt-2">
            <p className="text-[10px] text-muted-foreground/50 select-none">
              {appVersion ? `v${appVersion}` : ''}
              {updateReady && (
                <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-medium text-green-700 leading-none">
                  Update ready
                </span>
              )}
            </p>
            <p className="text-[10px] text-muted-foreground/30 select-none tracking-wide">
              Powered by Craig ✦
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Folder browser (nested dialog) ──────────────────────────────── */}
      <DropboxFolderBrowser
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        initialPath={folderPath}
        detectedFolders={detectedFolders}
        onSelect={(path) => {
          setFolderPath(path);
          setBrowserOpen(false);
          window.electronAPI.settings.set({ dropboxFolderPath: path });
          setFolderSaved(true);
          setTimeout(() => setFolderSaved(false), 3000);
        }}
      />

      {/* ── Mismatch confirmation dialog ─────────────────────────────────── */}
      <AlertDialog open={mismatchConfirmOpen} onOpenChange={setMismatchConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use a different folder?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  The path you typed differs from the shared data folder
                  {detectedFolders.length === 1 && (
                    <>
                      {' '}detected at{' '}
                      <code className="font-mono text-xs bg-muted px-1 rounded break-all">
                        {parentOf(detectedFolders[0].pathDisplay) || '/ (Dropbox root)'}
                      </code>
                    </>
                  )}
                  {detectedFolders.length > 1 && ' already found in your Dropbox'}.
                </p>
                <p>
                  Saving a different path will create a{' '}
                  <strong>separate, disconnected data folder</strong> that other admins
                  won't see. Continue only if you're certain this is the right location.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void commitFolderPath()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Uninstall confirmation dialog ────────────────────────────────── */}
      <AlertDialog open={uninstallOpen} onOpenChange={setUninstallOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isMac ? 'Remove app from this Mac' : 'Uninstall app from this PC?'}
            </AlertDialogTitle>

            {isMac ? (
              /* macOS: informational only — no destructive action is taken */
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm">
                  <p>
                    To remove <strong>NAPA Courier Admin</strong> from your Mac, drag it
                    to the Trash:
                  </p>
                  <div className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all select-all">
                    {appBundlePath ?? '/Applications/NAPA Courier Admin.app'}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    After moving it to the Trash, empty the Trash to complete the removal.
                    You can also use a utility like AppCleaner to remove associated
                    preference files from <code>~/Library</code>.
                  </p>
                  <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                    ✓ <strong>Your Dropbox data is not affected.</strong> All locations,
                    backups, and settings are stored in your Dropbox account and will
                    remain there after the app is removed.
                  </div>
                </div>
              </AlertDialogDescription>
            ) : (
              /* Windows: explicit confirmation before running the uninstaller */
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm">
                  <p>
                    This will launch the uninstaller and remove{' '}
                    <strong>NAPA Courier Admin</strong> from this PC. The app will quit
                    immediately after the uninstaller starts.
                  </p>
                  <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                    ✓ <strong>Your Dropbox data is not affected.</strong> All locations,
                    backups, and settings are stored in your Dropbox account and will
                    remain there after the app is removed from this PC.
                  </div>
                  <p className="text-xs text-muted-foreground">
                    If you change your mind, you can reinstall the app at any time from
                    the GitHub Releases page.
                  </p>
                </div>
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>
              {isMac ? 'Close' : 'Cancel'}
            </AlertDialogCancel>

            {/* Windows only: actual destructive confirm button */}
            {isWin && (
              <AlertDialogAction
                onClick={handleUninstall}
                disabled={uninstalling}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
              >
                {uninstalling ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting…</>
                ) : (
                  <><Trash2 className="w-3.5 h-3.5" /> Uninstall</>
                )}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
