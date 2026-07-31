import { useState, useEffect } from 'react';

export interface Location {
  id: string;
  state: string;
  city: string;
  siteName: string;
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

export interface AppState {
  locations: Location[];
  publishedLocations: Location[];
  pendingPublish: boolean;
  auditLog: AuditEntry[];
  currentUser: string;
}

const STORAGE_KEY = 'napa-courier-admin-state';

const seedData: Location[] = [
  {
    id: crypto.randomUUID(),
    state: 'Arkansas',
    city: 'Bentonville',
    siteName: "Sheriff's Office",
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

function getInitialState(): AppState {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // Fall through to default
    }
  }
  return {
    locations: seedData,
    publishedLocations: seedData,
    pendingPublish: false,
    auditLog: [],
    currentUser: 'Admin',
  };
}

export function useLocationStore() {
  const [state, setState] = useState<AppState>(getInitialState);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const createAuditEntry = (
    locationId: string,
    action: 'create' | 'update' | 'delete',
    diff: Record<string, { before: unknown; after: unknown }>
  ): AuditEntry => ({
    id: crypto.randomUUID(),
    locationId,
    action,
    changedBy: state.currentUser,
    changedAt: new Date().toISOString(),
    diff,
  });

  const addLocation = (location: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const newLocation: Location = {
      ...location,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    const auditEntry = createAuditEntry(newLocation.id, 'create', {
      location: { before: null, after: newLocation },
    });

    setState((prev) => ({
      ...prev,
      locations: [...prev.locations, newLocation],
      auditLog: [...prev.auditLog, auditEntry],
      pendingPublish: true,
    }));

    return newLocation;
  };

  const updateLocation = (id: string, updates: Partial<Location>) => {
    setState((prev) => {
      const oldLocation = prev.locations.find((loc) => loc.id === id);
      if (!oldLocation) return prev;

      const diff: Record<string, { before: unknown; after: unknown }> = {};
      Object.keys(updates).forEach((key) => {
        const k = key as keyof Location;
        if (updates[k] !== oldLocation[k]) {
          diff[key] = { before: oldLocation[k], after: updates[k] };
        }
      });

      if (Object.keys(diff).length === 0) return prev;

      const updatedLocation = {
        ...oldLocation,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      const auditEntry = createAuditEntry(id, 'update', diff);

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

      const auditEntry = createAuditEntry(id, 'delete', {
        location: { before: location, after: null },
      });

      return {
        ...prev,
        locations: prev.locations.filter((loc) => loc.id !== id),
        auditLog: [...prev.auditLog, auditEntry],
        pendingPublish: true,
      };
    });
  };

  const publish = () => {
    setState((prev) => ({
      ...prev,
      publishedLocations: prev.locations,
      pendingPublish: false,
    }));
  };

  const exportData = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `napa-courier-locations-${timestamp}.json`;
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const setCurrentUser = (username: string) => {
    setState((prev) => ({ ...prev, currentUser: username }));
  };

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
    setCurrentUser,
    getAuditHistory,
  };
}
