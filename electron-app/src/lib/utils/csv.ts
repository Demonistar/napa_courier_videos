// ─── CSV Parser ────────────────────────────────────────────────────────────────

/**
 * Parse a raw CSV string into headers + row objects.
 * Handles: quoted fields, commas inside quotes, CRLF/LF, BOM stripping.
 */
export function parseCsv(raw: string): { headers: string[]; rows: Record<string, string>[] } {
  // Strip BOM if present
  const text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;

  const lines = splitCsvLines(text);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = (values[idx] ?? '').trim();
    });
    rows.push(row);
  }

  return { headers, rows };
}

/** Split into logical lines, respecting quoted newlines. */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // Check for escaped quote ("")
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if ((ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) && !inQuotes) {
      if (ch === '\r') i++; // consume \n of CRLF
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Parse a single CSV line into an array of field strings. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// ─── Column Auto-Mapper ────────────────────────────────────────────────────────

export type ImportField =
  | 'siteName'
  | 'accountNumber'
  | 'state'
  | 'city'
  | 'address'
  | 'videoUrl'
  | 'instructions'
  | 'imageUrl';

export const IMPORT_FIELDS: { field: ImportField; label: string; required: boolean }[] = [
  { field: 'siteName',       label: 'Site Name',       required: true  },
  { field: 'accountNumber',  label: 'Account Number',  required: false },
  { field: 'state',          label: 'State',           required: true  },
  { field: 'city',           label: 'City',            required: true  },
  { field: 'address',        label: 'Address',         required: false },
  { field: 'instructions',   label: 'Instructions / Notes', required: false },
  { field: 'videoUrl',       label: 'Video URL',       required: false },
  { field: 'imageUrl',       label: 'Image URL',       required: false },
];

const FIELD_ALIASES: Record<ImportField, string[]> = {
  siteName: [
    'site name', 'sitename', 'name', 'location name', 'location',
    'store', 'business', 'business name', 'customer name', 'site',
  ],
  accountNumber: [
    'account number', 'account #', 'account#', 'acct', 'acct #', 'acct#',
    'account', 'customer number', 'customer #', 'cust #', 'cust#', 'cust number',
    'account no', 'acct no', 'acct number',
  ],
  state: ['state', 'st', 'province', 'state/province'],
  city: ['city', 'town', 'municipality', 'city name'],
  address: [
    'address', 'street address', 'street', 'addr', 'full address',
    'location address', 'mailing address', 'delivery address',
  ],
  videoUrl: [
    'video url', 'video link', 'video', 'url', 'link',
    'video_url', 'videourl', 'delivery video',
  ],
  instructions: [
    'instructions', 'notes', 'delivery notes', 'delivery instructions',
    'note', 'comments', 'comment', 'special instructions', 'delivery notes',
    'info', 'details',
  ],
  imageUrl: [
    'image url', 'image link', 'image', 'photo url', 'photo',
    'image_url', 'photo_url', 'img', 'picture', 'picture url',
  ],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[_\-\.]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Returns a best-guess mapping: field → matching CSV header ('' if no match).
 */
export function autoMapColumns(csvHeaders: string[]): Record<ImportField, string> {
  const result = {} as Record<ImportField, string>;
  const normalizedHeaders = csvHeaders.map(normalizeHeader);

  for (const { field } of IMPORT_FIELDS) {
    const aliases = FIELD_ALIASES[field];
    let matched = '';

    for (const alias of aliases) {
      const idx = normalizedHeaders.indexOf(alias);
      if (idx !== -1) {
        matched = csvHeaders[idx];
        break;
      }
    }

    result[field] = matched;
  }

  return result;
}
