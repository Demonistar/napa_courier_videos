import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ComboboxField } from './ComboboxField';
import { DuplicateWarning } from './DuplicateWarning';
import { findSimilarLocation } from '@/lib/utils/fuzzy';
import { Location } from '@/lib/store';
import { AlertCircle, Upload } from 'lucide-react';

interface LocationFormProps {
  location?: Location;
  allLocations: Location[];
  onSave: (data: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
}

export function LocationForm({ location, allLocations, onSave, onCancel }: LocationFormProps) {
  const [state, setState] = useState(location?.state || '');
  const [city, setCity] = useState(location?.city || '');
  const [siteName, setSiteName] = useState(location?.siteName || '');
  const [accountNumber, setAccountNumber] = useState(location?.accountNumber || '');
  const [address, setAddress] = useState(location?.address || '');
  const [videoUrl, setVideoUrl] = useState(location?.videoUrl || '');
  const [imageUrl, setImageUrl] = useState(location?.imageUrl || '');
  const [instructions, setInstructions] = useState(location?.instructions || '');
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [duplicateLocation, setDuplicateLocation] = useState<{
    siteName: string;
    city: string;
    state: string;
  } | null>(null);

  const stateOptions = useMemo(() => {
    const states = new Set(allLocations.map((loc) => loc.state));
    return Array.from(states).sort();
  }, [allLocations]);

  const cityOptions = useMemo(() => {
    if (!state) return [];
    const cities = new Set(
      allLocations.filter((loc) => loc.state === state).map((loc) => loc.city)
    );
    return Array.from(cities).sort();
  }, [allLocations, state]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setImageUrl(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    const locationsToCheck = location
      ? allLocations.filter((loc) => loc.id !== location.id)
      : allLocations;

    const similar = findSimilarLocation(siteName, address, locationsToCheck);

    if (similar && !showDuplicateWarning) {
      setDuplicateLocation(similar);
      setShowDuplicateWarning(true);
      return;
    }

    onSave({
      state,
      city,
      siteName,
      accountNumber,
      address,
      videoUrl: videoUrl.trim() || null,
      imageUrl: imageUrl.trim() || null,
      instructions,
      syncSource: null,
      lastVerified: null,
    });
  };

  const handleConfirmSave = () => {
    setShowDuplicateWarning(false);
    onSave({
      state,
      city,
      siteName,
      accountNumber,
      address,
      videoUrl: videoUrl.trim() || null,
      imageUrl: imageUrl.trim() || null,
      instructions,
      syncSource: null,
      lastVerified: null,
    });
  };

  const isValid = state.trim() && city.trim() && siteName.trim() && address.trim();

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="space-y-4">
          <ComboboxField
            label="State"
            value={state}
            onChange={setState}
            options={stateOptions}
            placeholder="Select or add state"
            searchPlaceholder="Search states..."
            testId="input-state"
          />

          <ComboboxField
            label="City"
            value={city}
            onChange={setCity}
            options={cityOptions}
            placeholder="Select or add city"
            searchPlaceholder="Search cities..."
            testId="input-city"
          />

          <div>
            <Label htmlFor="siteName">Site Name</Label>
            <Input
              id="siteName"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="e.g. Sheriff's Office"
              data-testid="input-site-name"
            />
          </div>

          <div>
            <Label htmlFor="accountNumber">Account Number</Label>
            <Input
              id="accountNumber"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="e.g. 00123456"
              data-testid="input-account-number"
            />
          </div>

          <div>
            <Label htmlFor="address">Address</Label>
            <Textarea
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Full street address including city, state, and ZIP"
              rows={2}
              data-testid="input-address"
            />
          </div>

          <div>
            <Label htmlFor="videoUrl">Video URL (optional)</Label>
            <Input
              id="videoUrl"
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://dropbox.com/..."
              data-testid="input-video-url"
            />
          </div>

          <div>
            <Label htmlFor="imageUrl">Image</Label>
            <div className="space-y-2">
              <Input
                id="imageUrl"
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="Image URL or upload below"
                data-testid="input-image-url"
              />
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="imageUpload"
                  className="flex items-center gap-2 px-3 py-2 text-sm border border-input rounded-md cursor-pointer hover:bg-accent"
                >
                  <Upload className="w-4 h-4" />
                  Upload Image
                </Label>
                <Input
                  id="imageUpload"
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                  data-testid="input-image-upload"
                />
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="instructions">Instructions / Notes</Label>
            <Textarea
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Delivery instructions, building access codes, special notes..."
              rows={4}
              data-testid="input-instructions"
            />
          </div>

          {showDuplicateWarning && duplicateLocation && (
            <DuplicateWarning
              duplicateLocation={duplicateLocation}
              onConfirm={handleConfirmSave}
              onCancel={() => setShowDuplicateWarning(false)}
            />
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 p-4 border-t bg-card">
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel">
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!isValid} data-testid="button-save">
          {location ? 'Update Location' : 'Create Location'}
        </Button>
      </div>
    </div>
  );
}
