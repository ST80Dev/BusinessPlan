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
      { sez: 'ricavi',             titolo: 'Ricavi' },
      { sez: 'variabili',          titolo: 'Costi variabili' },
      { sez: 'fissi',              titolo: 'Costi fissi di gestione' },
      { sez: 'prov_oneri_straord', titolo: 'Proventi/Oneri Straordinari' },
      { sez: 'imposte',            titolo: 'Imposte' }
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
       [Proventi/Oneri Straordinari]
       UTILE ANTE IMPOSTE / IMPOSTE / UTILE NETTO

     Per ogni macroarea variabile/fissa viene calcolata la "Media %"
     sul fatturato — la base che il budget (Step 6) userà per
     proiettare i costi sull'anno corrente.
     ────────────────────────────────────────────────────────── */

  /**
   * Calcola tutti i totali e i derivati del prospetto, anno per anno.
   * @returns {Object<string, Object>} per anno → { fatturato, cdv, totVar, mdc, totFissi, totCosti, provOneriStraordNetto, utileAnteImposte, imposte, utileNetto }
   */
  function _calcolaTotaliStorico(progetto) {
    const anni = progetto.meta.anni_storici;
    const macroSez = progetto.macro_sezioni || [];
    const out = {};
    // Somma per sezione orientata sul ruolo (cost/result), così le
    // macroaree custom partecipano automaticamente ai derivati.
    const sumSez = (sa, sez, orient) => macroSez
      .filter(m => m.sezione === sez)
      .reduce((s, m) => {
        const val = sa[m.id] || 0;
        const sign = orient === 'cost'
          ? (m.tipo === 'costo'  ? +1 : -1)
          : (m.tipo === 'ricavo' ? +1 : -1);
        return s + sign * val;
      }, 0);
    for (const a of anni) {
      const sa = (progetto.storico && progetto.storico[a]) || {};
      const fatturato = sa.ricavi || 0;
      const matPrime  = sa.mat_prime || 0;
      const altriVar  = sa.altri_var || 0;
      const rimIni    = sa.rim_ini || 0;
      const rimFin    = sa.rim_fin || 0;

      const cdv    = sumSez(sa, 'variabili', 'cost');
      const totVar = cdv;
      const mdc    = fatturato - totVar;

      const fissi = sumSez(sa, 'fissi', 'cost');

      const totCosti = totVar + fissi;

      const straord    = sa.straordinari || 0;
      const altriRic   = sa.altri_ric || 0;
      const altriProvF = sa.altri_prov_f || 0;
      const provOneriStraordNetto = sumSez(sa, 'prov_oneri_straord', 'result');
      const utileAnteImposte = mdc - fissi + provOneriStraordNetto;
      const imposte = sa.imposte || 0;
      const utileNetto = utileAnteImposte - imposte;

      out[a] = {
        fatturato, matPrime, altriVar, rimIni, rimFin,
        cdv, totVar, mdc, fissi, totCosti,
        straord, altriRic, altriProvF, provOneriStraordNetto,
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
    ['cdv','totVar','mdc','fissi','totCosti','utileAnteImposte','utileNetto','provOneriStraordNetto'].forEach(k => {
      const pcts = anni.map(a => totali[a][k] / totali[a].fatturato);
      out[k] = pcts.reduce((s, p) => s + p, 0) / pcts.length;
    });

    return out;
  }

  function _fmtPct(p) {
    if (typeof p !== 'number' || !isFinite(p)) return '';
    return (p * 100).toFixed(1).replace('.', ',') + '%';
  }

  /**
   * Inserisce le macroaree custom dell'utente nei template `righe`
   * dei prospetti, subito prima del primo totale che chiude la
   * rispettiva sezione (cdv → variabili, fissi → fissi,
   * utileAnteImposte → prov_oneri_straord). Ogni prospetto passa
   * le proprie opzioni (inputType / segno / segnoBuono) per
   * dare alle righe custom la stessa forma delle predefinite.
   *
   * @param {Array} righe        - template di righe del prospetto
   * @param {Array} macroAree    - progetto.macro_sezioni
   * @param {Object} [opts]
   * @param {Object} [opts.inputType]  - { variabili?, fissi?, prov_oneri_straord? }
   * @param {Object} [opts.segno]      - idem (display sign)
   * @param {Object} [opts.segnoBuono] - idem (segnaletica consuntivo)
   * @returns {Array}
   */
  function _injectCustomRighe(righe, macroAree, opts) {
    opts = opts || {};
    const customBySez = {};
    (macroAree || []).filter(m => m.custom).forEach(m => {
      (customBySez[m.sezione] = customBySez[m.sezione] || []).push(m);
    });
    if (Object.keys(customBySez).length === 0) return righe;

    const anchors = {
      cdv:              'variabili',
      fissi:            'fissi',
      utileAnteImposte: 'prov_oneri_straord'
    };
    const injected = {};
    const out = [];
    for (const r of righe) {
      if (r.tipo === 'totale' && anchors[r.id] && !injected[anchors[r.id]]) {
        const sez = anchors[r.id];
        (customBySez[sez] || []).forEach(m => {
          const row = { tipo: 'macro', id: m.id, label: m.label, custom: true };
          if (opts.inputType  && opts.inputType[sez])  row.inputType  = opts.inputType[sez];
          if (opts.segno      && opts.segno[sez])      row.segno      = opts.segno[sez];
          if (opts.segnoBuono && opts.segnoBuono[sez]) row.segnoBuono = opts.segnoBuono[sez];
          out.push(row);
        });
        injected[sez] = true;
      }
      out.push(r);
    }
    return out;
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
    const righeRaw = [
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

    const righe = _injectCustomRighe(righeRaw, progetto.macro_sezioni, {
      segno: { prov_oneri_straord: -1 }
    });

    let html = `
      <div class="ab-storico">
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
         Costi fissi → Proventi/Oneri Straordinari → Imposte). Ogni box è un
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
      { sez: 'ricavi',             titolo: 'Ricavi' },
      { sez: 'variabili',          titolo: 'Costi variabili' },
      { sez: 'fissi',              titolo: 'Costi fissi di gestione' },
      { sez: 'prov_oneri_straord', titolo: 'Proventi/Oneri Straordinari' },
      { sez: 'imposte',            titolo: 'Imposte' }
    ];

    let html = `
      <div class="ab-mappatura">
        <div class="ab-mappatura-head">
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

    // Sezioni in cui l'utente può creare gruppi propri (vedi
    // Projects.SEZIONI_CUSTOM): in queste mostriamo accanto al
    // titolo un pulsante "+ Nuovo gruppo".
    const sezioniConCustom = ['variabili', 'fissi', 'prov_oneri_straord'];

    sezioniProspetto.forEach(({ sez, titolo }) => {
      const macroSez = macroAree.filter(m => m.sezione === sez);
      const ammetteCustom = sezioniConCustom.indexOf(sez) >= 0;
      if (macroSez.length === 0 && !ammetteCustom) return;
      const btnNuovo = ammetteCustom
        ? `<span class="ab-mini-add" data-add-custom="${_escapeHtml(sez)}" title="Crea un nuovo gruppo in questa sezione" tabindex="0">+ Nuovo gruppo</span>`
        : '';
      html += `<div class="ab-mini-sezione">${_escapeHtml(titolo)}${btnNuovo}</div>`;
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
        const customCls = m.custom ? ' ab-mini-box-custom' : '';
        const tip = _descrizioneMacro(m).replace(/"/g, '&quot;');
        const elimina = m.custom
          ? `<span class="ab-mini-elimina" data-elimina-custom="${_escapeHtml(m.id)}" title="Elimina questo gruppo (i sottoconti tornano a Non mappati)" tabindex="0">×</span>`
          : '';
        html += `
          <div class="ab-mini-box${flagCls}${customCls}" data-drop-macro="${_escapeHtml(m.id)}" tabindex="0" title="${tip}">
            ${elimina}
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
      // "+ Nuovo gruppo" — crea una macroarea custom nella sezione
      const addBtn = ev.target.closest('[data-add-custom]');
      if (addBtn) {
        ev.preventDefault();
        const sez = addBtn.dataset.addCustom;
        const label = (window.prompt('Nome del nuovo gruppo:') || '').trim();
        if (!label) return;
        const id = Projects.creaMacroareaCustom(sez, label);
        if (id) {
          UI.aggiornaStatusBar('modificato');
          renderMacroSezioni();
        } else {
          UI.mostraNotifica('Impossibile creare il gruppo (nome non valido o sezione non ammessa).', 'error');
        }
        return;
      }
      // "×" su un box custom — eliminazione con conferma
      const delBtn = ev.target.closest('[data-elimina-custom]');
      if (delBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const id = delBtn.dataset.eliminaCustom;
        if (!confirm('Eliminare questo gruppo? I sottoconti mappati torneranno a "Non mappati".')) return;
        if (Projects.eliminaMacroareaCustom(id)) {
          UI.aggiornaStatusBar('modificato');
          renderMacroSezioni();
        }
        return;
      }
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
      { sez: 'ricavi',             titolo: 'Ricavi' },
      { sez: 'variabili',          titolo: 'Costi variabili' },
      { sez: 'fissi',              titolo: 'Costi fissi' },
      { sez: 'prov_oneri_straord', titolo: 'Proventi/Oneri Straordinari' },
      { sez: 'imposte',            titolo: 'Imposte' }
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
         fissa/straordinaria (input €). Vuota = usa default storico.
       - una colonna "Fonte" che indica se il valore viene da
         storico (S) o override utente (O).
       - per ogni macroarea, un'icona "nota" accanto all'override:
         click → si apre una textarea sotto la riga; se la nota è
         compilata l'icona diventa evidenziata (alert) per segnalarla
         visivamente all'utente.

     Tutti i totali sono ricalcolati al volo da BudgetEngine.calcolaBudget.
     ────────────────────────────────────────────────────────── */

  // Set di id macroarea con la riga-nota attualmente espansa.
  // Vive a livello di modulo: un re-render del prospetto (es. blur su
  // un override) non chiude le note già aperte.
  const _budgetNoteAperte = new Set();

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

  /**
   * Valore "Base storica" della singola macroarea, coerente con la cella
   * mostrata nel prospetto: media triennale € per ricavi, costi variabili
   * e rimanenze; ultimo anno arrotondato al centinaio per fissi,
   * proventi/oneri straordinari e imposte.
   */
  function _baseStoricaVoce(macroSezioni, b, id) {
    const m = (macroSezioni || []).find(x => x.id === id);
    const dato = b.valori[id];
    if (!dato) return 0;
    const isNonVarNonCalc = m && m.var_fisso !== 'variabile' && !m.calcolato && id !== 'ricavi';
    return isNonVarNonCalc ? (dato.ultimo_anno_euro || 0) : (dato.media_euro || 0);
  }

  /**
   * Aggregati di prospetto sulla "Base storica": stessa logica del
   * BudgetEngine ma usando come valore per voce la cella Base storica.
   * Restituisce gli stessi id usati per le righe-totale (fatturato, cdv,
   * mdc, fissi, totCosti, utileAnteImposte, utileNetto).
   */
  function _calcolaBaseStoricaTotali(progetto, b) {
    const macroSez = progetto.macro_sezioni || [];
    const v = id => _baseStoricaVoce(macroSez, b, id);
    // Somma per sezione orientata sul ruolo: 'cost' per variabili/fissi,
    // 'result' per prov_oneri_straord. Stesso schema dell'engine; include
    // automaticamente eventuali macroaree custom.
    const sumSez = (sez, orient) => macroSez
      .filter(m => m.sezione === sez)
      .reduce((s, m) => {
        const val = v(m.id) || 0;
        const sign = orient === 'cost'
          ? (m.tipo === 'costo'  ? +1 : -1)
          : (m.tipo === 'ricavo' ? +1 : -1);
        return s + sign * val;
      }, 0);
    const fatturato = v('ricavi');
    const cdv       = sumSez('variabili',          'cost');
    const fissi     = sumSez('fissi',              'cost');
    const mdc       = fatturato - cdv;
    const totCosti  = cdv + fissi;
    const provOneriStraordNetto = sumSez('prov_oneri_straord', 'result');
    const utileAnteImposte = mdc - fissi + provOneriStraordNetto;
    const utileNetto = utileAnteImposte - v('imposte');
    return { fatturato, cdv, mdc, fissi, totCosti, utileAnteImposte, utileNetto };
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
    const righeRaw = [
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

    const righe = _injectCustomRighe(righeRaw, progetto.macro_sezioni, {
      inputType: { variabili: 'pct', fissi: 'euro', prov_oneri_straord: 'euro' },
      segno:     { prov_oneri_straord: -1 }
    });

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
              <th class="num" title="Costi variabili: media triennale €. Fissi, proventi/oneri straordinari e imposte: ultimo anno arrotondato al centinaio (base del budget teorico).">Base storica</th>
              <th class="num">% storica</th>
              <th class="num">Override</th>
              <th class="num">Budget €</th>
              <th class="num">Budget %</th>
            </tr>
          </thead>
          <tbody>
    `;

    const totaleColspan = 6;

    // Totali "Base storica": ricalcoliamo gli aggregati con la stessa
    // logica del budget, ma usando come valore di partenza per ogni voce
    // la cella "Base storica" (media € per variabili/calcolati e ricavi,
    // ultimo anno arrotondato per fissi/prov_oneri_straord/imposte). Così i
    // totali mostrati nella colonna Base storica sono coerenti col valore
    // teorico che il budget partirebbe a usare in assenza di override.
    const baseTot = _calcolaBaseStoricaTotali(progetto, b);

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
        const valBase = baseTot[r.id] || 0;
        const pctBase = baseTot.fatturato > 0 ? valBase / baseTot.fatturato : 0;
        const cls = `ab-prospetto-tot ab-prospetto-tot-${r.evidenza || 'arancio'}`;
        html += `<tr class="${cls}">
          <td>${_escapeHtml(r.label)}</td>
          <td class="num">${_fmtEuroInt(valBase * segno)}</td>
          <td class="num">${_fmtPct(pctBase * segno)}</td>
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

      const note = (progetto.budget && progetto.budget.note) || {};
      const notaTesto = (note[r.id] || '').trim();
      const notaPresente = notaTesto.length > 0;
      const notaAperta = _budgetNoteAperte.has(r.id);

      html += `<tr class="${fonteCls}${notaPresente ? ' ab-budget-row-has-note' : ''}">
        <td>${_escapeHtml(r.label)}</td>
        <td class="num" title="${baseTitle}">${_fmtEuroInt(baseDisplay)}</td>
        <td class="num">${_fmtPct(dato.media_pct)}</td>
        <td class="num">${_renderOverrideCell(r, dato, progetto, notaPresente, notaAperta)}</td>
        <td class="num">${_fmtEuroInt(dato.valore * segno)}</td>
        <td class="num">${_fmtPct(dato.pct * segno)}</td>
      </tr>`;

      if (notaAperta) {
        const idEsc = _escapeHtml(r.id);
        // Azioni esplicite dentro la riga aperta: "Elimina" cancella il
        // testo e chiude la riga; "Chiudi" la nasconde lasciando il
        // contenuto invariato. Senza questi link, l'utente che apriva
        // il pannello per sbaglio non aveva un modo evidente di
        // chiuderlo o ripulirlo.
        const azioneElimina = notaPresente
          ? `<span class="ab-budget-nota-action ab-budget-nota-action-delete"
                   role="button" tabindex="0"
                   title="Cancella il testo della nota e chiudi la riga"
                   onclick="BudgetUI.eliminaNota('${idEsc}')"
                   onkeydown="BudgetUI.eliminaNotaKeyDown(event, '${idEsc}')">🗑 Elimina nota</span>`
          : '';
        html += `<tr class="ab-budget-nota-row${notaPresente ? ' ab-budget-nota-row-piena' : ''}">
          <td colspan="${totaleColspan}">
            <div class="ab-budget-nota-wrap">
              <label class="ab-budget-nota-label">Nota — ${_escapeHtml(r.label)}</label>
              <textarea class="ab-budget-nota-input"
                        rows="2"
                        placeholder="Annotazione libera per questa voce (visibile nei report)…"
                        data-macro-id="${idEsc}"
                        onblur="BudgetUI.notaBlur(this)"
                        onkeydown="BudgetUI.notaKeyDown(event)">${_escapeHtml(notaTesto)}</textarea>
              <div class="ab-budget-nota-actions">
                ${azioneElimina}
                <span class="ab-budget-nota-action"
                      role="button" tabindex="0"
                      title="Chiudi la riga nota (il testo resta salvato)"
                      onclick="BudgetUI.toggleNota('${idEsc}')"
                      onkeydown="BudgetUI.notaToggleKeyDown(event, '${idEsc}')">Chiudi</span>
              </div>
            </div>
          </td>
        </tr>`;
      }
    }

    html += '</tbody></table></div>';
    c.innerHTML = html;
  }

  /**
   * Cella "Override" con input editabile + icona-toggle per la nota
   * di voce. L'icona ha tre stati visivi distinti:
   *   - "+"  riga chiusa, nessuna nota → click per aggiungere
   *   - "!"  riga chiusa, nota presente → click per visualizzare
   *   - "✕"  riga aperta (con o senza nota) → click per chiudere
   * Per cancellare il testo della nota c'è un link "Elimina" dentro
   * la riga aperta (vedi renderBudget).
   */
  function _renderOverrideCell(r, dato, progetto, notaPresente, notaAperta) {
    const inputHtml = _renderOverrideInput(r, dato, progetto);
    const cls = 'ab-budget-nota-toggle'
      + (notaPresente ? ' ab-budget-nota-toggle-piena' : '')
      + (notaAperta   ? ' ab-budget-nota-toggle-aperta' : '');
    const icona = notaAperta ? '✕' : (notaPresente ? '!' : '+');
    const titolo = notaAperta
      ? 'Chiudi la riga nota'
      : (notaPresente
          ? 'Nota presente — clicca per leggere/modificare'
          : 'Aggiungi una nota a questa voce');
    const aria = notaAperta
      ? 'Chiudi nota'
      : (notaPresente ? 'Apri nota presente' : 'Aggiungi nota');
    return `<div class="ab-budget-override-wrap">
      ${inputHtml}
      <span class="${cls}"
            role="button"
            tabindex="0"
            title="${titolo}"
            aria-label="${aria}"
            onclick="BudgetUI.toggleNota('${_escapeHtml(r.id)}')"
            onkeydown="BudgetUI.notaToggleKeyDown(event, '${_escapeHtml(r.id)}')">${icona}</span>
    </div>`;
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

  /**
   * Apre/chiude la riga-nota di una voce del budget.
   *
   * Forza il blur del campo attivo prima del re-render, così
   * eventuali importi appena editati ma non ancora confermati
   * vengono salvati (coerente con la regola UI generale del progetto).
   */
  function toggleNota(macroId) {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    if (_budgetNoteAperte.has(macroId)) _budgetNoteAperte.delete(macroId);
    else                                _budgetNoteAperte.add(macroId);
    renderBudget();
    if (_budgetNoteAperte.has(macroId)) {
      const ta = document.querySelector('textarea[data-macro-id="' + macroId.replace(/"/g, '\\"') + '"]');
      if (ta) {
        ta.focus();
        const v = ta.value;
        ta.setSelectionRange(v.length, v.length);
      }
    }
  }

  function notaToggleKeyDown(e, macroId) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleNota(macroId);
    }
  }

  /**
   * Cancella il testo della nota della voce e chiude la riga.
   * Il blur dell'eventuale textarea attiva viene forzato prima così
   * che il salvataggio "su null" non venga sovrascritto dal blur
   * della textarea che salverebbe il testo digitato in pancia.
   */
  function eliminaNota(macroId) {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    Projects.aggiornaBudget('note.' + macroId, null);
    _budgetNoteAperte.delete(macroId);
    UI.aggiornaStatusBar('modificato');
    renderBudget();
  }

  function eliminaNotaKeyDown(e, macroId) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      eliminaNota(macroId);
    }
  }

  function notaBlur(el) {
    const macroId = el.dataset.macroId;
    if (!macroId) return;
    const testo = (el.value || '').trim();
    Projects.aggiornaBudget('note.' + macroId, testo || null);
    UI.aggiornaStatusBar('modificato');
    renderBudget();
  }

  function notaKeyDown(e) {
    // Esc: chiude senza salvare modifiche in corso (il blur successivo
    // salverà comunque, ma l'utente percepisce la chiusura immediata).
    if (e.key === 'Escape') {
      e.preventDefault();
      e.target.blur();
    }
    // Ctrl/Cmd + Enter: conferma e chiude la riga-nota.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const macroId = e.target.dataset.macroId;
      e.target.blur();
      if (macroId) _budgetNoteAperte.delete(macroId);
      renderBudget();
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

    const righeRaw = [
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

    const righe = _injectCustomRighe(righeRaw, progetto.macro_sezioni, {
      segno:      { prov_oneri_straord: -1 },
      segnoBuono: { variabili: -1, fissi: -1, prov_oneri_straord: +1 }
    });

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

  /* ──────────────────────────────────────────────────────────
     EXPORT PDF (Budget e Consuntivo)

     Il PDF viene prodotto via window.print() del browser, su un
     layout dedicato ad alta compatibilità: nessuna libreria esterna,
     nessun build step. Il flusso è:

       1) si forza il blur dell'eventuale campo attivo (regola UI
          generale del progetto: evita valori stale);
       2) si costruisce un container <div id="ab-pdf-print"> con il
          markup del report;
       3) si applica al body la classe `ab-pdf-mode` che — via CSS
          @media print — nasconde tutto il resto e mostra solo il
          report;
       4) si chiama window.print(); l'evento `afterprint` ripulisce
          il DOM e rimuove la classe.

     Il bottone "Esporta PDF" vive nel footer (`#footer-actions`,
     popolato dal router `UI.navigate()` in core/ui.js). Il footer è
     già nascosto in @media print, quindi nessuna classe ad-hoc.
     ────────────────────────────────────────────────────────── */

  function _printPdf(html, title) {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    // Rimuovi un eventuale container precedente (es. due click rapidi)
    const old = document.getElementById('ab-pdf-print');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    const cont = document.createElement('div');
    cont.id = 'ab-pdf-print';
    cont.innerHTML = html;
    document.body.appendChild(cont);
    document.body.classList.add('ab-pdf-mode');

    const oldTitle = document.title;
    if (title) document.title = title;

    function cleanup() {
      document.body.classList.remove('ab-pdf-mode');
      const c = document.getElementById('ab-pdf-print');
      if (c && c.parentNode) c.parentNode.removeChild(c);
      document.title = oldTitle;
      window.removeEventListener('afterprint', cleanup);
    }
    window.addEventListener('afterprint', cleanup);

    // Lasciamo al browser un tick per applicare i nuovi stili prima del print
    setTimeout(function () { window.print(); }, 50);
  }

  function _oggi() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  function _pdfHeader(progetto, sottotitolo) {
    const cliente = (progetto.meta && progetto.meta.cliente) || '—';
    const anno = (progetto.meta && progetto.meta.anno_corrente) || '';
    const note = (progetto.meta && Array.isArray(progetto.meta.note_anagrafica))
      ? progetto.meta.note_anagrafica : [];

    let noteHtml = '';
    if (note.length > 0) {
      const items = note.map(n => {
        const t = (n && n.titolo || '').trim();
        const x = (n && n.testo  || '').trim();
        if (!t && !x) return '';
        const sep = (t && x) ? ': ' : '';
        return '<span class="ab-pdf-head-note-item">'
             +   '<span class="ab-pdf-head-note-titolo">' + _escapeHtml(t) + '</span>'
             +   _escapeHtml(sep + x)
             + '</span>';
      }).filter(s => s).join('');
      if (items) noteHtml = '<div class="ab-pdf-head-note">' + items + '</div>';
    }

    return `
      <div class="ab-pdf-head">
        <div class="ab-pdf-head-title">
          <div class="ab-pdf-head-cliente">${_escapeHtml(cliente)}</div>
          <div class="ab-pdf-head-sub">${_escapeHtml(sottotitolo)}${anno ? ' — anno ' + _escapeHtml(String(anno)) : ''}</div>
          ${noteHtml}
        </div>
        <div class="ab-pdf-head-meta text-muted">
          <div>Studio AnaBil · Modulo A&amp;B</div>
          <div>Data stampa: ${_oggi()}</div>
        </div>
      </div>
    `;
  }

  /* ── Budget: PDF ─────────────────────────────────────────── */

  function _renderBudgetPdfHtml(progetto) {
    const b = BudgetEngine.calcolaBudget(progetto);
    const note = (progetto.budget && progetto.budget.note) || {};

    // KPI riepilogativi (stessi che vedo a video)
    const fattStorico = b.fatturato_storico_medio;
    const deltaFattStorico = fattStorico > 0 ? (b.fatturato - fattStorico) / fattStorico : 0;
    const deltaFattBe = (b.break_even != null && b.break_even > 0)
      ? (b.fatturato - b.break_even) / b.break_even : null;
    const mdcPct = b.fatturato > 0 ? b.mdc / b.fatturato : 0;
    const utileNettoPct = b.fatturato > 0 ? b.utileNetto / b.fatturato : 0;

    const righeRaw = [
      { tipo: 'sezione', label: 'RICAVI' },
      { tipo: 'macro',   id: 'ricavi',           label: 'Ricavi' },
      { tipo: 'totale',  id: 'fatturato',        label: 'FATTURATO',                              evidenza: 'verde-forte' },
      { tipo: 'spacer' },
      { tipo: 'macro',   id: 'mat_prime',        label: 'Costi p/mat. prime, suss., cons., merci' },
      { tipo: 'macro',   id: 'altri_var',        label: 'Altri costi variabili',                  nascondiSeZero: true },
      { tipo: 'macro',   id: 'rim_ini',          label: 'Rimanenze iniziali' },
      { tipo: 'macro',   id: 'rim_fin',          label: 'Rimanenze finali',                       segno: -1 },
      { tipo: 'totale',  id: 'cdv',              label: 'COSTO DEL VENDUTO',                      evidenza: 'arancio' },
      { tipo: 'totale',  id: 'mdc',              label: 'MARGINE DI CONTRIBUZIONE',               evidenza: 'verde' },
      { tipo: 'spacer' },
      { tipo: 'macro',   id: 'servizi',          label: 'Costi per servizi' },
      { tipo: 'macro',   id: 'godimento',        label: 'Costi p/godimento beni di terzi' },
      { tipo: 'macro',   id: 'personale',        label: 'Costi per il personale' },
      { tipo: 'macro',   id: 'ammortamenti',     label: 'Ammortamenti' },
      { tipo: 'macro',   id: 'oneri_gest',       label: 'Oneri diversi di gestione' },
      { tipo: 'macro',   id: 'oneri_fin',        label: 'Int. pass. e altri oneri finanz.' },
      { tipo: 'totale',  id: 'fissi',            label: 'TOTALE COSTI FISSI',                     evidenza: 'arancio' },
      { tipo: 'totale',  id: 'totCosti',         label: 'TOTALE COSTI',                           evidenza: 'arancio-forte' },
      { tipo: 'spacer' },
      { tipo: 'macro',   id: 'straordinari',     label: 'Oneri straordinari', segno: -1 },
      { tipo: 'macro',   id: 'altri_ric',        label: 'Altri ricavi e proventi' },
      { tipo: 'macro',   id: 'altri_prov_f',     label: 'Altri proventi finanziari' },
      { tipo: 'totale',  id: 'utileAnteImposte', label: 'UTILE ANTE IMPOSTE',                     evidenza: 'verde' },
      { tipo: 'spacer' },
      { tipo: 'macro',   id: 'imposte',          label: 'Imposte sul reddito' },
      { tipo: 'totale',  id: 'utileNetto',       label: 'UTILE NETTO',                            evidenza: 'verde-forte' }
    ];

    const righe = _injectCustomRighe(righeRaw, progetto.macro_sezioni, {
      segno: { prov_oneri_straord: -1 }
    });

    const colspanTot = 5;
    let body = '';

    // Totali "Base storica" (stessa logica della vista a video).
    const baseTot = _calcolaBaseStoricaTotali(progetto, b);

    // Numerazione note utente: assegniamo l'indice nell'ordine in cui le voci
    // compaiono nel prospetto (più leggibile in piè di pagina).
    const noteUtente = [];

    for (const r of righe) {
      if (r.tipo === 'spacer') {
        body += `<tr class="ab-prospetto-spacer"><td colspan="${colspanTot}">&nbsp;</td></tr>`;
        continue;
      }
      if (r.tipo === 'sezione') {
        body += `<tr class="ab-sezione"><td colspan="${colspanTot}">${_escapeHtml(r.label)}</td></tr>`;
        continue;
      }

      const segno = r.segno || 1;

      if (r.tipo === 'totale') {
        const valBudget = b[r.id] || 0;
        const pctBudget = b.fatturato > 0 ? valBudget / b.fatturato : 0;
        const valBase = baseTot[r.id] || 0;
        const pctBase = baseTot.fatturato > 0 ? valBase / baseTot.fatturato : 0;
        const cls = `ab-prospetto-tot ab-prospetto-tot-${r.evidenza || 'arancio'}`;
        body += `<tr class="${cls}">
          <td>${_escapeHtml(r.label)}</td>
          <td class="num">${_fmtEuroInt(valBase * segno)}</td>
          <td class="num">${_fmtPct(pctBase * segno)}</td>
          <td class="num">${_fmtEuroInt(valBudget * segno)}</td>
          <td class="num">${_fmtPct(pctBudget * segno)}</td>
        </tr>`;
        continue;
      }

      const m = (progetto.macro_sezioni || []).find(x => x.id === r.id);
      const dato = b.valori[r.id] || { valore: 0, pct: 0, media_euro: 0, media_pct: 0 };
      if (r.nascondiSeZero && Math.abs(dato.media_euro) < 0.005 && Math.abs(dato.valore) < 0.005) continue;

      const isNonVarNonCalc = m && m.var_fisso !== 'variabile' && !m.calcolato && r.id !== 'ricavi';
      const baseDisplay = isNonVarNonCalc ? (dato.ultimo_anno_euro || 0) : (dato.media_euro || 0);

      // Nota utente: se presente, assegna numero progressivo e lo mostra come [n]
      const notaTesto = (note[r.id] || '').trim();
      let notaMark = '';
      if (notaTesto.length > 0) {
        const n = noteUtente.length + 1;
        noteUtente.push({ n, label: r.label, testo: notaTesto });
        notaMark = ` <sup class="ab-pdf-noteref">[${n}]</sup>`;
      }

      body += `<tr>
        <td>${_escapeHtml(r.label)}${notaMark}</td>
        <td class="num">${_fmtEuroInt(baseDisplay)}</td>
        <td class="num">${_fmtPct(dato.media_pct)}</td>
        <td class="num">${_fmtEuroInt(dato.valore * segno)}</td>
        <td class="num">${_fmtPct(dato.pct * segno)}</td>
      </tr>`;
    }

    // KPI block
    const kpiHtml = `
      <div class="ab-pdf-kpi">
        <div class="ab-pdf-kpi-card">
          <div class="ab-pdf-kpi-label">Fatturato ipotizzato</div>
          <div class="ab-pdf-kpi-value">${_fmtEuroInt(b.fatturato)} €</div>
          <div class="ab-pdf-kpi-sub">Storico medio: ${_fmtEuroInt(fattStorico)} € ${fattStorico > 0 ? '(' + _fmtPctSigned(deltaFattStorico) + ' vs ipotizzato)' : ''}</div>
        </div>
        <div class="ab-pdf-kpi-card">
          <div class="ab-pdf-kpi-label">Margine di contribuzione</div>
          <div class="ab-pdf-kpi-value">${_fmtEuroInt(b.mdc)} €</div>
          <div class="ab-pdf-kpi-sub">${(mdcPct * 100).toFixed(1).replace('.', ',')}% sul fatturato</div>
        </div>
        <div class="ab-pdf-kpi-card">
          <div class="ab-pdf-kpi-label">Utile netto</div>
          <div class="ab-pdf-kpi-value">${_fmtEuroInt(b.utileNetto)} €</div>
          <div class="ab-pdf-kpi-sub">${(utileNettoPct * 100).toFixed(1).replace('.', ',')}% sul fatturato</div>
        </div>
        <div class="ab-pdf-kpi-card">
          <div class="ab-pdf-kpi-label">Fatturato di break-even</div>
          <div class="ab-pdf-kpi-value">${b.break_even != null ? _fmtEuroInt(b.break_even) + ' €' : '—'}</div>
          <div class="ab-pdf-kpi-sub">${deltaFattBe != null ? (b.fatturato >= b.break_even ? _fmtPctSigned(deltaFattBe) + ' sopra il pareggio' : _fmtPctSigned(deltaFattBe) + ' dal pareggio') : 'non calcolabile'}</div>
        </div>
      </div>
    `;

    // Note metodologiche fisse (riprendono i tooltip a video)
    const noteMetodo = [
      '<strong>Base storica</strong> — per costi variabili (mat. prime, altri costi variabili) e rimanenze: media triennale degli importi storici. Per costi fissi, proventi/oneri straordinari e imposte: ultimo anno arrotondato al centinaio (default del budget teorico).',
      '<strong>% storica</strong> — incidenza media sul fatturato calcolata come media delle incidenze % di ciascun anno storico (non come media degli importi diviso media del fatturato).',
      '<strong>Budget €</strong> — costi variabili: % budget × fatturato ipotizzato. Costi fissi, proventi/oneri straordinari e imposte: importo di partenza (ultimo anno) o override utente. Rimanenze: media € storica o override €.',
      '<strong>Costo del venduto</strong> = Mat. prime + Altri costi variabili + Rimanenze iniziali − Rimanenze finali.',
      `<strong>Fatturato di break-even</strong> = (Rim. iniziali − Rim. finali + Σ costi fissi) / (1 − Σ % costi variabili). ${b.break_even != null ? 'Differenza vs ipotizzato: ' + _fmtPctSigned(deltaFattBe || 0) : 'Non calcolabile (denominatore non positivo o costi fissi nulli).'}`
    ];

    // HTML completo
    let html = '';
    html += _pdfHeader(progetto, 'Budget anno');
    html += kpiHtml;
    html += '<table class="ab-pdf-tab"><thead><tr>'
         +    '<th>Macroarea</th>'
         +    '<th class="num">Base storica</th>'
         +    '<th class="num">% storica</th>'
         +    '<th class="num">Budget €</th>'
         +    '<th class="num">Budget %</th>'
         +  '</tr></thead><tbody>' + body + '</tbody></table>';

    // Le note di metodo restano nel codice ma sono nascoste in stampa
    // (CSS: .ab-pdf-notes-metodo { display: none }). L'operatore preferisce
    // riservare lo spazio alla tabella e alle annotazioni manuali per conto.
    html += '<div class="ab-pdf-notes ab-pdf-notes-metodo"><div class="ab-pdf-notes-title">Note di metodo</div><ol>';
    for (const t of noteMetodo) html += '<li>' + t + '</li>';
    html += '</ol></div>';

    if (noteUtente.length > 0) {
      html += '<div class="ab-pdf-notes"><div class="ab-pdf-notes-title">Annotazioni per voce</div><ol>';
      for (const nu of noteUtente) {
        html += '<li><strong>[' + nu.n + '] ' + _escapeHtml(nu.label) + '</strong> — ' + _escapeHtml(nu.testo) + '</li>';
      }
      html += '</ol></div>';
    }

    return html;
  }

  function esportaPdfBudget() {
    const progetto = Projects.getProgetto();
    if (!progetto || !progetto.sottoconti_ce || progetto.sottoconti_ce.length === 0) return;
    const cliente = (progetto.meta && progetto.meta.cliente) || 'progetto';
    const anno = (progetto.meta && progetto.meta.anno_corrente) || '';
    const html = _renderBudgetPdfHtml(progetto);
    _printPdf(html, `Budget ${anno} — ${cliente}`);
  }

  /* ── Consuntivo: PDF ─────────────────────────────────────── */

  /**
   * Per il PDF consuntivo costruiamo le colonne periodo come segue:
   *
   *   - frequenza TRIMESTRALE: 4 colonne fisse Q1..Q4 (anche se non
   *     compilate). Ogni colonna mostra il singolo trimestre isolato
   *     (non cumulato).
   *
   *   - frequenza MENSILE: 1 sola colonna "Cumulato gen→<ultimo mese
   *     compilato>" che somma i valori da gennaio fino all'ultimo
   *     mese effettivamente chiuso. Se nessun mese è compilato, la
   *     colonna mostra zero (e la testata indica "Nessun mese
   *     compilato").
   *
   * In entrambi i casi la colonna "Budget €" rimane il budget
   * annuale completo, come riferimento.
   */
  function _buildPdfPeriodCols(pre) {
    if (pre.frequenza === 'trimestrale') {
      const labels = ['1° trim. (gen-mar)','2° trim. (apr-giu)','3° trim. (lug-set)','4° trim. (ott-dic)'];
      return pre.periodi_keys.map((k, i) => ({
        key: k,
        label: labels[i],
        chiuso: !!(pre.per_periodo[k] && pre.per_periodo[k].inserito),
        valori: pre.per_periodo[k] ? pre.per_periodo[k].valori : {},
        totali: pre.per_periodo[k] || {}
      }));
    }

    // Mensile: cumulato gen→ultimo mese compilato
    const meseLabels = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    let lastIdx = -1;
    pre.periodi_keys.forEach((k, i) => {
      if (pre.per_periodo[k] && pre.per_periodo[k].inserito) lastIdx = i;
    });

    const valoriCum = {};
    const totaliCum = { fatturato: 0, cdv: 0, totVar: 0, mdc: 0, fissi: 0, totCosti: 0, provOneriStraordNetto: 0, utileAnteImposte: 0, imposte: 0, utileNetto: 0 };

    if (lastIdx >= 0) {
      for (let i = 0; i <= lastIdx; i++) {
        const k = pre.periodi_keys[i];
        const vp = pre.per_periodo[k];
        if (!vp) continue;
        for (const id in vp.valori) {
          const v = vp.valori[id].valore || 0;
          if (!valoriCum[id]) valoriCum[id] = { valore: 0 };
          valoriCum[id].valore += v;
        }
        for (const k2 in totaliCum) {
          totaliCum[k2] += vp[k2] || 0;
        }
      }
    }

    const label = lastIdx >= 0
      ? `Cumulato gen-${meseLabels[lastIdx].slice(0, 3).toLowerCase()} (${lastIdx + 1} mes${lastIdx === 0 ? 'e' : 'i'})`
      : 'Cumulato (nessun mese compilato)';

    return [{
      key: 'cumul',
      label,
      chiuso: lastIdx >= 0,
      valori: valoriCum,
      totali: totaliCum,
      isCumulMensile: true,
      ultimoMeseLabel: lastIdx >= 0 ? meseLabels[lastIdx] : null
    }];
  }

  function _renderConsuntivoPdfHtml(progetto) {
    const pre = BudgetEngine.calcolaPreconsuntivo(progetto);
    const note = (progetto.budget && progetto.budget.note) || {};
    const cols = _buildPdfPeriodCols(pre);

    // segnoBuono: +1 se "più alto = meglio" (ricavi, utile, MdC, rim. finali)
    //             -1 se "più alto = peggio" (costi, oneri, imposte)
    const righeRaw = [
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

    const righe = _injectCustomRighe(righeRaw, progetto.macro_sezioni, {
      segno:      { prov_oneri_straord: -1 },
      segnoBuono: { variabili: -1, fissi: -1, prov_oneri_straord: +1 }
    });

    const colspanTot = 4 + cols.length;
    let body = '';
    const noteUtente = [];

    function valColPeriodo(rowDef, col) {
      if (rowDef.tipo === 'totale') return col.totali[rowDef.id] || 0;
      return (col.valori[rowDef.id] && col.valori[rowDef.id].valore) || 0;
    }

    for (const r of righe) {
      if (r.tipo === 'spacer') {
        body += `<tr class="ab-prospetto-spacer"><td colspan="${colspanTot}">&nbsp;</td></tr>`;
        continue;
      }
      if (r.tipo === 'sezione') {
        body += `<tr class="ab-sezione"><td colspan="${colspanTot}">${_escapeHtml(r.label)}</td></tr>`;
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
      if (r.nascondiSeZero && Math.abs(valBudget) < 0.005 && Math.abs(valProiez) < 0.005) continue;

      const cls = r.tipo === 'totale' ? `ab-prospetto-tot ab-prospetto-tot-${r.evidenza || 'arancio'}` : '';

      // Δ vs budget: signed con classe per il colore (good/bad)
      const dAbs = (valProiez - valBudget) * segno;
      const dPct = valBudget !== 0 ? (valProiez - valBudget) / Math.abs(valBudget) : null;
      let deltaCell = '';
      if (Math.abs(dAbs) >= 0.5) {
        const sb = r.segnoBuono || 0;
        const buono = (dAbs * sb) >= 0;
        const segnoTxt = dAbs > 0 ? '+' : '';
        const pctTxt = dPct != null ? ` (${segnoTxt}${(dPct * 100).toFixed(1).replace('.', ',')}%)` : '';
        deltaCell = `<span class="${buono ? 'ab-pdf-delta-good' : 'ab-pdf-delta-bad'}">${segnoTxt}${_fmtEuroInt(dAbs)}${pctTxt}</span>`;
      }

      // Nota utente (segna solo macro, non i totali derivati)
      let notaMark = '';
      if (r.tipo === 'macro') {
        const t = (note[r.id] || '').trim();
        if (t.length > 0) {
          const n = noteUtente.length + 1;
          noteUtente.push({ n, label: r.label, testo: t });
          notaMark = ` <sup class="ab-pdf-noteref">[${n}]</sup>`;
        }
      }

      const celleP = cols.map(col => {
        const v = valColPeriodo(r, col) * segno;
        const cellCls = 'num' + (col.chiuso ? '' : ' ab-pdf-col-vuoto');
        return `<td class="${cellCls}">${Math.abs(v) < 0.5 ? '' : _fmtEuroInt(v)}</td>`;
      }).join('');

      body += `<tr class="${cls}">
        <td>${_escapeHtml(r.label)}${notaMark}</td>
        <td class="num">${_fmtEuroInt(valBudget * segno)}</td>
        <td class="num">${_fmtEuroInt(valProiez * segno)}</td>
        <td class="num">${deltaCell}</td>
        ${celleP}
      </tr>`;
    }

    // KPI di testa (proiezione vs budget) — riprende i 3 KPI a video
    const dFatt = pre.fatturato_proiettato - pre.budget.fatturato;
    const dFattPct = pre.budget.fatturato !== 0 ? dFatt / Math.abs(pre.budget.fatturato) : null;
    const dUtile = pre.proiezione.utileNetto - pre.budget.utileNetto;
    const dUtilePct = pre.budget.utileNetto !== 0 ? dUtile / Math.abs(pre.budget.utileNetto) : null;
    const dMdc = pre.proiezione.mdc - pre.budget.mdc;
    const dMdcPct = pre.budget.mdc !== 0 ? dMdc / Math.abs(pre.budget.mdc) : null;
    function _kpiSub(d, dpct) {
      const segno = d > 0 ? '+' : '';
      return `${segno}${_fmtEuroInt(d)} €${dpct != null ? ' (' + segno + (dpct * 100).toFixed(1).replace('.', ',') + '%)' : ''} vs budget`;
    }

    const kpiHtml = `
      <div class="ab-pdf-kpi">
        <div class="ab-pdf-kpi-card">
          <div class="ab-pdf-kpi-label">Fatturato consuntivato</div>
          <div class="ab-pdf-kpi-value">${_fmtEuroInt(pre.fatturato_consuntivato)} €</div>
          <div class="ab-pdf-kpi-sub">${pre.periodi_chiusi}/${pre.periodi_totali} periodi · ${(pre.frazione_anno * 100).toFixed(0)}% dell'anno</div>
        </div>
        <div class="ab-pdf-kpi-card">
          <div class="ab-pdf-kpi-label">Fatturato proiettato fine anno</div>
          <div class="ab-pdf-kpi-value">${_fmtEuroInt(pre.fatturato_proiettato)} €</div>
          <div class="ab-pdf-kpi-sub">${_kpiSub(dFatt, dFattPct)}</div>
        </div>
        <div class="ab-pdf-kpi-card">
          <div class="ab-pdf-kpi-label">Utile netto proiettato</div>
          <div class="ab-pdf-kpi-value">${_fmtEuroInt(pre.proiezione.utileNetto)} €</div>
          <div class="ab-pdf-kpi-sub">${_kpiSub(dUtile, dUtilePct)}</div>
        </div>
        <div class="ab-pdf-kpi-card">
          <div class="ab-pdf-kpi-label">MdC proiettato</div>
          <div class="ab-pdf-kpi-value">${_fmtEuroInt(pre.proiezione.mdc)} €</div>
          <div class="ab-pdf-kpi-sub">${_kpiSub(dMdc, dMdcPct)}</div>
        </div>
      </div>
    `;

    // Costruzione testata della tabella periodi
    const periodHeaders = cols.map(col => {
      const stato = col.chiuso ? '' : '<div class="ab-pdf-col-stato">non compilato</div>';
      return `<th class="num">${_escapeHtml(col.label)}${stato}</th>`;
    }).join('');

    const sottotitolo = pre.frequenza === 'trimestrale'
      ? 'Consuntivo trimestrale'
      : (cols[0] && cols[0].ultimoMeseLabel
          ? `Consuntivo mensile · cumulato gennaio-${cols[0].ultimoMeseLabel.toLowerCase()}`
          : 'Consuntivo mensile · nessun mese compilato');

    // Note metodologiche
    const noteMetodo = [
      pre.frequenza === 'trimestrale'
        ? '<strong>Colonne trimestrali</strong> — ogni colonna mostra il singolo trimestre <em>isolato</em>: i costi variabili sono % budget × fatturato del trimestre, i fissi/proventi/oneri straord./imposte sono pro-quota 1/4 del budget annuale. I trimestri non compilati sono indicati come tali e mostrano i soli costi pro-quota (fatturato 0).'
        : '<strong>Colonna cumulato</strong> — somma da gennaio all\'ultimo mese compilato. I costi variabili scalano col fatturato effettivo cumulato, i costi fissi/proventi/oneri straord./imposte sono pro-quota in dodicesimi.',
      '<strong>Budget €</strong> — è sempre il budget <em>annuale</em> completo, come riferimento. Non viene proporzionato al periodo: il confronto utile è quello della colonna "Proiezione fine anno", che ribalta sul totale anno il ritmo di fatturazione osservato.',
      '<strong>Proiezione fine anno</strong> — fatturato proiettato = fatturato consuntivato / frazione di anno chiusa. Costi variabili = % budget × fatturato proiettato. Costi fissi/proventi/oneri straord./imposte = budget annuale intero. Le rimanenze sono assunte stabili al budget.',
      '<strong>Δ vs budget</strong> — differenza Proiezione − Budget annuale. Verde = scostamento favorevole (più ricavi/utile o meno costi); rosso = sfavorevole.'
    ];

    let html = '';
    html += _pdfHeader(progetto, sottotitolo);
    html += kpiHtml;
    html += '<table class="ab-pdf-tab ab-pdf-tab-consuntivo"><thead><tr>'
         +    '<th>Macroarea</th>'
         +    '<th class="num">Budget €</th>'
         +    '<th class="num">Proiezione fine anno</th>'
         +    '<th class="num">Δ vs budget</th>'
         +    periodHeaders
         +  '</tr></thead><tbody>' + body + '</tbody></table>';

    // Le note di metodo restano nel codice ma sono nascoste in stampa
    // (CSS: .ab-pdf-notes-metodo { display: none }). L'operatore preferisce
    // riservare lo spazio alla tabella e alle annotazioni manuali per conto.
    html += '<div class="ab-pdf-notes ab-pdf-notes-metodo"><div class="ab-pdf-notes-title">Note di metodo</div><ol>';
    for (const t of noteMetodo) html += '<li>' + t + '</li>';
    html += '</ol></div>';

    if (noteUtente.length > 0) {
      html += '<div class="ab-pdf-notes"><div class="ab-pdf-notes-title">Annotazioni per voce</div><ol>';
      for (const nu of noteUtente) {
        html += '<li><strong>[' + nu.n + '] ' + _escapeHtml(nu.label) + '</strong> — ' + _escapeHtml(nu.testo) + '</li>';
      }
      html += '</ol></div>';
    }

    return html;
  }

  function esportaPdfConsuntivo() {
    const progetto = Projects.getProgetto();
    if (!progetto || !progetto.sottoconti_ce || progetto.sottoconti_ce.length === 0) return;
    const cliente = (progetto.meta && progetto.meta.cliente) || 'progetto';
    const anno = (progetto.meta && progetto.meta.anno_corrente) || '';
    const html = _renderConsuntivoPdfHtml(progetto);
    _printPdf(html, `Consuntivo ${anno} — ${cliente}`);
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
    toggleNota:         toggleNota,
    notaToggleKeyDown:  notaToggleKeyDown,
    notaBlur:           notaBlur,
    notaKeyDown:        notaKeyDown,
    eliminaNota:        eliminaNota,
    eliminaNotaKeyDown: eliminaNotaKeyDown,
    consuntivoBlur:     consuntivoBlur,
    cambiaFrequenza:    cambiaFrequenza,
    esportaPdfBudget:   esportaPdfBudget,
    esportaPdfConsuntivo: esportaPdfConsuntivo
  };

})();
