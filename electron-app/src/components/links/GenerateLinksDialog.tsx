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
  Download, Copy, ChevronRight, ExternalLink,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawResult {
  name: string;
  path: string;
  url: string;
  reused: boolean;
  error?: string;
}

interface ParsedResult extends RawResult {
  parsedSiteName: string;
  parsedAccountNumber: string;
}

export interface GenerateLinksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the admin clicks "Open in Import Wizard". */
  onSendToImport: (headers: string[], rows: Record<string, string>[]) => void;
}

// ─── Filename parser ──────────────────────────────────────────────────────────

/**
 * Best-effort parse of a video filename into (siteName, accountNumber).
 *
 * Expected naming: "{account}-{SITE-NAME-WORDS}.ext"
 *   e.g.  "63-BMW-OF-NWA.mp4"  → { accountNumber: "63", siteName: "BMW Of Nwa" }
 *         "00123456-SHERIFFS-OFFICE.mp4" → { accountNumber: "00123456", siteName: "Sheriffs Office" }
 *
 * Falls back to the full base name (dashes → spaces) as the site name if the
 * pattern doesn't match.
 */
function parseVideoFilename(name: string): { siteName: string; accountNumber: string } {
  const base = name.replace(/\.[^.]+$/, '').trim(); // strip extension
  // Leading digit(s), then a dash, then the rest
  const m = base.match(/^(\d+)-(.+)$/);
  if (m) {
    const siteName = m[2]
      .replace(/-+/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    return { accountNumber: m[1], siteName };
  }
  const siteName = base
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return { accountNumber: '', siteName };
}

// ─── CSV helper ───────────────────────────────────────────────────────────────

function buildCsv(results: ParsedResult[]): string {
  const esc = (v: string) =>
    v.includes(',') || v.includes('"') || v.includes('\n')
      ? `"${v.replace(/"/g, '""')}"`
      : v;
  const header = 'Site Name,Account Number,Video URL,Filename';
  const rows = results
    .filter((r) => r.url)
    .map((r) =>
      [esc(r.parsedSiteName), esc(r.parsedAccountNumber), esc(r.url), esc(r.name)].join(','),
    );
  return [header, ...rows].join('\n');
}

// ─── Component ────────────────────────────────────────────────────────────────

type Status = 'idle' | 'loading' | 'done' | 'error';

export function GenerateLinksDialog({
  open,
  onOpenChange,
  onSendToImport,
}: GenerateLinksDialogProps) {
  const { toast } = useToast();
  const [folderPath, setFolderPath] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [results, setResults] = useState<ParsedResult[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  // Pre-fill the folder path from the configured Dropbox folder on first open.
  useEffect(() => {
    if (open) {
      window.electronAPI.settings.get().then((s) => {
        if (!folderPath) setFolderPath(s.dropboxFolderPath || '');
      });
    }
  }, [open]);

  const handleGenerate = useCallback(async () => {
    const path = folderPath.trim();
    if (!path) return;

    setStatus('loading');
    setResults([]);
    setErrorMsg('');

    try {
      const res = await window.electronAPI.dropbox.generateLinks(path);
      if (!res.ok) {
        setErrorMsg(res.error ?? 'Unknown error');
        setStatus('error');
        return;
      }

      const parsed: ParsedResult[] = (res.results ?? []).map((r) => ({
        ...r,
        ...parseVideoFilename(r.name),
      }));
      setResults(parsed);
      setStatus('done');
    } catch (err: unknown) {
      setErrorMsg((err as Error).message);
      setStatus('error');
    }
  }, [folderPath]);

  const handleClose = (o: boolean) => {
    if (!o) {
      setStatus('idle');
      setResults([]);
      setErrorMsg('');
    }
    onOpenChange(o);
  };

  const handleExportCsv = () => {
    const csv = buildCsv(results);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dropbox-video-links-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyAll = () => {
    const text = results
      .filter((r) => r.url)
      .map((r) => `${r.parsedSiteName || r.name}\t${r.url}`)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: 'Copied', description: `${results.filter((r) => r.url).length} links copied to clipboard.` });
    });
  };

  const handleSendToImport = () => {
    const headers = ['Site Name', 'Account Number', 'Video URL'];
    const rows = results
      .filter((r) => r.url)
      .map((r) => ({
        'Site Name': r.parsedSiteName,
        'Account Number': r.parsedAccountNumber,
        'Video URL': r.url,
      }));
    onSendToImport(headers, rows);
    onOpenChange(false);
  };

  const ready    = results.filter((r) => r.url);
  const reused   = results.filter((r) => r.url && r.reused);
  const newLinks = results.filter((r) => r.url && !r.reused);
  const failed   = results.filter((r) => r.error);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl flex flex-col max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            Generate Shareable Video Links
          </DialogTitle>
          <DialogDescription>
            Scan a Dropbox folder and generate a public shareable link for every file.
            Files that already have a shared link are reused — no duplicates are created.
          </DialogDescription>
        </DialogHeader>

        <Separator />

        {/* ── Folder input (always visible) ─────────────────────────────── */}
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
              onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Full Dropbox path starting with <code className="text-[10px]">/</code>.
              Subfolders are <em>not</em> scanned — only files directly inside this folder.
            </p>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={!folderPath.trim() || status === 'loading'}
            className="mb-6 shrink-0"
          >
            {status === 'loading' ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating…</>
            ) : (
              <><Link2 className="w-4 h-4 mr-2" />Generate Links</>
            )}
          </Button>
        </div>

        {/* ── Loading ───────────────────────────────────────────────────── */}
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Scanning folder and generating links…</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Each file requires one or two Dropbox API calls. Large folders (100 + files)
              may take 20–30 seconds.
            </p>
          </div>
        )}

        {/* ── Error ─────────────────────────────────────────────────────── */}
        {status === 'error' && (
          <div className="flex items-start gap-2 text-destructive bg-destructive/5 border border-destructive/20 rounded-md p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Could not scan folder</p>
              <p className="text-xs mt-0.5">{errorMsg}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Check the path is correct and your Dropbox connection is active.
              </p>
            </div>
          </div>
        )}

        {/* ── Results ───────────────────────────────────────────────────── */}
        {status === 'done' && (
          <div className="flex flex-col gap-3 min-h-0 flex-1">
            {/* Summary badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-green-600 hover:bg-green-600 gap-1.5">
                <CheckCircle2 className="w-3 h-3" />
                {ready.length} links ready
              </Badge>
              {newLinks.length > 0 && (
                <Badge variant="outline" className="gap-1.5 border-green-400 text-green-700">
                  <CheckCircle2 className="w-3 h-3" />
                  {newLinks.length} new
                </Badge>
              )}
              {reused.length > 0 && (
                <Badge variant="secondary" className="gap-1.5">
                  <RefreshCw className="w-3 h-3" />
                  {reused.length} reused
                </Badge>
              )}
              {failed.length > 0 && (
                <Badge variant="destructive" className="gap-1.5">
                  <AlertTriangle className="w-3 h-3" />
                  {failed.length} failed
                </Badge>
              )}
            </div>

            {results.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No files found in this folder.
              </div>
            ) : (
              /* Results table */
              <ScrollArea className="flex-1 border rounded-md">
                <div className="divide-y text-sm">
                  {/* Table header */}
                  <div className="grid grid-cols-[2fr_1fr_3fr_auto] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                    <span>Site Name / Account</span>
                    <span className="truncate">Filename</span>
                    <span>Shared Link</span>
                    <span className="w-5" />
                  </div>

                  {results.map((r, i) => (
                    <div
                      key={i}
                      className={`grid grid-cols-[2fr_1fr_3fr_auto] gap-2 px-3 py-2.5 items-start ${r.error ? 'bg-destructive/5' : ''}`}
                    >
                      {/* Site name + account */}
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">
                          {r.parsedSiteName || r.name}
                        </p>
                        {r.parsedAccountNumber && (
                          <p className="text-xs text-muted-foreground font-mono">
                            #{r.parsedAccountNumber}
                          </p>
                        )}
                      </div>

                      {/* Original filename */}
                      <p className="text-xs text-muted-foreground truncate pt-0.5" title={r.name}>
                        {r.name}
                      </p>

                      {/* URL or error */}
                      {r.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline truncate pt-0.5 flex items-center gap-1 min-w-0"
                          title={r.url}
                        >
                          <span className="truncate">
                            {r.url.replace('https://www.dropbox.com', 'dropbox.com')}
                          </span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        <p className="text-xs text-destructive pt-0.5 truncate" title={r.error}>
                          {r.error}
                        </p>
                      )}

                      {/* Status icon */}
                      <div className="pt-0.5 shrink-0 w-5">
                        {r.error ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                        ) : r.reused ? (
                          <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" title="Existing link reused" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600" title="New link created" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-between pt-1 shrink-0">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportCsv}
                  disabled={ready.length === 0}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyAll}
                  disabled={ready.length === 0}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy All Links
                </Button>
              </div>

              <Button
                size="sm"
                onClick={handleSendToImport}
                disabled={ready.length === 0}
              >
                Open in Import Wizard
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
