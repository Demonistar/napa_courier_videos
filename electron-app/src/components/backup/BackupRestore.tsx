/**
 * BackupRestore — Electron version.
 * Same UI as the web app but handlers are async (Promise<boolean>).
 * Also accepts an isLoading prop for when backups are being fetched from Dropbox.
 */
import { useState } from 'react';
import { Clock, RotateCcw, Database, AlertTriangle, Globe, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { BackupEntry } from '@/lib/store';

interface BackupRestoreProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backups: BackupEntry[];
  isLoading?: boolean;
  onRestoreSingle: (backupId: string) => Promise<boolean>;
  onRestoreFull: (backupId: string) => Promise<boolean>;
}

type ConfirmTarget = { id: string; mode: 'single' | 'full' } | null;

function formatRelative(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatAbsolute(isoString: string): string {
  return new Date(isoString).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function actionVerb(label: string): string {
  if (label.startsWith('Added')) return 'added';
  if (label.startsWith('Edited')) return 'edited';
  if (label.startsWith('Deleted')) return 'deleted';
  if (label.startsWith('Restored')) return 'restored';
  return 'changed';
}

export function BackupRestore({
  open,
  onOpenChange,
  backups,
  isLoading,
  onRestoreSingle,
  onRestoreFull,
}: BackupRestoreProps) {
  const [confirm, setConfirm] = useState<ConfirmTarget>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const [showFullSection, setShowFullSection] = useState(false);

  const targetBackup = confirm ? backups.find((b) => b.id === confirm.id) : null;

  const handleConfirm = async () => {
    if (!confirm) return;
    setRestoring(true);
    try {
      const fn = confirm.mode === 'single' ? onRestoreSingle : onRestoreFull;
      const success = await fn(confirm.id);
      if (success) {
        setRestoredId(confirm.id);
        setTimeout(() => setRestoredId(null), 4000);
      }
    } finally {
      setRestoring(false);
      setConfirm(null);
    }
  };

  const recordSnapshots = backups.filter((b) => b.locationId !== null);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Database className="w-5 h-5" />
              Backup &amp; Restore
            </DialogTitle>
            <DialogDescription>
              Snapshots are saved to Dropbox automatically before every edit. Each backup is a
              separate timestamped file in your <code>backups/</code> folder.
            </DialogDescription>
          </DialogHeader>

          {restoredId && (
            <div className="shrink-0 flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-800">
              <RotateCcw className="w-4 h-4" />
              Restore applied. Changes saved to Dropbox.
            </div>
          )}

          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-6 pr-1">

              {/* ── Per-record restore (primary) ──────────────────── */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Restore a Single Record</h3>
                <p className="text-xs text-muted-foreground">
                  Restores one location to how it looked at that moment. Every other location is
                  left exactly as it currently is.
                </p>

                {isLoading ? (
                  <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading backups from Dropbox…
                  </div>
                ) : recordSnapshots.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground border border-dashed rounded-lg">
                    No per-record snapshots yet.
                    <br />
                    <span className="text-xs">They appear here after your first edit.</span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recordSnapshots.map((backup) => (
                      <div
                        key={backup.id}
                        className={`flex items-center gap-3 p-3 rounded-md border transition-colors ${
                          restoredId === backup.id
                            ? 'bg-green-50 border-green-200'
                            : 'bg-card hover:bg-muted/30'
                        }`}
                      >
                        <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {backup.locationName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            <span className="capitalize">{actionVerb(backup.label)}</span>
                            {' · '}
                            {formatRelative(backup.timestamp)}
                            {' · '}
                            {formatAbsolute(backup.timestamp)}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirm({ id: backup.id, mode: 'single' })}
                          className="shrink-0 text-xs"
                        >
                          Restore record
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <Separator />

              {/* ── Full system restore (secondary) ──────────────── */}
              <section className="space-y-3">
                <button
                  className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary transition-colors"
                  onClick={() => setShowFullSection((v) => !v)}
                >
                  <Globe className="w-4 h-4" />
                  Full System Restore
                  <Badge variant="outline" className="text-[10px] px-1.5 border-amber-300 text-amber-700">
                    Reverts everything
                  </Badge>
                  <span className="text-muted-foreground font-normal text-xs ml-1">
                    {showFullSection ? '▲ Hide' : '▼ Show'}
                  </span>
                </button>

                {showFullSection && (
                  <>
                    <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
                      <strong>All edits made after that snapshot</strong> — to every location —
                      will be undone. This is not limited to one record.
                    </div>
                    {isLoading ? (
                      <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading backups…
                      </div>
                    ) : backups.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No snapshots yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {backups.map((backup) => (
                          <div
                            key={backup.id}
                            className="flex items-center gap-3 p-3 rounded-md border bg-card hover:bg-muted/30"
                          >
                            <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {backup.label}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatRelative(backup.timestamp)}
                                {' · '}
                                {formatAbsolute(backup.timestamp)}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirm({ id: backup.id, mode: 'full' })}
                              className="shrink-0 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                            >
                              Restore all
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* ── Confirm: single record ────────────────────────────────────── */}
      <AlertDialog open={!!confirm && confirm.mode === 'single'} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this record?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Restores <strong className="text-foreground">{targetBackup?.locationName}</strong>{' '}
                  to its state from <strong className="text-foreground">{targetBackup ? formatAbsolute(targetBackup.timestamp) : ''}</strong>.
                </p>
                <div className="p-3 bg-green-50 border border-green-200 rounded-md text-green-800 text-xs">
                  ✓ Every other location in the database will stay exactly as it is right now.
                  Nothing else changes.
                </div>
                <p>Your current state is saved as a new backup first, so this can be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={restoring} className="gap-2">
              {restoring && <Loader2 className="w-4 h-4 animate-spin" />}
              Restore this record only
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Confirm: full system ──────────────────────────────────────── */}
      <AlertDialog open={!!confirm && confirm.mode === 'full'} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Restore the entire database?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  This will revert <strong className="text-foreground">every location</strong> back
                  to the state from{' '}
                  <strong className="text-foreground">
                    {targetBackup ? formatAbsolute(targetBackup.timestamp) : ''}
                  </strong>.
                </p>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-xs">
                  ⚠ All edits after that snapshot — to every record — will be undone.
                </div>
                <p>Your current state is saved as a new backup first.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={restoring}
              className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
            >
              {restoring && <Loader2 className="w-4 h-4 animate-spin" />}
              Yes, restore entire database
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
