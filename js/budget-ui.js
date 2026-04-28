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
    // useGrouping: 'always' forza il separatore migliaia anche per
    // numeri 4 cifre (default it-IT con minimumGroupingDigits=2 li
    // lascia non raggruppati: "5000" invece di "5.000")
    return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
  }

  function _fmtEuroInt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return Math.round(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: 'always' });
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

      // Mapping iniziale = default euristico per tutti i sottoconti.
      // Se il file porta già la mappatura (colonne M/sM compilate),
      // questa ha precedenza: i conti con sigla nota vengono assegnati
      // alla relativa macroarea, i conti con sigla sconosciuta (null)
      // restano esplicitamente non mappati. I conti senza sigla cadono
      // nel default.
      const def = ExcelImport.defaultMapping(parsed.sottoconti, macroAree);
      let mapping = def;
      if (parsed.mapping_da_file) {
        mapping = Object.assign({}, def);
        for (const codice in parsed.mapping_da_file) {
          const v = parsed.mapping_da_file[codice];
          if (v === null) delete mapping[codice];
          else            mapping[codice] = v;
        }
      }

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

    // Info: il file portava la mappatura M/sM (Caso B)
    if (parsed.mapping_da_file) {
      const daFile = Object.values(parsed.mapping_da_file).filter(v => v).length;
      const nonRic = (parsed.sigle_sconosciute || []).length;
      warnHtml += '<div class="ab-import-info">' +
        '📄 Mappatura rilevata nel file (colonne M/sM): ' +
        daFile + ' sottoconti classificati direttamente dal file. ' +
        'I sottoconti senza sigla utilizzano la mappatura predefinita per mastro.' +
        (nonRic > 0
          ? ' <strong>Sigle non riconosciute:</strong> ' + _escapeHtml(parsed.sigle_sconosciute.join(', ')) + ' — i conti relativi restano da classificare.'
          : '') +
        '</div>';
    }

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
     STORICO & MEDIE

     Riproduce il prospetto del template Excel dello studio:
       RICAVI / FATTURATO
       Costi materie prime + Altri var + Rim.Ini + Rim.Fin
       COSTO DEL VENDUTO  (= mat_prime + altri_var + rim_ini − rim_fin)
       TOTALE COSTI VARIABILI  (= CdV)
       MARGINE DI CONTRIBUZIONE
       [Costi fissi]
       COSTI FISSI DI GESTIONE / TOTALE COSTI FISSI / TOTALE COSTI
       [Sotto la linea]
       UTILE ANTE IMPOSTE / IMPOSTE / UTILE NETTO

     Per ogni macroarea variabile/fissa viene calcolata la "Media %"
     sul fatturato — la base che il budget (Step 6) userà per
     proiettare i costi sull'anno corrente.
     ────────────────────────────────────────────────────────── */

  /**
   * Calcola tutti i totali e i derivati del prospetto, anno per anno.
   * @returns {Object<string, Object>} per anno → { fatturato, cdv, totVar, mdc, totFissi, totCosti, sottoLineaNetto, utileAnteImposte, imposte, utileNetto }
   */
  function _calcolaTotaliStorico(progetto) {
    const anni = progetto.meta.anni_storici;
    const out = {};
    for (const a of anni) {
      const sa = (progetto.storico && progetto.storico[a]) || {};
      const fatturato = sa.ricavi || 0;
      const matPrime  = sa.mat_prime || 0;
      const altriVar  = sa.altri_var || 0;
      const rimIni    = sa.rim_ini || 0;
      const rimFin    = sa.rim_fin || 0;

      const cdv    = matPrime + altriVar + rimIni - rimFin;
      const totVar = cdv;
      const mdc    = fatturato - totVar;

      const fissi = ['servizi','godimento','personale','ammortamenti','oneri_gest','oneri_fin']
        .reduce((s, k) => s + (sa[k] || 0), 0);

      const totCosti = totVar + fissi;

      const straord    = sa.straordinari || 0;
      const altriRic   = sa.altri_ric || 0;
      const altriProvF = sa.altri_prov_f || 0;
      const sottoLineaNetto = altriRic + altriProvF - straord;
      const utileAnteImposte = mdc - fissi + sottoLineaNetto;
      const imposte = sa.imposte || 0;
      const utileNetto = utileAnteImposte - imposte;

      out[a] = {
        fatturato, matPrime, altriVar, rimIni, rimFin,
        cdv, totVar, mdc, fissi, totCosti,
        straord, altriRic, altriProvF, sottoLineaNetto,
        utileAnteImposte, imposte, utileNetto
      };
    }
    return out;
  }

  /**
   * Restituisce l'incidenza % media sul fatturato per ogni macroarea
   * variabile o fissa, calcolata come media (importo[anno]/ricavi[anno])
   * sui soli anni con ricavi > 0.
   *
   * Esposta anche per ID derivati ('cdv','totVar','mdc','fissi',
   * 'totCosti','utileAnteImposte','utileNetto') usando i totali.
   */
  function _calcolaMediePct(progetto, totali) {
    const anni = progetto.meta.anni_storici.filter(a => totali[a].fatturato > 0);
    if (anni.length === 0) return {};

    const macroAree = progetto.macro_sezioni;
    const out = {};

    macroAree.forEach(m => {
      const pcts = anni.map(a => {
        const v = (progetto.storico[a] || {})[m.id] || 0;
        return v / totali[a].fatturato;
      });
      out[m.id] = pcts.reduce((s, p) => s + p, 0) / pcts.length;
    });

    // Derivati
    ['cdv','totVar','mdc','fissi','totCosti','utileAnteImposte','utileNetto','sottoLineaNetto'].forEach(k => {
      const pcts = anni.map(a => totali[a][k] / totali[a].fatturato);
      out[k] = pcts.reduce((s, p) => s + p, 0) / pcts.length;
    });

    return out;
  }

  function _fmtPct(p) {
    if (typeof p !== 'number' || !isFinite(p)) return '';
    return (p * 100).toFixed(1).replace('.', ',') + '%';
  }

  function renderStorico() {
    const c = document.getElementById('content');
    if (!c) return;
    const progetto = Projects.getProgetto();
    if (!progetto || !progetto.storico || Object.keys(progetto.storico).length === 0 ||
        !progetto.sottoconti_ce || progetto.sottoconti_ce.length === 0) {
      c.innerHTML = _placeholder('Storico & medie', 'Importa prima il CE da Excel per popolare lo storico.');
      return;
    }

    const anni = progetto.meta.anni_storici;
    const totali = _calcolaTotaliStorico(progetto);
    const mediePct = _calcolaMediePct(progetto, totali);

    // Schema righe del prospetto (tipo, etichetta, formula/macroId)
    const righe = [
      { tipo: 'sezione', label: 'RICAVI' },
      { tipo: 'macro',   id: 'ricavi',       label: 'Ricavi' },
      { tipo: 'totale',  id: 'fatturato',    label: 'FATTURATO',                evidenza: 'verde-forte' },
      { tipo: 'spacer' },

      { tipo: 'macro',   id: 'mat_prime',    label: 'Costi p/mat. prime, suss., cons., merci' },
      { tipo: 'macro',   id: 'altri_var',    label: 'Altri costi variabili',    nascondiSeZero: true },
      { tipo: 'macro',   id: 'rim_ini',      label: 'Rimanenze iniziali' },
      { tipo: 'macro',   id: 'rim_fin',      label: 'Rimanenze finali',         segno: -1 },
      { tipo: 'totale',  id: 'cdv',          label: 'COSTO DEL VENDUTO',        evidenza: 'arancio' },
      { tipo: 'spacer' },
      { tipo: 'totale',  id: 'totVar',       label: 'TOTALE COSTI VARIABILI',   evidenza: 'arancio' },
      { tipo: 'totale',  id: 'mdc',          label: 'MARGINE DI CONTRIBUZIONE', evidenza: 'verde' },
      { tipo: 'spacer' },

      { tipo: 'macro',   id: 'servizi',      label: 'Costi per servizi' },
      { tipo: 'macro',   id: 'godimento',    label: 'Costi p/godimento beni di terzi' },
      { tipo: 'macro',   id: 'personale',    label: 'Costi per il personale' },
      { tipo: 'macro',   id: 'ammortamenti', label: 'Ammortamenti' },
      { tipo: 'macro',   id: 'oneri_gest',   label: 'Oneri diversi di gestione' },
      { tipo: 'macro',   id: 'oneri_fin',    label: 'Int. pass. e altri oneri finanz.' },
      { tipo: 'totale',  id: 'fissi',        label: 'COSTI FISSI DI GESTIONE',  evidenza: 'arancio' },
      { tipo: 'spacer' },
      { tipo: 'totale',  id: 'fissi',        label: 'TOTALE COSTI FISSI',       evidenza: 'arancio' },
      { tipo: 'totale',  id: 'totCosti',     label: 'TOTALE COSTI',             evidenza: 'arancio-forte' },
      { tipo: 'spacer' },

      { tipo: 'macro',   id: 'straordinari', label: 'Oneri straordinari',       segno: -1 },
      { tipo: 'macro',   id: 'altri_ric',    label: 'Altri ricavi e proventi' },
      { tipo: 'macro',   id: 'altri_prov_f', label: 'Altri proventi finanziari' },
      { tipo: 'totale',  id: 'utileAnteImposte', label: 'UTILE ANTE IMPOSTE',   evidenza: 'verde' },
      { tipo: 'spacer' },

      { tipo: 'macro',   id: 'imposte',      label: 'Imposte sul reddito' },
      { tipo: 'totale',  id: 'utileNetto',   label: 'UTILE NETTO',              evidenza: 'verde-forte' }
    ];

    let html = `
      <div class="ab-storico">
        <div class="ab-storico-head">
          <h2>Storico CE per macroarea</h2>
          <p class="text-muted">
            Importi per anno e incidenza media percentuale sul fatturato. La media % delle
            macroaree variabili è la base che il budget userà per proiettare i costi
            sull'anno in corso.
          </p>
        </div>
        <table class="ab-storico-tab ab-storico-prospetto">
          <thead>
            <tr>
              <th>Macroarea</th>
              ${anni.map(a => `<th class="num">${a}</th>`).join('')}
              <th class="num">Media %</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const r of righe) {
      if (r.tipo === 'spacer') {
        html += `<tr class="ab-prospetto-spacer"><td colspan="${anni.length + 2}">&nbsp;</td></tr>`;
        continue;
      }
      if (r.tipo === 'sezione') {
        html += `<tr class="ab-sezione"><td colspan="${anni.length + 2}">${_escapeHtml(r.label)}</td></tr>`;
        continue;
      }

      const segno = r.segno || 1;
      let valori, mediaPct;
      if (r.tipo === 'macro') {
        valori = anni.map(a => ((progetto.storico[a] || {})[r.id] || 0));
      } else {
        // totale: leggo dai totali calcolati
        valori = anni.map(a => totali[a][r.id] || 0);
      }

      // Salta riga se nascondiSeZero e tutti i valori sono zero
      if (r.nascondiSeZero && valori.every(v => Math.abs(v) < 0.005)) continue;

      mediaPct = mediePct[r.id];

      const cls = r.tipo === 'totale'
        ? `ab-prospetto-tot ab-prospetto-tot-${r.evidenza || 'arancio'}`
        : '';

      html += `<tr class="${cls}"><td>${_escapeHtml(r.label)}</td>`;
      valori.forEach(v => {
        const display = v * segno;
        html += `<td class="num">${_fmtEuro(display)}</td>`;
      });
      // Media % — mostra solo se la macroarea/derivato ha un'incidenza significativa
      const mostraPct = (r.tipo === 'totale' || r.id !== 'ricavi');
      html += `<td class="num">${mostraPct && mediaPct != null ? _fmtPct(mediaPct * segno) : ''}</td>`;
      html += '</tr>';
    }

    html += '</tbody></table></div>';
    c.innerHTML = html;
  }

  /* ──────────────────────────────────────────────────────────
     MAPPATURA SOTTOCONTI → MACROAREE

     Layout a due colonne:
       - Sidebar interna sx: mini-CE con tutte le macroaree
         strutturate per sezione (Ricavi → Costi variabili →
         Costi fissi → Sotto la linea → Imposte). Ogni box è un
         drop target con contatore live.
       - Main dx: lista dei sottoconti raggruppati per macroarea
         attualmente assegnata. Ogni riga è draggable; il dropdown
         resta come fallback. Multi-select via Shift/Ctrl-click sul
         codice del sottoconto.

     I sottoconti dei mastri di variazione rimanenze (61, 80)
     sono read-only — confluiscono nel calcolo automatico delle
     rim. iniziali/finali.
     ────────────────────────────────────────────────────────── */

  // Set di codici sottoconto correntemente selezionati per multi-drop.
  // Vive a livello di modulo per sopravvivere ai re-render parziali
  // ma viene svuotato a ogni renderMacroSezioni completo.
  let _selectedCodici = new Set();

  function renderMacroSezioni() {
    const c = document.getElementById('content');
    if (!c) return;
    const progetto = Projects.getProgetto();
    if (!progetto || !Array.isArray(progetto.sottoconti_ce) || progetto.sottoconti_ce.length === 0) {
      c.innerHTML = _placeholder('Mappatura sottoconti', 'Importa prima il CE da Excel per popolare i sottoconti.');
      return;
    }

    _selectedCodici = new Set();

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

    const sezioniProspetto = [
      { sez: 'ricavi',      titolo: 'Ricavi' },
      { sez: 'variabili',   titolo: 'Costi variabili' },
      { sez: 'fissi',       titolo: 'Costi fissi di gestione' },
      { sez: 'sotto_linea', titolo: 'Voci sotto la linea' },
      { sez: 'imposte',     titolo: 'Imposte' }
    ];

    let html = `
      <div class="ab-mappatura">
        <div class="ab-mappatura-head">
          <h2>Mappatura sottoconti → macroaree</h2>
          <p class="text-muted">
            <strong>Trascina</strong> uno o più sottoconti dalla lista a destra sui box della
            <em>mini-CE</em> a sinistra per riassegnarli; in alternativa usa il menu a tendina
            sulla riga. Per selezionare più sottoconti tieni premuto <kbd>Shift</kbd> o
            <kbd>Ctrl</kbd> mentre clicchi sul codice. I sottoconti dei mastri 61 e 80
            (variazione rimanenze) confluiscono automaticamente nelle rim. iniziali/finali.
          </p>
          <div class="ab-mappatura-stats">
            <span><strong>${totale}</strong> sottoconti CE totali</span>
            <span><strong>${mappati}</strong> mappati</span>
            <span class="${nonMappati.length > 0 ? 'ab-stats-warn' : ''}"><strong>${nonMappati.length}</strong> non mappati</span>
            <span><strong>${inRimanenze.length}</strong> in rimanenze (calcolato)</span>
            <span class="ab-mappatura-selcount" data-sel-count></span>
          </div>
        </div>

        <div class="ab-mappatura-layout">
          <aside class="ab-mini-ce" aria-label="Mini conto economico — drop target">
            ${_renderMiniCE(macroAree, gruppi, nonMappati, inRimanenze, sezioniProspetto)}
          </aside>

          <div class="ab-mappatura-main">
    `;

    // Sezione "Non mappato" in alto se non vuota
    if (nonMappati.length > 0) {
      html += _renderGruppoSottoconti({
        id: '__non_mappati__',
        label: 'Sottoconti non mappati',
        descrizione: 'Trascinali su un box della mini-CE per assegnarli',
        sottoconti: nonMappati,
        macroAree: macroAree,
        progetto: progetto,
        readonly: false,
        evidenza: 'warn'
      });
    }

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

    html += '</div></div></div>';
    c.innerHTML = html;

    _setupMappaturaDnD();
  }

  /* Renderizza la sidebar mini-CE: una palette di drop target
     organizzata come il prospetto budget/consuntivo, con contatore
     live dei sottoconti già assegnati a ciascun box. */
  function _renderMiniCE(macroAree, gruppi, nonMappati, inRimanenze, sezioniProspetto) {
    let html = '';

    // Box "Non mappati" sempre in cima (drop target che rimuove
    // il mapping). Visibile sempre, evidenziato se non vuoto.
    const nmCount = nonMappati.length;
    const nmCls = nmCount > 0 ? ' ab-mini-box-warn' : ' ab-mini-box-empty';
    html += `
      <div class="ab-mini-box ab-mini-box-special${nmCls}" data-drop-macro="__non_mappati__" tabindex="0">
        <div class="ab-mini-box-label">Non mappati</div>
        <div class="ab-mini-box-count">${nmCount}</div>
      </div>
    `;

    sezioniProspetto.forEach(({ sez, titolo }) => {
      const macroSez = macroAree.filter(m => m.sezione === sez);
      if (macroSez.length === 0) return;
      html += `<div class="ab-mini-sezione">${_escapeHtml(titolo)}</div>`;
      macroSez.forEach(m => {
        if (m.calcolato) {
          // Box readonly: rim. iniziali / rim. finali, hatch pattern
          const inRim = inRimanenze.length;
          html += `
            <div class="ab-mini-box ab-mini-box-readonly" title="Calcolato dai mastri 61/80 (${inRim} sottoconti)">
              <div class="ab-mini-box-label">${_escapeHtml(m.label)}</div>
              <div class="ab-mini-box-count">=</div>
            </div>
          `;
          return;
        }
        const count = (gruppi[m.id] || []).length;
        const flagCls = m.var_fisso === 'variabile' ? ' ab-mini-flag-var'
                      : m.var_fisso === 'fisso'     ? ' ab-mini-flag-fix' : '';
        const tip = _descrizioneMacro(m).replace(/"/g, '&quot;');
        html += `
          <div class="ab-mini-box${flagCls}" data-drop-macro="${_escapeHtml(m.id)}" tabindex="0" title="${tip}">
            <div class="ab-mini-box-label">${_escapeHtml(m.label)}</div>
            <div class="ab-mini-box-count" data-mini-count="${_escapeHtml(m.id)}">${count}</div>
          </div>
        `;
      });
    });

    return html;
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

    // Anche i gruppi a destra fanno da drop target (utile per
    // riassegnare al volo senza muovere il mouse fino alla sidebar).
    // Esclusi: gruppo "in rimanenze" (readonly).
    const dropAttr = readonly ? '' : ` data-drop-macro="${_escapeHtml(id)}"`;

    let html = `
      <div class="ab-gruppo${evidenzaClass}" data-gruppo="${id}"${dropAttr}>
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
      const dragAttr = readonly ? '' : ' draggable="true"';
      const codAttr  = readonly ? '' : ` data-drag-codice="${_escapeHtml(s.codice)}"`;
      const cls      = readonly ? '' : ' ab-row-draggable';
      html += `
        <tr${dragAttr} class="${cls.trim()}"${codAttr}>
          <td class="codice-conto ab-cell-codice">${_escapeHtml(s.codice)}</td>
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

  /* ──────────────────────────────────────────────────────────
     Drag & drop + multi-select per la mappatura sottoconti.
     Single delegation su #content: un set di listener gestisce
     tutte le righe e i drop target del DOM corrente. Va
     re-installato dopo ogni renderMacroSezioni perché sostituisce
     l'innerHTML del container.
     ────────────────────────────────────────────────────────── */
  function _setupMappaturaDnD() {
    const root = document.querySelector('.ab-mappatura');
    if (!root) return;

    // Click sulla cella codice → toggle selezione (solo Shift/Ctrl)
    root.addEventListener('click', (ev) => {
      const cell = ev.target.closest('.ab-cell-codice');
      if (!cell) return;
      const tr = cell.closest('tr.ab-row-draggable');
      if (!tr) return;
      const codice = tr.dataset.dragCodice;
      if (!codice) return;
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        if (_selectedCodici.has(codice)) {
          _selectedCodici.delete(codice);
          tr.classList.remove('ab-row-selected');
        } else {
          _selectedCodici.add(codice);
          tr.classList.add('ab-row-selected');
        }
        _aggiornaSelCount();
      }
    });

    // Drag start: se la riga trascinata non è selezionata, il drag
    // riguarda solo quella riga (la selezione esistente viene
    // ignorata per il drop ma rimane visibile finché non si rilascia).
    root.addEventListener('dragstart', (ev) => {
      const tr = ev.target.closest('tr.ab-row-draggable');
      if (!tr || !ev.dataTransfer) return;
      const codice = tr.dataset.dragCodice;
      let codici;
      if (_selectedCodici.has(codice) && _selectedCodici.size > 1) {
        codici = Array.from(_selectedCodici);
      } else {
        codici = [codice];
      }
      ev.dataTransfer.setData('application/x-ab-codici', JSON.stringify(codici));
      ev.dataTransfer.effectAllowed = 'move';
      // Visual feedback: tutte le righe coinvolte diventano "dragging"
      codici.forEach(cd => {
        const r = root.querySelector(`tr[data-drag-codice="${CSS.escape(cd)}"]`);
        if (r) r.classList.add('ab-row-dragging');
      });
      root.classList.add('ab-dnd-active');
    });

    root.addEventListener('dragend', () => {
      root.querySelectorAll('.ab-row-dragging').forEach(r => r.classList.remove('ab-row-dragging'));
      root.querySelectorAll('.ab-drop-hover').forEach(t => t.classList.remove('ab-drop-hover'));
      root.classList.remove('ab-dnd-active');
    });

    root.addEventListener('dragover', (ev) => {
      const tgt = ev.target.closest('[data-drop-macro]');
      if (!tgt) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      tgt.classList.add('ab-drop-hover');
    });

    root.addEventListener('dragleave', (ev) => {
      const tgt = ev.target.closest('[data-drop-macro]');
      if (!tgt) return;
      // dragleave si attiva anche entrando nei figli — verifichiamo
      // di stare davvero uscendo dal box
      if (!tgt.contains(ev.relatedTarget)) {
        tgt.classList.remove('ab-drop-hover');
      }
    });

    root.addEventListener('drop', (ev) => {
      const tgt = ev.target.closest('[data-drop-macro]');
      if (!tgt || !ev.dataTransfer) return;
      ev.preventDefault();
      tgt.classList.remove('ab-drop-hover');

      let codici = [];
      try {
        codici = JSON.parse(ev.dataTransfer.getData('application/x-ab-codici') || '[]');
      } catch (e) { codici = []; }
      if (codici.length === 0) return;

      const macroId = tgt.dataset.dropMacro;
      const finalId = (macroId === '__non_mappati__') ? '' : macroId;

      let mosso = 0;
      for (const cd of codici) {
        const cur = (Projects.getProgetto().mapping || {})[cd] || '';
        if (cur === finalId) continue;
        Projects.aggiornaMappingSottoconto(cd, finalId);
        mosso++;
      }
      if (mosso > 0) {
        UI.aggiornaStatusBar('modificato');
      }
      renderMacroSezioni();
    });
  }

  function _aggiornaSelCount() {
    const span = document.querySelector('[data-sel-count]');
    if (!span) return;
    const n = _selectedCodici.size;
    span.textContent = n > 0 ? `· ${n} selezionato${n === 1 ? '' : 'i'} (Shift+click per aggiungere/togliere)` : '';
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

  /* ──────────────────────────────────────────────────────────
     BUDGET ANNO

     Card prominente con:
       - Fatturato ipotizzato (input editabile, default = media storica)
       - 3 KPI: MdC, Utile netto, Fatturato di break-even

     Tabella prospetto identica per layout allo Storico, ma con:
       - una colonna "Override" per macroarea variabile (input %) o
         fissa/sotto-linea (input €). Vuota = usa default storico.
       - una colonna "Fonte" che indica se il valore viene da
         storico (S) o override utente (O).

     Tutti i totali sono ricalcolati al volo da BudgetEngine.calcolaBudget.
     ────────────────────────────────────────────────────────── */

  function _parseEuro(s) {
    if (!s) return null;
    const clean = String(s).replace(/[€\s.]/g, '').replace(',', '.').trim();
    if (clean === '' || clean === '-') return null;
    const n = parseFloat(clean);
    return isFinite(n) ? n : null;
  }
  function _parsePct(s) {
    if (!s) return null;
    const clean = String(s).replace(/[%\s]/g, '').replace(',', '.').trim();
    if (clean === '' || clean === '-') return null;
    const n = parseFloat(clean);
    return isFinite(n) ? n / 100 : null;
  }
  function _fmtKpi(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: 'always' }) + ' €';
  }
  function _fmtPctSigned(p) {
    if (typeof p !== 'number' || !isFinite(p)) return '';
    const s = (p * 100).toFixed(1).replace('.', ',');
    return (p > 0 ? '+' : '') + s + '%';
  }

  function renderBudget() {
    const c = document.getElementById('content');
    if (!c) return;
    const progetto = Projects.getProgetto();
    if (!progetto || !progetto.sottoconti_ce || progetto.sottoconti_ce.length === 0) {
      c.innerHTML = _placeholder('Budget anno', 'Importa prima il CE da Excel per costruire il budget.');
      return;
    }

    const b = BudgetEngine.calcolaBudget(progetto);
    const annoCorrente = progetto.meta.anno_corrente;

    // Schema righe del prospetto budget — layout compatto allineato al
    // Consuntivo: rimosse le righe-totale ridondanti (TOTALE COSTI VARIABILI =
    // CdV per costruzione; COSTI FISSI DI GESTIONE = TOTALE COSTI FISSI in
    // assenza di ulteriori sotto-aggregati) e gli spacer relativi, per far
    // stare l'intero prospetto a video senza scroll verticale.
    const righe = [
      { tipo: 'sezione', label: 'RICAVI' },
      { tipo: 'macro',   id: 'ricavi',       label: 'Ricavi',                                 inputType: 'euro_fatturato' },
      { tipo: 'totale',  id: 'fatturato',    label: 'FATTURATO',                              evidenza: 'verde-forte' },
      { tipo: 'spacer' },

      { tipo: 'macro',   id: 'mat_prime',    label: 'Costi p/mat. prime, suss., cons., merci', inputType: 'pct' },
      { tipo: 'macro',   id: 'altri_var',    label: 'Altri costi variabili',                  inputType: 'pct',  nascondiSeZero: true },
      { tipo: 'macro',   id: 'rim_ini',      label: 'Rimanenze iniziali',                     inputType: 'euro' },
      { tipo: 'macro',   id: 'rim_fin',      label: 'Rimanenze finali',                       inputType: 'euro', segno: -1 },
      { tipo: 'totale',  id: 'cdv',          label: 'COSTO DEL VENDUTO',                      evidenza: 'arancio' },
      { tipo: 'totale',  id: 'mdc',          label: 'MARGINE DI CONTRIBUZIONE',               evidenza: 'verde' },
      { tipo: 'spacer' },

      { tipo: 'macro',   id: 'servizi',      label: 'Costi per servizi',                      inputType: 'euro' },
      { tipo: 'macro',   id: 'godimento',    label: 'Costi p/godimento beni di terzi',        inputType: 'euro' },
      { tipo: 'macro',   id: 'personale',    label: 'Costi per il personale',                 inputType: 'euro' },
      { tipo: 'macro',   id: 'ammortamenti', label: 'Ammortamenti',                           inputType: 'euro' },
      { tipo: 'macro',   id: 'oneri_gest',   label: 'Oneri diversi di gestione',              inputType: 'euro' },
      { tipo: 'macro',   id: 'oneri_fin',    label: 'Int. pass. e altri oneri finanz.',       inputType: 'euro' },
      { tipo: 'totale',  id: 'fissi',        label: 'TOTALE COSTI FISSI',                     evidenza: 'arancio' },
      { tipo: 'totale',  id: 'totCosti',     label: 'TOTALE COSTI',                           evidenza: 'arancio-forte' },
      { tipo: 'spacer' },

      { tipo: 'macro',   id: 'straordinari', label: 'Oneri straordinari',                     inputType: 'euro', segno: -1 },
      { tipo: 'macro',   id: 'altri_ric',    label: 'Altri ricavi e proventi',                inputType: 'euro' },
      { tipo: 'macro',   id: 'altri_prov_f', label: 'Altri proventi finanziari',              inputType: 'euro' },
      { tipo: 'totale',  id: 'utileAnteImposte', label: 'UTILE ANTE IMPOSTE',                 evidenza: 'verde' },
      { tipo: 'spacer' },

      { tipo: 'macro',   id: 'imposte',      label: 'Imposte sul reddito',                    inputType: 'euro' },
      { tipo: 'totale',  id: 'utileNetto',   label: 'UTILE NETTO',                            evidenza: 'verde-forte' }
    ];

    // KPI: differenze percentuali fatturato vs storico medio e fatturato vs BE
    const fattStorico = b.fatturato_storico_medio;
    const deltaFattStorico = fattStorico > 0 ? (b.fatturato - fattStorico) / fattStorico : 0;
    const deltaFattBe = (b.break_even != null && b.break_even > 0)
      ? (b.fatturato - b.break_even) / b.break_even : null;
    const mdcPct = b.fatturato > 0 ? b.mdc / b.fatturato : 0;
    const utileNettoPct = b.fatturato > 0 ? b.utileNetto / b.fatturato : 0;

    let html = `
      <div class="ab-budget">

        <div class="ab-budget-card">
          <div class="ab-budget-fatturato">
            <div class="ab-budget-fatturato-label">Fatturato ipotizzato anno ${annoCorrente}</div>
            <div class="amount-field ab-budget-fatturato-input"
                 contenteditable="true"
                 data-budget-field="fatturato_ipotizzato"
                 onblur="BudgetUI.budgetBlur(this)"
                 onkeydown="BudgetUI.budgetKeyDown(event)">${_fmtEuro(b.fatturato)}</div>
            <div class="ab-budget-fatturato-sub text-muted">
              Storico medio: ${_fmtEuro(fattStorico)} ${fattStorico > 0 ? `(${_fmtPctSigned(deltaFattStorico)} vs ipotizzato)` : ''}
            </div>
          </div>

          <div class="ab-budget-kpi">
            <div class="ab-budget-kpi-card ab-kpi-verde">
              <div class="ab-kpi-label">Margine di contribuzione</div>
              <div class="ab-kpi-value">${_fmtKpi(b.mdc)}</div>
              <div class="ab-kpi-sub">${(mdcPct * 100).toFixed(1).replace('.', ',')}% sul fatturato</div>
            </div>
            <div class="ab-budget-kpi-card ${b.utileNetto >= 0 ? 'ab-kpi-verde' : 'ab-kpi-rosso'}">
              <div class="ab-kpi-label">Utile netto</div>
              <div class="ab-kpi-value">${_fmtKpi(b.utileNetto)}</div>
              <div class="ab-kpi-sub">${(utileNettoPct * 100).toFixed(1).replace('.', ',')}% sul fatturato</div>
            </div>
            <div class="ab-budget-kpi-card ab-kpi-arancio">
              <div class="ab-kpi-label">Fatturato di break-even</div>
              <div class="ab-kpi-value">${_fmtKpi(b.break_even)}</div>
              <div class="ab-kpi-sub">
                ${deltaFattBe != null
                  ? (b.fatturato >= b.break_even
                      ? `${_fmtPctSigned(deltaFattBe)} sopra il pareggio`
                      : `${_fmtPctSigned(deltaFattBe)} dal pareggio`)
                  : 'non calcolabile'}
              </div>
            </div>
          </div>
        </div>

        <table class="ab-storico-tab ab-storico-prospetto ab-budget-tab">
          <thead>
            <tr>
              <th>Macroarea</th>
              <th class="num" title="Costi variabili: media triennale €. Fissi, sotto-linea e imposte: ultimo anno arrotondato al centinaio (base del budget teorico).">Base storica</th>
              <th class="num">% storica</th>
              <th class="num">Override</th>
              <th class="num">Budget €</th>
              <th class="num">Budget %</th>
            </tr>
          </thead>
          <tbody>
    `;

    const totaleColspan = 6;

    for (const r of righe) {
      if (r.tipo === 'spacer') {
        html += `<tr class="ab-prospetto-spacer"><td colspan="${totaleColspan}">&nbsp;</td></tr>`;
        continue;
      }
      if (r.tipo === 'sezione') {
        html += `<tr class="ab-sezione"><td colspan="${totaleColspan}">${_escapeHtml(r.label)}</td></tr>`;
        continue;
      }

      const segno = r.segno || 1;

      if (r.tipo === 'totale') {
        const valBudget = b[r.id] || 0;
        const pctBudget = b.fatturato > 0 ? valBudget / b.fatturato : 0;
        const cls = `ab-prospetto-tot ab-prospetto-tot-${r.evidenza || 'arancio'}`;
        html += `<tr class="${cls}">
          <td>${_escapeHtml(r.label)}</td>
          <td class="num"></td>
          <td class="num"></td>
          <td class="num"></td>
          <td class="num">${_fmtEuroInt(valBudget * segno)}</td>
          <td class="num">${_fmtPct(pctBudget * segno)}</td>
        </tr>`;
        continue;
      }

      // riga macro
      const m = (progetto.macro_sezioni || []).find(x => x.id === r.id);
      const dato = b.valori[r.id] || { valore: 0, pct: 0, fonte: 'storico', media_euro: 0, media_pct: 0 };

      // Salta riga se nascondiSeZero e tutti i valori (storico + budget) sono nulli
      if (r.nascondiSeZero && Math.abs(dato.media_euro) < 0.005 && Math.abs(dato.valore) < 0.005) continue;

      const fonteCls = dato.fonte === 'override' ? 'ab-fonte-override' : 'ab-fonte-storico';

      // Colonna "Base storica": per le voci non variabili (e non calcolate)
      // mostriamo l'ultimo anno arrotondato al centinaio, che è il default
      // del budget teorico. Per variabili pure e calcolato resta la media €
      // informativa.
      const isNonVarNonCalc = m && m.var_fisso !== 'variabile' && !m.calcolato && r.id !== 'ricavi';
      const baseDisplay = isNonVarNonCalc ? (dato.ultimo_anno_euro || 0) : (dato.media_euro || 0);
      const baseTitle   = isNonVarNonCalc
        ? `Ultimo anno arrotondato al centinaio${b.ultimo_anno ? ' (' + b.ultimo_anno + ')' : ''}`
        : 'Media triennale';

      html += `<tr class="${fonteCls}">
        <td>${_escapeHtml(r.label)}</td>
        <td class="num" title="${baseTitle}">${_fmtEuroInt(baseDisplay)}</td>
        <td class="num">${_fmtPct(dato.media_pct)}</td>
        <td class="num">${_renderOverrideInput(r, dato, progetto)}</td>
        <td class="num">${_fmtEuroInt(dato.valore * segno)}</td>
        <td class="num">${_fmtPct(dato.pct * segno)}</td>
      </tr>`;
    }

    html += '</tbody></table></div>';
    c.innerHTML = html;
  }

  function _renderOverrideInput(r, dato, progetto) {
    if (r.inputType === 'euro_fatturato') {
      // Riga Ricavi: campo cardine. Scrive sullo stesso fatturato_ipotizzato
      // della card in alto (rimangono sincronizzati via re-render). Reso
      // visibilmente come input principale del prospetto perché è il valore
      // da cui dipendono tutti i costi variabili calcolati a percentuale.
      const cur = (progetto.budget && progetto.budget.fatturato_ipotizzato);
      const display = (typeof cur === 'number' && isFinite(cur)) ? _fmtEuroInt(cur) : '';
      return `<div class="amount-field ab-budget-input ab-budget-input-cardine"
                   contenteditable="true"
                   data-budget-field="fatturato_ipotizzato"
                   data-input-type="euro"
                   data-placeholder="auto"
                   title="Fatturato ipotizzato — campo cardine del budget"
                   onblur="BudgetUI.budgetBlur(this)"
                   onkeydown="BudgetUI.budgetKeyDown(event)">${display}</div>`;
    }

    const ovrPct = (progetto.budget && progetto.budget.override_pct) || {};
    const ovrEur = (progetto.budget && progetto.budget.override_fissi) || {};

    if (r.inputType === 'pct') {
      const cur = ovrPct[r.id];
      const display = (typeof cur === 'number') ? (cur * 100).toFixed(1).replace('.', ',') + '%' : '';
      return `<div class="amount-field ab-budget-input"
                   contenteditable="true"
                   data-budget-field="override_pct.${_escapeHtml(r.id)}"
                   data-input-type="pct"
                   data-placeholder="auto"
                   onblur="BudgetUI.budgetBlur(this)"
                   onkeydown="BudgetUI.budgetKeyDown(event)">${display}</div>`;
    }

    if (r.inputType === 'euro') {
      const cur = ovrEur[r.id];
      const display = (typeof cur === 'number') ? _fmtEuroInt(cur) : '';
      return `<div class="amount-field ab-budget-input"
                   contenteditable="true"
                   data-budget-field="override_fissi.${_escapeHtml(r.id)}"
                   data-input-type="euro"
                   data-placeholder="auto"
                   onblur="BudgetUI.budgetBlur(this)"
                   onkeydown="BudgetUI.budgetKeyDown(event)">${display}</div>`;
    }
    return '';
  }

  function budgetBlur(el) {
    const field = el.dataset.budgetField;
    const inputType = el.dataset.inputType;
    const txt = (el.textContent || '').trim();

    let parsed;
    if (field === 'fatturato_ipotizzato') {
      parsed = _parseEuro(txt);
    } else if (inputType === 'pct') {
      parsed = _parsePct(txt);
    } else {
      parsed = _parseEuro(txt);
    }

    Projects.aggiornaBudget(field, parsed);
    UI.aggiornaStatusBar('modificato');
    renderBudget();
  }

  function budgetKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.target.blur();
    }
  }

  /* ──────────────────────────────────────────────────────────
     CONSUNTIVO / PRECONSUNTIVO

     L'utente sceglie la frequenza (mensile/trimestrale) e inserisce
     il fatturato realmente fatturato nei periodi chiusi. La pagina
     mostra:
       - il fatturato consuntivato year-to-date
       - la proiezione di fine anno (= fatt_cons / frazione_anno)
       - la proiezione delle macroaree (variabili scalate, fissi
         interi) confrontata col budget originale
     ────────────────────────────────────────────────────────── */

  const _MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const _TRIMESTRI = ['1° trimestre (gen-mar)','2° trimestre (apr-giu)','3° trimestre (lug-set)','4° trimestre (ott-dic)'];

  function _delta(a, b) {
    return { abs: a - b, pct: b !== 0 ? (a - b) / Math.abs(b) : null };
  }

  function _fmtDelta(d, segnoBuono, intero) {
    // segnoBuono: +1 se più alto è meglio (ricavi, utile), -1 se più alto è peggio (costi)
    if (d == null || !isFinite(d.abs)) return '';
    const cls = (d.abs * (segnoBuono || 0) >= 0) ? 'ab-delta-good' : 'ab-delta-bad';
    const segno = d.abs > 0 ? '+' : '';
    const eur = segno + (intero ? _fmtEuroInt(d.abs) : _fmtEuro(d.abs));
    const pct = d.pct != null ? ` (${segno}${(d.pct * 100).toFixed(1).replace('.', ',')}%)` : '';
    return `<span class="${cls}">${eur}${pct}</span>`;
  }

  function renderConsuntivo() {
    const c = document.getElementById('content');
    if (!c) return;
    const progetto = Projects.getProgetto();
    if (!progetto || !progetto.sottoconti_ce || progetto.sottoconti_ce.length === 0) {
      c.innerHTML = _placeholder('Consuntivo', 'Importa prima il CE da Excel per costruire il consuntivo.');
      return;
    }

    const cons = progetto.consuntivo || { frequenza: 'mensile', fatturato: {} };
    const pre = BudgetEngine.calcolaPreconsuntivo(progetto);
    const annoCorrente = progetto.meta.anno_corrente;

    const periodi = pre.frequenza === 'trimestrale' ? _TRIMESTRI : _MESI;
    const periodiBrevi = pre.frequenza === 'trimestrale'
      ? ['1° trim.','2° trim.','3° trim.','4° trim.']
      : ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    const periodiKeys = pre.periodi_keys;

    let html = `
      <div class="ab-consuntivo">

        <div class="ab-consuntivo-head">
          <div class="ab-consuntivo-head-left">
            <div class="ab-consuntivo-head-top">
              <h2>Consuntivo & preconsuntivo ${annoCorrente}</h2>
              <div class="ab-consuntivo-controls">
                <div class="ab-freq-selector">
                  <span class="text-muted">Frequenza:</span>
                  <div class="ab-freq-toggle">
                    <div class="ab-freq-opt ${pre.frequenza === 'mensile' ? 'active' : ''}"
                         onclick="BudgetUI.cambiaFrequenza('mensile')">Mensile</div>
                    <div class="ab-freq-opt ${pre.frequenza === 'trimestrale' ? 'active' : ''}"
                         onclick="BudgetUI.cambiaFrequenza('trimestrale')">Trimestrale</div>
                  </div>
                </div>
                <div class="ab-consuntivo-stats text-muted">
                  <span><strong>${pre.periodi_chiusi}</strong> / ${pre.periodi_totali} periodi chiusi</span>
                  <span><strong>${(pre.frazione_anno * 100).toFixed(0)}%</strong> dell'anno</span>
                  <span>Consuntivato: <strong>${_fmtEuroInt(pre.fatturato_consuntivato)}</strong></span>
                </div>
              </div>
            </div>
            <p class="text-muted ab-consuntivo-desc">
              Inserisci il fatturato realmente fatturato nelle colonne ${pre.frequenza === 'trimestrale' ? 'trimestrali' : 'mensili'} a destra.
              Il sistema proietta a fine anno mantenendo lo stesso ritmo di fatturazione, applica le percentuali di costo del budget e distribuisce i costi fissi pro-rata sul periodo.
            </p>
          </div>

          <div class="ab-consuntivo-kpi">
            <div class="ab-budget-kpi-card ab-kpi-verde">
              <div class="ab-kpi-label">Fatturato proiettato fine anno</div>
              <div class="ab-kpi-value">${_fmtKpi(pre.fatturato_proiettato)}</div>
              <div class="ab-kpi-sub">${_fmtDelta(_delta(pre.fatturato_proiettato, pre.budget.fatturato), +1)} vs budget</div>
            </div>
            <div class="ab-budget-kpi-card ${pre.proiezione.utileNetto >= 0 ? 'ab-kpi-verde' : 'ab-kpi-rosso'}">
              <div class="ab-kpi-label">Utile netto proiettato</div>
              <div class="ab-kpi-value">${_fmtKpi(pre.proiezione.utileNetto)}</div>
              <div class="ab-kpi-sub">${_fmtDelta(_delta(pre.proiezione.utileNetto, pre.budget.utileNetto), +1)} vs budget</div>
            </div>
            <div class="ab-budget-kpi-card ab-kpi-arancio">
              <div class="ab-kpi-label">MdC proiettato</div>
              <div class="ab-kpi-value">${_fmtKpi(pre.proiezione.mdc)}</div>
              <div class="ab-kpi-sub">${_fmtDelta(_delta(pre.proiezione.mdc, pre.budget.mdc), +1)} vs budget</div>
            </div>
          </div>
        </div>

        <div class="ab-consuntivo-tab-scroll">
        <table class="ab-storico-tab ab-storico-prospetto ab-consuntivo-tab ab-consuntivo-tab-scroll-table">
          <thead>
            <tr>
              <th class="ab-col-stick ab-col-stick-1">Macroarea</th>
              <th class="num ab-col-stick ab-col-stick-2">Budget €</th>
              <th class="num ab-col-stick ab-col-stick-3">Proiezione fine anno</th>
              <th class="num ab-col-stick ab-col-stick-4">Δ vs budget</th>
              ${periodiKeys.map((k, i) => {
                const isChiuso = pre.per_periodo[k] && pre.per_periodo[k].inserito;
                return `<th class="num ab-col-periodo ${isChiuso ? 'ab-col-periodo-chiuso' : ''}" title="${_escapeHtml(periodi[i])}">${_escapeHtml(periodiBrevi[i])}</th>`;
              }).join('')}
            </tr>
          </thead>
          <tbody>
    `;

    const righe = [
      { tipo: 'sezione', label: 'RICAVI' },
      { tipo: 'macro',   id: 'ricavi',           label: 'Ricavi',                                 segnoBuono: +1 },
      { tipo: 'totale',  id: 'fatturato',        label: 'FATTURATO',                              evidenza: 'verde-forte', segnoBuono: +1 },
      { tipo: 'spacer' },
      { tipo: 'macro',   id: 'mat_prime',        label: 'Costi p/mat. prime, suss., cons., merci', segnoBuono: -1 },
      { tipo: 'macro',   id: 'altri_var',        label: 'Altri costi variabili',                  nascondiSeZero: true, segnoBuono: -1 },
      { tipo: 'macro',   id: 'rim_ini',          label: 'Rimanenze iniziali',                     segnoBuono: -1 },
      { tipo: 'macro',   id: 'rim_fin',          label: 'Rimanenze finali',                       segno: -1, segnoBuono: +1 },
      { tipo: 'totale',  id: 'cdv',              label: 'COSTO DEL VENDUTO',                      evidenza: 'arancio', segnoBuono: -1 },
      { tipo: 'totale',  id: 'mdc',              label: 'MARGINE DI CONTRIBUZIONE',               evidenza: 'verde', segnoBuono: +1 },
      { tipo: 'spacer' },
      { tipo: 'macro',   id: 'servizi',          label: 'Costi per servizi',                      segnoBuono: -1 },
      { tipo: 'macro',   id: 'godimento',        label: 'Costi p/godimento beni di terzi',        segnoBuono: -1 },
      { tipo: 'macro',   id: 'personale',        label: 'Costi per il personale',                 segnoBuono: -1 },
      { tipo: 'macro',   id: 'ammortamenti',     label: 'Ammortamenti',                           segnoBuono: -1 },
      { tipo: 'macro',   id: 'oneri_gest',       label: 'Oneri diversi di gestione',              segnoBuono: -1 },
      { tipo: 'macro',   id: 'oneri_fin',        label: 'Int. pass. e altri oneri finanz.',       segnoBuono: -1 },
      { tipo: 'totale',  id: 'fissi',            label: 'TOTALE COSTI FISSI',                     evidenza: 'arancio', segnoBuono: -1 },
      { tipo: 'totale',  id: 'totCosti',         label: 'TOTALE COSTI',                           evidenza: 'arancio-forte', segnoBuono: -1 },
      { tipo: 'spacer' },
      { tipo: 'macro',   id: 'straordinari',     label: 'Oneri straordinari', segno: -1,          segnoBuono: +1 },
      { tipo: 'macro',   id: 'altri_ric',        label: 'Altri ricavi e proventi',                segnoBuono: +1 },
      { tipo: 'macro',   id: 'altri_prov_f',     label: 'Altri proventi finanziari',              segnoBuono: +1 },
      { tipo: 'totale',  id: 'utileAnteImposte', label: 'UTILE ANTE IMPOSTE',                     evidenza: 'verde-forte', segnoBuono: +1 },
      { tipo: 'spacer' },
      { tipo: 'macro',   id: 'imposte',          label: 'Imposte sul reddito',                    segnoBuono: -1 },
      { tipo: 'totale',  id: 'utileNetto',       label: 'UTILE NETTO',                            evidenza: 'verde', segnoBuono: +1 }
    ];

    const colspanTot = 4 + periodiKeys.length;
    const valPerPeriodo = (rowDef, k) => {
      const vp = pre.per_periodo[k];
      if (!vp) return 0;
      if (rowDef.tipo === 'totale') return vp[rowDef.id] || 0;
      return (vp.valori[rowDef.id] && vp.valori[rowDef.id].valore) || 0;
    };

    for (const r of righe) {
      if (r.tipo === 'spacer') {
        html += `<tr class="ab-prospetto-spacer"><td colspan="${colspanTot}">&nbsp;</td></tr>`;
        continue;
      }
      if (r.tipo === 'sezione') {
        // Etichetta avvolta in uno span sticky: `position: sticky` su un
        // <td colspan> ha comportamenti incoerenti tra browser (l'etichetta
        // continua a scorrere via). Lo span sticky è invece affidabile.
        html += `<tr class="ab-sezione"><td colspan="${colspanTot}"><span class="ab-sezione-label-sticky">${_escapeHtml(r.label)}</span></td></tr>`;
        continue;
      }

      const segno = r.segno || 1;
      let valBudget, valProiez;
      if (r.tipo === 'totale') {
        valBudget = pre.budget[r.id] || 0;
        valProiez = pre.proiezione[r.id] || 0;
      } else {
        valBudget = (pre.budget.valori[r.id] && pre.budget.valori[r.id].valore) || 0;
        valProiez = (pre.proiezione.valori[r.id] && pre.proiezione.valori[r.id].valore) || 0;
      }

      // Salta riga se nascondiSeZero e tutti i valori sono nulli
      if (r.nascondiSeZero && Math.abs(valBudget) < 0.005 && Math.abs(valProiez) < 0.005) continue;

      const cls = r.tipo === 'totale'
        ? `ab-prospetto-tot ab-prospetto-tot-${r.evidenza || 'arancio'}`
        : '';

      const d = _delta(valProiez, valBudget);

      // Celle dei periodi: editabili solo sulla riga FATTURATO (totale)
      const isFatturato = r.tipo === 'totale' && r.id === 'fatturato';
      const celleP = periodiKeys.map(k => {
        const vp = pre.per_periodo[k] || {};
        const isChiuso = vp.inserito;
        const periodCls = `num ab-col-periodo ${isChiuso ? 'ab-col-periodo-chiuso' : ''}`;
        if (isFatturato) {
          const valore = cons.fatturato && cons.fatturato[k];
          const display = (typeof valore === 'number' && valore > 0) ? _fmtEuroInt(valore) : '';
          return `<td class="${periodCls}">
            <div class="amount-field ab-periodo-input-cell"
                 contenteditable="true"
                 data-cons-field="fatturato.${k}"
                 data-input-type="euro"
                 data-placeholder="0"
                 onblur="BudgetUI.consuntivoBlur(this)"
                 onkeydown="BudgetUI.budgetKeyDown(event)">${display}</div>
          </td>`;
        }
        const v = valPerPeriodo(r, k) * segno;
        return `<td class="${periodCls}">${Math.abs(v) < 0.5 ? '' : _fmtEuroInt(v)}</td>`;
      }).join('');

      html += `<tr class="${cls}">
        <td class="ab-col-stick ab-col-stick-1">${_escapeHtml(r.label)}</td>
        <td class="num ab-col-stick ab-col-stick-2">${_fmtEuroInt(valBudget * segno)}</td>
        <td class="num ab-col-stick ab-col-stick-3">${_fmtEuroInt(valProiez * segno)}</td>
        <td class="num ab-col-stick ab-col-stick-4">${_fmtDelta({ abs: d.abs * segno, pct: d.pct }, r.segnoBuono, true)}</td>
        ${celleP}
      </tr>`;
    }

    html += '</tbody></table></div></div>';
    c.innerHTML = html;
  }

  function consuntivoBlur(el) {
    const field = el.dataset.consField;
    const txt = (el.textContent || '').trim();
    const parsed = _parseEuro(txt);
    Projects.aggiornaConsuntivo(field, parsed);
    UI.aggiornaStatusBar('modificato');
    // Preserva la posizione di scroll orizzontale tra un re-render e l'altro
    const scroller = document.querySelector('.ab-consuntivo-tab-scroll');
    const scrollLeft = scroller ? scroller.scrollLeft : 0;
    renderConsuntivo();
    if (scrollLeft) {
      const newScroller = document.querySelector('.ab-consuntivo-tab-scroll');
      if (newScroller) newScroller.scrollLeft = scrollLeft;
    }
  }

  function cambiaFrequenza(freq) {
    const progetto = Projects.getProgetto();
    if (!progetto) return;
    const cur = progetto.consuntivo && progetto.consuntivo.frequenza;
    if (cur === freq) return;

    // Conferma prima di azzerare i valori inseriti
    const haDati = progetto.consuntivo && progetto.consuntivo.fatturato &&
                   Object.values(progetto.consuntivo.fatturato).some(v => v > 0);
    if (haDati) {
      if (!confirm('Cambiando frequenza i valori già inseriti verranno azzerati. Procedere?')) return;
    }

    Projects.aggiornaConsuntivo('frequenza', freq);
    UI.aggiornaStatusBar('modificato');
    renderConsuntivo();
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
    cambiaMacroarea:    cambiaMacroarea,
    budgetBlur:         budgetBlur,
    budgetKeyDown:      budgetKeyDown,
    consuntivoBlur:     consuntivoBlur,
    cambiaFrequenza:    cambiaFrequenza
  };

})();
