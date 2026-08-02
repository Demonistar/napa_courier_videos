import { useState } from 'react';
import { ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AuditHistoryProps {
  history: Array<{
    id: string;
    action: 'create' | 'update' | 'delete';
    changedBy: string;
    changedAt: string;
  }>;
}

export function AuditHistory({ history }: AuditHistoryProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (history.length === 0) return null;

  const actionLabels = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
  };

  const actionColors = {
    create: 'text-green-600',
    update: 'text-blue-600',
    delete: 'text-red-600',
  };

  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full justify-between"
        data-testid="button-toggle-history"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Clock className="w-4 h-4" />
          History
        </span>
        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </Button>

      {isExpanded && (
        <div className="border rounded-md divide-y bg-card">
          {history.map((entry) => (
            <div key={entry.id} className="p-3 space-y-1" data-testid={`audit-entry-${entry.id}`}>
              <div className="flex items-start justify-between gap-2">
                <p className={cn('text-sm font-medium', actionColors[entry.action])}>
                  {actionLabels[entry.action]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(entry.changedAt), { addSuffix: true })}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">by {entry.changedBy}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
