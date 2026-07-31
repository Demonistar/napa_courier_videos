import { MapPin } from 'lucide-react';

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <MapPin className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium text-foreground mb-2">No location selected</h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        Select a location from the tree on the left to view its details, or add a new location to get started.
      </p>
    </div>
  );
}
