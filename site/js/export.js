// ============================================================================
// Export engine — CSV / JSON downloads, clipboard copy, and PNG snapshot of
// a chart. Uses the `downloads` runtime capability when this page is running
// as a published Artifact (declared at publish time); falls back to a plain
// blob-URL download for local development / non-sandboxed contexts, where
// that capability does not exist.
// ============================================================================

import { toast } from './components.js';

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach(r => lines.push(r.map(csvEscape).join(',')));
  return lines.join('\n');
}

async function saveFile(filename, data, mime) {
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      const downloads = await window.claude.use('downloads');
      if (downloads) {
        await downloads.save({ filename, data: data instanceof Blob ? data : new Blob([data], { type: mime }) });
        toast(`Saved ${filename}`);
        return;
      }
    }
  } catch (err) {
    console.warn('[export] downloads capability failed, falling back', err);
  }
  // Local-dev / non-sandboxed fallback.
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Downloaded ${filename}`);
  } catch (err) {
    console.error('[export] fallback download failed', err);
    toast('Download failed — your browser may be blocking it.');
  }
}

export function downloadCSV(filename, headers, rows) {
  return saveFile(filename, toCSV(headers, rows), 'text/csv');
}

export function downloadJSON(filename, obj) {
  return saveFile(filename, JSON.stringify(obj, null, 2), 'application/json');
}

let sheetJSLoading = null;
function loadSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (sheetJSLoading) return sheetJSLoading;
  sheetJSLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error('Could not load the Excel export library.'));
    document.head.appendChild(script);
  });
  return sheetJSLoading;
}

export async function downloadXLSX(filename, sheetName, headers, rows) {
  try {
    const XLSX = await loadSheetJS();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    await saveFile(filename, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'application/octet-stream');
  } catch (err) {
    console.error('[export] xlsx failed', err);
    toast('Excel export failed — try CSV instead.');
  }
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    toast('Could not copy — clipboard access blocked.');
  }
}

/** Rasterize an inline SVG element to a PNG and offer it for download. */
export async function downloadSVGAsPNG(svgEl, filename, { scale = 2, background } = {}) {
  const rect = svgEl.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * scale));
  const h = Math.max(1, Math.round(rect.height * scale));
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const bg = background || getComputedStyle(document.body).getPropertyValue('--surface') || '#fff';
  const svgStr = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg.trim() || '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await saveFile(filename, blob, 'image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
