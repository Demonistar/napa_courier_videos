import { useState, useRef, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Upload, AlertTriangle, CheckCircle2, SkipForward, ChevronRight, FileText, X, Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Location } from '@/lib/store';
import { parseCsv, autoMapColumns, IMPORT_FIELDS, type ImportField } from '@/lib/utils/csv';
import { findSimilarLocation } from '@/lib/utils/fuzzy';

// ─── Types ────────────────────────────────────────────────────────────────────

type ColumnMap = Record<ImportField, string>; // field → CSV header ('') = skip

interface RowPreview {
  index: number;
  raw: Record<string, string>;
  mapped: Omit<Location, 'id' | 'createdAt' | 'updatedAt'> | null; // null if missing required
  missingFields: string[];
  duplicate: { siteName: string; city: string; state: string } | null;
  skip: boolean;
}

type Step = 'upload' | 'map' | 'preview';

interface CsvImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingLocations: Location[];
  onImport: (
    rows: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>[],
    source: string,
  ) => void;
  /** Pre-seed the wizard at the column-mapping step (e.g. from Generate Links). */
  seedData?: { headers: string[]; rows: Record<string, string>[] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SKIP_VALUE = '__skip__';

const ACCEPTED_EXTENSIONS = /\.(csv|txt|xlsx|xls)$/i;
const ACCEPTED_MIME = [
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

/**
 * Parse the first sheet of an Excel workbook (ArrayBuffer) into the same
 * {headers, rows} shape that parseCsv produces.
 */
function parseXlsx(buffer: ArrayBuffer): { headers: string[]; rows: Record<string, string>[] } {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };

  const sheet = workbook.Sheets[sheetName];
  // header:1 gives us an array-of-arrays; defval keeps empty cells as ''
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
  if (data.length === 0) return { headers: [], rows: [] };

  const rawHeaders = data[0] as unknown[];
  const headers = rawHeaders.map((h) => String(h ?? '').trim()).filter(Boolean);
  if (headers.length === 0) return { headers: [], rows: [] };

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < data.length; i++) {
    const values = data[i] as unknown[];
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = String(values[idx] ?? '').trim();
    });
    // Skip entirely blank rows
    if (Object.values(row).some((v) => v !== '')) {
      rows.push(row);
    }
  }

  return { headers, rows };
}

function buildMappedRow(
  raw: Record<string, string>,
  columnMap: ColumnMap,
): {
  data: Omit<Location, 'id' | 'createdAt' | 'updatedAt'> | null;
  missingFields: string[];
} {
  const missingFields: string[] = [];

  const get = (field: ImportField) => {
    const col = columnMap[field];
    if (!col) return '';
    return (raw[col] ?? '').trim();
  };

  const required = IMPORT_FIELDS.filter((f) => f.required);
  for (const { field, label } of required) {
    if (!get(field)) missingFields.push(label);
  }

  if (missingFields.length > 0) return { data: null, missingFields };

  return {
    data: {
      state: get('state'),
      city: get('city'),
      siteName: get('siteName'),
      accountNumber: get('accountNumber'),
      address: get('address'),
      videoUrl: get('videoUrl') || null,
      imageUrl: get('imageUrl') || null,
      instructions: get('instructions'),
      syncSource: 'csv_import',
      lastVerified: null,
    },
    missingFields: [],
  };
}

// ─── Step Components ──────────────────────────────────────────────────────────

// Headers chosen to match the first alias in FIELD_ALIASES so auto-mapping is perfect on re-upload.
const TEMPLATE_HEADERS = [
  'Site Name',
  'Account Number',
  'State',
  'City',
  'Address',
  'Instructions',
  'Video URL',
  'Image URL',
];

function downloadTemplate() {
  const header = TEMPLATE_HEADERS.join(',');
  const example =
    '"Example Location","00123456","Arkansas","Bentonville","215 SW 14th St, Bentonville, AR 72712","Enter through main entrance","","" ';
  const csv = `${header}\n${example}\n`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'napa-courier-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function UploadStep({
  onParsed,
  onFileName,
}: {
  onParsed: (headers: string[], rows: Record<string, string>[]) => void;
  onFileName: (name: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      setError('');

      if (!ACCEPTED_EXTENSIONS.test(file.name)) {
        setError('Please upload a .csv, .xlsx, or .xls file.');
        return;
      }

      onFileName(file.name);

      const isExcel = /\.(xlsx|xls)$/i.test(file.name);

      if (isExcel) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const { headers, rows } = parseXlsx(e.target?.result as ArrayBuffer);
            if (headers.length === 0) {
              setError('The spreadsheet appears to be empty or has no columns.');
              return;
            }
            if (rows.length === 0) {
              setError('The spreadsheet has headers but no data rows.');
              return;
            }
            onParsed(headers, rows);
          } catch {
            setError('Could not read the Excel file. Make sure it is a valid .xlsx or .xls workbook.');
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result as string;
          const { headers, rows } = parseCsv(text);
          if (headers.length === 0) {
            setError('The file appears to be empty or has no columns.');
            return;
          }
          if (rows.length === 0) {
            setError('The file has headers but no data rows.');
            return;
          }
          onParsed(headers, rows);
        };
        reader.readAsText(file);
      }
    },
    [onParsed, onFileName],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg p-12 flex flex-col items-center justify-center gap-3
          cursor-pointer transition-colors
          ${dragOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30'
          }
        `}
      >
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Upload className="w-5 h-5 text-muted-foreground" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            Drop a file here, or click to browse
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Supports Excel (.xlsx, .xls) and CSV (.csv, .txt) — first sheet is imported
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            // Reset so the same file can be re-selected after an error
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">Expected columns (can be in any order):</p>
        <p>Site Name, Account Number, State, City, Address, Instructions / Notes, Video URL, Image URL</p>
        <p>Column names don't need to match exactly — you'll confirm the mapping in the next step.</p>
        <div className="pt-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); downloadTemplate(); }}
            className="inline-flex items-center gap-1.5 text-primary hover:underline font-medium"
          >
            <Download className="w-3 h-3" />
            Download blank CSV template
          </button>
          <span className="ml-1 text-muted-foreground">
            — fill it in (or open in Excel and save as .xlsx) and upload it here.
          </span>
        </div>
      </div>
    </div>
  );
}

function MapStep({
  headers,
  rows,
  columnMap,
  onChange,
  onNext,
  onBack,
}: {
  headers: string[];
  rows: Record<string, string>[];
  columnMap: ColumnMap;
  onChange: (field: ImportField, col: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const requiredFields = IMPORT_FIELDS.filter((f) => f.required);
  const canProceed = requiredFields.every((f) => columnMap[f.field]);

  const previewHeader = headers[0];
  const previewRow = rows[0] ?? {};

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Found <span className="font-medium text-foreground">{rows.length} data rows</span> with{' '}
        <span className="font-medium text-foreground">{headers.length} columns</span>.
        Map each location field to the correct spreadsheet column below.
      </p>

      <div className="rounded-md border overflow-hidden">
        <div className="grid grid-cols-[1fr_1fr_1fr] text-xs font-medium text-muted-foreground bg-muted/50 px-3 py-2 border-b">
          <span>Location Field</span>
          <span>Spreadsheet Column</span>
          <span>Sample Value</span>
        </div>
        <div className="divide-y">
          {IMPORT_FIELDS.map(({ field, label, required }) => {
            const selectedCol = columnMap[field];
            const sampleVal = selectedCol ? (previewRow[selectedCol] ?? '') : '';

            return (
              <div
                key={field}
                className="grid grid-cols-[1fr_1fr_1fr] items-center px-3 py-2.5 gap-2"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-foreground">{label}</span>
                  {required && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-primary/40 text-primary">
                      required
                    </Badge>
                  )}
                </div>

                <Select
                  value={selectedCol || SKIP_VALUE}
                  onValueChange={(val) => onChange(field, val === SKIP_VALUE ? '' : val)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!required && (
                      <SelectItem value={SKIP_VALUE} className="text-xs text-muted-foreground">
                        — skip this field —
                      </SelectItem>
                    )}
                    {headers.map((h) => (
                      <SelectItem key={h} value={h} className="text-xs">
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span className="text-xs text-muted-foreground truncate">
                  {sampleVal || (selectedCol ? <em>empty</em> : '—')}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {!canProceed && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Map all required fields before continuing.
        </div>
      )}

      <div className="flex justify-between pt-1">
        <Button variant="outline" onClick={onBack} size="sm">
          Back
        </Button>
        <Button onClick={onNext} disabled={!canProceed} size="sm">
          Preview Import
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function PreviewStep({
  rows,
  onConfirm,
  onBack,
  onToggleSkip,
}: {
  rows: RowPreview[];
  onConfirm: () => void;
  onBack: () => void;
  onToggleSkip: (index: number) => void;
}) {
  const toImport = rows.filter((r) => !r.skip && r.mapped !== null);
  const skipped = rows.filter((r) => r.skip || r.mapped === null);
  const duplicates = rows.filter((r) => r.duplicate && !r.skip);
  const invalid = rows.filter((r) => r.mapped === null);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge className="gap-1.5 bg-green-600 hover:bg-green-600 text-white">
          <CheckCircle2 className="w-3 h-3" />
          {toImport.length} will be added
        </Badge>
        {duplicates.length > 0 && (
          <Badge variant="outline" className="gap-1.5 border-amber-400 text-amber-700 bg-amber-50">
            <AlertTriangle className="w-3 h-3" />
            {duplicates.length} possible duplicate{duplicates.length !== 1 ? 's' : ''}
          </Badge>
        )}
        {skipped.length > 0 && (
          <Badge variant="secondary" className="gap-1.5">
            <SkipForward className="w-3 h-3" />
            {skipped.length} skipped
          </Badge>
        )}
      </div>

      {duplicates.length > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <strong>Possible duplicates flagged.</strong> These rows closely match an existing location by
          name and address. They're set to skip by default — uncheck "Skip" to force-add them anyway.
        </div>
      )}

      {/* Row table */}
      <div className="rounded-md border overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_auto] text-xs font-medium text-muted-foreground bg-muted/50 px-3 py-2 border-b">
          <span className="w-20 mr-2">Status</span>
          <span>Location</span>
          <span className="w-24 text-right">Action</span>
        </div>
        <ScrollArea className="max-h-72">
          <div className="divide-y">
            {rows.map((row) => {
              const isInvalid = row.mapped === null;
              const isDuplicate = !!row.duplicate;
              const isSkipped = row.skip;

              return (
                <div
                  key={row.index}
                  className={`grid grid-cols-[auto_1fr_auto] items-start px-3 py-2.5 gap-2 ${
                    isSkipped ? 'opacity-50' : ''
                  }`}
                >
                  {/* Status */}
                  <div className="w-20 mr-2 pt-0.5">
                    {isInvalid ? (
                      <Badge variant="outline" className="text-[10px] px-1 border-destructive/40 text-destructive">
                        invalid
                      </Badge>
                    ) : isDuplicate ? (
                      <Badge variant="outline" className="text-[10px] px-1 border-amber-400 text-amber-700 bg-amber-50">
                        duplicate
                      </Badge>
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    )}
                  </div>

                  {/* Details */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {row.mapped?.siteName ?? <span className="text-muted-foreground italic">—</span>}
                    </p>
                    {row.mapped && (
                      <p className="text-xs text-muted-foreground">
                        {row.mapped.city}, {row.mapped.state}
                        {row.mapped.accountNumber && (
                          <span className="ml-2 font-mono">#{row.mapped.accountNumber}</span>
                        )}
                      </p>
                    )}
                    {isInvalid && (
                      <p className="text-xs text-destructive">
                        Missing: {row.missingFields.join(', ')}
                      </p>
                    )}
                    {isDuplicate && row.duplicate && (
                      <p className="text-xs text-amber-700">
                        Matches existing: "{row.duplicate.siteName}" in {row.duplicate.city}, {row.duplicate.state}
                      </p>
                    )}
                  </div>

                  {/* Action toggle */}
                  <div className="w-24 text-right">
                    {!isInvalid && (
                      <button
                        onClick={() => onToggleSkip(row.index)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          isSkipped
                            ? 'border-muted-foreground/30 text-muted-foreground hover:border-primary hover:text-primary'
                            : isDuplicate
                            ? 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100'
                            : 'border-transparent text-muted-foreground hover:border-muted-foreground/30'
                        }`}
                      >
                        {isSkipped ? 'Include' : 'Skip'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      <div className="flex justify-between items-center pt-1">
        <Button variant="outline" onClick={onBack} size="sm">
          Back
        </Button>
        <Button
          onClick={onConfirm}
          disabled={toImport.length === 0}
          size="sm"
          className="min-w-36"
        >
          Import {toImport.length} location{toImport.length !== 1 ? 's' : ''}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CsvImport({ open, onOpenChange, existingLocations, onImport, seedData }: CsvImportProps) {
  const [step, setStep] = useState<Step>('upload');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [columnMap, setColumnMap] = useState<ColumnMap>({} as ColumnMap);
  const [previewRows, setPreviewRows] = useState<RowPreview[]>([]);
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    if (open && seedData) {
      setCsvHeaders(seedData.headers);
      setCsvRows(seedData.rows);
      setColumnMap(autoMapColumns(seedData.headers) as ColumnMap);
      setFileName('__generated_links__');
      setStep('map');
    }
  }, [open]);

  const reset = () => {
    setStep('upload');
    setCsvHeaders([]);
    setCsvRows([]);
    setColumnMap({} as ColumnMap);
    setPreviewRows([]);
    setFileName('');
  };

  const handleParsed = (headers: string[], rows: Record<string, string>[]) => {
    setCsvHeaders(headers);
    setCsvRows(rows);
    setColumnMap(autoMapColumns(headers) as ColumnMap);
    setStep('map');
  };

  const handleColumnChange = (field: ImportField, col: string) => {
    setColumnMap((prev) => ({ ...prev, [field]: col }));
  };

  const handleBuildPreview = () => {
    const rows: RowPreview[] = csvRows.map((raw, index) => {
      const { data, missingFields } = buildMappedRow(raw, columnMap);

      let duplicate = null;
      if (data) {
        duplicate = findSimilarLocation(data.siteName, data.address, existingLocations);
      }

      return {
        index,
        raw,
        mapped: data,
        missingFields,
        duplicate,
        // Duplicates default to skipped (safe); user must explicitly include them
        skip: !!duplicate,
      };
    });
    setPreviewRows(rows);
    setStep('preview');
  };

  const handleToggleSkip = (index: number) => {
    setPreviewRows((prev) =>
      prev.map((r) => (r.index === index ? { ...r, skip: !r.skip } : r)),
    );
  };

  const handleConfirm = () => {
    const toImport = previewRows
      .filter((r) => !r.skip && r.mapped !== null)
      .map((r) => r.mapped!);

    const source = /\.(xlsx|xls)$/i.test(fileName) ? 'Excel import'
                 : fileName === '__generated_links__'    ? 'Dropbox link generator'
                 : 'CSV import';
    onImport(toImport, source);
    onOpenChange(false);
    reset();
  };

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  const stepLabel: Record<Step, string> = {
    upload: 'Step 1 of 3 — Upload',
    map: 'Step 2 of 3 — Map Columns',
    preview: 'Step 3 of 3 — Preview & Confirm',
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Import Locations from Spreadsheet
          </DialogTitle>
          <DialogDescription>{stepLabel[step]}</DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="pt-1">
          {step === 'upload' && (
            <UploadStep
              onParsed={handleParsed}
              onFileName={setFileName}
            />
          )}

          {step === 'map' && (
            <MapStep
              headers={csvHeaders}
              rows={csvRows}
              columnMap={columnMap}
              onChange={handleColumnChange}
              onNext={handleBuildPreview}
              onBack={() => setStep('upload')}
            />
          )}

          {step === 'preview' && (
            <PreviewStep
              rows={previewRows}
              onConfirm={handleConfirm}
              onBack={() => setStep('map')}
              onToggleSkip={handleToggleSkip}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
