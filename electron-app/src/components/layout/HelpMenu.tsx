import { BookOpen, Play, Database } from 'lucide-react';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useState } from 'react';

interface HelpMenuProps {
  onStartTour: () => void;
  onOpenBackup: () => void;
}

export function HelpMenu({ onStartTour, onOpenBackup }: HelpMenuProps) {
  const [showGuide, setShowGuide] = useState(false);

  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground font-normal px-2 py-1">
        Help &amp; Tools
      </DropdownMenuLabel>

      <Dialog open={showGuide} onOpenChange={setShowGuide}>
        <DialogTrigger asChild>
          <DropdownMenuItem onSelect={(e) => e.preventDefault()} data-testid="menu-help-guide">
            <BookOpen className="w-4 h-4 mr-2" />
            How to use this app
          </DropdownMenuItem>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>NAPA Courier Admin Guide</DialogTitle>
            <DialogDescription>Quick reference for managing delivery locations</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold mb-2">Managing Locations</h3>
              <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                <li>Browse locations using the tree view on the left</li>
                <li>Click any location to view its full details</li>
                <li>Use the search bar to quickly find specific locations</li>
                <li>Add new locations with the &quot;Add Location&quot; button</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Publishing Changes</h3>
              <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                <li>Changes are saved to a staging layer automatically</li>
                <li>The orange badge shows how many unpublished changes you have</li>
                <li>Click &quot;Publish to Live&quot; to make changes visible to drivers</li>
                <li>Only published locations appear in the driver app</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Editing &amp; Deleting</h3>
              <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                <li>Select a location and click &quot;Modify Selected&quot; to edit</li>
                <li>The system will warn you if a similar location already exists</li>
                <li>All changes are tracked in the audit history</li>
                <li>Delete operations require confirmation</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Dropbox Identity</h3>
              <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                <li>Connect Dropbox via Settings to identify yourself in the audit log</li>
                <li>Your Dropbox display name appears as the author of every change</li>
                <li>Sessions last 30 days — you will be prompted to refresh before expiry</li>
                <li>If Dropbox is not connected, set your display name in Settings</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Backup &amp; Restore</h3>
              <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                <li>The last 20 changes are saved as full database snapshots automatically</li>
                <li>Open &quot;Backup &amp; Restore&quot; to roll back to any previous state</li>
                <li>Restoring a snapshot saves the current state first, so it is reversible</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Data Export</h3>
              <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                <li>Click &quot;Export&quot; to download all data as JSON</li>
                <li>Exports include both staging and published versions plus backup snapshots</li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DropdownMenuSeparator />

      <DropdownMenuItem onClick={onStartTour} data-testid="menu-start-tour">
        <Play className="w-4 h-4 mr-2" />
        Start Interactive Tour
      </DropdownMenuItem>

      <DropdownMenuItem onClick={onOpenBackup} data-testid="menu-backup-restore">
        <Database className="w-4 h-4 mr-2" />
        Backup &amp; Restore
      </DropdownMenuItem>
    </>
  );
}
