/**
 * xlsx-mini.js
 * Lettore xlsx minimale, vanilla JS, zero dipendenze.
 *
 * xlsx = ZIP con dentro XML SpreadsheetML. Estraiamo solo:
 *   - xl/sharedStrings.xml  (testo condiviso)
 *   - xl/worksheets/sheet1.xml (la prima scheda)
 *
 * Usa DecompressionStream('deflate-raw') (Chrome 80+, Edge 80+).
 *
 * API:
 *   ExcelImport.readXlsx(File|ArrayBuffer) → Promise<{rows: Array<Array<cell>>}>
 *
 *   Le celle sono restituite come stringhe (testo) o numeri.
 *   La matrice rows è densa: le celle vuote sono '' (stringa vuota).
 *
 * NB: gestisce solo letture base (no formule, no stili). Sufficiente
 * per i bilanci di verifica esportati dai gestionali italiani.
 */

'use strict';

const XlsxMini = (() => {

  /* ──────────────────────────────────────────────────────────
     ZIP reader minimale

     Formato (semplificato):
       [Local File Header + dati] × N
       [Central Directory] × N
       [End of Central Directory Record]

     Leggiamo End of CD per trovare il CD, poi iteriamo il CD per
     trovare i file e usiamo i Local File Header per leggere i dati.
     ────────────────────────────────────────────────────────── */

  const SIG_EOCD = 0x06054b50;  // End of Central Directory
  const SIG_CD   = 0x02014b50;  // Central Directory entry
  const SIG_LFH  = 0x04034b50;  // Local File Header

  function _readU16(view, off) { return view.getUint16(off, true); }
  function _readU32(view, off) { return view.getUint32(off, true); }

  /**
   * Trova End of Central Directory Record scansionando dal fondo.
   * @returns {number} offset, -1 se non trovato
   */
  function _findEOCD(view) {
    const len = view.byteLength;
    const max = Math.min(len, 65557); // 22 + 65535 (commento massimo)
    for (let i = len - 22; i >= len - max; i--) {
      if (i < 0) break;
      if (_readU32(view, i) === SIG_EOCD) return i;
    }
    return -1;
  }

  /**
   * Estrae l'elenco dei file dal Central Directory.
   * @returns {Array<{name, compMethod, compSize, lfhOffset}>}
   */
  function _readCentralDirectory(view) {
    const eocd = _findEOCD(view);
    if (eocd < 0) throw new Error('xlsx-mini: EOCD non trovato (file non zip o corrotto)');

    const cdOffset = _readU32(view, eocd + 16);
    const cdEntries = _readU16(view, eocd + 10);

    const out = [];
    let p = cdOffset;
    for (let i = 0; i < cdEntries; i++) {
      if (_readU32(view, p) !== SIG_CD) throw new Error('xlsx-mini: signature CD invalida @ ' + p);
      const compMethod = _readU16(view, p + 10);
      const compSize   = _readU32(view, p + 20);
      const nameLen    = _readU16(view, p + 28);
      const extraLen   = _readU16(view, p + 30);
      const commentLen = _readU16(view, p + 32);
      const lfhOffset  = _readU32(view, p + 42);

      const nameBytes = new Uint8Array(view.buffer, view.byteOffset + p + 46, nameLen);
      const name = new TextDecoder('utf-8').decode(nameBytes);
      out.push({ name, compMethod, compSize, lfhOffset });

      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  /**
   * Legge i bytes compressi di un file dato il suo Local File Header offset.
   * @returns {Uint8Array} bytes compressi (o non compressi se compMethod=0)
   */
  function _readFileBytes(view, entry) {
    const p = entry.lfhOffset;
    if (_readU32(view, p) !== SIG_LFH) throw new Error('xlsx-mini: signature LFH invalida @ ' + p);
    const nameLen  = _readU16(view, p + 26);
    const extraLen = _readU16(view, p + 28);
    const dataStart = p + 30 + nameLen + extraLen;
    return new Uint8Array(view.buffer, view.byteOffset + dataStart, entry.compSize);
  }

  /**
   * Decomprime bytes deflate raw → Uint8Array.
   */
  async function _inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  /**
   * Estrae un singolo file dallo zip.
   * compMethod 0 = stored (no compressione)
   * compMethod 8 = deflate
   */
  async function _extractFile(view, entry) {
    const compressed = _readFileBytes(view, entry);
    if (entry.compMethod === 0) return compressed;
    if (entry.compMethod === 8) return await _inflate(compressed);
    throw new Error('xlsx-mini: metodo compressione non supportato: ' + entry.compMethod);
  }

  /* ──────────────────────────────────────────────────────────
     XML parser — usa DOMParser nativo
     ────────────────────────────────────────────────────────── */

  /**
   * Parsea xl/sharedStrings.xml → array di stringhe per indice.
   */
  function _parseSharedStrings(xmlText) {
    if (!xmlText) return [];
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const sis = doc.getElementsByTagName('si');
    const out = [];
    for (let i = 0; i < sis.length; i++) {
      // La <si> può contenere uno o più <t> (anche dentro <r> per testo formattato)
      const ts = sis[i].getElementsByTagName('t');
      let text = '';
      for (let j = 0; j < ts.length; j++) text += ts[j].textContent || '';
      out.push(text);
    }
    return out;
  }

  /**
   * Converte riferimento di colonna 'A','B',...,'AA' in indice 0-based.
   */
  function _colIndex(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  /**
   * Parsea xl/worksheets/sheet1.xml → matrice di celle (string|number).
   */
  function _parseSheet(xmlText, sharedStrings) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const rows = doc.getElementsByTagName('row');
    const out = [];
    let maxCol = 0;

    // Prima passata: raccolgo le righe con i loro indici di colonna
    const tmp = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const rNum = parseInt(row.getAttribute('r') || (r + 1), 10);
      const cells = row.getElementsByTagName('c');
      const rowData = {}; // colIdx → value

      for (let c = 0; c < cells.length; c++) {
        const cell = cells[c];
        const ref = cell.getAttribute('r') || '';
        const t   = cell.getAttribute('t') || '';
        const colIdx = _colIndex(ref.replace(/[0-9]+$/, ''));
        if (colIdx > maxCol) maxCol = colIdx;

        let val = '';
        if (t === 'inlineStr') {
          const isEl = cell.getElementsByTagName('is')[0];
          if (isEl) {
            const ts = isEl.getElementsByTagName('t');
            for (let j = 0; j < ts.length; j++) val += ts[j].textContent || '';
          }
        } else {
          const vEl = cell.getElementsByTagName('v')[0];
          if (vEl) {
            const raw = vEl.textContent || '';
            if (t === 's') {
              const idx = parseInt(raw, 10);
              val = sharedStrings[idx] != null ? sharedStrings[idx] : '';
            } else if (t === 'b') {
              val = raw === '1';
            } else {
              // Default: numero
              const n = Number(raw);
              val = isNaN(n) ? raw : n;
            }
          }
        }

        rowData[colIdx] = val;
      }

      tmp.push({ rNum, rowData });
    }

    // Seconda passata: costruisco righe dense (colmando i buchi).
    // Le righe mancanti vengono inserite come array vuoti per
    // mantenere allineamento con il numero di riga del foglio.
    let cursor = 1;
    for (const item of tmp) {
      while (cursor < item.rNum) {
        out.push(new Array(maxCol + 1).fill(''));
        cursor++;
      }
      const arr = new Array(maxCol + 1).fill('');
      for (const k in item.rowData) arr[k] = item.rowData[k];
      out.push(arr);
      cursor++;
    }

    return out;
  }

  /* ──────────────────────────────────────────────────────────
     API pubblica
     ────────────────────────────────────────────────────────── */

  /**
   * Legge un xlsx da File o ArrayBuffer e restituisce {rows} della
   * prima scheda. La struttura è una matrice 2D di celle (string|number).
   *
   * @param {File|ArrayBuffer} input
   * @returns {Promise<{rows: Array<Array<string|number>>}>}
   */
  async function readXlsx(input) {
    let buf;
    if (input instanceof ArrayBuffer) buf = input;
    else if (input && typeof input.arrayBuffer === 'function') buf = await input.arrayBuffer();
    else throw new Error('xlsx-mini: input deve essere File o ArrayBuffer');

    const view = new DataView(buf);
    const entries = _readCentralDirectory(view);

    const need = (path) => entries.find(e => e.name === path);
    const sheetEntry = need('xl/worksheets/sheet1.xml');
    if (!sheetEntry) throw new Error('xlsx-mini: xl/worksheets/sheet1.xml non trovato');

    const ssEntry = entries.find(e => e.name === 'xl/sharedStrings.xml');

    const dec = new TextDecoder('utf-8');
    const sheetXml = dec.decode(await _extractFile(view, sheetEntry));
    const ssXml    = ssEntry ? dec.decode(await _extractFile(view, ssEntry)) : '';

    const sharedStrings = _parseSharedStrings(ssXml);
    const rows = _parseSheet(sheetXml, sharedStrings);

    return { rows };
  }

  return { readXlsx };

})();

// In contesto Node (test), esporta come modulo CommonJS.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = XlsxMini;
}
