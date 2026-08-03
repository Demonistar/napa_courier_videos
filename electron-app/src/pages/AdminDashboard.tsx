import { useState, useMemo, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useLocationStore, type BackupEntry } from '@/lib/store';
import { TopBar } from '@/components/layout/TopBar';
import { LocationTree } from '@/components/tree/LocationTree';
import { LocationDetail } from '@/components/detail/LocationDetail';
import { EmptyState } from '@/components/detail/EmptyState';
import { LocationForm } from '@/components/form/LocationForm';
import { Button } from '@/components/ui/button';
import { Edit, Plus, Trash2, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
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

interface AdminDashboardProps {
  onLogout: () => void;
  initialUser?: string;
}

export default function AdminDashboard({ onLogout, initialUser }: AdminDashboardProps) {
  const {
    state,
    isLoading,
    isSaving,
    hasConflict,
    conflictMessage,
    pendingChangesCount,
    addLocation,
    updateLocation,
    deleteLocation,
    publish,
    exportData,
    exportCsv,
    setCurrentUser,
    getAuditHistory,
    getBackups,
    restoreBackup,
    restoreSingleLocation,
    resolveConflict,
    reload,
  } = useLocationStore();

  const { user: dropboxUser, disconnect: dropboxDisconnect, refresh: dropboxRefresh } = useDropboxUser();
  const { toast } = useToast();

  // Sync Dropbox identity into store's currentUser
  useEffect(() => {
    if (dropboxUser.connected && dropboxUser.name) {
      setCurrentUser(dropboxUser.name);
    } else if (initialUser) {
      setCurrentUser(initialUser);
    }
  }, [dropboxUser.connected, dropboxUser.name, initialUser]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);

  // Hydrate update-ready state on mount and keep it current via push event.
  useEffect(() => {
    window.electronAPI.app.getUpdateStatus().then(({ updateDownloaded }) => {
      if (updateDownloaded) setUpdateReady(true);
    });
    const cleanup = window.electronAPI.app.onUpdateReady(() => setUpdateReady(true));
    return cleanup;
  }, []);

  const { isTourActive, startTour, endTour } = useTour();

  const selectedLocation = useMemo(
    () => state.locations.find((loc) => loc.id === selectedLocationId) ?? null,
    [state.locations, selectedLocationId],
  );

  const auditHistory = useMemo(
    () => (selectedLocationId ? getAuditHistory(selectedLocationId) : []),
    [selectedLocationId, state.auditLog],
  );

  // Load backups when panel opens
  useEffect(() => {
    if (!backupOpen) return;
    setBackupsLoading(true);
    getBackups()
      .then(setBackups)
      .finally(() => setBackupsLoading(false));
  }, [backupOpen]);

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

  // ── Publish ───────────────────────────────────────────────────────────────

  const handlePublish = () => setPublishDialogOpen(true);

  const confirmPublish = async () => {
    const ok = await publish();
    setPublishDialogOpen(false);
    if (ok) {
      toast({ title: 'Published', description: 'All changes are now live for drivers.' });
    } else {
      toast({ title: 'Publish failed', description: 'Could not write to Dropbox. Check your connection.', variant: 'destructive' });
    }
  };

  // ── CSV Import ────────────────────────────────────────────────────────────

  const handleImportLocations = (rows: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>[], source: string) => {
    rows.forEach((row) => addLocation(row, { source }));
    toast({
      title: 'Import complete',
      description: `${rows.length} location${rows.length !== 1 ? 's' : ''} added to staging. Publish when ready.`,
    });
  };

  // ── Backup restore ────────────────────────────────────────────────────────

  const handleRestoreSingle = async (backupId: string): Promise<boolean> => {
    const success = await restoreSingleLocation(backupId);
    if (success) {
      const updated = await getBackups();
      setBackups(updated);
      toast({
        title: 'Record restored',
        description: 'Only that location was changed. Everything else is untouched.',
      });
    }
    return success;
  };

  const handleRestoreFull = async (backupId: string): Promise<boolean> => {
    const success = await restoreBackup(backupId);
    if (success) {
      setSelectedLocationId(null);
      setViewMode('default');
      const updated = await getBackups();
      setBackups(updated);
      toast({
        title: 'Full restore complete',
        description: 'All locations reverted to the selected snapshot.',
      });
    }
    return success;
  };

  // ── Loading / saving indicators ───────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Loading location data from Dropbox…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Saving indicator */}
      {isSaving && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 text-xs text-muted-foreground bg-card border rounded-full px-3 py-1.5 shadow-sm">
          <Loader2 className="w-3 h-3 animate-spin" />
          Saving to Dropbox…
        </div>
      )}

      <TopBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        pendingChanges={pendingChangesCount}
        onPublish={handlePublish}
        onExportJson={exportData}
        onExportCsv={exportCsv}
        currentUser={state.currentUser}
        onStartTour={startTour}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenBackup={() => setBackupOpen(true)}
        onOpenImport={() => setImportOpen(true)}
        dropboxUser={dropboxUser}
        updateReady={updateReady}
      />

      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal">
          {/* ── Left — Location Tree ─────────────────────────────────── */}
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

          {/* ── Right — Detail + Actions ─────────────────────────────── */}
          <Panel defaultSize={75} minSize={60}>
            <PanelGroup direction="vertical">
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
                      onCancel={() => setViewMode('default')}
                    />
                  )}
                </div>
              </Panel>

              <PanelResizeHandle className="h-1 bg-border hover:bg-primary transition-colors" />

              <Panel defaultSize={40} minSize={20} maxSize={60}>
                <div className="h-full border-t bg-card p-6 overflow-auto" data-tour-id="action-bar">
                  {viewMode === 'default' && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                        Actions
                      </h3>
                      <div className="grid gap-3">
                        <Button onClick={handleAddLocation} className="justify-start" data-tour-id="add-button">
                          <Plus className="w-4 h-4 mr-2" />
                          Add New Location
                        </Button>
                        <Button variant="secondary" onClick={handleModifyLocation} disabled={!selectedLocationId} className="justify-start">
                          <Edit className="w-4 h-4 mr-2" />
                          Modify Selected
                        </Button>
                        <Button variant="destructive" onClick={handleDeleteLocation} disabled={!selectedLocationId} className="justify-start">
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Selected
                        </Button>
                      </div>

                      {selectedLocation && (
                        <div className="mt-4 p-3 border rounded-md bg-muted/30 space-y-1">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Selected Location
                          </p>
                          <p className="text-sm font-medium text-foreground">{selectedLocation.siteName}</p>
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
              <strong className="text-foreground">{selectedLocation?.siteName}</strong>?
              Removes it from staging — publish to make it live.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete Location</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish */}
      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish Changes to Live</DialogTitle>
            <DialogDescription>
              This will write {pendingChangesCount} change{pendingChangesCount !== 1 ? 's' : ''} to
              the live file in Dropbox. Drivers will see the updated location data immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="outline" onClick={() => setPublishDialogOpen(false)}>Cancel</Button>
            <Button onClick={confirmPublish}>Confirm Publish</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Write conflict warning */}
      <AlertDialog open={hasConflict} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Another admin made changes
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{conflictMessage ?? 'The location data in Dropbox was updated by another admin while you were editing.'}</p>
                <p>Reload to get the latest data (your unsaved changes will be lost), or force-save to overwrite the other admin's changes.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolveConflict('force')} className="border-amber-300 text-amber-700 hover:bg-amber-50">
              Force Save My Changes
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => resolveConflict('reload')} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Reload from Dropbox
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Settings */}
      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        dropboxUser={dropboxUser}
        onDropboxDisconnect={async () => { await dropboxDisconnect(); onLogout(); }}
        onDropboxRefresh={dropboxRefresh}
        currentUser={state.currentUser}
        onCurrentUserChange={setCurrentUser}
        updateReady={updateReady}
      />

      {/* Backup & Restore */}
      <BackupRestore
        open={backupOpen}
        onOpenChange={setBackupOpen}
        backups={backups}
        isLoading={backupsLoading}
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
