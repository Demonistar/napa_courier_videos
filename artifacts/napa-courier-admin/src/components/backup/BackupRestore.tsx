import { useState } from 'react';
import { Clock, RotateCcw, Database, AlertTriangle } from 'lucide-react';
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
import { BackupEntry } from '@/lib/store';

interface BackupRestoreProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backups: BackupEntry[];
  onRestore: (backupId: string) => boolean;
}

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
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function BackupRestore({ open, onOpenChange, backups, onRestore }: BackupRestoreProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [restoredId, setRestoredId] = useState<string | null>(null);

  const targetBackup = confirmId ? backups.find((b) => b.id === confirmId) : null;

  const handleConfirmRestore = () => {
    if (!confirmId) return;
    const success = onRestore(confirmId);
    if (success) {
      setRestoredId(confirmId);
      setTimeout(() => setRestoredId(null), 3000);
    }
    setConfirmId(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="w-5 h-5" />
              Backup &amp; Restore
            </DialogTitle>
            <DialogDescription>
              The last {backups.length === 0 ? '0' : `${backups.length}`} change
              {backups.length !== 1 ? 's' : ''} are saved as full snapshots. Restoring one
              replaces the current database state — it can be undone by restoring a later
              snapshot.
            </DialogDescription>
          </DialogHeader>

          {restoredId && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-800">
              Database restored successfully. The current state has been updated.
            </div>
          )}

          {backups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Database className="w-10 h-10 mb-3 opacity-30" />
              <p className="font-medium">No snapshots yet</p>
              <p className="text-xs mt-1">
                Snapshots are created automatically before every add, edit, delete, or publish
                action.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-96 pr-2">
              <div className="space-y-2">
                {backups.map((backup, index) => (
                  <div
                    key={backup.id}
                    className={`flex items-start justify-between gap-3 p-3 border rounded-md transition-colors ${
                      restoredId === backup.id
                        ? 'border-green-300 bg-green-50'
                        : 'hover:bg-muted/40'
                    }`}
                    data-testid={`backup-entry-${backup.id}`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <Clock className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {backup.label}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatAbsolute(backup.timestamp)}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs py-0">
                            {backup.locationCount} location{backup.locationCount !== 1 ? 's' : ''}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatRelative(backup.timestamp)}
                          </span>
                          {index === 0 && (
                            <Badge className="text-xs py-0 bg-blue-100 text-blue-800 border-blue-200">
                              Most recent
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmId(backup.id)}
                      className="shrink-0"
                      data-testid={`button-restore-${backup.id}`}
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmId} onOpenChange={(o) => !o && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Restore this snapshot?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the current database with the snapshot from{' '}
              <strong>{targetBackup ? formatAbsolute(targetBackup.timestamp) : ''}</strong>.
              <br />
              <br />
              Your current state will be saved as a new snapshot first, so you can undo this
              restore if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRestore}>Restore Snapshot</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
