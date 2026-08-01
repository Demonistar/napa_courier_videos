import { useState } from 'react';
import { Clock, RotateCcw, Database, AlertTriangle, User, Globe } from 'lucide-react';
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
  /** Restores ONE location from a snapshot, leaving all other locations untouched */
  onRestoreSingle: (backupId: string) => boolean;
  /** Replaces the ENTIRE database with a snapshot — all locations reverted */
  onRestoreFull: (backupId: string) => boolean;
}

type ConfirmTarget = {
  id: string;
  mode: 'single' | 'full';
} | null;

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
  onRestoreSingle,
  onRestoreFull,
}: BackupRestoreProps) {
  const [confirm, setConfirm] = useState<ConfirmTarget>(null);
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const [restoredMode, setRestoredMode] = useState<'single' | 'full' | null>(null);
  const [showFullSection, setShowFullSection] = useState(false);

  const targetBackup = confirm ? backups.find((b) => b.id === confirm.id) : null;

  const handleConfirm = () => {
    if (!confirm) return;
    const fn = confirm.mode === 'single' ? onRestoreSingle : onRestoreFull;
    const success = fn(confirm.id);
    if (success) {
      setRestoredId(confirm.id);
      setRestoredMode(confirm.mode);
      setTimeout(() => {
        setRestoredId(null);
        setRestoredMode(null);
      }, 4000);
    }
    setConfirm(null);
  };

  // Split into per-record vs system-wide
  const recordSnapshots = backups.filter((b) => b.locationId !== null);
  const allSnapshots = backups; // Full restore can use any snapshot

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
              Snapshots are saved automatically before every edit, add, delete, or publish. The
              normal case is restoring a single record — only that one location changes, everything
              else stays exactly as it is.
            </DialogDescription>
          </DialogHeader>

          {restoredId && (
            <div
              className={`shrink-0 flex items-center gap-2 p-3 border rounded-md text-sm ${
                restoredMode === 'full'
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-green-50 border-green-200 text-green-800'
              }`}
            >
              {restoredMode === 'full'
                ? 'Full system restore complete. All locations reverted to the selected snapshot.'
                : 'Record restored. Only that location was changed — everything else is untouched.'}
            </div>
          )}

          <div className="flex-1 overflow-hidden flex flex-col gap-0 min-h-0">
            {/* ── Section 1: Single-record restore ───────────────────── */}
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center gap-2 px-1 py-2 shrink-0">
                <User className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Restore a Single Record</h3>
                <Badge variant="secondary" className="text-xs py-0">
                  {recordSnapshots.length}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground px-1 pb-2 shrink-0">
                Clicking <strong>Restore this record</strong> only reverts that one location. Every
                other location stays exactly as it is right now.
              </p>

              {recordSnapshots.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                  <Database className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-sm">No per-record snapshots yet</p>
                  <p className="text-xs mt-1">
                    Snapshots appear here after you edit, add, or delete a location.
                  </p>
                </div>
              ) : (
                <ScrollArea className="flex-1 min-h-0 pr-1">
                  <div className="space-y-2 pb-1">
                    {recordSnapshots.map((backup, index) => (
                      <div
                        key={backup.id}
                        className={`flex items-start justify-between gap-3 p-3 border rounded-md transition-colors ${
                          restoredId === backup.id && restoredMode === 'single'
                            ? 'border-green-300 bg-green-50'
                            : 'hover:bg-muted/40'
                        }`}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <Clock className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-foreground truncate">
                                {backup.locationName}
                              </p>
                              <Badge
                                variant="outline"
                                className="text-xs py-0 capitalize shrink-0"
                              >
                                {actionVerb(backup.label)}
                              </Badge>
                              {index === 0 && (
                                <Badge className="text-xs py-0 bg-blue-100 text-blue-800 border-blue-200 shrink-0">
                                  Most recent
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatAbsolute(backup.timestamp)} · {formatRelative(backup.timestamp)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {backup.locationCount} locations in database at this point
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirm({ id: backup.id, mode: 'single' })}
                          className="shrink-0"
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                          Restore this record
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>

            {/* ── Section 2: Full system restore ─────────────────────── */}
            <div className="shrink-0 mt-2">
              <Separator />
              <button
                className="flex items-center gap-2 w-full px-1 py-2 text-left hover:bg-muted/40 rounded transition-colors group"
                onClick={() => setShowFullSection((v) => !v)}
              >
                <Globe className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-muted-foreground group-hover:text-foreground transition-colors">
                  Full System Restore
                </h3>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 ml-1" />
                <span className="text-xs text-muted-foreground ml-auto">
                  {showFullSection ? 'Hide' : 'Show'}
                </span>
              </button>

              {showFullSection && (
                <div className="mt-1 space-y-2">
                  <div className="flex items-start gap-2 p-3 border border-amber-200 bg-amber-50 rounded-md text-xs text-amber-800">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>
                      <strong>Reverts every location</strong>, not just one. Use this only if
                      something went wrong across the whole database. All edits made after the
                      chosen snapshot will be lost for all records.
                    </p>
                  </div>

                  {allSnapshots.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 py-2">No snapshots available.</p>
                  ) : (
                    <ScrollArea className="max-h-48 pr-1">
                      <div className="space-y-2 pb-1">
                        {allSnapshots.map((backup) => (
                          <div
                            key={backup.id}
                            className={`flex items-start justify-between gap-3 p-3 border rounded-md transition-colors ${
                              restoredId === backup.id && restoredMode === 'full'
                                ? 'border-amber-300 bg-amber-50'
                                : 'hover:bg-muted/40'
                            }`}
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <Clock className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {backup.label}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {formatAbsolute(backup.timestamp)} · {formatRelative(backup.timestamp)}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {backup.locationCount} locations in database at this point
                                </p>
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirm({ id: backup.id, mode: 'full' })}
                              className="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50"
                            >
                              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                              Restore all
                            </Button>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Confirm: single-record restore ───────────────────────────── */}
      <AlertDialog
        open={!!confirm && confirm.mode === 'single'}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-primary" />
              Restore this record only?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  This will revert{' '}
                  <strong className="text-foreground">
                    {targetBackup?.locationName ?? 'this location'}
                  </strong>{' '}
                  back to its state from{' '}
                  <strong className="text-foreground">
                    {targetBackup ? formatAbsolute(targetBackup.timestamp) : ''}
                  </strong>
                  .
                </p>
                <div className="p-3 bg-green-50 border border-green-200 rounded-md text-green-800 text-xs">
                  ✓ Every other location in the database will stay exactly as it is right now.
                  Nothing else changes.
                </div>
                <p>Your current state is saved as a new snapshot first, so this can be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              Restore {targetBackup?.locationName ?? 'this record'} only
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Confirm: full system restore ─────────────────────────────── */}
      <AlertDialog
        open={!!confirm && confirm.mode === 'full'}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Restore the entire database?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  This will revert{' '}
                  <strong className="text-foreground">every location</strong> back to the state
                  from{' '}
                  <strong className="text-foreground">
                    {targetBackup ? formatAbsolute(targetBackup.timestamp) : ''}
                  </strong>
                  .
                </p>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-xs">
                  ⚠ All edits made after that snapshot — to every record — will be undone. This is
                  not limited to one location.
                </div>
                <p>Your current state is saved as a new snapshot first, so this can be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Yes, restore entire database
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
