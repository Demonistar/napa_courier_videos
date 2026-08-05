import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ─── Data Types ────────────────────────────────────────────────────────────────
// These match the web app exactly so all components work without changes.

export interface Location {
  id: string;
  state: string;
  city: string;
  siteName: string;
  accountNumber: string;
  address: string;
  videoUrl: string | null;
  imageUrl: string | null;
  instructions: string;
  syncSource: string | null;
  lastVerified: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  locationId: string;
  action: 'create' | 'update' | 'delete';
  changedBy: string;
  changedAt: string;
  diff: Record<string, { before: unknown; after: unknown }>;
}

/** Metadata for a backup snapshot. The full snapshot is stored in Dropbox. */
export interface BackupEntry {
  id: string;
  label: string;
  timestamp: string;
  locationId: string | null;
  locationName: string | null;
  /** Dropbox path to the full backup file — used to load the snapshot on demand. */
  dropboxPath: string;
}

interface AppState {
  locations: Location[];
  publishedLocations: Location[]; // from locations-live.json
  auditLog: AuditEntry[];
  currentUser: string;
}

interface StagingPayload {
  version: number;
  locations: Location[];
  auditLog: AuditEntry[];
  currentUser: string;
  lastModified?: string;
}

// ─── Audit helpers ─────────────────────────────────────────────────────────────

const AUDITABLE_FIELDS: (keyof Location)[] = [
  'siteName', 'accountNumber', 'state', 'city', 'address',
  'videoUrl', 'imageUrl', 'instructions',
];

function buildLocationDiff(
  before: Location | null,
  after: Location | null,
): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of AUDITABLE_FIELDS) {
    diff[field] = { before: before ? before[field] : null, after: after ? after[field] : null };
  }
  return diff;
}

function createAuditEntry(
  locationId: string,
  action: 'create' | 'update' | 'delete',
  diff: Record<string, { before: unknown; after: unknown }>,
  user: string,
): AuditEntry {
  return {
    id: crypto.randomUUID(),
    locationId,
    action,
    changedBy: user,
    changedAt: new Date().toISOString(),
    diff,
  };
}

// ─── CSV export helpers ────────────────────────────────────────────────────────

function esc(val: string | null | undefined): string {
  const s = val ?? '';
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// ─── Store hook ────────────────────────────────────────────────────────────────

const INITIAL_STATE: AppState = {
  locations: [],
  publishedLocations: [],
  auditLog: [],
  currentUser: 'Admin',
};

const SAVE_DEBOUNCE_MS = 800;

export function useLocationStore() {
  const [appState, setAppState] = useState<AppState>(INITIAL_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  // Hard errors from background sync or load — watched by AdminDashboard for toast
  const [saveError, setSaveError] = useState<string | null>(null);
  // Recovery notice when staging was empty but live data was found — non-destructive toast
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [cachedBackups, setCachedBackups] = useState<BackupEntry[]>([]);

  // Current Dropbox rev of locations-staging.json — used for write-safety
  const stagingRevRef = useRef('');
  // Current Dropbox rev of locations-live.json — used for safe publish
  const liveRevRef = useRef('');
  // Whether we've completed the initial load (don't save before first load)
  const initializedRef = useRef(false);
  // Pending state to save (we save the latest version after debounce)
  const pendingSaveRef = useRef<AppState | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load from Dropbox ────────────────────────────────────────────────────

  const loadFromDropbox = useCallback(async () => {
    setIsLoading(true);
    setHasConflict(false);
    setConflictMessage(null);
    try {
      const [stagingResult, liveResult] = await Promise.all([
        window.electronAPI.data.loadStaging(),
        window.electronAPI.data.loadLive(),
      ]);

      if (!stagingResult.ok) {
        // Real error (network, API failure) — surface it as a toast in the dashboard
        setSaveError(stagingResult.error ?? 'Failed to load from Dropbox.');
      } else if (stagingResult.data) {
        const data = stagingResult.data as StagingPayload;
        stagingRevRef.current = stagingResult.rev ?? '';

        // Capture live rev so publish() can use safe update mode
        if (liveResult.ok) {
          liveRevRef.current = liveResult.rev ?? '';
        }

        // Published locations come from the live file (may be null if never published)
        const liveData = liveResult.ok && liveResult.data
          ? (liveResult.data as { locations?: Location[] }).locations ?? []
          : [];

        const stagingLocations = data.locations ?? [];

        // Recovery: if staging came back empty but live has real data, seed the
        // in-memory state from live instead of showing a blank app. This does NOT
        // auto-save — the recovered locations only persist to staging when the
        // admin makes their next normal edit, via the existing debounced save path.
        let effectiveLocations = stagingLocations;
        if (stagingLocations.length === 0 && liveData.length > 0) {
          effectiveLocations = liveData;
          setRecoveryNotice(
            `Staging was empty but live data was found — recovered ${liveData.length} location${liveData.length !== 1 ? 's' : ''} from the last published version.`,
          );
        }

        setAppState({
          locations: effectiveLocations,
          publishedLocations: liveData,
          auditLog: data.auditLog ?? [],
          currentUser: data.currentUser ?? 'Admin',
        });
      }
    } catch (err) {
      console.error('Failed to load from Dropbox:', err);
      setSaveError((err as Error).message ?? 'Failed to load from Dropbox.');
    } finally {
      setIsLoading(false);
      initializedRef.current = true;
    }
  }, []);

  useEffect(() => {
    loadFromDropbox();
  }, [loadFromDropbox]);

  // ── Auto-save after state changes ─────────────────────────────────────────

  const doSync = useCallback(async (snapshot: AppState) => {
    setIsSaving(true);
    try {
      const payload: StagingPayload = {
        version: 1,
        locations: snapshot.locations,
        auditLog: snapshot.auditLog,
        currentUser: snapshot.currentUser,
      };
      const result = await window.electronAPI.data.saveStaging(payload, stagingRevRef.current);
      if (result.ok && result.newRev) {
        stagingRevRef.current = result.newRev;
        setHasConflict(false);
        setSaveError(null);
      } else if (result.conflict) {
        setHasConflict(true);
        setConflictMessage(result.error ?? 'Another admin saved changes since you loaded.');
      } else if (!result.ok) {
        // Hard write error (network, quota, etc.) — surface as a toast
        setSaveError(result.error ?? 'Failed to save to Dropbox.');
      }
    } catch (err) {
      console.error('Sync failed:', err);
      setSaveError((err as Error).message ?? 'Failed to save to Dropbox.');
    } finally {
      setIsSaving(false);
    }
  }, []);

  const scheduleSync = useCallback((snapshot: AppState) => {
    pendingSaveRef.current = snapshot;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (pendingSaveRef.current) doSync(pendingSaveRef.current);
    }, SAVE_DEBOUNCE_MS);
  }, [doSync]);

  // ── Backup helpers ────────────────────────────────────────────────────────

  const pushBackup = useCallback(async (
    label: string,
    snapshot: AppState,
    locationId: string | null,
    locationName: string | null,
  ): Promise<void> => {
    const entry = {
      id: crypto.randomUUID(),
      label,
      timestamp: new Date().toISOString(),
      locationId,
      locationName,
      snapshot: { locations: snapshot.locations, auditLog: snapshot.auditLog },
    };
    // Fire-and-forget — backup failure is non-fatal
    window.electronAPI.data.saveBackup(entry).catch(console.error);
  }, []);

  // ── CRUD mutations ─────────────────────────────────────────────────────────

  const addLocation = useCallback(
    (location: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>, options?: { source?: string }) => {
      const now = new Date().toISOString();
      const newLocation: Location = { ...location, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      const label = options?.source
        ? `Added "${newLocation.siteName}" (${options.source})`
        : `Added "${newLocation.siteName}"`;

      setAppState((prev) => {
        pushBackup(label, prev, newLocation.id, newLocation.siteName);
        const auditEntry = createAuditEntry(newLocation.id, 'create', buildLocationDiff(null, newLocation), prev.currentUser);
        const next = { ...prev, locations: [...prev.locations, newLocation], auditLog: [...prev.auditLog, auditEntry] };
        scheduleSync(next);
        return next;
      });

      return newLocation;
    },
    [pushBackup, scheduleSync],
  );

  const updateLocation = useCallback(
    (id: string, updates: Partial<Location>) => {
      setAppState((prev) => {
        const old = prev.locations.find((l) => l.id === id);
        if (!old) return prev;

        const diff: Record<string, { before: unknown; after: unknown }> = {};
        (Object.keys(updates) as (keyof Location)[]).forEach((key) => {
          if (updates[key] !== old[key]) diff[key] = { before: old[key], after: updates[key] };
        });
        if (Object.keys(diff).length === 0) return prev;

        pushBackup(`Edited "${old.siteName}"`, prev, id, old.siteName);
        const updated: Location = { ...old, ...updates, updatedAt: new Date().toISOString() };
        const auditEntry = createAuditEntry(id, 'update', diff, prev.currentUser);
        const next = {
          ...prev,
          locations: prev.locations.map((l) => (l.id === id ? updated : l)),
          auditLog: [...prev.auditLog, auditEntry],
        };
        scheduleSync(next);
        return next;
      });
    },
    [pushBackup, scheduleSync],
  );

  const deleteLocation = useCallback(
    (id: string) => {
      setAppState((prev) => {
        const location = prev.locations.find((l) => l.id === id);
        if (!location) return prev;
        pushBackup(`Deleted "${location.siteName}"`, prev, id, location.siteName);
        const auditEntry = createAuditEntry(id, 'delete', buildLocationDiff(location, null), prev.currentUser);
        const next = {
          ...prev,
          locations: prev.locations.filter((l) => l.id !== id),
          auditLog: [...prev.auditLog, auditEntry],
        };
        scheduleSync(next);
        return next;
      });
    },
    [pushBackup, scheduleSync],
  );

  const setCurrentUser = useCallback((username: string) => {
    setAppState((prev) => {
      // No-op when username is unchanged — avoids scheduling a spurious sync
      // that would fire with stale (possibly empty) locations before loadFromDropbox
      // has populated state (Bug 3 fix).
      if (prev.currentUser === username) return prev;
      const next = { ...prev, currentUser: username };
      // Only persist if the initial load has already completed.
      // Before that, scheduleSync would race against loadFromDropbox and could
      // overwrite staging with an empty locations array.
      if (initializedRef.current) {
        scheduleSync(next);
      }
      return next;
    });
  }, [scheduleSync]);

  // ── Publish ────────────────────────────────────────────────────────────────

  const publish = useCallback(async (): Promise<{ ok: boolean; conflict?: boolean; error?: string }> => {
    setIsSaving(true);
    try {
      await pushBackup('Published to Live', appState, null, null);
      const result = await window.electronAPI.data.publish(
        appState.locations,
        appState.currentUser,
        liveRevRef.current,
      );
      if (result.ok) {
        // Track the new rev so the next publish uses safe update mode
        if (result.newRev) liveRevRef.current = result.newRev;
        setAppState((prev) => ({ ...prev, publishedLocations: prev.locations }));
      }
      return result;
    } catch (err) {
      console.error('Publish failed:', err);
      return { ok: false, error: (err as Error).message };
    } finally {
      setIsSaving(false);
    }
  }, [appState, pushBackup]);

  // ── Backup & Restore ──────────────────────────────────────────────────────

  const getBackups = useCallback(async (): Promise<BackupEntry[]> => {
    const result = await window.electronAPI.data.listBackups();
    const list = result.ok ? (result.backups ?? []) : [];
    setCachedBackups(list);
    return list;
  }, []);

  const restoreBackup = useCallback(async (backupId: string): Promise<boolean> => {
    const backup = cachedBackups.find((b) => b.id === backupId);
    if (!backup) return false;

    const result = await window.electronAPI.data.loadBackup(backup.dropboxPath);
    if (!result.ok || !result.snapshot) return false;

    const snap = result.snapshot as { locations: Location[]; auditLog: AuditEntry[] };

    await pushBackup(`Before full restore to: ${backup.label}`, appState, null, null);

    setAppState((prev) => {
      const next = { ...prev, locations: snap.locations, auditLog: snap.auditLog };
      scheduleSync(next);
      return next;
    });
    return true;
  }, [cachedBackups, appState, pushBackup, scheduleSync]);

  const restoreSingleLocation = useCallback(async (backupId: string): Promise<boolean> => {
    const backup = cachedBackups.find((b) => b.id === backupId);
    if (!backup || !backup.locationId) return false;

    const result = await window.electronAPI.data.loadBackup(backup.dropboxPath);
    if (!result.ok || !result.snapshot) return false;

    const snap = result.snapshot as { locations: Location[]; auditLog: AuditEntry[] };

    await pushBackup(`Restored "${backup.locationName}"`, appState, backup.locationId, backup.locationName);

    setAppState((prev) => {
      const locationInSnapshot = snap.locations.find((l) => l.id === backup.locationId);
      let newLocations: Location[];

      if (locationInSnapshot) {
        const existsNow = prev.locations.some((l) => l.id === backup.locationId);
        newLocations = existsNow
          ? prev.locations.map((l) => (l.id === backup.locationId ? locationInSnapshot : l))
          : [...prev.locations, locationInSnapshot];
      } else {
        newLocations = prev.locations.filter((l) => l.id !== backup.locationId);
      }

      const auditEntry = createAuditEntry(
        backup.locationId!,
        'update',
        { restored: { before: 'current version', after: `snapshot from ${backup.timestamp}` } },
        prev.currentUser,
      );
      const next = { ...prev, locations: newLocations, auditLog: [...prev.auditLog, auditEntry] };
      scheduleSync(next);
      return next;
    });
    return true;
  }, [cachedBackups, appState, pushBackup, scheduleSync]);

  // ── Conflict resolution ───────────────────────────────────────────────────

  const resolveConflict = useCallback(async (choice: 'reload' | 'force') => {
    if (choice === 'reload') {
      await loadFromDropbox();
    } else {
      // Force overwrite — upload with no rev check
      setIsSaving(true);
      try {
        const payload: StagingPayload = {
          version: 1,
          locations: appState.locations,
          auditLog: appState.auditLog,
          currentUser: appState.currentUser,
        };
        const result = await window.electronAPI.data.saveStaging(payload, '', true); // force=true: explicit admin override
        if (result.ok && result.newRev) stagingRevRef.current = result.newRev;
      } finally {
        setIsSaving(false);
      }
    }
    setHasConflict(false);
    setConflictMessage(null);
  }, [appState, loadFromDropbox]);

  // ── Manual File menu actions ──────────────────────────────────────────────

  /** Immediately saves staging to Dropbox — same rev-safe path as the auto-save. */
  const manualSave = useCallback(async (): Promise<{ ok: boolean; conflict?: boolean; error?: string }> => {
    // Flush any pending debounce — we're saving right now
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      pendingSaveRef.current = null;
    }
    setIsSaving(true);
    try {
      const payload: StagingPayload = {
        version: 1,
        locations: appState.locations,
        auditLog: appState.auditLog,
        currentUser: appState.currentUser,
      };
      const result = await window.electronAPI.data.saveStaging(payload, stagingRevRef.current);
      if (result.ok && result.newRev) {
        stagingRevRef.current = result.newRev;
        setHasConflict(false);
        setSaveError(null);
      } else if (result.conflict) {
        setHasConflict(true);
        setConflictMessage(result.error ?? 'Another admin saved changes since you loaded.');
      } else if (!result.ok) {
        setSaveError(result.error ?? 'Failed to save to Dropbox.');
      }
      return result;
    } catch (err) {
      const msg = (err as Error).message;
      setSaveError(msg);
      return { ok: false, error: msg };
    } finally {
      setIsSaving(false);
    }
  }, [appState]);

  /** Creates a full-snapshot backup of the current staging state. */
  const manualBackup = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const entry = {
        id: crypto.randomUUID(),
        label: 'Manual backup',
        timestamp: new Date().toISOString(),
        locationId: null as string | null,
        locationName: null as string | null,
        snapshot: { locations: appState.locations, auditLog: appState.auditLog },
      };
      return await window.electronAPI.data.saveBackup(entry);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }, [appState]);

  // ── Audit history ─────────────────────────────────────────────────────────

  const getAuditHistory = useCallback(
    (locationId: string, limit = 5): AuditEntry[] =>
      appState.auditLog
        .filter((e) => e.locationId === locationId)
        .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())
        .slice(0, limit),
    [appState.auditLog],
  );

  // ── Pending changes count (compare staging vs published) ─────────────────

  const pendingChangesCount = useMemo(() => {
    const publishedById = new Map(appState.publishedLocations.map((l) => [l.id, l]));
    const stagingIds = new Set(appState.locations.map((l) => l.id));
    let count = 0;
    for (const loc of appState.locations) {
      const pub = publishedById.get(loc.id);
      if (!pub || pub.updatedAt !== loc.updatedAt) count++;
    }
    for (const pub of appState.publishedLocations) {
      if (!stagingIds.has(pub.id)) count++;
    }
    return count;
  }, [appState.locations, appState.publishedLocations]);

  // ── Exports ────────────────────────────────────────────────────────────────

  const exportData = useCallback(() => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const json = JSON.stringify({ exportedAt: new Date().toISOString(), state: appState }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `napa-courier-locations-${timestamp}.json`; a.click();
    URL.revokeObjectURL(url);
  }, [appState]);

  const exportCsv = useCallback(() => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const headers = ['Site Name', 'Account Number', 'State', 'City', 'Address', 'Instructions', 'Video URL', 'Image URL'];
    const rows = appState.locations.map((loc) =>
      [esc(loc.siteName), esc(loc.accountNumber), esc(loc.state), esc(loc.city),
       esc(loc.address), esc(loc.instructions), esc(loc.videoUrl), esc(loc.imageUrl)].join(','),
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `napa-courier-locations-${timestamp}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [appState.locations]);

  // ── Public interface (matches web app as closely as possible) ─────────────

  return {
    state: appState,
    isLoading,
    isSaving,
    hasConflict,
    conflictMessage,
    saveError,
    recoveryNotice,
    pendingChangesCount,

    addLocation,
    updateLocation,
    deleteLocation,
    publish,
    setCurrentUser,
    getAuditHistory,
    exportData,
    exportCsv,

    getBackups,
    restoreBackup,
    restoreSingleLocation,

    reload: loadFromDropbox,
    resolveConflict,
    manualSave,
    manualBackup,
  };
}

// Convenience re-export so components importing from '@/lib/store' keep working
export { useLocationStore as default };
