import { useState, useEffect } from 'react';
import { Cloud, CloudOff, AlertTriangle, RefreshCw, LogOut, FolderOpen, Info } from 'lucide-react';
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
  onDropboxRefresh,
  currentUser,
  onCurrentUserChange,
}: SettingsPanelProps) {
  const [folderUrl, setFolderUrl] = useState('');
  const [folderSaved, setFolderSaved] = useState(false);
  const [folderLoading, setFolderLoading] = useState(false);
  const [localUser, setLocalUser] = useState(currentUser);

  // Load folder URL from server on open
  useEffect(() => {
    if (!open) return;
    fetch('/api/settings', { credentials: 'include' })
      .then((r) => r.json())
      .then((d: { dropboxFolderUrl?: string }) => {
        setFolderUrl(d.dropboxFolderUrl ?? '');
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    setLocalUser(currentUser);
  }, [currentUser]);

  const saveFolderUrl = async () => {
    setFolderLoading(true);
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropboxFolderUrl: folderUrl }),
      });
      setFolderSaved(true);
      setTimeout(() => setFolderSaved(false), 3000);
    } catch {
      // ignore
    } finally {
      setFolderLoading(false);
    }
  };

  const saveLocalUser = () => {
    onCurrentUserChange(localUser.trim() || 'Unknown user');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your Dropbox connection and app preferences.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* ── Dropbox Connection ─────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Dropbox Connection</h3>

            {dropboxUser.connected ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 border rounded-md bg-muted/30">
                  <Cloud className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{dropboxUser.name}</p>
                    <p className="text-xs text-muted-foreground">{dropboxUser.email}</p>
                    {dropboxUser.expiresAt && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Session valid until{' '}
                        {new Date(dropboxUser.expiresAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    )}
                  </div>
                </div>

                {dropboxUser.needsReauth && (
                  <div className="flex items-start gap-2 p-3 border border-amber-200 bg-amber-50 rounded-md text-sm text-amber-800">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Session expiring soon</p>
                      <p className="text-xs mt-0.5">
                        Refresh now to continue using your Dropbox identity for the next 30 days.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={onDropboxRefresh}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    Refresh Session
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onDropboxDisconnect}
                    className="text-destructive hover:text-destructive"
                  >
                    <LogOut className="w-3.5 h-3.5 mr-1.5" />
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 border rounded-md bg-muted/30">
                  <CloudOff className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Not connected</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Dropbox is not connected. Your changes will be attributed to the display name
                      below instead.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-3 border border-blue-100 bg-blue-50 rounded-md text-xs text-blue-800">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>
                    To connect Dropbox, authorize the Dropbox connector in the Replit integrations
                    panel (sidebar &rsaquo; Integrations), then refresh this page.
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* ── Identity Fallback ──────────────────────────────────────── */}
          {!dropboxUser.connected && (
            <section className="space-y-2">
              <Label htmlFor="display-name" className="text-sm font-semibold">
                Display Name (when Dropbox is not connected)
              </Label>
              <p className="text-xs text-muted-foreground">
                This name will appear in audit log entries as the author of changes.
              </p>
              <div className="flex gap-2">
                <Input
                  id="display-name"
                  value={localUser}
                  onChange={(e) => setLocalUser(e.target.value)}
                  placeholder="Your name"
                  data-testid="input-display-name"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={saveLocalUser}
                  className="shrink-0"
                  data-testid="button-save-display-name"
                >
                  Save
                </Button>
              </div>
            </section>
          )}

          {/* ── Dropbox Folder URL ─────────────────────────────────────── */}
          <section className="space-y-2">
            <Label htmlFor="folder-url" className="text-sm font-semibold flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              Dropbox Shared Folder URL
            </Label>
            <p className="text-xs text-muted-foreground">
              Paste the shared Dropbox folder link where delivery videos are stored. Video sync is
              not yet active — this field is a placeholder for a future feature.
            </p>
            <div className="flex gap-2">
              <Input
                id="folder-url"
                type="url"
                value={folderUrl}
                onChange={(e) => setFolderUrl(e.target.value)}
                placeholder="https://www.dropbox.com/sh/..."
                data-testid="input-folder-url"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={saveFolderUrl}
                disabled={folderLoading}
                className="shrink-0"
                data-testid="button-save-folder-url"
              >
                {folderSaved ? 'Saved' : 'Save'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Video sync will be enabled in a future update once the folder is provided.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
