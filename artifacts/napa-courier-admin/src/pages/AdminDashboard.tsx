import { useState, useMemo } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useLocationStore } from '@/lib/store';
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
  } = useLocationStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const { isTourActive, startTour, endTour } = useTour();
  const { toast } = useToast();

  const selectedLocation = useMemo(
    () => state.locations.find((loc) => loc.id === selectedLocationId) || null,
    [state.locations, selectedLocationId]
  );

  const auditHistory = useMemo(
    () => (selectedLocationId ? getAuditHistory(selectedLocationId) : []),
    [selectedLocationId, getAuditHistory]
  );

  const handleAddLocation = () => {
    setViewMode('add');
    setSelectedLocationId(null);
  };

  const handleModifyLocation = () => {
    if (selectedLocationId) {
      setViewMode('modify');
    }
  };

  const handleDeleteLocation = () => {
    if (selectedLocationId) {
      setDeleteDialogOpen(true);
    }
  };

  const confirmDelete = () => {
    if (selectedLocationId) {
      deleteLocation(selectedLocationId);
      setSelectedLocationId(null);
      setDeleteDialogOpen(false);
      toast({
        title: 'Location deleted',
        description: 'The location has been removed from the staging layer.',
      });
    }
  };

  const handleSaveLocation = (data: Parameters<typeof addLocation>[0]) => {
    if (viewMode === 'add') {
      const newLocation = addLocation(data);
      setSelectedLocationId(newLocation.id);
      toast({
        title: 'Location created',
        description: `${data.siteName} has been added to the staging layer.`,
      });
    } else if (viewMode === 'modify' && selectedLocationId) {
      updateLocation(selectedLocationId, data);
      toast({
        title: 'Location updated',
        description: 'Changes saved to staging layer.',
      });
    }
    setViewMode('default');
  };

  const handleCancelForm = () => {
    setViewMode('default');
  };

  const handlePublish = () => {
    setPublishDialogOpen(true);
  };

  const confirmPublish = () => {
    publish();
    setPublishDialogOpen(false);
    toast({
      title: 'Published successfully',
      description: 'All changes are now live for drivers.',
    });
  };

  const pendingChangesCount = state.pendingPublish
    ? state.locations.length - state.publishedLocations.length || 1
    : 0;

  return (
    <div className="flex flex-col h-screen bg-background">
      <TopBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        pendingChanges={pendingChangesCount}
        onPublish={handlePublish}
        onExport={exportData}
        currentUser={state.currentUser}
        onStartTour={startTour}
      />

      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal">
          {/* Left Panel - Location Tree */}
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

          {/* Right Panel - Detail and Actions */}
          <Panel defaultSize={75} minSize={60}>
            <PanelGroup direction="vertical">
              {/* Top Right - Detail Panel */}
              <Panel defaultSize={60} minSize={40}>
                <div className="h-full bg-background" data-tour-id="detail-panel">
                  {selectedLocation && viewMode === 'default' ? (
                    <LocationDetail location={selectedLocation} auditHistory={auditHistory} />
                  ) : viewMode === 'default' ? (
                    <EmptyState />
                  ) : null}

                  {(viewMode === 'add' || viewMode === 'modify') && (
                    <LocationForm
                      location={viewMode === 'modify' ? selectedLocation || undefined : undefined}
                      allLocations={state.locations}
                      onSave={handleSaveLocation}
                      onCancel={handleCancelForm}
                    />
                  )}
                </div>
              </Panel>

              <PanelResizeHandle className="h-1 bg-border hover:bg-primary transition-colors" />

              {/* Bottom Right - Action Bar */}
              <Panel defaultSize={40} minSize={20} maxSize={60}>
                <div className="h-full border-t bg-card p-6" data-tour-id="action-bar">
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
                        <div className="mt-6 p-4 border rounded-md bg-muted/30 space-y-1">
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Location</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <strong className="text-foreground">{selectedLocation?.siteName}</strong>? This action
              will remove it from the staging layer. You must publish to make the deletion live.
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

      {/* Publish Confirmation Dialog */}
      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish Changes to Live</DialogTitle>
            <DialogDescription>
              This will publish {pendingChangesCount} change{pendingChangesCount !== 1 ? 's' : ''}{' '}
              to the live environment. Drivers will see the updated location data immediately.
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

      {/* Tour Overlay */}
      {isTourActive && <TourOverlay steps={tourSteps} onComplete={endTour} />}
    </div>
  );
}
