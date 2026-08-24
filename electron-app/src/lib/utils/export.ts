/**
 * Export utilities — CSV, XLSX, PDF, TXT.
 * All functions take the staging locations array and trigger a browser download.
 */

import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import { Location } from '@/lib/store';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEsc(val: string | null | undefined): string {
  const s = val ?? '';
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

/**
 * Returns the account number as a genuine JS number when it round-trips
 * cleanly (no leading zeros, digits only) — for XLSX this makes
 * XLSX.utils.aoa_to_sheet emit a real numeric cell instead of text, since
 * it types each cell by the JS value's actual type. Falls back to the
 * original string for anything that wouldn't round-trip cleanly (leading
 * zeros, non-digit characters), where converting to a number would silently
 * corrupt the value.
 */
function acctAsNumberOrString(val: string | null | undefined): number | string {
  const s = (val ?? '').trim();
  if (s !== '' && /^\d+$/.test(s) && String(Number(s)) === s) return Number(s);
  return val ?? '';
}

/** Same rule as acctAsNumberOrString, but for CSV — a genuine unquoted
 *  number string so Excel reads it as a number rather than text. */
function csvEscAcct(val: string | null | undefined): string {
  const s = (val ?? '').trim();
  if (s !== '' && /^\d+$/.test(s) && String(Number(s)) === s) return s;
  return csvEsc(val);
}

const HEADERS = [
  'Site Name', 'Account Number', 'State', 'City',
  'Address', 'Instructions', 'Video URL', 'Image URL',
];

function toRow(loc: Location): string[] {
  return [
    loc.siteName ?? '', loc.accountNumber ?? '', loc.state ?? '', loc.city ?? '',
    loc.address ?? '', loc.instructions ?? '', loc.videoUrl ?? '', loc.imageUrl ?? '',
  ];
}

/** Same as toRow, but with accountNumber as a real number where it safely
 *  round-trips — used only for XLSX, where aoa_to_sheet types each cell by
 *  the JS value's actual type. toRow (string-only) stays as-is for TXT,
 *  where there's no real "cell type" concept to fix either way. */
function toXlsxRow(loc: Location): (string | number)[] {
  return [
    loc.siteName ?? '', acctAsNumberOrString(loc.accountNumber), loc.state ?? '', loc.city ?? '',
    loc.address ?? '', loc.instructions ?? '', loc.videoUrl ?? '', loc.imageUrl ?? '',
  ];
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function exportCsv(locations: Location[]): void {
  const rows = locations.map((loc) =>
    [csvEsc(loc.siteName), csvEscAcct(loc.accountNumber), csvEsc(loc.state), csvEsc(loc.city),
     csvEsc(loc.address), csvEsc(loc.instructions), csvEsc(loc.videoUrl), csvEsc(loc.imageUrl)].join(','),
  );
  const csv = [HEADERS.join(','), ...rows].join('\n');
  triggerDownload(
    new Blob([csv], { type: 'text/csv' }),
    `napa-courier-locations-${timestamp()}.csv`,
  );
}

// ─── XLSX ─────────────────────────────────────────────────────────────────────

export function exportXlsx(locations: Location[]): void {
  const data = [HEADERS, ...locations.map(toXlsxRow)];
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Set column widths
  ws['!cols'] = [
    { wch: 32 }, // Site Name
    { wch: 14 }, // Account Number
    { wch: 12 }, // State
    { wch: 18 }, // City
    { wch: 42 }, // Address
    { wch: 50 }, // Instructions
    { wch: 60 }, // Video URL
    { wch: 60 }, // Image URL
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Locations');
  const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  triggerDownload(
    new Blob([wbArray], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `napa-courier-locations-${timestamp()}.xlsx`,
  );
}

// ─── TXT (tab-delimited) ──────────────────────────────────────────────────────

export function exportTxt(locations: Location[]): void {
  const rows = locations.map((loc) => toRow(loc).join('\t'));
  const txt = [HEADERS.join('\t'), ...rows].join('\n');
  triggerDownload(
    new Blob([txt], { type: 'text/plain' }),
    `napa-courier-locations-${timestamp()}.txt`,
  );
}

// ─── PDF (formatted reference sheet) ─────────────────────────────────────────

export function exportPdf(locations: Location[]): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  const PW = 215.9;   // letter width mm
  const PH = 279.4;   // letter height mm
  const ML = 18;      // left margin
  const MR = 18;      // right margin
  const MT = 16;      // top margin
  const MB = 14;      // bottom margin
  const CW = PW - ML - MR; // content width

  // Current Y cursor; wraps to new page automatically
  let y = MT;
  const checkPage = (needed: number) => {
    if (y + needed > PH - MB) {
      doc.addPage();
      y = MT;
    }
  };

  // ── Title block ────────────────────────────────────────────────────────────
  doc.setFillColor(30, 64, 175);          // blue-800
  doc.rect(ML, y, CW, 11, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('NAPA Courier — Location Reference Sheet', ML + 3.5, y + 7.5);
  y += 13;

  const exportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  doc.setTextColor(100, 116, 139);        // slate-500
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Exported ${exportDate}  ·  ${locations.length} location${locations.length !== 1 ? 's' : ''}`,
    ML, y + 3.5,
  );
  y += 9;

  // ── Group by state → city ──────────────────────────────────────────────────
  const grouped = new Map<string, Map<string, Location[]>>();
  for (const loc of locations) {
    const st = (loc.state || '(No State)').trim();
    const ci = (loc.city  || '(No City)' ).trim();
    if (!grouped.has(st)) grouped.set(st, new Map());
    const byCity = grouped.get(st)!;
    if (!byCity.has(ci)) byCity.set(ci, []);
    byCity.get(ci)!.push(loc);
  }

  const states = Array.from(grouped.keys()).sort();

  for (const state of states) {
    const cities = grouped.get(state)!;

    // State header bar
    checkPage(12);
    doc.setFillColor(241, 245, 249);      // slate-100
    doc.setDrawColor(203, 213, 225);      // slate-300
    doc.rect(ML, y, CW, 7.5, 'FD');
    doc.setTextColor(15, 23, 42);         // slate-900
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text(state.toUpperCase(), ML + 3, y + 5.2);
    y += 9.5;

    const cityNames = Array.from(cities.keys()).sort();
    for (const city of cityNames) {
      const locs = cities.get(city)!;

      // City subheader
      checkPage(7);
      doc.setTextColor(71, 85, 105);      // slate-600
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.text(city, ML + 2, y + 4);
      y += 6.5;

      for (const loc of locs) {
        const hasAddr  = !!(loc.address?.trim());
        const hasNotes = !!(loc.instructions?.trim());
        const hasVideo = !!(loc.videoUrl?.trim());

        // Card height: top-pad(3) + name(5) + [addr(4.2)] + [notes(4.2)] + [video(4.2)] + bot-pad(3)
        const cardH = 6 + 5 + (hasAddr ? 4.2 : 0) + (hasNotes ? 4.2 : 0) + (hasVideo ? 4.2 : 0) + 3.5;

        checkPage(cardH + 2);

        // Card background
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(226, 232, 240);  // slate-200
        doc.roundedRect(ML + 3, y, CW - 3, cardH, 1.2, 1.2, 'FD');

        const cx = ML + 7;
        let cy = y + 4.5;

        // ── Site name ────────────────────────────────────────────────────
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'bold');
        // Truncate long names so they don't overflow into the account number
        const maxNameW = CW - 28;
        const nameLines = doc.splitTextToSize(loc.siteName || '(Unnamed)', maxNameW);
        doc.text(nameLines[0], cx, cy);

        // Account number — right-aligned in muted color
        if (loc.accountNumber?.trim()) {
          doc.setTextColor(100, 116, 139);
          doc.setFontSize(7.5);
          doc.setFont('helvetica', 'normal');
          doc.text(`#${loc.accountNumber}`, ML + CW - 4, cy, { align: 'right' });
        }

        cy += 4.5;

        // ── Address ───────────────────────────────────────────────────────
        if (hasAddr) {
          doc.setTextColor(71, 85, 105);
          doc.setFontSize(7.5);
          doc.setFont('helvetica', 'normal');
          const addrLine = doc.splitTextToSize(loc.address!, CW - 18)[0];
          doc.text(addrLine, cx, cy);
          cy += 4.2;
        }

        // ── Instructions (italic, lighter) ─────────────────────────────────
        if (hasNotes) {
          doc.setTextColor(107, 114, 128); // gray-500
          doc.setFontSize(7);
          doc.setFont('helvetica', 'italic');
          const noteLine = doc.splitTextToSize(loc.instructions!, CW - 18)[0];
          doc.text(noteLine, cx, cy);
          cy += 4.2;
        }

        // ── Video URL (blue link style) ────────────────────────────────────
        if (hasVideo) {
          doc.setTextColor(37, 99, 235);   // blue-600
          doc.setFontSize(7);
          doc.setFont('helvetica', 'normal');
          const vUrl = loc.videoUrl!;
          const maxVideoW = CW - 18;
          const videoLine = doc.splitTextToSize(vUrl, maxVideoW)[0];
          doc.text(videoLine, cx, cy);
        }

        y += cardH + 1.5;
      }

      y += 2; // gap between cities
    }

    y += 3; // gap between states
  }

  // ── Page footers (page N of M) ─────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setTextColor(148, 163, 184);      // slate-400
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(`Page ${p} of ${totalPages}`, PW / 2, PH - 6, { align: 'center' });
  }

  doc.save(`napa-courier-locations-${timestamp()}.pdf`);
}
