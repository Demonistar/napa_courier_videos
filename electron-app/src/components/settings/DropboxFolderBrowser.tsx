import { useState, useEffect } from 'react';
import { AlertCircle, ChevronRight, Folder, Home, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface FolderEntry {
  name: string;
  pathDisplay: string;
  pathLower: string;
}

export interface DetectedFolder {
  name: string;
  pathDisplay: string;
  pathLower: string;
}

interface DropboxFolderBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The current dropboxFolderPath setting — browser starts here so the admin
   * lands where they already configured rather than at the root.
   */
  initialPath?: string;
  /**
   * Pre-detected "NAPA Admin Data" folders found by findNapaAdminFolders().
   * Shown as quick-pick banners at the top of the browser so new admins are
   * immediately steered to the folder the other admins are already using.
   */
  detectedFolders: DetectedFolder[];
  /**
   * Called with the selected PARENT folder path (i.e. the value that should
   * become dropboxFolderPath — the app will place "NAPA Admin Data" inside it).
   */
  onSelect: (parentPath: string) => void;
}

/** Strip the last segment from a Dropbox path to get its parent. */
function parentOf(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx > 0 ? p.substring(0, idx) : '';
}

/** Build breadcrumb segments from a Dropbox path string. */
function toBreadcrumbs(path: string): Array<{ label: string; path: string }> {
  if (!path) return [{ label: 'Dropbox', path: '' }];
  const parts = path.split('/').filter(Boolean);
  return [
    { label: 'Dropbox', path: '' },
    ...parts.map((p, i) => ({ label: p, path: '/' + parts.slice(0, i + 1).join('/') })),
  ];
}

export function DropboxFolderBrowser({
  open,
  onOpenChange,
  initialPath,
  detectedFolders,
  onSelect,
}: DropboxFolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null);

  // Start at the currently-configured path when the dialog opens.
  useEffect(() => {
    if (open) setCurrentPath(initialPath || '');
  }, [open, initialPath]);

  // Reset test result whenever the admin navigates to a new path.
  useEffect(() => {
    setTestResult(null);
  }, [currentPath]);

  // Reload folder listing whenever currentPath changes (while open).
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    window.electronAPI.dropbox
      .listFolder(currentPath)
      .then((result) => {
        if (result.ok && result.folders) {
          setEntries(
            [...result.folders].sort((a, b) => a.name.localeCompare(b.name))
          );
        } else {
          setError(result.error ?? 'Could not load folder');
          setEntries([]);
        }
      })
      .catch((err: unknown) => {
        setError(String(err));
        setEntries([]);
      })
      .finally(() => setLoading(false));
  }, [open, currentPath]);

  const testCurrentPath = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.electronAPI.dropbox.testFolderPath(currentPath);
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: String(err) });
    } finally {
      setTesting(false);
    }
  };

  const breadcrumbs = toBreadcrumbs(currentPath);
  const hasDetected = detectedFolders.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl flex flex-col gap-0 p-0 max-h-[82vh]">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <DialogTitle>Browse Dropbox Folders</DialogTitle>
          <DialogDescription>
            Navigate to the folder that should{' '}
            <strong>contain</strong> the{' '}
            <code className="font-mono text-xs bg-muted px-1 rounded">
              NAPA Admin Data
            </code>{' '}
            subfolder, then click{' '}
            <strong>"Select This Folder"</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
          {/* ── Detected folders — shown at top as quick-picks ─────── */}
          {hasDetected && (
            <div
              className={cn(
                'mx-4 mt-3 p-3 rounded-md border text-xs space-y-2 shrink-0',
                detectedFolders.length === 1
                  ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900'
                  : 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900'
              )}
            >
              <p
                className={cn(
                  'font-semibold',
                  detectedFolders.length === 1
                    ? 'text-green-800 dark:text-green-300'
                    : 'text-amber-800 dark:text-amber-300'
                )}
              >
                {detectedFolders.length === 1
                  ? '✓ Existing shared data folder found — click Use This to connect to it:'
                  : `${detectedFolders.length} existing data folders found — pick the one the other admins are using:`}
              </p>
              {detectedFolders.map((f) => (
                <div
                  key={f.pathLower}
                  className="flex items-center justify-between gap-3 flex-wrap"
                >
                  <code
                    className={cn(
                      'font-mono break-all flex-1',
                      detectedFolders.length === 1
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-amber-700 dark:text-amber-400'
                    )}
                  >
                    {parentOf(f.pathDisplay) || '/ (Dropbox root)'}
                  </code>
                  <Button
                    size="sm"
                    variant={detectedFolders.length === 1 ? 'default' : 'outline'}
                    className={cn(
                      'shrink-0 h-7 text-xs',
                      detectedFolders.length === 1
                        ? 'bg-green-600 hover:bg-green-700 text-white'
                        : 'border-amber-300 text-amber-800 hover:bg-amber-100'
                    )}
                    onClick={() => onSelect(parentOf(f.pathDisplay))}
                  >
                    Use This
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* ── Breadcrumb navigation ───────────────────────────────── */}
          <div className="flex items-center gap-1 px-4 py-2 text-sm overflow-x-auto shrink-0 border-b">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path} className="flex items-center gap-1 shrink-0">
                {i > 0 && (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                )}
                <button
                  onClick={() => i < breadcrumbs.length - 1 && setCurrentPath(crumb.path)}
                  className={cn(
                    'transition-colors max-w-[160px] truncate',
                    i === breadcrumbs.length - 1
                      ? 'text-foreground font-medium cursor-default'
                      : 'text-muted-foreground hover:text-foreground hover:underline'
                  )}
                  title={crumb.path || 'Dropbox root'}
                >
                  {i === 0 ? <Home className="w-3.5 h-3.5" /> : crumb.label}
                </button>
              </span>
            ))}
          </div>

          {/* ── Folder list ─────────────────────────────────────────── */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-4 py-2">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading folders…</span>
                </div>
              ) : error ? (
                <div className="flex items-center gap-2 py-8 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : entries.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No subfolders here. You can select this folder as-is using the
                  button below.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {entries.map((entry) => (
                    <button
                      key={entry.pathLower}
                      onClick={() => setCurrentPath(entry.pathDisplay)}
                      className="flex items-center gap-2.5 w-full px-2 py-2 rounded-md hover:bg-accent text-sm transition-colors text-left group"
                    >
                      <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                      <span className="flex-1 truncate">{entry.name}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── Footer — shows selected path + action buttons ───────────── */}
        <div className="flex flex-col gap-2 px-5 py-4 border-t bg-muted/30 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                Selected folder
              </p>
              <code className="text-xs font-mono text-foreground block truncate">
                {currentPath || '/ (Dropbox root)'}
              </code>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void testCurrentPath()}
                disabled={testing}
                className="gap-1"
                title="Check whether this path exists in your Dropbox"
              >
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Test
              </Button>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => onSelect(currentPath)}>
                Select This Folder
              </Button>
            </div>
          </div>

          {/* Test result */}
          {testResult !== null && (
            <div
              className={[
                'flex items-start gap-2 px-2.5 py-2 rounded-md text-xs',
                testResult.ok
                  ? 'border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 text-green-800 dark:text-green-300'
                  : 'border border-destructive/30 bg-destructive/5 text-destructive',
              ].join(' ')}
            >
              <span>{testResult.ok ? testResult.message : testResult.error}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
