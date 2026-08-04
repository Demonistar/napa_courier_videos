import { useState, useEffect } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  CloudOff,
  FolderOpen,
  Loader2,
  LogOut,
  Moon,
  Monitor,
  RefreshCw,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropboxFolderBrowser, type DetectedFolder } from './DropboxFolderBrowser';
import { DropboxUserInfo } from '@/hooks/use-dropbox-user';

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dropboxUser: DropboxUserInfo;
  onDropboxDisconnect: () => void;
  onDropboxRefresh: () => void;
  currentUser: string;
  onCurrentUserChange: (name: string) => void;
  updateReady?: boolean;
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
}: SettingsPanelProps) {
  const [folderPath, setFolderPath] = useState('');
  const [folderSaved, setFolderSaved] = useState(false);
  const [localUser, setLocalUser] = useState(currentUser);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('light');

  // Folder browser + auto-detection state
  const [browserOpen, setBrowserOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectedFolders, setDetectedFolders] = useState<DetectedFolder[]>([]);

  useEffect(() => { setLocalUser(currentUser); }, [currentUser]);

  // Load settings + app version when panel opens.
  useEffect(() => {
    if (!open) return;
    window.electronAPI.settings.get().then((s) => {
      setFolderPath(s.dropboxFolderPath ?? '');
      if (s.displayNameOverride) setLocalUser(s.displayNameOverride);
      setTheme(s.theme ?? 'light');
    });
    window.electronAPI.app.getVersion().then(setAppVersion);
  }, [open]);

  // Auto-detect existing "NAPA Admin Data" folders when the panel opens and
  // Dropbox is connected.  Steers new admins to the shared folder immediately.
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

  const saveFolderPath = async () => {
    await window.electronAPI.settings.set({ dropboxFolderPath: folderPath });
    setFolderSaved(true);
    setTimeout(() => setFolderSaved(false), 3000);
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
            {/* ── Dropbox Account ───────────────────────────────────── */}
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

            {/* ── Appearance ────────────────────────────────────────── */}
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

            {/* ── Dropbox Data Folder ───────────────────────────────── */}
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

              {/* Auto-detection results ──────────────────────────────── */}
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

              {/* Path input + save + browse ─────────────────────────── */}
              <div className="flex gap-2">
                <Input
                  id="folder-path"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="/NAPA Courier Admin"
                  className="font-mono text-sm"
                />
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
              <p className="text-xs text-muted-foreground">
                The app stores files inside a{' '}
                <code className="font-mono text-xs">NAPA Admin Data/</code> subfolder at
                this path. Changes take effect on next data reload.
              </p>
            </section>

            {/* ── Display Name override ──────────────────────────────── */}
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
          </div>

          {/* ── Update-ready notice ────────────────────────────────────── */}
          {updateReady && (
            <div className="flex items-center justify-between gap-3 p-3 border border-green-200 bg-green-50 rounded-md">
              <p className="text-xs text-green-800 font-medium">
                Update ready — restart to install
              </p>
              <Button
                size="sm"
                className="gap-1.5 bg-green-600 hover:bg-green-700 text-white shrink-0"
                onClick={() => window.electronAPI.app.quitAndInstall()}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Restart
              </Button>
            </div>
          )}

          {/* ── Version + easter egg ──────────────────────────────────── */}
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

      {/* Folder browser — nested dialog, opened from the Browse button ─────── */}
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
    </>
  );
}
