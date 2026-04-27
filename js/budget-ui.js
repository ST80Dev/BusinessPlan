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
     MAPPATURA SOTTOCONTI → MACROAREE

     L'utente vede ogni sottoconto raggruppato sotto la macroarea
     attualmente assegnata. Cambiando il dropdown il sottoconto si
     sposta in un'altra macroarea, lo storico viene ricalcolato e
     la pagina viene re-renderizzata. I sottoconti dei mastri di
     variazione rimanenze (61, 80) sono read-only — confluiscono
     nel calcolo automatico delle rim. iniziali/finali.
     ────────────────────────────────────────────────────────── */
  function renderMacroSezioni() {
    const c = document.getElementById('content');
    if (!c) return;
    const progetto = Projects.getProgetto();
    if (!progetto || !Array.isArray(progetto.sottoconti_ce) || progetto.sottoconti_ce.length === 0) {
      c.innerHTML = _placeholder('Mappatura sottoconti', 'Importa prima il CE da Excel per popolare i sottoconti.');
      return;
    }

    const macroAree = progetto.macro_sezioni;
    const mapping   = progetto.mapping || {};

    // Raggruppa: per ogni macroarea la lista dei sottoconti mappati;
    // più due gruppi speciali "Non mappato" e "In rimanenze".
    const gruppi = {};
    macroAree.forEach(m => { if (!m.calcolato) gruppi[m.id] = []; });

    const nonMappati = [];
    const inRimanenze = [];

    for (const s of progetto.sottoconti_ce) {
      if (ExcelImport.MASTRI_VARIAZIONE_RIMANENZE.indexOf(s.mastro) >= 0) {
        inRimanenze.push(s);
        continue;
      }
      const macroId = mapping[s.codice];
      if (macroId && gruppi[macroId]) gruppi[macroId].push(s);
      else nonMappati.push(s);
    }

    // Ordina sottoconti dentro ciascun gruppo per codice
    const sortByCod = (a, b) => a.codice.localeCompare(b.codice);
    Object.values(gruppi).forEach(arr => arr.sort(sortByCod));
    nonMappati.sort(sortByCod);
    inRimanenze.sort(sortByCod);

    // Stats header
    const totale = progetto.sottoconti_ce.length;
    const mappati = totale - nonMappati.length - inRimanenze.length;

    let html = `
      <div class="ab-mappatura">
        <div class="ab-mappatura-head">
          <h2>Mappatura sottoconti → macroaree</h2>
          <p class="text-muted">
            Per ciascun sottoconto puoi cambiare la macroarea di destinazione tramite il menu a tendina.
            I sottoconti dei mastri 61 e 80 (variazione rimanenze) confluiscono automaticamente nelle
            rimanenze iniziali/finali e non sono modificabili. Per "promuovere" un sottoconto dei
            costi fissi a costo variabile (es. <em>Lavorazioni di terzi</em>), spostalo in
            <strong>Altri costi variabili</strong>.
          </p>
          <div class="ab-mappatura-stats">
            <span><strong>${totale}</strong> sottoconti CE totali</span>
            <span><strong>${mappati}</strong> mappati</span>
            <span><strong>${nonMappati.length}</strong> non mappati</span>
            <span><strong>${inRimanenze.length}</strong> in rimanenze (calcolato)</span>
          </div>
        </div>
    `;

    // Sezione "Non mappato" in alto se non vuota
    if (nonMappati.length > 0) {
      html += _renderGruppoSottoconti({
        id: '__non_mappati__',
        label: 'Sottoconti non mappati',
        descrizione: 'Da assegnare a una macroarea',
        sottoconti: nonMappati,
        macroAree: macroAree,
        progetto: progetto,
        readonly: false,
        evidenza: 'warn'
      });
    }

    // Sezioni di prospetto in ordine
    const sezioniProspetto = [
      { sez: 'ricavi',      titolo: 'Ricavi' },
      { sez: 'variabili',   titolo: 'Costi variabili' },
      { sez: 'fissi',       titolo: 'Costi fissi di gestione' },
      { sez: 'sotto_linea', titolo: 'Voci sotto la linea' },
      { sez: 'imposte',     titolo: 'Imposte' }
    ];

    sezioniProspetto.forEach(({ sez, titolo }) => {
      const macroSez = macroAree.filter(m => m.sezione === sez && !m.calcolato);
      if (macroSez.length === 0) return;
      html += `<div class="ab-mappatura-sezione-titolo">${_escapeHtml(titolo)}</div>`;
      macroSez.forEach(m => {
        html += _renderGruppoSottoconti({
          id: m.id,
          label: m.label,
          descrizione: _descrizioneMacro(m),
          sottoconti: gruppi[m.id] || [],
          macroAree: macroAree,
          progetto: progetto,
          readonly: false
        });
      });
    });

    // Sezione "In rimanenze" in fondo
    if (inRimanenze.length > 0) {
      html += `<div class="ab-mappatura-sezione-titolo">Confluiscono nelle rimanenze (calcolato)</div>`;
      html += _renderGruppoSottoconti({
        id: '__rimanenze__',
        label: 'Mastri 61 e 80 — variazione rimanenze',
        descrizione: 'Σ Dare → Rim. iniziali; Σ Avere → Rim. finali',
        sottoconti: inRimanenze,
        macroAree: macroAree,
        progetto: progetto,
        readonly: true
      });
    }

    html += '</div>';
    c.innerHTML = html;
  }

  function _descrizioneMacro(m) {
    const flag = m.var_fisso ? (m.var_fisso === 'variabile' ? 'Variabile' : 'Fisso') : '';
    const mastri = m.mastri && m.mastri.length > 0 ? `Mastri tipici: ${m.mastri.join(', ')}` : '';
    return [flag, mastri].filter(Boolean).join(' · ');
  }

  function _renderGruppoSottoconti(opts) {
    const { id, label, descrizione, sottoconti, macroAree, progetto, readonly, evidenza } = opts;
    const evidenzaClass = evidenza === 'warn' ? ' ab-gruppo-warn' : '';
    const anni = progetto.meta.anni_storici;

    let html = `
      <div class="ab-gruppo${evidenzaClass}" data-gruppo="${id}">
        <div class="ab-gruppo-head">
          <div class="ab-gruppo-title">${_escapeHtml(label)} <span class="ab-gruppo-count">(${sottoconti.length})</span></div>
          ${descrizione ? `<div class="ab-gruppo-sub text-muted">${_escapeHtml(descrizione)}</div>` : ''}
        </div>
    `;

    if (sottoconti.length === 0) {
      html += '<div class="ab-gruppo-vuoto text-muted">— nessun sottoconto —</div>';
      html += '</div>';
      return html;
    }

    html += `
      <table class="ab-mappatura-tab">
        <thead>
          <tr>
            <th>Codice</th>
            <th>Descrizione</th>
            <th class="num">Mastro</th>
    `;
    anni.forEach(a => { html += `<th class="num">${a}</th>`; });
    html += `<th>Macroarea</th></tr></thead><tbody>`;

    for (const s of sottoconti) {
      html += `
        <tr>
          <td class="codice-conto">${_escapeHtml(s.codice)}</td>
          <td>${_escapeHtml(s.descrizione || '')}</td>
          <td class="num codice-conto">${_escapeHtml(s.mastro || '')}</td>
      `;
      anni.forEach(a => {
        const v = s.valori && s.valori[a];
        const importo = v ? Math.max(v.dare, v.avere) : 0;
        html += `<td class="num">${_fmtEuro(importo)}</td>`;
      });
      if (readonly) {
        html += `<td class="ab-mappatura-readonly text-muted">— rimanenze —</td>`;
      } else {
        const cur = (progetto.mapping || {})[s.codice] || '';
        html += `<td>${_dropdownMacroaree(s.codice, cur, macroAree)}</td>`;
      }
      html += '</tr>';
    }

    html += '</tbody></table></div>';
    return html;
  }

  function _dropdownMacroaree(codiceSottoconto, currentId, macroAree) {
    const sezioniProspetto = [
      { sez: 'ricavi',      titolo: 'Ricavi' },
      { sez: 'variabili',   titolo: 'Costi variabili' },
      { sez: 'fissi',       titolo: 'Costi fissi' },
      { sez: 'sotto_linea', titolo: 'Sotto la linea' },
      { sez: 'imposte',     titolo: 'Imposte' }
    ];

    let html = `<select class="form-select form-select-sm ab-macro-select" data-codice="${_escapeHtml(codiceSottoconto)}" onchange="BudgetUI.cambiaMacroarea(this.dataset.codice, this.value)">`;
    html += `<option value=""${currentId === '' ? ' selected' : ''}>— Non mappato —</option>`;
    sezioniProspetto.forEach(({ sez, titolo }) => {
      const macroSez = macroAree.filter(m => m.sezione === sez && !m.calcolato);
      if (macroSez.length === 0) return;
      html += `<optgroup label="${_escapeHtml(titolo)}">`;
      macroSez.forEach(m => {
        const sel = m.id === currentId ? ' selected' : '';
        html += `<option value="${_escapeHtml(m.id)}"${sel}>${_escapeHtml(m.label)}</option>`;
      });
      html += '</optgroup>';
    });
    html += '</select>';
    return html;
  }

  /**
   * Handler chiamato dal dropdown: aggiorna mapping, ricalcola
   * storico e re-renderizza la pagina.
   */
  function cambiaMacroarea(codice, macroareaId) {
    Projects.aggiornaMappingSottoconto(codice, macroareaId);
    UI.aggiornaStatusBar('modificato');
    renderMacroSezioni();
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
    applicaImport:      applicaImport,
    cambiaMacroarea:    cambiaMacroarea
  };

})();
