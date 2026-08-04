/**
 * GenerateLinksDialog
 *
 * Scans a Dropbox folder, generates a public shareable link for every file,
 * then matches each file against existing locations by account number.
 *
 * Primary flow  → matched locations get their Video URL overwritten (via
 *                  onApplyUpdates → store.updateLocation → audit trail)
 * Secondary     → unmatched files can be sent to the Import Wizard or
 *                  exported as CSV
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, Link2, CheckCircle2, AlertTriangle, RefreshCw,
  Download, ChevronRight, ArrowRight, ExternalLink,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Location } from '@/lib/store';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawResult {
  name: string;
  path: string;
  url: string;
  reused: boolean;
  error?: string;
}

export interface MatchedUpdate {
  id: string;
  accountNumber: string;
  siteName: string;
  oldVideoUrl: string | null;
  newVideoUrl: string;
}

interface UnmatchedItem {
  name: string;
  parsedAccount: string;
  parsedSiteName: string;
  url: string;
  error?: string;
}

export interface GenerateLinksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingLocations: Location[];
  /**
   * Called when the admin confirms "Apply Updates".
   * Each entry maps to one existing Location by id.
   * Caller should invoke store.updateLocation for each entry —
   * that handles audit trail, backup, and staging sync.
   */
  onApplyUpdates: (updates: MatchedUpdate[]) => void;
  /** Optional: send unmatched files to the import wizard. */
  onSendToImport?: (headers: string[], rows: Record<string, string>[]) => void;
}

// ─── Filename parser ──────────────────────────────────────────────────────────

/**
 * Parse a Dropbox video filename into { accountNumber, siteName }.
 *
 * Primary pattern — "### - NAME" (space-dash-space separator):
 *   "63 - BMW OF NWA.mp4"      → { accountNumber: "63",       siteName: "BMW OF NWA" }
 *   "00123456 - Site Name.mp4" → { accountNumber: "00123456", siteName: "Site Name"  }
 *
 * Fallback pattern — "###-NAME" (dash only, no spaces):
 *   "63-BMW-OF-NWA.mp4"        → { accountNumber: "63",       siteName: "BMW OF NWA" }
 *
 * Returns accountNumber as-is (preserving leading zeros) so it can be
 * compared directly against Location.accountNumber.
 */
function parseVideoFilename(name: string): { accountNumber: string; parsedSiteName: string } {
  const base = name.replace(/\.[^.]+$/, '').trim();

  // Primary: "ACCOUNT - NAME" (space, dash, space)
  const spaceMatch = base.match(/^([^\s].+?)\s+-\s+(.+)$/);
  if (spaceMatch) {
    return {
      accountNumber: spaceMatch[1].trim(),
      parsedSiteName: spaceMatch[2].trim(),
    };
  }

  // Fallback: "DIGITS-REST" (no spaces, dash-separated)
  const dashMatch = base.match(/^(\d+)-(.+)$/);
  if (dashMatch) {
    const siteName = dashMatch[2]
      .replace(/-+/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    return { accountNumber: dashMatch[1], parsedSiteName: siteName };
  }

  // No recognisable account number
  return {
    accountNumber: '',
    parsedSiteName: base.replace(/[-_]+/g, ' ').trim(),
  };
}

/** Normalise an account number for comparison (trim, collapse whitespace). */
function normaliseAcct(s: string) {
  return s.trim().replace(/\s+/g, ' ');
}

// ─── CSV export helper ────────────────────────────────────────────────────────

function esc(v: string) {
  return v.includes(',') || v.includes('"') || v.includes('\n')
    ? `"${v.replace(/"/g, '""')}"`
    : v;
}

function buildCsv(matched: MatchedUpdate[], unmatched: UnmatchedItem[]): string {
  const header = 'Account Number,Site Name,Old Video URL,New Video URL,Status';
  const mRows = matched.map((r) =>
    [esc(r.accountNumber), esc(r.siteName), esc(r.oldVideoUrl ?? ''), esc(r.newVideoUrl), 'matched'].join(','),
  );
  const uRows = unmatched
    .filter((r) => r.url)
    .map((r) =>
      [esc(r.parsedAccount), esc(r.parsedSiteName), '', esc(r.url), 'unmatched'].join(','),
    );
  return [header, ...mRows, ...uRows].join('\n');
}

// ─── Component ────────────────────────────────────────────────────────────────

type Status = 'idle' | 'loading' | 'review' | 'done' | 'error';
type ReviewTab = 'matched' | 'unmatched';

export function GenerateLinksDialog({
  open,
  onOpenChange,
  existingLocations,
  onApplyUpdates,
  onSendToImport,
}: GenerateLinksDialogProps) {
  const { toast } = useToast();
  const [folderPath, setFolderPath] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [matched, setMatched] = useState<MatchedUpdate[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedItem[]>([]);
  const [scanErrors, setScanErrors] = useState<RawResult[]>([]);
  const [activeTab, setActiveTab] = useState<ReviewTab>('matched');
  const [appliedCount, setAppliedCount] = useState(0);

  // Pre-fill the configured Dropbox folder path on first open.
  useEffect(() => {
    if (open && !folderPath) {
      window.electronAPI.settings.get().then((s) => {
        setFolderPath(s.dropboxFolderPath || '');
      });
    }
  }, [open]);

  const handleClose = (o: boolean) => {
    if (!o) {
      // Reset on close so it's fresh next time
      setStatus('idle');
      setMatched([]);
      setUnmatched([]);
      setScanErrors([]);
      setErrorMsg('');
      setActiveTab('matched');
    }
    onOpenChange(o);
  };

  const handleScan = useCallback(async () => {
    const path = folderPath.trim();
    if (!path) return;

    setStatus('loading');
    setMatched([]);
    setUnmatched([]);
    setScanErrors([]);
    setErrorMsg('');

    try {
      const res = await window.electronAPI.dropbox.generateLinks(path);

      if (!res.ok) {
        setErrorMsg(res.error ?? 'Unknown error from Dropbox');
        setStatus('error');
        return;
      }

      const results: RawResult[] = res.results ?? [];

      // Separate scan-level errors from successful link generations
      const good = results.filter((r) => r.url);
      const bad  = results.filter((r) => !r.url);
      setScanErrors(bad);

      // Build a lookup map: normalised account number → Location
      const byAccount = new Map<string, Location>();
      for (const loc of existingLocations) {
        const key = normaliseAcct(loc.accountNumber ?? '');
        if (key) byAccount.set(key.toLowerCase(), loc);
      }

      const newMatched: MatchedUpdate[] = [];
      const newUnmatched: UnmatchedItem[] = [];

      for (const raw of good) {
        const { accountNumber, parsedSiteName } = parseVideoFilename(raw.name);
        const loc = accountNumber
          ? byAccount.get(normaliseAcct(accountNumber).toLowerCase())
          : undefined;

        if (loc) {
          newMatched.push({
            id: loc.id,
            accountNumber: loc.accountNumber,
            siteName: loc.siteName,
            oldVideoUrl: loc.videoUrl,
            newVideoUrl: raw.url,
          });
        } else {
          newUnmatched.push({
            name: raw.name,
            parsedAccount: accountNumber,
            parsedSiteName,
            url: raw.url,
          });
        }
      }

      setMatched(newMatched);
      setUnmatched(newUnmatched);
      // If nothing matched, start on the unmatched tab so the admin isn't
      // staring at an empty table.
      setActiveTab(newMatched.length > 0 ? 'matched' : 'unmatched');
      setStatus('review');
    } catch (err: unknown) {
      setErrorMsg((err as Error).message);
      setStatus('error');
    }
  }, [folderPath, existingLocations]);

  const handleApply = () => {
    if (matched.length === 0) return;
    onApplyUpdates(matched);
    setAppliedCount(matched.length);
    setStatus('done');
  };

  const handleExportCsv = () => {
    const csv = buildCsv(matched, unmatched);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dropbox-video-links-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendUnmatchedToImport = () => {
    if (!onSendToImport) return;
    const headers = ['Site Name', 'Account Number', 'Video URL'];
    const rows = unmatched
      .filter((u) => u.url)
      .map((u) => ({
        'Site Name': u.parsedSiteName,
        'Account Number': u.parsedAccount,
        'Video URL': u.url,
      }));
    onSendToImport(headers, rows);
    handleClose(false);
  };

  const totalFiles = matched.length + unmatched.length + scanErrors.length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl flex flex-col max-h-[88vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            Update Video Links from Dropbox
          </DialogTitle>
          <DialogDescription>
            Scan a Dropbox folder, generate public shareable links, then apply them
            directly to matching location records. Existing links are never duplicated.
          </DialogDescription>
        </DialogHeader>

        <Separator />

        {/* ── Folder path input (always visible) ──────────────────────── */}
        <div className="flex gap-2 items-end pt-1">
          <div className="flex-1">
            <Label htmlFor="genFolderPath" className="mb-1.5 block">
              Dropbox Folder Path
            </Label>
            <Input
              id="genFolderPath"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="/Delivery Optimization/Delivery Walk Through Videos/Completed and Labeled Videos"
              disabled={status === 'loading'}
              onKeyDown={(e) => e.key === 'Enter' && handleScan()}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Only files directly inside this folder are scanned — subfolders are
              ignored. Filenames must follow the{' '}
              <span className="font-mono text-[10px]">### - Site Name</span> pattern.
            </p>
          </div>
          <Button
            onClick={handleScan}
            disabled={!folderPath.trim() || status === 'loading'}
            className="mb-6 shrink-0"
          >
            {status === 'loading' ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scanning…</>
            ) : (
              <><Link2 className="w-4 h-4 mr-2" />Scan Folder</>
            )}
          </Button>
        </div>

        {/* ── Loading ─────────────────────────────────────────────────── */}
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Scanning folder and generating links…</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Files are processed in parallel. Large folders (100 + files) may take
              20–30 seconds.
            </p>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────────── */}
        {status === 'error' && (
          <div className="flex items-start gap-3 bg-destructive/5 border border-destructive/20 rounded-md p-3">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Could not scan folder</p>
              <p className="text-xs text-muted-foreground mt-0.5">{errorMsg}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Check the path starts with <code className="text-[10px]">/</code> and
                your Dropbox connection is active.
              </p>
            </div>
          </div>
        )}

        {/* ── Review ──────────────────────────────────────────────────── */}
        {status === 'review' && (
          <div className="flex flex-col gap-3 min-h-0 flex-1">
            {/* Summary strip */}
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="text-muted-foreground">{totalFiles} file{totalFiles !== 1 ? 's' : ''} scanned</span>
              <span className="text-muted-foreground">·</span>
              <Badge className="bg-blue-600 hover:bg-blue-600 gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {matched.length} location{matched.length !== 1 ? 's' : ''} matched
              </Badge>
              {unmatched.length > 0 && (
                <Badge variant="outline" className="gap-1 text-amber-700 border-amber-400">
                  <AlertTriangle className="w-3 h-3" />
                  {unmatched.length} unmatched
                </Badge>
              )}
              {scanErrors.length > 0 && (
                <Badge variant="destructive" className="gap-1">
                  {scanErrors.length} link error{scanErrors.length !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>

            {/* Tab buttons */}
            <div className="flex gap-1 border-b">
              <button
                onClick={() => setActiveTab('matched')}
                className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === 'matched'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Matched ({matched.length})
              </button>
              <button
                onClick={() => setActiveTab('unmatched')}
                className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === 'unmatched'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Unmatched ({unmatched.length})
              </button>
            </div>

            {/* ── Matched tab ─────────────────────────────────────────── */}
            {activeTab === 'matched' && (
              <>
                {matched.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                    <AlertTriangle className="w-8 h-8 text-muted-foreground" />
                    <p className="text-sm font-medium">No locations matched</p>
                    <p className="text-xs text-muted-foreground max-w-xs">
                      None of the filenames could be matched to an existing location by
                      account number. Check the{' '}
                      <strong>Unmatched</strong> tab to see what was found.
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="flex-1 border rounded-md">
                    <div className="divide-y text-sm">
                      {/* Header row */}
                      <div className="grid grid-cols-[1fr_2fr_2fr] gap-3 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                        <span>Account / Site</span>
                        <span>Current Video URL</span>
                        <span>New Video URL</span>
                      </div>

                      {matched.map((m) => (
                        <div key={m.id} className="grid grid-cols-[1fr_2fr_2fr] gap-3 px-3 py-2.5 items-start">
                          {/* Account + site name */}
                          <div className="min-w-0">
                            <p className="font-medium truncate">{m.siteName}</p>
                            <p className="text-xs text-muted-foreground font-mono">
                              #{m.accountNumber}
                            </p>
                          </div>

                          {/* Old URL */}
                          <div className="min-w-0 pt-0.5">
                            {m.oldVideoUrl ? (
                              <a
                                href={m.oldVideoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-muted-foreground hover:text-foreground hover:underline truncate flex items-center gap-1"
                                title={m.oldVideoUrl}
                              >
                                <span className="truncate">{m.oldVideoUrl.replace(/^https?:\/\//, '')}</span>
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            ) : (
                              <span className="text-xs italic text-muted-foreground">none</span>
                            )}
                          </div>

                          {/* Arrow + new URL */}
                          <div className="min-w-0 pt-0.5 flex items-start gap-1">
                            <ArrowRight className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                            <a
                              href={m.newVideoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline truncate flex items-center gap-1 min-w-0"
                              title={m.newVideoUrl}
                            >
                              <span className="truncate">
                                {m.newVideoUrl.replace('https://www.dropbox.com', 'dropbox.com')}
                              </span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </>
            )}

            {/* ── Unmatched tab ────────────────────────────────────────── */}
            {activeTab === 'unmatched' && (
              <>
                {unmatched.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                    <CheckCircle2 className="w-8 h-8 text-green-500" />
                    <p className="text-sm font-medium text-green-700">All files matched</p>
                    <p className="text-xs text-muted-foreground">
                      Every file in the folder was matched to an existing location.
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="flex-1 border rounded-md">
                    <div className="divide-y text-sm">
                      <div className="px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                        These files have no matching location (by account number). They
                        won&apos;t be updated. Use the Import Wizard to add them as new records.
                      </div>
                      {unmatched.map((u, i) => (
                        <div key={i} className="px-3 py-2.5 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{u.name}</p>
                            <p className="text-xs text-muted-foreground">
                              Parsed account:{' '}
                              {u.parsedAccount ? (
                                <span className="font-mono">#{u.parsedAccount}</span>
                              ) : (
                                <span className="italic">could not parse account number</span>
                              )}
                            </p>
                          </div>
                          {u.url && (
                            <a
                              href={u.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline shrink-0 flex items-center gap-1"
                            >
                              Link <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </>
            )}

            {/* Footer actions */}
            <div className="flex items-center justify-between pt-1 shrink-0">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleExportCsv}>
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV
                </Button>
                {unmatched.length > 0 && onSendToImport && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSendUnmatchedToImport}
                    title="Send unmatched files to the Import Wizard to create new locations"
                  >
                    Import Unmatched…
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                )}
              </div>

              <Button
                size="sm"
                onClick={handleApply}
                disabled={matched.length === 0}
                className="gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                Apply Updates ({matched.length})
              </Button>
            </div>
          </div>
        )}

        {/* ── Done ────────────────────────────────────────────────────── */}
        {status === 'done' && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <p className="text-base font-semibold">
                {appliedCount} video link{appliedCount !== 1 ? 's' : ''} updated
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Changes are staged and ready to publish. Each update was logged in
                the audit trail.
              </p>
            </div>
            <div className="flex gap-2">
              {unmatched.length > 0 && onSendToImport && (
                <Button variant="outline" size="sm" onClick={handleSendUnmatchedToImport}>
                  Import {unmatched.length} Unmatched…
                </Button>
              )}
              <Button size="sm" onClick={() => handleClose(false)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
