import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DuplicateWarningProps {
  duplicateLocation: {
    siteName: string;
    city: string;
    state: string;
  };
  onConfirm: () => void;
  onCancel: () => void;
}

export function DuplicateWarning({
  duplicateLocation,
  onConfirm,
  onCancel,
}: DuplicateWarningProps) {
  return (
    <div className="p-4 border border-accent bg-accent/10 rounded-md space-y-3">
      <div className="flex gap-3">
        <AlertCircle className="w-5 h-5 text-accent shrink-0 mt-0.5" />
        <div className="flex-1 space-y-1">
          <p className="font-medium text-sm text-foreground">Similar location detected</p>
          <p className="text-sm text-muted-foreground">
            A similar location already exists: <strong>{duplicateLocation.siteName}</strong> in{' '}
            {duplicateLocation.city}, {duplicateLocation.state}
          </p>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to save this location?
          </p>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel} data-testid="button-cancel-duplicate">
          Cancel
        </Button>
        <Button size="sm" onClick={onConfirm} data-testid="button-confirm-save">
          Confirm Save
        </Button>
      </div>
    </div>
  );
}
