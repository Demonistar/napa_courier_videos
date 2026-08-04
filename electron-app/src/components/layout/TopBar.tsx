import { Search, HelpCircle, Download, Upload, Settings, Cloud, CloudOff, AlertTriangle, Link2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HelpMenu } from './HelpMenu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DropboxUserInfo } from '@/hooks/use-dropbox-user';

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  pendingChanges: number;
  onPublish: () => void;
  onExportCsv: () => void;
  onExportXlsx: () => void;
  onExportPdf: () => void;
  onExportTxt: () => void;
  onExportJson: () => void;
  currentUser: string;
  onStartTour: () => void;
  onOpenSettings: () => void;
  onOpenBackup: () => void;
  onOpenImport: () => void;
  onOpenGenerateLinks: () => void;
  dropboxUser: DropboxUserInfo;
}

export function TopBar({
  searchQuery,
  onSearchChange,
  pendingChanges,
  onPublish,
  onExportCsv,
  onExportXlsx,
  onExportPdf,
  onExportTxt,
  onExportJson,
  currentUser,
  onStartTour,
  onOpenSettings,
  onOpenBackup,
  onOpenImport,
  onOpenGenerateLinks,
  dropboxUser,
}: TopBarProps) {
  return (
    <div className="h-16 border-b bg-card flex items-center px-6 gap-4 shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-1 h-8 bg-primary rounded-full" />
        <h1 className="text-xl font-semibold text-foreground whitespace-nowrap">
          NAPA Courier Admin
        </h1>
      </div>

      {/* Search */}
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
            data-tour-id="search-bar"
          />
        </div>
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Reauth warning */}
        {dropboxUser.connected && dropboxUser.needsReauth && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-50 text-amber-800 gap-1.5 cursor-pointer"
                onClick={onOpenSettings}
                data-testid="badge-dropbox-reauth"
              >
                <AlertTriangle className="w-3 h-3" />
                Reconnect Dropbox
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Your Dropbox session is expiring. Click to refresh.</TooltipContent>
          </Tooltip>
        )}

        {/* Pending publish badge */}
        {pendingChanges > 0 && (
          <Badge
            variant="secondary"
            className="bg-accent text-accent-foreground gap-1.5"
            data-testid="badge-pending-changes"
          >
            <span className="w-2 h-2 rounded-full bg-accent-foreground/70" />
            {pendingChanges} unpublished change{pendingChanges !== 1 ? 's' : ''}
          </Badge>
        )}

        <Button
          variant={pendingChanges > 0 ? 'default' : 'outline'}
          onClick={onPublish}
          disabled={pendingChanges === 0}
          data-testid="button-publish"
          data-tour-id="publish-button"
        >
          Publish to Live
        </Button>

        <Button variant="outline" onClick={onOpenImport} data-testid="button-import">
          <Upload className="w-4 h-4 mr-2" />
          Import
        </Button>
        <Button variant="outline" onClick={onOpenGenerateLinks} data-testid="button-generate-links">
          <Link2 className="w-4 h-4 mr-2" />
          Generate Links
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" data-testid="button-export">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onExportXlsx} data-testid="button-export-xlsx">
              Export as Excel
              <span className="ml-auto text-xs text-muted-foreground pl-4">.xlsx</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportCsv} data-testid="button-export-csv">
              Export as CSV
              <span className="ml-auto text-xs text-muted-foreground pl-4">.csv</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportPdf} data-testid="button-export-pdf">
              Export as PDF
              <span className="ml-auto text-xs text-muted-foreground pl-4">reference sheet</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportTxt} data-testid="button-export-txt">
              Export as Text
              <span className="ml-auto text-xs text-muted-foreground pl-4">tab-delimited</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onExportJson} data-testid="button-export-json">
              Export as JSON
              <span className="ml-auto text-xs text-muted-foreground pl-4">full backup</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Settings */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenSettings}
              data-testid="button-settings"
            >
              <Settings className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings &amp; Dropbox</TooltipContent>
        </Tooltip>

        {/* Help */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="button-help">
              <HelpCircle className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <HelpMenu onStartTour={onStartTour} onOpenBackup={onOpenBackup} />
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Identity indicator */}
        <div className="pl-3 border-l flex items-center gap-1.5">
          {dropboxUser.connected ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Cloud className="w-4 h-4 text-blue-500 shrink-0" />
              </TooltipTrigger>
              <TooltipContent>Signed in via Dropbox</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <CloudOff className="w-4 h-4 text-muted-foreground shrink-0" />
              </TooltipTrigger>
              <TooltipContent>Dropbox not connected</TooltipContent>
            </Tooltip>
          )}
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{currentUser}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
