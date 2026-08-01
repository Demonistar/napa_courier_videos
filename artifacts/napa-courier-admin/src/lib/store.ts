import { useState, useEffect } from 'react';

// ─── Data Types ────────────────────────────────────────────────────────────────

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
  // Reserved for future Dropbox sync — intentionally null for now
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

export interface AppState {
  locations: Location[];
  publishedLocations: Location[];
  pendingPublish: boolean;
  auditLog: AuditEntry[];
  currentUser: string;
}

export interface BackupEntry {
  id: string;
  timestamp: string;
  /** Human-readable description of the action that triggered this snapshot */
  label: string;
  /** Number of locations in this snapshot */
  locationCount: number;
  /**
   * If this snapshot was triggered by a single-record mutation, the ID of that
   * location. Null for system-wide events like Publish.
   * Used to enable single-record restore (restores only this one location,
   * leaving all other records exactly as they are now).
   */
  locationId: string | null;
  /** Display name of the location at snapshot time, for labeling in the UI */
  locationName: string | null;
  snapshot: AppState;
}

// ─── Storage Keys ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'napa-courier-admin-state';
const BACKUP_KEY = 'napa-courier-admin-backups';
const MAX_BACKUPS = 20;

// ─── Backup Helpers ────────────────────────────────────────────────────────────

export function getBackups(): BackupEntry[] {
  try {
    const stored = localStorage.getItem(BACKUP_KEY);
    return stored ? (JSON.parse(stored) as BackupEntry[]) : [];
  } catch {
    return [];
  }
}

function pushBackup(
  label: string,
  snapshot: AppState,
  locationId: string | null = null,
  locationName: string | null = null,
): void {
  try {
    const existing = getBackups();
    const entry: BackupEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      label,
      locationCount: snapshot.locations.length,
      locationId,
      locationName,
      snapshot,
    };
    const updated = [entry, ...existing].slice(0, MAX_BACKUPS);
    localStorage.setItem(BACKUP_KEY, JSON.stringify(updated));
  } catch {
    // Silently ignore storage errors (quota exceeded, etc.)
  }
}

// ─── Seed Data ─────────────────────────────────────────────────────────────────

const seedData: Location[] = [
  {
    id: crypto.randomUUID(),
    state: 'Arkansas',
    city: 'Bentonville',
    siteName: "Sheriff's Office",
    accountNumber: '',
    address: '215 SW 14th St, Bentonville, AR 72712',
    videoUrl: null,
    imageUrl: null,
    instructions: 'Enter through main entrance. Deliver to dispatch window on the left.',
    syncSource: null,
    lastVerified: null,
    createdAt: new Date('2024-01-15T10:30:00').toISOString(),
    updatedAt: new Date('2024-01-15T10:30:00').toISOString(),
  },
  {
    id: crypto.randomUUID(),
    state: 'Arkansas',
    city: 'Bentonville',
    siteName: 'Christian Brothers Automotive',
    accountNumber: '',
    address: '3404 SE 14th St, Bentonville, AR 72712',
    videoUrl: null,
    imageUrl: null,
    instructions: 'Park in customer lot. Ring bell at service counter.',
    syncSource: null,
    lastVerified: null,
    createdAt: new Date('2024-01-18T14:20:00').toISOString(),
    updatedAt: new Date('2024-01-18T14:20:00').toISOString(),
  },
  {
    id: crypto.randomUUID(),
    state: 'Arkansas',
    city: 'Bentonville',
    siteName: 'Straight Line',
    accountNumber: '',
    address: '1007 SE 28th St, Bentonville, AR 72712',
    videoUrl: null,
    imageUrl: null,
    instructions: 'Deliver to receiving bay on east side of building.',
    syncSource: null,
    lastVerified: null,
    createdAt: new Date('2024-01-20T09:15:00').toISOString(),
    updatedAt: new Date('2024-01-20T09:15:00').toISOString(),
  },
  {
    id: crypto.randomUUID(),
    state: 'Arkansas',
    city: 'Bentonville',
    siteName: 'Straight Line 2',
    accountNumber: '',
    address: '2101 SE Walton Blvd, Bentonville, AR 72712',
    videoUrl: null,
    imageUrl: null,
    instructions: 'Secondary location. Use north entrance.',
    syncSource: null,
    lastVerified: null,
    createdAt: new Date('2024-02-01T11:45:00').toISOString(),
    updatedAt: new Date('2024-02-01T11:45:00').toISOString(),
  },
  {
    id: crypto.randomUUID(),
    state: 'Arkansas',
    city: 'Rogers',
    siteName: 'Rogers Police Department',
    accountNumber: '',
    address: '317 W Walnut St, Rogers, AR 72756',
    videoUrl: null,
    imageUrl: null,
    instructions: 'Check in at front desk. Leave package with officer on duty.',
    syncSource: null,
    lastVerified: null,
    createdAt: new Date('2024-01-22T08:30:00').toISOString(),
    updatedAt: new Date('2024-01-22T08:30:00').toISOString(),
  },
  {
    id: crypto.randomUUID(),
    state: 'Arkansas',
    city: 'Rogers',
    siteName: 'Rogers Fire Station',
    accountNumber: '',
    address: '110 S 2nd St, Rogers, AR 72756',
    videoUrl: null,
    imageUrl: null,
    instructions: 'Ring doorbell. Firefighters will receive package at bay door.',
    syncSource: null,
    lastVerified: null,
    createdAt: new Date('2024-02-05T13:10:00').toISOString(),
    updatedAt: new Date('2024-02-05T13:10:00').toISOString(),
  },
  {
    id: crypto.randomUUID(),
    state: 'Missouri',
    city: 'Monett',
    siteName: 'Monett City Hall',
    accountNumber: '',
    address: '217 E Broadway, Monett, MO 65708',
    videoUrl: null,
    imageUrl: null,
    instructions: 'Deliver to city clerk office, second floor.',
    syncSource: null,
    lastVerified: null,
    createdAt: new Date('2024-01-25T15:40:00').toISOString(),
    updatedAt: new Date('2024-01-25T15:40:00').toISOString(),
  },
  {
    id: crypto.randomUUID(),
    state: 'Missouri',
    city: 'Mount Vernon',
    siteName: 'Mount Vernon Courthouse',
    accountNumber: '',
    address: '100 W Hwy 174, Mount Vernon, MO 65712',
    videoUrl: null,
    imageUrl: null,
    instructions: 'Security check required. Ask for county clerk.',
    syncSource: null,
    lastVerified: null,
    createdAt: new Date('2024-02-08T10:00:00').toISOString(),
    updatedAt: new Date('2024-02-08T10:00:00').toISOString(),
  },
  {
    id: crypto.randomUUID(),
    state: 'Missouri',
    city: 'Cassville',
    siteName: 'Cassville Pharmacy',
    accountNumber: '',
    address: '1010 Old Exeter Rd, Cassville, MO 65625',
    videoUrl: null,
    imageUrl: null,
    instructions: 'Enter through front door. Deliver to pharmacy counter in back.',
    syncSource: null,
    lastVerified: null,
    createdAt: new Date('2024-02-10T16:25:00').toISOString(),
    updatedAt: new Date('2024-02-10T16:25:00').toISOString(),
  },
];

// ─── State Init ────────────────────────────────────────────────────────────────

function getInitialState(): AppState {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as AppState;
    } catch {
      // Fall through to seed
    }
  }
  return {
    locations: seedData,
    publishedLocations: seedData,
    pendingPublish: false,
    auditLog: [],
    currentUser: 'Unknown user',
  };
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useLocationStore() {
  const [state, setState] = useState<AppState>(getInitialState);

  // Persist state to localStorage on every change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // ── Identity ──────────────────────────────────────────────────────────────

  const setCurrentUser = (username: string) => {
    setState((prev) => ({ ...prev, currentUser: username }));
  };

  // ── Audit ─────────────────────────────────────────────────────────────────

  /** Fields shown in the audit history panel. Internal bookkeeping fields excluded. */
  const AUDITABLE_FIELDS: (keyof Location)[] = [
    'siteName', 'accountNumber', 'state', 'city', 'address',
    'videoUrl', 'imageUrl', 'instructions',
  ];

  /**
   * Build a field-level diff for create (before=null) or delete (after=null).
   * Produces the same shape as update diffs so the history panel is consistent.
   */
  function buildLocationDiff(
    before: Location | null,
    after: Location | null,
  ): Record<string, { before: unknown; after: unknown }> {
    const diff: Record<string, { before: unknown; after: unknown }> = {};
    for (const field of AUDITABLE_FIELDS) {
      diff[field] = {
        before: before ? before[field] : null,
        after:  after  ? after[field]  : null,
      };
    }
    return diff;
  }

  const createAuditEntry = (
    locationId: string,
    action: 'create' | 'update' | 'delete',
    diff: Record<string, { before: unknown; after: unknown }>,
    user: string,
  ): AuditEntry => ({
    id: crypto.randomUUID(),
    locationId,
    action,
    changedBy: user,
    changedAt: new Date().toISOString(),
    diff,
  });

  // ── CRUD ──────────────────────────────────────────────────────────────────

  const addLocation = (
    location: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>,
    options?: { source?: string },
  ) => {
    const now = new Date().toISOString();
    const newLocation: Location = {
      ...location,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    const backupLabel = options?.source
      ? `Added "${newLocation.siteName}" (${options.source})`
      : `Added "${newLocation.siteName}"`;

    setState((prev) => {
      // Snapshot BEFORE the change — scoped to this new record's ID
      pushBackup(backupLabel, prev, newLocation.id, newLocation.siteName);

      const auditEntry = createAuditEntry(
        newLocation.id,
        'create',
        buildLocationDiff(null, newLocation),
        prev.currentUser,
      );

      return {
        ...prev,
        locations: [...prev.locations, newLocation],
        auditLog: [...prev.auditLog, auditEntry],
        pendingPublish: true,
      };
    });

    return newLocation;
  };

  const updateLocation = (id: string, updates: Partial<Location>) => {
    setState((prev) => {
      const oldLocation = prev.locations.find((loc) => loc.id === id);
      if (!oldLocation) return prev;

      const diff: Record<string, { before: unknown; after: unknown }> = {};
      (Object.keys(updates) as (keyof Location)[]).forEach((key) => {
        if (updates[key] !== oldLocation[key]) {
          diff[key] = { before: oldLocation[key], after: updates[key] };
        }
      });

      if (Object.keys(diff).length === 0) return prev;

      // Snapshot BEFORE the change — scoped to this record's ID
      pushBackup(`Edited "${oldLocation.siteName}"`, prev, id, oldLocation.siteName);

      const updatedLocation: Location = {
        ...oldLocation,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      const auditEntry = createAuditEntry(id, 'update', diff, prev.currentUser);

      return {
        ...prev,
        locations: prev.locations.map((loc) => (loc.id === id ? updatedLocation : loc)),
        auditLog: [...prev.auditLog, auditEntry],
        pendingPublish: true,
      };
    });
  };

  const deleteLocation = (id: string) => {
    setState((prev) => {
      const location = prev.locations.find((loc) => loc.id === id);
      if (!location) return prev;

      // Snapshot BEFORE the change — scoped to this record's ID
      pushBackup(`Deleted "${location.siteName}"`, prev, id, location.siteName);

      const auditEntry = createAuditEntry(
        id,
        'delete',
        buildLocationDiff(location, null),
        prev.currentUser,
      );

      return {
        ...prev,
        locations: prev.locations.filter((loc) => loc.id !== id),
        auditLog: [...prev.auditLog, auditEntry],
        pendingPublish: true,
      };
    });
  };

  // ── Publish ───────────────────────────────────────────────────────────────

  const publish = () => {
    setState((prev) => {
      // Publish is a system-wide event — no single locationId
      pushBackup('Published to Live', prev, null, null);
      return {
        ...prev,
        publishedLocations: prev.locations,
        pendingPublish: false,
      };
    });
  };

  // ── Backup & Restore ──────────────────────────────────────────────────────

  /**
   * Full restore — replaces the ENTIRE AppState with the chosen snapshot.
   * Every location, the published layer, and the audit log all revert.
   */
  const restoreBackup = (backupId: string) => {
    const backups = getBackups();
    const target = backups.find((b) => b.id === backupId);
    if (!target) return false;

    setState((prev) => {
      pushBackup(`Before full restore to: ${target.label}`, prev, null, null);
      return target.snapshot;
    });

    return true;
  };

  /**
   * Single-record restore — extracts ONE location from a snapshot and upserts
   * it into the CURRENT state. Every other location is left exactly as it is.
   *
   * - Location existed in snapshot → update in place (or re-add if since deleted)
   * - Location didn't exist in snapshot (was added after) → remove it
   */
  const restoreSingleLocation = (backupId: string) => {
    const backups = getBackups();
    const target = backups.find((b) => b.id === backupId);
    if (!target || !target.locationId) return false;

    setState((prev) => {
      // Snapshot current state first so the restore itself is undoable
      pushBackup(
        `Restored "${target.locationName}"`,
        prev,
        target.locationId,
        target.locationName,
      );

      const locationInSnapshot = target.snapshot.locations.find(
        (loc) => loc.id === target.locationId,
      );

      let newLocations: Location[];

      if (locationInSnapshot) {
        const existsNow = prev.locations.some((loc) => loc.id === target.locationId);
        if (existsNow) {
          // Update in place — all other locations untouched
          newLocations = prev.locations.map((loc) =>
            loc.id === target.locationId ? locationInSnapshot : loc,
          );
        } else {
          // Was deleted after snapshot — add it back
          newLocations = [...prev.locations, locationInSnapshot];
        }
      } else {
        // Didn't exist at snapshot time (was added after) — remove it
        newLocations = prev.locations.filter((loc) => loc.id !== target.locationId);
      }

      const auditEntry = createAuditEntry(
        target.locationId!,
        'update',
        { restored: { before: 'current version', after: `snapshot from ${target.timestamp}` } },
        prev.currentUser,
      );

      return {
        ...prev,
        locations: newLocations,
        auditLog: [...prev.auditLog, auditEntry],
        pendingPublish: true,
      };
    });

    return true;
  };

  // ── Export ────────────────────────────────────────────────────────────────

  const exportData = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `napa-courier-locations-${timestamp}.json`;
    const payload = {
      exportedAt: new Date().toISOString(),
      state,
      backups: getBackups(),
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Export current staging locations as CSV using the exact same column headers
   * as the import template, so a full export → edit → re-import round-trip works
   * with zero column-mapping friction.
   */
  const exportCsv = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `napa-courier-locations-${timestamp}.csv`;

    // Must match TEMPLATE_HEADERS in CsvImport.tsx exactly
    const headers = [
      'Site Name', 'Account Number', 'State', 'City',
      'Address', 'Instructions', 'Video URL', 'Image URL',
    ];

    const esc = (val: string | null | undefined): string => {
      const s = val ?? '';
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const rows = state.locations.map((loc) =>
      [
        esc(loc.siteName),
        esc(loc.accountNumber),
        esc(loc.state),
        esc(loc.city),
        esc(loc.address),
        esc(loc.instructions),
        esc(loc.videoUrl),
        esc(loc.imageUrl),
      ].join(','),
    );

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── History ───────────────────────────────────────────────────────────────

  const getAuditHistory = (locationId: string, limit = 5): AuditEntry[] => {
    return state.auditLog
      .filter((entry) => entry.locationId === locationId)
      .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())
      .slice(0, limit);
  };

  return {
    state,
    addLocation,
    updateLocation,
    deleteLocation,
    publish,
    exportData,
    exportCsv,
    setCurrentUser,
    getAuditHistory,
    restoreBackup,
    restoreSingleLocation,
    getBackups,
  };
}
