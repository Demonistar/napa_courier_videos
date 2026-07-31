import { Search, HelpCircle, Download } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HelpMenu } from './HelpMenu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  pendingChanges: number;
  onPublish: () => void;
  onExport: () => void;
  currentUser: string;
  onStartTour: () => void;
}

export function TopBar({
  searchQuery,
  onSearchChange,
  pendingChanges,
  onPublish,
  onExport,
  currentUser,
  onStartTour,
}: TopBarProps) {
  return (
    <div className="h-16 border-b bg-card flex items-center px-6 gap-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-1 h-8 bg-primary rounded-full" />
          <h1 className="text-xl font-semibold text-foreground">NAPA Courier Admin</h1>
        </div>
      </div>

      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search locations..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        {pendingChanges > 0 && (
          <Badge variant="secondary" className="bg-accent text-accent-foreground gap-1.5" data-testid="badge-pending-changes">
            <span className="w-2 h-2 rounded-full bg-accent-foreground/70" />
            {pendingChanges} unpublished change{pendingChanges !== 1 ? 's' : ''}
          </Badge>
        )}

        <Button
          variant={pendingChanges > 0 ? 'default' : 'outline'}
          onClick={onPublish}
          disabled={pendingChanges === 0}
          data-testid="button-publish"
        >
          Publish to Live
        </Button>

        <Button variant="outline" onClick={onExport} data-testid="button-export">
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="button-help">
              <HelpCircle className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <HelpMenu onStartTour={onStartTour} />
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="pl-3 border-l">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{currentUser}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
