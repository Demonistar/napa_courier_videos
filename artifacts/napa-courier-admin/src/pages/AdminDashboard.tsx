import { useState, useMemo, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useLocationStore, getBackups, type BackupEntry } from '@/lib/store';
import { TopBar } from '@/components/layout/TopBar';
import { LocationTree } from '@/components/tree/LocationTree';
import { LocationDetail } from '@/components/detail/LocationDetail';
import { EmptyState } from '@/components/detail/EmptyState';
import { LocationForm } from '@/components/form/LocationForm';
import { Button } from '@/components/ui/button';
import { Edit, Plus, Trash2 } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TourOverlay } from '@/components/tutorial/TourOverlay';
import { useTour, tourSteps } from '@/components/tutorial/useTour';
import { useToast } from '@/hooks/use-toast';
import { useDropboxUser } from '@/hooks/use-dropbox-user';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { BackupRestore } from '@/components/backup/BackupRestore';
import { CsvImport } from '@/components/import/CsvImport';
import { Location } from '@/lib/store';

type ViewMode = 'default' | 'add' | 'modify';

export default function AdminDashboard() {
  const {
    state,
    addLocation,
    updateLocation,
    deleteLocation,
    publish,
    exportData,
    getAuditHistory,
    setCurrentUser,
    restoreBackup,
    restoreSingleLocation,
  } = useLocationStore();

  const { user: dropboxUser, disconnect: dropboxDisconnect, refresh: dropboxRefresh } = useDropboxUser();

  // Sync Dropbox identity into the store's currentUser
  useEffect(() => {
    if (dropboxUser.connected && dropboxUser.name) {
      setCurrentUser(dropboxUser.name);
    }
  }, [dropboxUser.connected, dropboxUser.name]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [backups, setBackups] = useState<BackupEntry[]>([]);

  const { isTourActive, startTour, endTour } = useTour();
  const { toast } = useToast();

  const selectedLocation = useMemo(
    () => state.locations.find((loc) => loc.id === selectedLocationId) || null,
    [state.locations, selectedLocationId],
  );

  const auditHistory = useMemo(
    () => (selectedLocationId ? getAuditHistory(selectedLocationId) : []),
    [selectedLocationId, getAuditHistory],
  );

  // Refresh backups list whenever the backup panel opens (or mutations happen)
  useEffect(() => {
    if (backupOpen) {
      setBackups(getBackups());
    }
  }, [backupOpen, state.locations, state.auditLog]);

  // ── Location actions ──────────────────────────────────────────────────────

  const handleAddLocation = () => {
    setViewMode('add');
    setSelectedLocationId(null);
  };

  const handleModifyLocation = () => {
    if (selectedLocationId) setViewMode('modify');
  };

  const handleDeleteLocation = () => {
    if (selectedLocationId) setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (selectedLocationId) {
      deleteLocation(selectedLocationId);
      setSelectedLocationId(null);
      setDeleteDialogOpen(false);
      toast({ title: 'Location deleted', description: 'Removed from staging layer.' });
    }
  };

  const handleSaveLocation = (data: Parameters<typeof addLocation>[0]) => {
    if (viewMode === 'add') {
      const newLocation = addLocation(data);
      setSelectedLocationId(newLocation.id);
      toast({ title: 'Location added', description: `${data.siteName} added to staging.` });
    } else if (viewMode === 'modify' && selectedLocationId) {
      updateLocation(selectedLocationId, data);
      toast({ title: 'Location updated', description: 'Changes saved to staging.' });
    }
    setViewMode('default');
  };

  const handleCancelForm = () => setViewMode('default');

  // ── Publish ───────────────────────────────────────────────────────────────

  const handlePublish = () => setPublishDialogOpen(true);

  const confirmPublish = () => {
    publish();
    setPublishDialogOpen(false);
    toast({ title: 'Published', description: 'All changes are now live for drivers.' });
  };

  // ── CSV Import ────────────────────────────────────────────────────────────

  const handleImportLocations = (
    rows: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>[],
    source: string,
  ) => {
    rows.forEach((row) => addLocation(row, { source }));
    toast({
      title: 'Import complete',
      description: `${rows.length} location${rows.length !== 1 ? 's' : ''} added to staging. Publish when ready.`,
    });
  };

  // ── Backup restore ────────────────────────────────────────────────────────

  // Reverts ONE location; every other record stays exactly as it is now
  const handleRestoreSingle = (backupId: string) => {
    const success = restoreSingleLocation(backupId);
    if (success) {
      setBackups(getBackups());
      toast({
        title: 'Record restored',
        description: 'Only that location was changed. Everything else is untouched.',
      });
    }
    return success;
  };

  // Replaces the ENTIRE database with a snapshot
  const handleRestoreFull = (backupId: string) => {
    const success = restoreBackup(backupId);
    if (success) {
      setSelectedLocationId(null);
      setViewMode('default');
      setBackups(getBackups());
      toast({
        title: 'Full restore complete',
        description: 'All locations reverted to the selected snapshot.',
      });
    }
    return success;
  };

  // ── Pending count ─────────────────────────────────────────────────────────

  const pendingChangesCount = state.pendingPublish
    ? Math.max(1, state.locations.length - state.publishedLocations.length)
    : 0;

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <TopBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        pendingChanges={pendingChangesCount}
        onPublish={handlePublish}
        onExport={exportData}
        currentUser={state.currentUser}
        onStartTour={startTour}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenBackup={() => setBackupOpen(true)}
        onOpenImport={() => setImportOpen(true)}
        dropboxUser={dropboxUser}
      />

      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal">
          {/* ── Left Panel — Location Tree ──────────────────────────── */}
          <Panel defaultSize={25} minSize={15} maxSize={40}>
            <div className="h-full border-r bg-card" data-tour-id="location-tree">
              <LocationTree
                locations={state.locations}
                selectedLocationId={selectedLocationId}
                onSelectLocation={(id) => {
                  setSelectedLocationId(id);
                  setViewMode('default');
                }}
                searchQuery={searchQuery}
                onAddLocation={handleAddLocation}
              />
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary transition-colors" />

          {/* ── Right Panel — Detail + Actions ─────────────────────── */}
          <Panel defaultSize={75} minSize={60}>
            <PanelGroup direction="vertical">
              {/* Top Right — Detail Panel */}
              <Panel defaultSize={60} minSize={40}>
                <div className="h-full bg-background overflow-auto" data-tour-id="detail-panel">
                  {viewMode === 'default' && selectedLocation && (
                    <LocationDetail location={selectedLocation} auditHistory={auditHistory} />
                  )}
                  {viewMode === 'default' && !selectedLocation && <EmptyState />}
                  {(viewMode === 'add' || viewMode === 'modify') && (
                    <LocationForm
                      location={viewMode === 'modify' ? (selectedLocation ?? undefined) : undefined}
                      allLocations={state.locations}
                      onSave={handleSaveLocation}
                      onCancel={handleCancelForm}
                    />
                  )}
                </div>
              </Panel>

              <PanelResizeHandle className="h-1 bg-border hover:bg-primary transition-colors" />

              {/* Bottom Right — Action Bar */}
              <Panel defaultSize={40} minSize={20} maxSize={60}>
                <div className="h-full border-t bg-card p-6 overflow-auto" data-tour-id="action-bar">
                  {viewMode === 'default' && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                        Actions
                      </h3>
                      <div className="grid gap-3">
                        <Button
                          onClick={handleAddLocation}
                          className="justify-start"
                          data-testid="button-add-location"
                          data-tour-id="add-button"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Add New Location
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={handleModifyLocation}
                          disabled={!selectedLocationId}
                          className="justify-start"
                          data-testid="button-modify-location"
                        >
                          <Edit className="w-4 h-4 mr-2" />
                          Modify Selected
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={handleDeleteLocation}
                          disabled={!selectedLocationId}
                          className="justify-start"
                          data-testid="button-delete-location"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Selected
                        </Button>
                      </div>

                      {selectedLocation && (
                        <div className="mt-4 p-3 border rounded-md bg-muted/30 space-y-1">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Selected Location
                          </p>
                          <p className="text-sm font-medium text-foreground">
                            {selectedLocation.siteName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {selectedLocation.city}, {selectedLocation.state}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>

      {/* ── Dialogs ──────────────────────────────────────────────────── */}

      {/* Delete */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Location</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <strong className="text-foreground">{selectedLocation?.siteName}</strong>? This
              removes it from the staging layer. You must publish to make the deletion live.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} data-testid="button-confirm-delete">
              Delete Location
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish */}
      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish Changes to Live</DialogTitle>
            <DialogDescription>
              This will push {pendingChangesCount} change{pendingChangesCount !== 1 ? 's' : ''} to
              the live environment. Drivers will see the updated location data immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="outline" onClick={() => setPublishDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmPublish} data-testid="button-confirm-publish">
              Confirm Publish
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Settings */}
      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        dropboxUser={dropboxUser}
        onDropboxDisconnect={dropboxDisconnect}
        onDropboxRefresh={dropboxRefresh}
        currentUser={state.currentUser}
        onCurrentUserChange={setCurrentUser}
      />

      {/* Backup & Restore */}
      <BackupRestore
        open={backupOpen}
        onOpenChange={setBackupOpen}
        backups={backups}
        onRestoreSingle={handleRestoreSingle}
        onRestoreFull={handleRestoreFull}
      />

      {/* CSV Import */}
      <CsvImport
        open={importOpen}
        onOpenChange={setImportOpen}
        existingLocations={state.locations}
        onImport={handleImportLocations}
      />

      {/* Tour */}
      {isTourActive && <TourOverlay steps={tourSteps} onComplete={endTour} />}
    </div>
  );
}
