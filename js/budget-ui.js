/**
 * budget-ui.js
 * Rendering UI per il modulo "Analisi Costi & Budget".
 *
 * Le sotto-sezioni (Importa CE, Macro-sezioni, Storico, Budget,
 * Consuntivo) sono gestite qui per non far gonfiare ulteriormente
 * ui.js. Ogni renderXxx() scrive in #content.
 *
 * Dipende da: projects.js, budget-engine.js, xlsx-mini.js,
 * excel-import.js, ui.js (helper formattazione).
 */

'use strict';

const BudgetUI = (() => {

  /* Dati transitori dell'ultimo import (in memoria, non in progetto
     finché l'utente non clicca "Applica"). */
  let _lastParsed  = null;
  let _lastMapping = null;
  let _lastStorico = null;

  /* ──────────────────────────────────────────────────────────
     Helpers di formato
     ────────────────────────────────────────────────────────── */
  function _fmtEuro(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function _escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  /* ──────────────────────────────────────────────────────────
     IMPORTA CE
     ────────────────────────────────────────────────────────── */

  function renderImportaCE() {
    const c = document.getElementById('content');
    if (!c) return;
    const progetto = Projects.getProgetto();
    if (!progetto) return;

    const giaImportato = Array.isArray(progetto.sottoconti_ce) && progetto.sottoconti_ce.length > 0;

    c.innerHTML = `
      <div class="ab-import">

        <div class="ab-import-intro">
          <h2>Importa CE da bilancio di verifica</h2>
          <p class="text-muted">
            Carica il file Excel del bilancio di verifica esportato dal gestionale.
            Il sistema legge automaticamente la sezione CE (dopo "Ratei e risconti passivi"),
            estrae i sottoconti e li pre-mappa alle macroaree in base al mastro di
            appartenenza. Le rimanenze iniziali e finali vengono calcolate dai mastri di
            variazione 61 (lavori in corso) e 80 (variazione rimanenze materiali).
          </p>
        </div>

        <div class="ab-import-dropzone" id="ab-dropzone">
          <div class="ab-import-dropzone-icon">⇪</div>
          <div class="ab-import-dropzone-title">Trascina qui il file .xlsx</div>
          <div class="ab-import-dropzone-sub">oppure</div>
          <div class="btn btn-primary" onclick="BudgetUI.scegliFileXlsx()">Scegli file</div>
          <div class="ab-import-dropzone-fixture text-muted">
            Esempio incluso: <span class="ab-fixture-link" onclick="BudgetUI.caricaFixture()">samples/ab/MSIT-001.xlsx</span>
          </div>
        </div>

        <div id="ab-import-summary" class="ab-import-summary hidden"></div>

        ${giaImportato ? `
          <div class="ab-import-info">
            <strong>Import attuale:</strong> ${progetto.sottoconti_ce.length} sottoconti CE,
            anni ${progetto.meta.anni_storici.join(', ')}.
            <span class="text-muted">Caricare un nuovo file sovrascrive l'import esistente.</span>
          </div>
        ` : ''}

      </div>
    `;

    _attaccaDropzone();
  }

  function _attaccaDropzone() {
    const dz = document.getElementById('ab-dropzone');
    if (!dz) return;
    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('drag-over');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) _processaFile(file);
    });
  }

  function scegliFileXlsx() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) _processaFile(f);
    };
    input.click();
  }

  /**
   * Per debug/demo: tenta di caricare la fixture inclusa nel repo.
   * Funziona se l'app è servita da http(s); su file:// alcuni
   * browser bloccano fetch e mostriamo un suggerimento.
   */
  async function caricaFixture() {
    try {
      const r = await fetch('samples/ab/MSIT-001.xlsx');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = await r.arrayBuffer();
      _processaArrayBuffer(buf, 'MSIT-001.xlsx');
    } catch (err) {
      UI.mostraNotifica('Impossibile caricare la fixture (' + err.message + '). Trascina manualmente il file dal filesystem.', 'warning');
    }
  }

  async function _processaFile(file) {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      UI.mostraNotifica('Formato non valido. Caricare un file .xlsx', 'error');
      return;
    }
    const buf = await file.arrayBuffer();
    await _processaArrayBuffer(buf, file.name);
  }

  async function _processaArrayBuffer(buf, fileName) {
    try {
      const { rows } = await XlsxMini.readXlsx(buf);
      const parsed = ExcelImport.parseBilancioVerifica(rows);
      const macroAree = BudgetEngine.MACROAREE_AB;
      const mapping = ExcelImport.defaultMapping(parsed.sottoconti, macroAree);
      const storico = ExcelImport.calcolaStorico(parsed, mapping, macroAree);

      _lastParsed = parsed;
      _lastMapping = mapping;
      _lastStorico = storico;

      _renderSummary(parsed, mapping, storico, macroAree, fileName);
    } catch (err) {
      console.error(err);
      UI.mostraNotifica('Errore nel parsing del file: ' + err.message, 'error');
    }
  }

  /* ──────────────────────────────────────────────────────────
     Anteprima import
     ────────────────────────────────────────────────────────── */
  function _renderSummary(parsed, mapping, storico, macroAree, fileName) {
    const sumEl = document.getElementById('ab-import-summary');
    if (!sumEl) return;
    sumEl.classList.remove('hidden');

    const numMappati = Object.keys(mapping).length;
    const totRimanenze = parsed.sottoconti.filter(s =>
      ExcelImport.MASTRI_VARIAZIONE_RIMANENZE.indexOf(s.mastro) >= 0
    ).length;
    const numNonMap = parsed.sottoconti.length - numMappati - totRimanenze;

    const sezioni = [
      { sez: 'ricavi',      titolo: 'Ricavi' },
      { sez: 'variabili',   titolo: 'Costi variabili' },
      { sez: 'fissi',       titolo: 'Costi fissi di gestione' },
      { sez: 'sotto_linea', titolo: 'Voci sotto la linea' },
      { sez: 'imposte',     titolo: 'Imposte' }
    ];

    let tabHtml = '<table class="ab-storico-tab"><thead><tr><th>Macroarea</th>';
    parsed.anni.forEach(a => { tabHtml += `<th class="num">${a}</th>`; });
    tabHtml += '</tr></thead><tbody>';

    sezioni.forEach(({ sez, titolo }) => {
      const macroSez = macroAree.filter(m => m.sezione === sez);
      if (macroSez.length === 0) return;
      tabHtml += `<tr class="ab-sezione"><td colspan="${parsed.anni.length + 1}">${_escapeHtml(titolo)}</td></tr>`;
      macroSez.forEach(m => {
        tabHtml += `<tr><td>${_escapeHtml(m.label)}</td>`;
        parsed.anni.forEach(a => {
          const v = (storico[a] || {})[m.id];
          tabHtml += `<td class="num">${_fmtEuro(v || 0)}</td>`;
        });
        tabHtml += '</tr>';
      });
    });
    tabHtml += '</tbody></table>';

    let warnHtml = '';
    if (numNonMap > 0) {
      warnHtml += `<div class="ab-import-warn">⚠ ${numNonMap} sottoconti non sono stati mappati automaticamente. Sarà possibile mapparli a mano dalla sezione "Mappatura sottoconti".</div>`;
    }
    if (parsed.warnings && parsed.warnings.length > 0) {
      parsed.warnings.forEach(w => { warnHtml += `<div class="ab-import-warn">⚠ ${_escapeHtml(w)}</div>`; });
    }

    sumEl.innerHTML = `
      <div class="ab-import-summary-head">
        <h3>Anteprima import — ${_escapeHtml(fileName || '')}</h3>
        <div class="ab-import-meta">
          <span><strong>Ditta:</strong> ${_escapeHtml(parsed.ditta || '—')}</span>
          <span><strong>Anni:</strong> ${parsed.anni.join(', ')}</span>
          <span><strong>Sottoconti CE:</strong> ${parsed.sottoconti.length}</span>
          <span><strong>Mappati:</strong> ${numMappati}</span>
        </div>
      </div>

      ${warnHtml}

      ${tabHtml}

      <div class="ab-import-actions">
        <div class="btn btn-secondary" onclick="BudgetUI.annullaImport()">Annulla</div>
        <div class="btn btn-primary" onclick="BudgetUI.applicaImport()">Applica al progetto</div>
      </div>
    `;
  }

  function annullaImport() {
    _lastParsed = null;
    _lastMapping = null;
    _lastStorico = null;
    const sumEl = document.getElementById('ab-import-summary');
    if (sumEl) {
      sumEl.classList.add('hidden');
      sumEl.innerHTML = '';
    }
  }

  function applicaImport() {
    if (!_lastParsed) {
      UI.mostraNotifica('Nessun import in attesa.', 'error');
      return;
    }
    Projects.applicaImportCE(_lastParsed, _lastMapping, _lastStorico);
    UI.mostraNotifica('Import applicato. Sottoconti, mapping e storico aggiornati.', 'success');
    annullaImport();
    UI.aggiornaStatusBar('modificato');
    renderImportaCE();
  }

  /* ──────────────────────────────────────────────────────────
     Storico — vista riepilogativa dell'import
     ────────────────────────────────────────────────────────── */
  function renderStorico() {
    const c = document.getElementById('content');
    if (!c) return;
    const progetto = Projects.getProgetto();
    if (!progetto || !progetto.storico || Object.keys(progetto.storico).length === 0 ||
        !progetto.sottoconti_ce || progetto.sottoconti_ce.length === 0) {
      c.innerHTML = _placeholder('Storico & medie', 'Importa prima il CE da Excel per popolare lo storico.');
      return;
    }

    const macroAree = progetto.macro_sezioni;
    const anni = progetto.meta.anni_storici;
    const sezioni = [
      { sez: 'ricavi',      titolo: 'Ricavi' },
      { sez: 'variabili',   titolo: 'Costi variabili' },
      { sez: 'fissi',       titolo: 'Costi fissi di gestione' },
      { sez: 'sotto_linea', titolo: 'Voci sotto la linea' },
      { sez: 'imposte',     titolo: 'Imposte' }
    ];

    let html = `<div class="ab-storico"><h2>Storico CE per macroarea</h2>`;
    html += '<table class="ab-storico-tab"><thead><tr><th>Macroarea</th>';
    anni.forEach(a => { html += `<th class="num">${a}</th>`; });
    html += '</tr></thead><tbody>';

    sezioni.forEach(({ sez, titolo }) => {
      const macroSez = macroAree.filter(m => m.sezione === sez);
      if (macroSez.length === 0) return;
      html += `<tr class="ab-sezione"><td colspan="${anni.length + 1}">${_escapeHtml(titolo)}</td></tr>`;
      macroSez.forEach(m => {
        html += `<tr><td>${_escapeHtml(m.label)}</td>`;
        anni.forEach(a => {
          const v = (progetto.storico[a] || {})[m.id];
          html += `<td class="num">${_fmtEuro(v || 0)}</td>`;
        });
        html += '</tr>';
      });
    });

    html += '</tbody></table></div>';
    c.innerHTML = html;
  }

  /* ──────────────────────────────────────────────────────────
     Placeholder per le sezioni successive (Step 4, 6, 7)
     ────────────────────────────────────────────────────────── */
  function renderMacroSezioni() {
    const c = document.getElementById('content');
    if (!c) return;
    c.innerHTML = _placeholder('Mappatura sottoconti', 'Editor mappatura sottoconto → macroarea con override variabile/fisso. Disponibile nel prossimo step.');
  }

  function renderBudget() {
    const c = document.getElementById('content');
    if (!c) return;
    c.innerHTML = _placeholder('Budget anno', 'Fatturato ipotizzato, costi attesi, risultato e fatturato di break-even. Disponibile nel prossimo step.');
  }

  function renderConsuntivo() {
    const c = document.getElementById('content');
    if (!c) return;
    c.innerHTML = _placeholder('Consuntivo', 'Inserimento fatturato per periodo (mensile/trimestrale) e preconsuntivo. Disponibile nel prossimo step.');
  }

  function _placeholder(titolo, descrizione) {
    return (
      '<div class="tab-disabled-notice">' +
        '<div class="tab-disabled-notice-icon">🚧</div>' +
        '<div class="tab-disabled-notice-title">' + titolo + '</div>' +
        '<div class="tab-disabled-notice-desc">' + descrizione + '</div>' +
      '</div>'
    );
  }

  return {
    renderImportaCE:    renderImportaCE,
    renderMacroSezioni: renderMacroSezioni,
    renderStorico:      renderStorico,
    renderBudget:       renderBudget,
    renderConsuntivo:   renderConsuntivo,
    scegliFileXlsx:     scegliFileXlsx,
    caricaFixture:      caricaFixture,
    annullaImport:      annullaImport,
    applicaImport:      applicaImport
  };

})();
