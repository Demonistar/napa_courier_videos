import { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ComboboxField } from './ComboboxField';
import { DuplicateWarning } from './DuplicateWarning';
import { findSimilarLocation } from '@/lib/utils/fuzzy';
import { Location, LookupEntry } from '@/lib/store';
import { AlertCircle, Upload, Loader2 } from 'lucide-react';

interface LocationFormProps {
  location?: Location;
  allLocations: Location[];
  /** Customer address lookup, keyed by account number — used to auto-fill
   *  blank state/city/address fields when the typed account number matches
   *  a known customer. */
  lookup: Record<string, LookupEntry>;
  onSave: (data: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
  /**
   * Optional Electron-specific hook: called when the admin picks a file to
   * upload.  Should upload the file to persistent storage and return the value
   * to store in location.imageUrl (e.g. "images/63-BMW-OF-NWA.png").
   * When absent the form falls back to an inline base64 data URI (web preview).
   */
  onImageUpload?: (
    file: File,
    accountNumber: string,
    siteName: string,
  ) => Promise<string>;
  /** For tour-step tracking (Electron AdminDashboard only). */
  onTourFieldChange?: (values: { state: string; city: string; siteName: string; address: string }) => void;
}

export function LocationForm({
  location,
  allLocations,
  lookup,
  onSave,
  onCancel,
  onImageUpload,
  onTourFieldChange,
}: LocationFormProps) {
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

  // Preview shown in the form while an image is selected / uploading.
  // For Electron: object URL (immediately visible); cleared after upload resolves.
  // For web fallback: same as imageUrl (base64 data URI).
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const previewObjectUrl = useRef<string | null>(null);

  // Revoke any object URL we created when the component unmounts or preview changes.
  useEffect(() => {
    return () => {
      if (previewObjectUrl.current) {
        URL.revokeObjectURL(previewObjectUrl.current);
        previewObjectUrl.current = null;
      }
    };
  }, []);

  // Seed preview from existing imageUrl when editing a location.
  // Relative paths (images/…) are resolved by the parent; we skip them here.
  useEffect(() => {
    const url = location?.imageUrl ?? '';
    if (url.startsWith('data:') || url.startsWith('http')) {
      setImagePreview(url);
    }
  }, [location?.imageUrl]);

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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show an immediate local preview while the upload is in flight.
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
    const objUrl = URL.createObjectURL(file);
    previewObjectUrl.current = objUrl;
    setImagePreview(objUrl);

    if (onImageUpload) {
      // Electron path: upload to Dropbox, store relative path in record.
      setUploading(true);
      try {
        const stored = await onImageUpload(file, accountNumber, siteName);
        setImageUrl(stored);
        // Keep the object URL as the preview so the admin sees the image
        // without waiting for a round-trip download.
      } catch (err) {
        console.error('Image upload failed:', err);
        setImagePreview(null);
        URL.revokeObjectURL(objUrl);
        previewObjectUrl.current = null;
      } finally {
        setUploading(false);
      }
    } else {
      // Web / dev fallback: encode as base64 data URI.
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setImageUrl(dataUrl);
        setImagePreview(dataUrl);
        // Revoke the temporary object URL now that we have the data URI.
        URL.revokeObjectURL(objUrl);
        previewObjectUrl.current = null;
      };
      reader.readAsDataURL(file);
    }
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
      // Generate-Links-discovered photos aren't editable from this form yet —
      // preserve whatever the location already had rather than wiping them
      // out on every save. New locations simply start with none.
      imageUrls: location?.imageUrls ?? [],
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
      imageUrls: location?.imageUrls ?? [],
      instructions,
      syncSource: null,
      lastVerified: null,
    });
  };

  const isValid = state.trim() && city.trim() && siteName.trim();

  // Notify parent of field changes for tour-step gating.
  useEffect(() => {
    onTourFieldChange?.({ state, city, siteName, address });
  }, [state, city, siteName, address]);

  // Auto-fill blank state/city/address from the customer lookup when the
  // typed account number matches a known customer. Never overwrites a field
  // the admin has already typed something into.
  useEffect(() => {
    const entry = lookup[accountNumber.trim()];
    if (!entry) return;
    if (!state.trim() && entry.state) setState(entry.state);
    if (!city.trim() && entry.city) setCity(entry.city);
    if (!address.trim() && entry.address) setAddress(entry.address);
  }, [accountNumber, lookup]);

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
              {/* Show preview when available */}
              {imagePreview && (
                <div className="border rounded-lg overflow-hidden bg-muted relative">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="w-full h-32 object-cover"
                  />
                  {uploading && (
                    <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      <span className="ml-2 text-sm">Uploading…</span>
                    </div>
                  )}
                </div>
              )}
              {!onImageUpload && (
                /* URL text input is only shown in web / dev mode where there's
                   no Dropbox upload. In Electron the file picker is the only
                   entry point; admins shouldn't type raw URLs. */
                <Input
                  id="imageUrl"
                  type="url"
                  value={imageUrl.startsWith('data:') ? '' : imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value);
                    setImagePreview(e.target.value || null);
                  }}
                  placeholder="Image URL or upload below"
                  data-testid="input-image-url"
                />
              )}
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="imageUpload"
                  className={`flex items-center gap-2 px-3 py-2 text-sm border border-input rounded-md cursor-pointer hover:bg-accent ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  {uploading
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Upload className="w-4 h-4" />}
                  {uploading ? 'Uploading…' : 'Upload Image'}
                </Label>
                <Input
                  id="imageUpload"
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={uploading}
                  className="hidden"
                  data-testid="input-image-upload"
                />
                {imageUrl && !uploading && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => { setImageUrl(''); setImagePreview(null); }}
                  >
                    Remove
                  </button>
                )}
              </div>

              {/* Additional photos discovered via Generate Links (Street View,
                  Map View, etc.) — separate from the single manually-uploaded
                  image above. These are Dropbox share-link URLs, rendered
                  directly (never resolved through dropbox:downloadImage, that
                  path is only for the relative-path manual upload). Read-only
                  here — editing/removing individual photos isn't built yet;
                  re-running Generate Links is how new ones get added. */}
              {location?.imageUrls && location.imageUrls.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-xs text-muted-foreground">
                    {location.imageUrls.length} additional photo{location.imageUrls.length !== 1 ? 's' : ''} from Generate Links
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {location.imageUrls.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block aspect-square rounded-md overflow-hidden border bg-muted hover:opacity-80 transition-opacity"
                        title="Open full size"
                      >
                        <img src={url} alt="Additional site photo" className="w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
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
        <Button onClick={handleSave} disabled={!isValid || uploading} data-testid="button-save">
          {location ? 'Update Location' : 'Create Location'}
        </Button>
      </div>
    </div>
  );
}
