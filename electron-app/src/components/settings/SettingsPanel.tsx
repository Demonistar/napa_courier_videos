import { useState, useEffect } from 'react';
import { Cloud, CloudOff, FolderOpen, LogOut } from 'lucide-react';
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
}

export function SettingsPanel({
  open,
  onOpenChange,
  dropboxUser,
  onDropboxDisconnect,
  currentUser,
  onCurrentUserChange,
}: SettingsPanelProps) {
  const [folderPath, setFolderPath] = useState('');
  const [folderSaved, setFolderSaved] = useState(false);
  const [localUser, setLocalUser] = useState(currentUser);

  useEffect(() => { setLocalUser(currentUser); }, [currentUser]);

  // Load current settings when panel opens
  useEffect(() => {
    if (!open) return;
    window.electronAPI.settings.get().then((s) => {
      setFolderPath(s.dropboxFolderPath ?? '');
      if (s.displayNameOverride) setLocalUser(s.displayNameOverride);
    });
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
              The app creates <code className="font-mono text-xs">locations-staging.json</code>,{' '}
              <code className="font-mono text-xs">locations-live.json</code>, and a{' '}
              <code className="font-mono text-xs">backups/</code> subfolder inside this path.
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
      </DialogContent>
    </Dialog>
  );
}
