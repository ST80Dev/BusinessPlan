// ============================================================================
// pdf-import.js — Modulo puro di parsing PDF per import bilancio (SP storico)
// ============================================================================
//
// Estrae testo e numeri da un PDF di bilancio (PDF.js), li raggruppa in righe,
// e propone un mapping verso le voci dello schema SP/CE normativo.
//
// Modulo disaccoppiato: niente DOM, niente localStorage, niente UI. Tutte le
// dipendenze (pdfjsLib, schema, savedMapping) sono iniettate come parametri.
// L'integrazione UI e la persistenza delle regole sono responsabilità del
// chiamante (v. pdf-test.html per un esempio di uso).
//
// API pubblica:
//   normalizeLabel(s)            — normalizza testo per matching fuzzy
//   parseItalianNumber(s)        — estrae numero in formato IT da stringa
//   formatItalianNumber(n)       — formatta numero in locale IT
//   buildDictionary(schemaRoots) — costruisce dizionario normLabel → voce SP/CE
//   findBestMatch(text, dict, savedMapping)
//                                — cerca la miglior voce per un testo PDF
//   extractPdf(arrayBuffer, pdfjsLib)
//                                — estrae item testuali da PDF (async)
//   groupIntoLines(items)        — raggruppa item per riga
//   estraiRighe(arrayBuffer, { pdfjsLib, schemaRoots, savedMapping })
//                                — pipeline completa: PDF → righe mappate
// ============================================================================

/**
 * Normalizza un'etichetta per il matching: lowercase, apostrofi uniformi,
 * simboli eliminati, spazi compattati.
 * @param {string} s
 * @returns {string}
 */
export function normalizeLabel(s) {
  return s.toLowerCase()
    .replace(/[''`’‘]/g, "'")
    .replace(/[^\w\s'àèéìòùç]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Estrae un numero dal formato italiano (1.234.567,89) da una stringa.
 * Ritorna null se non trova un numero riconoscibile.
 * @param {string} s
 * @returns {number|null}
 */
export function parseItalianNumber(s) {
  const m = s.match(/([\d.]+,\d{2})\b/);
  if (m) {
    return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  }
  const m2 = s.match(/\b(\d{1,3}(?:\.\d{3})+)\b/);
  if (m2) {
    return parseFloat(m2[1].replace(/\./g, ''));
  }
  const m3 = s.match(/\b(\d+)\b/);
  if (m3 && m3[1].length >= 2) {
    return parseFloat(m3[1]);
  }
  return null;
}

/**
 * Versione restrittiva di parseItalianNumber: considera valido SOLO un numero
 * posizionato alla fine della stringa (con eventuali spazi finali). Un numero
 * in mezzo al testo non viene riconosciuto.
 *
 * Motivazione: nei bilanci PDF l'importo di una voce e' sempre l'ultimo
 * elemento a destra della riga. Numeri "in mezzo" (es. codici conto, date,
 * riferimenti) non sono importi da importare.
 *
 * @param {string} s
 * @returns {number|null}
 */
export function parseTrailingItalianNumber(s) {
  const t = s.replace(/\s+$/, '');
  // 1.234,56 oppure 1234,56 a fine stringa
  let m = t.match(/(?:^|\s)([\d.]+,\d{2})$/);
  if (m) return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  // 1.234 oppure 1.234.567 a fine stringa (separatori migliaia, senza decimali)
  m = t.match(/(?:^|\s)(\d{1,3}(?:\.\d{3})+)$/);
  if (m) return parseFloat(m[1].replace(/\./g, ''));
  // Intero plain a fine stringa, almeno 2 cifre, preceduto da spazio
  m = t.match(/\s(\d{2,})$/);
  if (m) return parseFloat(m[1]);
  return null;
}

/**
 * Formatta un numero in locale italiana.
 * @param {number|null} n
 * @returns {string}
 */
export function formatItalianNumber(n) {
  if (n == null) return '';
  return n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Attraversa ricorsivamente un albero di nodi schema e popola dizionario + lista piatta.
 * Funzione interna, usata da buildDictionary.
 */
function walkTree(nodes, flatList, dict) {
  for (const node of nodes) {
    flatList.push({ id: node.id, label: node.label });
    const key = normalizeLabel(node.label);
    dict[key] = { id: node.id, label: node.label };
    if (node.children) walkTree(node.children, flatList, dict);
  }
}

/**
 * Costruisce il dizionario di matching a partire dagli alberi schema passati.
 * @param {Array<Array>} schemaRoots — array di alberi (es. [SP_ATTIVO, SP_PASSIVO, CE])
 * @returns {{ dict: Object, flatList: Array }}
 */
export function buildDictionary(schemaRoots) {
  const dict = {};
  const flatList = [];
  for (const root of schemaRoots) {
    if (Array.isArray(root)) walkTree(root, flatList, dict);
  }
  return { dict, flatList };
}

/**
 * Cerca la miglior voce schema per un testo PDF.
 * Priorità: mapping salvato → match esatto normalizzato → substring → overlap di parole.
 * @param {string} text                    — testo originale (non normalizzato) della riga
 * @param {Object} dict                    — dizionario da buildDictionary
 * @param {Array}  flatList                — lista piatta nodi schema
 * @param {Object} [savedMapping={}]       — dizionario { testoOriginale: idVoce }
 * @returns {{ id, label, status }|null}   — status: 'manual' | 'auto' | 'partial'
 */
export function findBestMatch(text, dict, flatList, savedMapping = {}) {
  const norm = normalizeLabel(text);
  if (!norm) return null;

  if (savedMapping[text]) {
    const node = flatList.find(n => n.id === savedMapping[text]);
    if (node) return { id: node.id, label: node.label, status: 'manual' };
  }

  if (dict[norm]) {
    return { ...dict[norm], status: 'auto' };
  }

  let bestMatch = null;
  let bestScore = 0;

  for (const [key, entry] of Object.entries(dict)) {
    if (key.length < 6) continue;

    let score = 0;
    if (norm.includes(key)) {
      score = key.length / norm.length;
    } else if (key.includes(norm) && norm.length >= 8) {
      score = norm.length / key.length;
    } else {
      const wordsA = norm.split(' ').filter(w => w.length > 3);
      const wordsB = key.split(' ').filter(w => w.length > 3);
      if (wordsA.length > 0 && wordsB.length > 0) {
        const common = wordsA.filter(w => wordsB.includes(w));
        score = common.length / Math.max(wordsA.length, wordsB.length);
      }
    }

    if (score > bestScore && score >= 0.4) {
      bestScore = score;
      bestMatch = { ...entry, status: score >= 0.7 ? 'auto' : 'partial' };
    }
  }

  return bestMatch;
}

/**
 * Heuristica per detection grassetto a partire dal fontName PDF.
 * PDF.js espone item.fontName (id opaco tipo "g_d0_f1") + styles[fontName]
 * con eventuali info sulla fontFamily. I font "bold" hanno tipicamente il
 * nome che contiene "bold", "heavy", "black", "semibold", "demi", "extrabold".
 *
 * Non e' 100% affidabile: dipende da come il PDF e' stato generato. Sui PDF
 * nativi di software contabili funziona bene nella maggior parte dei casi.
 *
 * @param {string} fontName
 * @param {Object} styles                 — textContent.styles da PDF.js
 * @returns {boolean}
 */
function isBoldFont(fontName, styles) {
  const candidates = [];
  if (fontName) candidates.push(fontName);
  if (styles && styles[fontName]) {
    const s = styles[fontName];
    if (s.fontFamily) candidates.push(s.fontFamily);
  }
  const joined = candidates.join(' ').toLowerCase();
  return /\b(bold|heavy|black|semibold|demibold|demi|extrabold)\b/.test(joined)
      || /bold|heavy|black/.test(joined); // fallback senza word-boundary per nomi concatenati
}

/**
 * Estrae tutti gli item testuali da un PDF tramite PDF.js.
 * @param {ArrayBuffer} arrayBuffer
 * @param {Object} pdfjsLib          — istanza PDF.js (es. import da lib/pdf.min.mjs)
 * @returns {Promise<Array>}         — item: { text, x, y, page, column, pageWidth, bold }
 */
export async function extractPdf(arrayBuffer, pdfjsLib) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allItems = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();
    const pageWidth = viewport.width;
    const styles = textContent.styles || {};

    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      allItems.push({
        text: item.str.trim(),
        x, y,
        page: i,
        column: x < pageWidth / 2 ? 'left' : 'right',
        pageWidth,
        bold: isBoldFont(item.fontName, styles)
      });
    }
  }

  return allItems;
}

/**
 * Raggruppa gli item estratti per riga (stessa pagina, y approssimativa ±3).
 * Il flag `bold` della riga e' quello dell'item-label (primo item non numerico,
 * o primo item se tutti numerici). Gli importi nei bilanci sono spesso non-bold
 * anche quando la label e' in grassetto (es. totali), quindi guardare la label
 * e' piu' affidabile che un "any bold" sulla riga intera.
 *
 * @param {Array} items
 * @returns {Array} — righe: { text, column, page, x, y, bold }
 */
export function groupIntoLines(items) {
  const lines = [];
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);

  let currentLine = null;
  for (const item of sorted) {
    if (!currentLine || currentLine.page !== item.page || Math.abs(currentLine.y - item.y) > 3) {
      currentLine = { page: item.page, y: item.y, items: [], column: item.column };
      lines.push(currentLine);
    }
    currentLine.items.push(item);
    if (item.x < currentLine.items[0].x) {
      currentLine.column = item.column;
    }
  }

  const onlyNumeric = /^[\d.,\s]+$/;
  return lines.map(line => {
    const sortedItems = line.items.sort((a, b) => a.x - b.x);
    const text = sortedItems.map(i => i.text).join(' ');
    const firstItem = sortedItems[0];
    const labelItem = sortedItems.find(it => !onlyNumeric.test(it.text)) || firstItem;
    return {
      text,
      column: firstItem.column,
      page: line.page,
      x: firstItem.x,
      y: line.y,
      bold: !!(labelItem && labelItem.bold)
    };
  });
}

/**
 * Trasforma una lista di righe in righe annotate con valore numerico, label
 * ripulita e match con lo schema.
 * @param {Array}  lines          — output di groupIntoLines
 * @param {Object} dict           — da buildDictionary
 * @param {Array}  flatList       — da buildDictionary
 * @param {Object} [savedMapping] — mapping salvato (opzionale)
 * @returns {Array} righe: { text, fullText, value, column, schemaId, schemaLabel, status, page, bold }
 */
export function annotateLines(lines, dict, flatList, savedMapping = {}) {
  const rows = [];
  for (const line of lines) {
    const text = line.text;
    if (!text || text.length < 3) continue;

    // Per l'import bilancio si considera valido solo il numero in fondo a
    // destra della riga: codici/date/riferimenti in mezzo al testo non sono
    // importi. Le righe che restano con value=null vengono filtrate a monte
    // da estraiRighe({ soloConImporto: true }) nella UI.
    const value = parseTrailingItalianNumber(text);

    let label = text;
    if (value != null) {
      label = text
        .replace(/\s*([\d.]+,\d{2})\s*$/, '')
        .replace(/\s*(\d{1,3}(?:\.\d{3})+)\s*$/, '')
        .replace(/\s*(\d{2,})\s*$/, '')
        .trim();
    }
    if (!label) label = text;

    const match = findBestMatch(label, dict, flatList, savedMapping);

    rows.push({
      text: label,
      fullText: text,
      value,
      column: line.column,
      schemaId: match ? match.id : '',
      schemaLabel: match ? match.label : '',
      status: match ? match.status : 'none',
      page: line.page,
      bold: !!line.bold
    });
  }
  return rows;
}

/**
 * Pipeline completa: PDF ArrayBuffer → righe mappate pronte per la UI.
 * Funzione di alto livello che combina extractPdf, groupIntoLines, annotateLines.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {Object} opts
 * @param {Object} opts.pdfjsLib            — istanza PDF.js
 * @param {Array<Array>} opts.schemaRoots   — alberi schema (es. [SP_ATTIVO, SP_PASSIVO, CE])
 * @param {Object} [opts.savedMapping={}]   — mapping persistito (testo → id voce)
 * @param {boolean} [opts.soloConImporto=false]
 *                                           — se true, scarta righe senza valore
 *                                             numerico riconosciuto (utile per
 *                                             import bilancio; false per debug
 *                                             estrazione testuale)
 * @returns {Promise<Array>}                — righe annotate
 */
export async function estraiRighe(arrayBuffer, {
  pdfjsLib,
  schemaRoots,
  savedMapping = {},
  soloConImporto = false
}) {
  const items = await extractPdf(arrayBuffer, pdfjsLib);
  const lines = groupIntoLines(items);
  const { dict, flatList } = buildDictionary(schemaRoots);
  const rows = annotateLines(lines, dict, flatList, savedMapping);
  return soloConImporto ? rows.filter(r => r.value != null) : rows;
}
