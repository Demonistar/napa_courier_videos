import { useState, useEffect } from 'react';
import { Cloud, CloudOff, FolderOpen, LogOut, Moon, Monitor, RefreshCw, Sun } from 'lucide-react';
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
    // 'system' — follow OS preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefersDark);
  }
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

  useEffect(() => { setLocalUser(currentUser); }, [currentUser]);

  // Load current settings and app version when panel opens
  useEffect(() => {
    if (!open) return;
    window.electronAPI.settings.get().then((s) => {
      setFolderPath(s.dropboxFolderPath ?? '');
      if (s.displayNameOverride) setLocalUser(s.displayNameOverride);
      setTheme(s.theme ?? 'light');
    });
    window.electronAPI.app.getVersion().then(setAppVersion);
  }, [open]);

  const saveFolderPath = async () => {
    await window.electronAPI.settings.set({ dropboxFolderPath: folderPath });
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your Dropbox connection and data folder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* ── Dropbox Account ─────────────────────────────────────── */}
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

          {/* ── Appearance ──────────────────────────────────────────── */}
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

          {/* ── Dropbox Data Folder ─────────────────────────────────── */}
          <section className="space-y-2">
            <Label htmlFor="folder-path" className="text-sm font-semibold flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              Data Folder Path
            </Label>
            <p className="text-xs text-muted-foreground">
              The absolute Dropbox path where location files are stored (e.g.{' '}
              <code className="font-mono text-xs bg-muted px-1 rounded">/NAPA Courier Admin</code>).
              All admins must use the same path to share data.
            </p>
            <div className="flex gap-2">
              <Input
                id="folder-path"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="/NAPA Courier Admin"
                className="font-mono text-sm"
              />
              <Button variant="outline" size="sm" onClick={saveFolderPath} className="shrink-0">
                {folderSaved ? 'Saved ✓' : 'Save'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The app stores files inside a{' '}
              <code className="font-mono text-xs">NAPA Admin Data/</code> subfolder at this path.
              Changes take effect on next reload.
            </p>
          </section>

          {/* ── Display Name override ───────────────────────────────── */}
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

        {/* ── Update-ready notice ──────────────────────────────────── */}
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

        {/* ── Version + easter egg ─────────────────────────────────── */}
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
  );
}
