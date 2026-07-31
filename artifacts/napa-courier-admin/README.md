# NAPA Courier Admin Dashboard

A professional admin HUD for managing NAPA auto parts franchise courier delivery location directory. Built for daily use by business owners and non-technical staff.

## Features

### Location Management
- **Hierarchical Tree Navigation**: Browse locations organized by State → City → Site
- **Quick Search**: Real-time search across all location fields (site name, address, city, state)
- **Complete CRUD**: Create, read, update, and delete delivery locations
- **Duplicate Detection**: Automatic fuzzy matching warns when similar locations exist
- **Rich Details**: Support for addresses, delivery instructions, images, and video URLs

### Publishing Workflow
- **Staging Layer**: All edits go to a draft/staging layer first
- **Live Layer**: Published locations are what drivers see
- **Pending Changes Badge**: Visual indicator shows unpublished changes count
- **One-Click Publish**: Push all staging changes live with confirmation

### Audit Trail
- **Complete History**: Every create, update, and delete is logged
- **User Tracking**: Records who made each change and when
- **Diff Tracking**: Stores before/after values for all modifications
- **Per-Location History**: View the last 5 audit entries for each location

### Data Management
- **localStorage Persistence**: All data stored locally in browser
- **JSON Export**: Download complete database snapshot with timestamp
- **Schema-Ready**: Extensible data model prepared for future database migration

### User Experience
- **Resizable Panels**: Three-pane layout with adjustable panel sizes
- **Guided Tour**: Interactive step-by-step walkthrough for new users
- **Help System**: Built-in documentation and quick reference guide
- **Responsive Design**: Works on desktop and tablet (mobile-first CSS)

## Architecture

### File Structure

```
src/
├── lib/
│   ├── store.ts                 # localStorage-backed state management
│   └── utils/
│       └── fuzzy.ts             # Levenshtein distance for duplicate detection
├── components/
│   ├── form/
│   │   ├── ComboboxField.tsx    # Reusable state/city picker with "Add new" support
│   │   ├── LocationForm.tsx     # Full location add/edit form
│   │   └── DuplicateWarning.tsx # Inline warning card for similar locations
│   ├── tree/
│   │   └── LocationTree.tsx     # Collapsible state/city/site tree
│   ├── detail/
│   │   ├── LocationDetail.tsx   # Selected location detail view
│   │   ├── AuditHistory.tsx     # Expandable audit log
│   │   └── EmptyState.tsx       # "No location selected" placeholder
│   ├── layout/
│   │   ├── TopBar.tsx           # Global header with search/publish/export
│   │   └── HelpMenu.tsx         # Help dropdown with guide and tour trigger
│   └── tutorial/
│       ├── TourOverlay.tsx      # Spotlight overlay for guided tour
│       └── useTour.ts           # Tour step definitions and state
├── pages/
│   └── AdminDashboard.tsx       # Main three-pane dashboard
└── App.tsx                      # Root router and providers
```

### Data Model

```typescript
interface Location {
  id: string;              // UUID, stable, never changes
  state: string;           // Combobox with "add new" support
  city: string;            // Combobox filtered by state
  siteName: string;        // Free text
  address: string;         // Multi-line
  videoUrl: string | null; // Plain URL (Dropbox, etc.)
  imageUrl: string | null; // URL or base64 data URI
  instructions: string;    // Delivery notes
  syncSource: string | null;       // Future: external sync source
  lastVerified: string | null;     // Future: verification timestamp
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // ISO timestamp
}

interface AuditEntry {
  id: string;
  locationId: string;
  action: 'create' | 'update' | 'delete';
  changedBy: string;       // Simple username (no auth yet)
  changedAt: string;       // ISO timestamp
  diff: Record<string, { before: unknown; after: unknown }>;
}

interface AppState {
  locations: Location[];          // Staging/draft layer
  publishedLocations: Location[]; // Live layer (what drivers see)
  pendingPublish: boolean;        // True if staging differs from live
  auditLog: AuditEntry[];
  currentUser: string;            // Stored in localStorage
}
```

### Storage Strategy

All data is stored in localStorage under the key `napa-courier-admin-state`. The schema is designed to be easily migrated to a database:

- UUIDs for stable IDs
- ISO timestamps for all dates
- Normalized audit log separate from locations
- Clear separation between staging and live data

## Design System

**Layout Paradigm**: Dashboard cockpit — information-dense three-pane split with resizable panels

**Aesthetic**: Utilitarian precision — enterprise admin tool with NAPA red accent (#D62B1F) on slate/navy foundation

**Typography**:
- UI: DM Sans (400, 500, 600, 700)
- Data: Space Mono (400, 700)

**Color Palette**:
- Primary: NAPA Red (#D62B1F / `hsl(5 78% 50%)`)
- Sidebar: Navy (`hsl(215 30% 18%)`)
- Background: Light slate (`hsl(210 20% 98%)`)
- Accent (warnings): Amber (`hsl(38 92% 50%)`)
- Destructive: Red (`hsl(0 72% 51%)`)

## Usage Guide

### Adding a Location
1. Click "Add Location" in the tree panel or action bar
2. Fill in State, City, Site Name, and Address (required)
3. Optionally add video URL, image, and delivery instructions
4. Click "Create Location"
5. If similar location detected, confirm or cancel

### Modifying a Location
1. Select location from tree
2. Click "Modify Selected" in action bar
3. Update fields as needed
4. Click "Update Location"

### Publishing Changes
1. Make edits (add, modify, delete locations)
2. Orange badge shows unpublished change count
3. Click "Publish to Live" when ready
4. Confirm to push changes live

### Searching
- Type in global search bar (top)
- Tree filters in real-time
- Matches site name, city, state, or address
- Matched text is highlighted

### Data Export
1. Click "Export" button in top bar
2. Downloads JSON file: `napa-courier-locations-{timestamp}.json`
3. Contains full AppState (staging, live, audit log)

## Development

Built with:
- React 18 + TypeScript
- Vite for build tooling
- Tailwind CSS 4 for styling
- shadcn/ui component library
- react-resizable-panels for layout
- wouter for routing
- date-fns for date formatting

No backend required — fully client-side localStorage app.

## Future Enhancements

The schema includes extension hooks for:
- `syncSource`: External data sync (e.g. Google Sheets, API)
- `lastVerified`: Manual or automated location verification workflow
- User authentication (currently simple username in localStorage)
- Backend database migration (UUIDs and ISO timestamps ready)
- QR code generation for locations
- Map/GPS integration
- Bulk import/export (CSV, Excel)
