import { useState, useEffect } from 'react';
import { Copy, ExternalLink, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Location } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { AuditHistory } from './AuditHistory';
import { formatDistanceToNow } from 'date-fns';

interface LocationDetailProps {
  location: Location;
  auditHistory: Array<{
    id: string;
    action: 'create' | 'update' | 'delete';
    changedBy: string;
    changedAt: string;
  }>;
  /**
   * Optional Electron-specific resolver: called when imageUrl is a relative
   * Dropbox path (e.g. "images/63-BMW-OF-NWA.png").  Should return a base64
   * data URI or a temporary HTTPS URL suitable for <img src>.
   * When absent, imageUrl is used directly (handles https:// and data: URIs).
   */
  resolveImageUrl?: (relativePath: string) => Promise<string>;
}

/** Returns true for relative Dropbox image paths stored by the Electron app. */
function isRelativePath(url: string): boolean {
  return url.startsWith('images/') || (!!url && !url.startsWith('http') && !url.startsWith('data:'));
}

export function LocationDetail({ location, auditHistory, resolveImageUrl }: LocationDetailProps) {
  const { toast } = useToast();

  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);

  const rawImageUrl = location.imageUrl ?? '';

  useEffect(() => {
    setResolvedSrc(null);
    setImageError(false);

    if (!rawImageUrl) return;

    if (isRelativePath(rawImageUrl) && resolveImageUrl) {
      let cancelled = false;
      setImageLoading(true);
      resolveImageUrl(rawImageUrl)
        .then((src) => { if (!cancelled) { setResolvedSrc(src); setImageLoading(false); } })
        .catch(() => { if (!cancelled) { setImageError(true); setImageLoading(false); } });
      return () => { cancelled = true; };
    }

    // Direct URL or data URI — use as-is.
    setResolvedSrc(rawImageUrl);
  }, [rawImageUrl, resolveImageUrl]);

  const displaySrc = resolvedSrc;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied to clipboard',
      description: 'Address copied successfully',
    });
  };

  const mostRecentAudit = auditHistory[0];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground" data-testid="text-location-name">
            {location.siteName}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {location.city}, {location.state}
          </p>
        </div>

        {location.accountNumber && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Account Number
            </p>
            <p className="text-sm text-foreground font-mono" data-testid="text-account-number">
              {location.accountNumber}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Address
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap" data-testid="text-address">
                {location.address}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(location.address)}
              data-testid="button-copy-address"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Image
            </p>
            {imageLoading ? (
              <div className="border rounded-lg p-8 flex flex-col items-center justify-center bg-muted/30">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Loading image…</p>
              </div>
            ) : imageError ? (
              <div className="border border-dashed rounded-lg p-8 flex flex-col items-center justify-center bg-muted/30">
                <ImageIcon className="w-8 h-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Image unavailable</p>
              </div>
            ) : displaySrc ? (
              <div className="border rounded-lg overflow-hidden bg-muted">
                <img
                  src={displaySrc}
                  alt={location.siteName}
                  className="w-full h-48 object-cover"
                  data-testid="img-location"
                />
              </div>
            ) : (
              <div className="border border-dashed rounded-lg p-8 flex flex-col items-center justify-center bg-muted/30">
                <ImageIcon className="w-8 h-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No image assigned</p>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Delivery Video
            </p>
            {location.videoUrl ? (
              <Button
                variant="outline"
                size="sm"
                asChild
                data-testid="button-video-link"
              >
                <a href={location.videoUrl} target="_blank" rel="noopener noreferrer">
                  Watch Delivery Video
                  <ExternalLink className="w-4 h-4 ml-2" />
                </a>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">No video assigned</p>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Instructions / Notes
            </p>
            {location.instructions ? (
              <p className="text-sm text-foreground whitespace-pre-wrap" data-testid="text-instructions">
                {location.instructions}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No instructions provided</p>
            )}
          </div>
        </div>

        {mostRecentAudit && (
          <div className="pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              Last modified {formatDistanceToNow(new Date(mostRecentAudit.changedAt), { addSuffix: true })} by{' '}
              <span className="font-medium">{mostRecentAudit.changedBy}</span>
            </p>
          </div>
        )}

        <AuditHistory history={auditHistory} />
      </div>
    </div>
  );
}
