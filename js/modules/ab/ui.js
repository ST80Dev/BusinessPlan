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
  let _lastParsed             = null;
  let _lastMapping            = null;
  let _lastStorico            = null;
  let _lastPreservati         = 0;  // # scelte manuali di mappatura preservate dal precedente import
  let _lastClassificazione    = null; // mappa { codiceMastro: 'sp'|'ce'|'ignora' } dell'ultima conferma
  let _lastMastriRimanenze    = null; // string[] mastri marcati come variazione rimanenze

  /* Stato della modale di classificazione mastri (Step "anteprima
     mastri" prima del parse vero e proprio). Popolato da
     _processaArrayBuffer e consumato da confermaModaleClassifica. */
  let _modaleClassifica = null; // { analisi, fileName, classificazione, mastriRimanenze }

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

  // Numero intero puro (ore, conteggi) con separatore migliaia, senza valuta.
  function _fmtNum0(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
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
      const analisi = ExcelImport.analizzaMastri(rows);

      // Nessuna decisione automatica: l'operatore conferma sempre la
      // classificazione dei mastri nella modale di anteprima, anche
      // sui file "tipici". Sui re-import del medesimo cliente la
      // modale ripropone la scelta precedente (vedi
      // meta.classificazione_mastri).
      _aperturaModaleClassifica(analisi, fileName);
    } catch (err) {
      console.error(err);
      UI.mostraNotifica('Errore nel parsing del file: ' + err.message, 'error');
    }
  }

  /* ──────────────────────────────────────────────────────────
     MODALE ANTEPRIMA CLASSIFICAZIONE MASTRI

     Sostituisce la vecchia logica pivot-based (54/00/000) con una
     scelta esplicita per ciascun mastro del file. Funziona anche su
     bilanci di SNC/affitti con SP minimale e su file in cui le righe
     SP non sono in cima al foglio.

     Stato precompilato sul re-import: se il progetto corrente ha già
     una scelta (`meta.classificazione_mastri`, `meta.mastri_rimanenze`)
     i dropdown e i toggle ripartono da lì invece che dai default.
     ────────────────────────────────────────────────────────── */

  function _aperturaModaleClassifica(analisi, fileName) {
    const progetto = Projects.getProgetto();
    const sceltePrec = (progetto && progetto.meta && progetto.meta.classificazione_mastri) || {};
    const rimPrec    = (progetto && progetto.meta && progetto.meta.mastri_rimanenze)
      ? progetto.meta.mastri_rimanenze.slice()
      : ExcelImport.MASTRI_VARIAZIONE_RIMANENZE.slice();

    const classificazione = {};
    analisi.mastri.forEach(m => {
      classificazione[m.codice] = sceltePrec[m.codice] || m.classificazione_default;
    });

    // Mastri rimanenze: tieni solo quelli effettivamente presenti nel file
    const codiciPresenti = new Set(analisi.mastri.map(m => m.codice));
    const mastriRimanenze = rimPrec.filter(c => codiciPresenti.has(c));

    _modaleClassifica = { analisi, fileName, classificazione, mastriRimanenze };
    _renderModaleClassifica();
    UI.openModal('modal-ab-classifica-mastri');
  }

  function _renderModaleClassifica() {
    const body = document.getElementById('ab-classifica-body');
    if (!body || !_modaleClassifica) return;

    const { analisi, fileName, classificazione, mastriRimanenze } = _modaleClassifica;
    const rimSet = new Set(mastriRimanenze);

    let rows = '';
    analisi.mastri.forEach(m => {
      const cls    = classificazione[m.codice];
      const isRim  = rimSet.has(m.codice);
      const isCE   = (cls === 'ce');
      const rowCls = 'ab-cls-row ab-cls-row-' + cls;
      rows += `
        <tr class="${rowCls}">
          <td class="ab-cls-cod">${_escapeHtml(m.codice)}</td>
          <td class="ab-cls-descr" title="${_escapeHtml(m.descrizione_rappresentativa)}">${_escapeHtml(m.descrizione_rappresentativa || '—')}</td>
          <td class="ab-cls-num num">${m.numero_sottoconti}</td>
          <td class="ab-cls-sel">
            <select class="form-select ab-cls-select" data-mastro="${_escapeHtml(m.codice)}"
                    onchange="BudgetUI.classificaMastroChange(this)">
              <option value="sp"     ${cls==='sp'    ?'selected':''}>SP (escluso)</option>
              <option value="ce"     ${cls==='ce'    ?'selected':''}>CE (importato)</option>
              <option value="ignora" ${cls==='ignora'?'selected':''}>Ignora</option>
            </select>
          </td>
          <td class="ab-cls-rim">
            <div class="ab-cls-checkbox ${isRim?'checked':''} ${isCE?'':'disabled'}"
                 data-mastro="${_escapeHtml(m.codice)}"
                 onclick="BudgetUI.toggleRimanenze('${_escapeHtml(m.codice)}')"
                 title="${isCE?'Mastro di variazione rimanenze (doppia entry D/A)':'Disponibile solo per mastri CE'}">
              ${isRim ? '✓' : ''}
            </div>
          </td>
        </tr>`;
    });

    body.innerHTML = `
      <div class="ab-cls-meta">
        <div><strong>File:</strong> ${_escapeHtml(fileName || '—')}</div>
        <div><strong>Ditta:</strong> ${_escapeHtml(analisi.ditta || '—')}</div>
        <div><strong>Anni:</strong> ${analisi.anni.join(', ') || '—'}</div>
        <div><strong>Mastri trovati:</strong> ${analisi.mastri.length}</div>
      </div>

      <div class="ab-cls-help">
        Il default propone <strong>01–57 → SP</strong> e <strong>58+ → CE</strong> secondo la
        numerazione standard del piano dei conti italiano. Modifica la classificazione
        di un mastro se nel piano del tuo cliente compare un'eccezione (es. SP
        oltre il 57 o conti CE sotto il 58). La spunta "Variazione rim." identifica i mastri
        in doppia entry D/A da cui si calcolano rimanenze iniziali/finali.
      </div>

      <table class="ab-cls-tab">
        <thead>
          <tr>
            <th>Mastro</th>
            <th>Descrizione esempio</th>
            <th class="num"># cti</th>
            <th>Classificazione</th>
            <th>Variazione rim.</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  /**
   * Handler dropdown classificazione: aggiorna lo stato e ridipinge
   * la riga (la disabilitazione del toggle rimanenze dipende dalla
   * classe scelta).
   */
  function classificaMastroChange(selEl) {
    if (!_modaleClassifica) return;
    const codice = selEl.getAttribute('data-mastro');
    const valore = selEl.value;
    _modaleClassifica.classificazione[codice] = valore;
    // Se sposto fuori da CE, rimuovo l'eventuale flag rimanenze
    if (valore !== 'ce') {
      const idx = _modaleClassifica.mastriRimanenze.indexOf(codice);
      if (idx >= 0) _modaleClassifica.mastriRimanenze.splice(idx, 1);
    }
    _renderModaleClassifica();
  }

  /**
   * Toggle "variazione rimanenze" per un mastro. Attivo solo se il
   * mastro è classificato CE: i sottoconti del mastro contribuiranno
   * a rimanenze_iniziali (somma Dare) e rimanenze_finali (somma Avere)
   * invece che alle macroaree normali.
   */
  function toggleRimanenze(codice) {
    if (!_modaleClassifica) return;
    if (_modaleClassifica.classificazione[codice] !== 'ce') return;
    const arr = _modaleClassifica.mastriRimanenze;
    const i   = arr.indexOf(codice);
    if (i >= 0) arr.splice(i, 1); else arr.push(codice);
    _renderModaleClassifica();
  }

  function annullaModaleClassifica() {
    _modaleClassifica = null;
    UI.closeModal('modal-ab-classifica-mastri');
  }

  /**
   * Conferma la classificazione e prosegue con il flusso di import
   * pre-esistente (default mapping, preservazione scelte manuali,
   * anteprima storico). Salva la scelta in `meta.classificazione_mastri`
   * e `meta.mastri_rimanenze` per pre-popolare la modale al prossimo
   * import dello stesso progetto.
   */
  function confermaModaleClassifica() {
    if (!_modaleClassifica) return;
    const { analisi, fileName, classificazione, mastriRimanenze } = _modaleClassifica;

    const parsed = ExcelImport.applicaClassificazione(analisi, classificazione, mastriRimanenze);

    // La scelta viene tenuta in memoria e persistita solo quando
    // l'utente clicca "Applica al progetto" (vedi applicaImport):
    // così se l'anteprima storico viene annullata, il progetto non
    // viene modificato.
    _lastClassificazione = Object.assign({}, classificazione);
    _lastMastriRimanenze = mastriRimanenze.slice();

    UI.closeModal('modal-ab-classifica-mastri');
    _modaleClassifica = null;

    _proseguiImport(parsed, fileName);
  }

  /**
   * Fase finale dell'import: identica al flusso pre-modale.
   * Calcola mapping default, preserva scelte manuali da import
   * precedente, calcola storico, mostra anteprima.
   */
  function _proseguiImport(parsed, fileName) {
    try {
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

      // Re-import su progetto già popolato: per i codici già visti in
      // un import precedente, le scelte dell'utente (assegnazione manuale
      // a una macroarea, oppure rimozione esplicita della mappatura
      // dallo Step "Mappatura sottoconti") hanno priorità su default e
      // sigle del file. I codici non presenti nei sottoconti precedenti
      // (= conti nuovi) restano gestiti dal default + sigle. Il conteggio
      // dei "non mappati" mostrato nel sommario continuerà quindi a
      // segnalare i nuovi conti che richiedono attenzione.
      const progettoCorr = Projects.getProgetto();
      let preservati = 0;
      if (progettoCorr && Array.isArray(progettoCorr.sottoconti_ce) && progettoCorr.sottoconti_ce.length > 0) {
        const codiciVecchi = new Set(progettoCorr.sottoconti_ce.map(s => s.codice));
        const oldMapping   = progettoCorr.mapping || {};
        for (const s of parsed.sottoconti) {
          if (!codiciVecchi.has(s.codice)) continue;
          const oldTarget = oldMapping[s.codice];
          const newTarget = mapping[s.codice];
          if (oldTarget) {
            if (newTarget !== oldTarget) preservati++;
            mapping[s.codice] = oldTarget;
          } else if (newTarget !== undefined) {
            // Codice già visto e lasciato esplicitamente non mappato:
            // la decisione dell'utente ("non lo voglio classificato")
            // prevale sul default.
            preservati++;
            delete mapping[s.codice];
          }
        }
      }

      const storico = ExcelImport.calcolaStorico(parsed, mapping, macroAree);

      _lastParsed     = parsed;
      _lastMapping    = mapping;
      _lastStorico    = storico;
      _lastPreservati = preservati;

      _renderSummary(parsed, mapping, storico, macroAree, fileName, preservati);
    } catch (err) {
      console.error(err);
      UI.mostraNotifica('Errore nel parsing del file: ' + err.message, 'error');
    }
  }

  /* ──────────────────────────────────────────────────────────
     Anteprima import
     ────────────────────────────────────────────────────────── */
  function _renderSummary(parsed, mapping, storico, macroAree, fileName, preservati) {
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

    if (preservati && preservati > 0) {
      warnHtml += `<div class="ab-import-info">↺ ${preservati} scelte manuali di mappatura preservate dal precedente import.</div>`;
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
    _lastParsed          = null;
    _lastMapping         = null;
    _lastStorico         = null;
    _lastPreservati      = 0;
    _lastClassificazione = null;
    _lastMastriRimanenze = null;
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

    // Salva la classificazione mastri scelta nella modale: serve a
    // pre-popolare la modale al prossimo re-import dello stesso
    // cliente. Lo facciamo qui (e non in confermaModaleClassifica)
    // così se l'utente annulla l'anteprima storico il progetto non
    // resta sporco.
    const progetto = Projects.getProgetto();
    if (progetto && progetto.meta) {
      if (_lastClassificazione) progetto.meta.classificazione_mastri = _lastClassificazione;
      if (_lastMastriRimanenze) progetto.meta.mastri_rimanenze       = _lastMastriRimanenze;
    }

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

    // Numero colonne per riga: 1 (etichetta) + 2 per anno (€ e %) + 1 (Media %)
    const totaleColspan = anni.length * 2 + 2;

    let html = `
      <div class="ab-storico">
        <table class="ab-storico-tab ab-storico-prospetto ab-storico-prospetto-3a">
          <thead>
            <tr>
              <th>Macroarea</th>
              ${anni.map(a => `<th class="num ab-storico-anno-eur">${a} €</th><th class="num ab-storico-anno-pct">${a} %</th>`).join('')}
              <th class="num" title="Media triennale dell'incidenza % sul fatturato di ciascun anno">Media %</th>
            </tr>
          </thead>
          <tbody>
    `;

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

      // Per i ricavi (denominatore) le % sul fatturato sono sempre 100%
      // e poco informative: lasciamo le celle % vuote. Per i derivati
      // mostriamo sempre la %, altrimenti rispettiamo la macroarea.
      const mostraPct = (r.tipo === 'totale' || r.id !== 'ricavi');

      html += `<tr class="${cls}"><td>${_escapeHtml(r.label)}</td>`;
      valori.forEach((v, i) => {
        const display = v * segno;
        html += `<td class="num ab-storico-anno-eur">${_fmtEuro(display)}</td>`;
        const fattAnno = (totali[anni[i]] || {}).fatturato || 0;
        const pctAnno = (mostraPct && fattAnno > 0) ? (v / fattAnno) * segno : null;
        html += `<td class="num ab-storico-anno-pct">${pctAnno != null ? _fmtPct(pctAnno) : ''}</td>`;
      });
      // Media triennale delle % anno per anno
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
          // Non è drop target, ma resta cliccabile per scorrere al gruppo
          // "In rimanenze" nel main (presente solo se ci sono sottoconti).
          const scrollAttr = inRim > 0 ? ' data-scroll-target="__rimanenze__" tabindex="0"' : '';
          html += `
            <div class="ab-mini-box ab-mini-box-readonly"${scrollAttr} title="Calcolato dai mastri 61/80 (${inRim} sottoconti)">
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
    html += `<th>Macroarea</th>`;
    if (!readonly) html += `<th class="ab-sc-azioni-col" title="Elimina sottoconto"></th>`;
    html += `</tr></thead><tbody>`;

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
        if (readonly) {
          html += `<td class="num">${_fmtEuro(importo)}</td>`;
        } else {
          // Importo editabile post-import: modifica la cifra senza
          // dover ritoccare il file Excel di origine. Il valore viene
          // riscritto sul lato Dare/Avere prevalente del conto.
          html += `<td class="num cell-amount"><div class="amount-field ab-sc-valore"
            contenteditable="true" draggable="false" data-placeholder="0"
            data-sc-codice="${_escapeHtml(s.codice)}" data-sc-anno="${_escapeHtml(String(a))}"
            title="Modifica l'importo di questo conto per l'anno ${_escapeHtml(String(a))}"
            onblur="BudgetUI.valoreSottocontoBlur(this)"
            onkeydown="BudgetUI.valoreSottocontoKeyDown(event)">${_fmtEuro(importo)}</div></td>`;
        }
      });
      if (readonly) {
        html += `<td class="ab-mappatura-readonly text-muted">— rimanenze —</td>`;
      } else {
        const cur = (progetto.mapping || {})[s.codice] || '';
        html += `<td>${_dropdownMacroaree(s.codice, cur, macroAree)}</td>`;
        html += `<td class="ab-sc-azioni"><span class="ab-sc-elimina" role="button" tabindex="0"
          draggable="false" data-elimina-sc="${_escapeHtml(s.codice)}"
          title="Elimina questo sottoconto dal progetto">×</span></td>`;
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
      // "×" su una riga sottoconto — elimina il conto importato
      const scDel = ev.target.closest('[data-elimina-sc]');
      if (scDel) {
        ev.preventDefault();
        ev.stopPropagation();
        _eliminaSottocontoConConferma(scDel.dataset.eliminaSc);
        return;
      }
      // Click su un box della mini-CE (sidebar sx) → scorri il main
      // fino al raggruppamento corrispondente. Ignorato se il click
      // è già stato gestito dai controlli "+ Nuovo gruppo" / "×".
      const miniBox = ev.target.closest('.ab-mini-box');
      if (miniBox) {
        const gruppoId = miniBox.dataset.dropMacro || miniBox.dataset.scrollTarget;
        if (gruppoId) _scrollToGruppo(gruppoId);
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

    // Tastiera: Enter/Spazio sulla "×" di un sottoconto lo elimina
    // (coerente con l'accessibilità dei box custom).
    root.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const scDel = ev.target.closest('[data-elimina-sc]');
      if (scDel) {
        ev.preventDefault();
        _eliminaSottocontoConConferma(scDel.dataset.eliminaSc);
        return;
      }
      // Enter/Spazio su un box della mini-CE → scorri al raggruppamento
      const miniBox = ev.target.closest('.ab-mini-box');
      if (miniBox) {
        const gruppoId = miniBox.dataset.dropMacro || miniBox.dataset.scrollTarget;
        if (gruppoId) {
          ev.preventDefault();
          _scrollToGruppo(gruppoId);
        }
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

  /* Scorre la colonna principale fino al raggruppamento indicato e
     lo evidenzia brevemente. Chiamato al click/Enter su un box della
     mini-CE (sidebar sx). Se il gruppo non è presente nel DOM (es.
     "Non mappati" quando è vuoto) l'operazione è un no-op. */
  function _scrollToGruppo(gruppoId) {
    const main = document.querySelector('.ab-mappatura-main');
    if (!main) return;
    const target = main.querySelector(`[data-gruppo="${CSS.escape(gruppoId)}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('ab-gruppo-flash');
    setTimeout(() => target.classList.remove('ab-gruppo-flash'), 1400);
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

  /**
   * Blur su una cella importo editabile della mappatura: salva il
   * nuovo valore sul sottoconto e ricalcola storico + prospetti.
   */
  function valoreSottocontoBlur(el) {
    const codice = el.dataset.scCodice;
    const anno   = el.dataset.scAnno;
    if (!codice || !anno) return;
    const nuovo = _parseEuro((el.textContent || '').trim());
    if (Projects.aggiornaValoreSottoconto(codice, anno, nuovo)) {
      UI.aggiornaStatusBar('modificato');
      renderMacroSezioni();
    }
  }

  function valoreSottocontoKeyDown(e) {
    // Enter/Esc confermano (blur → salvataggio). Blocchiamo il newline.
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      e.target.blur();
    }
  }

  /**
   * Elimina un sottoconto importato previa conferma. Usato sia dal
   * click sulla "×" sia dalla scorciatoia da tastiera (Enter/Spazio).
   */
  function _eliminaSottocontoConConferma(codice) {
    if (!codice) return;
    const prog = Projects.getProgetto();
    const sc = (prog && Array.isArray(prog.sottoconti_ce))
      ? prog.sottoconti_ce.find(x => x.codice === codice)
      : null;
    const descr = sc && sc.descrizione ? ' — ' + sc.descrizione : '';
    if (!confirm(`Eliminare il sottoconto "${codice}${descr}"?\n\nIl conto viene rimosso dal progetto e lo storico ricalcolato. Il file Excel di origine non viene modificato.`)) return;
    if (Projects.eliminaSottoconto(codice)) {
      UI.aggiornaStatusBar('modificato');
      renderMacroSezioni();
    }
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
   * Valore "Ultimo anno €" della singola macroarea — riferimento storico
   * fisso, indipendente dal fatturato ipotizzato:
   *   - proventi/oneri straordinari: 0 (natura non ricorrente)
   *   - rimanenze (calcolato): media storica degli importi €
   *   - tutti gli altri (ricavi, costi variabili, costi fissi, imposte):
   *     ultimo esercizio storico arrotondato al centinaio.
   */
  function _baseStoricaVoce(macroSezioni, b, id) {
    const m = (macroSezioni || []).find(x => x.id === id);
    const dato = b.valori[id];
    if (!dato) return 0;
    if (m && m.sezione === 'prov_oneri_straord') return 0;
    if (m && m.calcolato) return dato.media_euro || 0;
    return dato.ultimo_anno_euro || 0;
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
    const seed = BudgetEngine.calcolaSeedFatturato(progetto);
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

    // Comportamento per voce (Fisso/Variabile) — il tipo di input della
    // riga (€ vs %) e la presenza del toggle F/V dipendono dal var_fisso
    // *corrente* della voce, non dal valore statico dello schema. Una voce
    // di costo (sezioni variabili/fissi, non calcolata) può essere
    // stagionalizzata a piacere: se 'variabile' si edita in % sul
    // fatturato, se 'fisso' in € — restando nel suo gruppo di
    // appartenenza (e quindi nel/fuori dal costo del venduto per
    // costruzione). Vedi Projects.impostaComportamentoMacro.
    righe.forEach(r => {
      if (r.tipo !== 'macro') return;
      const m = (progetto.macro_sezioni || []).find(x => x.id === r.id);
      if (!m) return;
      const togglable = m.tipo === 'costo'
        && (m.sezione === 'variabili' || m.sezione === 'fissi')
        && !m.calcolato;
      if (!togglable) return;
      r.togglable = true;
      r.varFisso  = m.var_fisso;
      r.sezione   = m.sezione;
      // Input coerente col comportamento: variabile → %, fisso → €.
      r.inputType = m.var_fisso === 'variabile' ? 'pct' : 'euro';
    });

    // Medie storiche in € dei derivati per la colonna "Media" sulle
    // righe-totale. Sulle righe macroarea l'engine espone già
    // dato.media_euro (con lo stesso filtro). Filtriamo qui agli anni
    // effettivamente importati (ricavi > 0) per non dividere per il
    // numero di colonne quando un esercizio non è stato caricato.
    const totaliStorico = _calcolaTotaliStorico(progetto);
    const anniReali = (b.anni_reali && b.anni_reali.length > 0)
      ? b.anni_reali
      : ((progetto.meta && progetto.meta.anni_storici) || []).filter(a => (totaliStorico[a] || {}).fatturato > 0);
    const medieEuroDerivati = {};
    ['fatturato','cdv','totVar','mdc','fissi','totCosti','provOneriStraordNetto','utileAnteImposte','imposte','utileNetto'].forEach(k => {
      const vals = anniReali.map(a => (totaliStorico[a] || {})[k] || 0);
      medieEuroDerivati[k] = vals.length > 0 ? vals.reduce((s,v) => s+v, 0) / vals.length : 0;
    });
    // Etichetta dinamica per l'intestazione di colonna: lista compatta
    // degli anni a due cifre. Es. [2023,2024,2025] -> "'23–'24–'25";
    // [2024,2025] -> "'24–'25"; [2025] -> "'25" (col header diventa
    // "Solo '25" perché la media di un solo valore non è significativa).
    const yy = y => "'" + String(y).slice(-2);
    const mediaHeader = anniReali.length === 0
      ? 'Media'
      : anniReali.length === 1
        ? 'Solo ' + yy(anniReali[0])
        : 'Media ' + anniReali.map(yy).join('–');
    const mediaHeaderTitle = anniReali.length <= 1
      ? 'Valore dell\'unico anno storico importato (la media non è significativa con un solo esercizio).'
      : `Media degli importi € sugli anni storici importati (${anniReali.join(', ')}), riferimento informativo per le decisioni di budget.`;

    // KPI: differenze percentuali fatturato vs ultimo fatturato storico
    // (arrotondato al centinaio, base del budget teorico) e vs break-even
    const fattBase = b.fatturato_ultimo_arrotondato;
    const deltaFattBase = fattBase > 0 ? (b.fatturato - fattBase) / fattBase : 0;
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
              Ultimo fatturato${b.ultimo_anno ? ' (' + b.ultimo_anno + ')' : ''} arrotondato: ${_fmtEuro(fattBase)} ${fattBase > 0 ? `(${_fmtPctSigned(deltaFattBase)} vs ipotizzato)` : ''}
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

        ${_renderSeedPanel(progetto, seed, b)}

        <table class="ab-storico-tab ab-storico-prospetto ab-budget-tab">
          <thead>
            <tr>
              <th>Macroarea</th>
              <th class="num" title="${_escapeHtml(mediaHeaderTitle)}">${_escapeHtml(mediaHeader)}</th>
              <th class="num" title="Incidenza % media sul fatturato calcolata come media delle incidenze % di ciascun anno storico importato.">% storica</th>
              <th class="num" title="Riferimento storico (ultimo esercizio importato arrotondato al centinaio per ricavi, costi variabili, costi fissi e imposte; media € per rimanenze; 0 per proventi/oneri straordinari). Indipendente dal fatturato ipotizzato — il quale impatta solo la colonna Budget €.">Ultimo anno €</th>
              <th class="ab-comp-col" title="Comportamento di calcolo della voce di costo. Fisso: importo € ancorato allo storico, ripartito nel tempo. Variabile: stagionalizzato coi ricavi (% sul fatturato). Cambia solo il calcolo, non la collocazione: la voce resta nel suo gruppo e la sua appartenenza al costo del venduto non cambia.">Comportamento</th>
              <th class="num">Override</th>
              <th class="num">Budget €</th>
              <th class="num">Budget %</th>
            </tr>
          </thead>
          <tbody>
    `;

    const totaleColspan = 8;

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
        const valMediaTri = medieEuroDerivati[r.id] || 0;
        const cls = `ab-prospetto-tot ab-prospetto-tot-${r.evidenza || 'arancio'}`;
        html += `<tr class="${cls}">
          <td>${_escapeHtml(r.label)}</td>
          <td class="num">${_fmtEuroInt(valMediaTri * segno)}</td>
          <td class="num">${_fmtPct(pctBase * segno)}</td>
          <td class="num">${_fmtEuroInt(valBase * segno)}</td>
          <td class="ab-comp-col"></td>
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

      // Colonna "Ultimo anno €" = riferimento storico fisso, indipendente
      // dal fatturato ipotizzato (che impatta solo la colonna Budget €):
      //   - straordinari: 0 (natura non ricorrente)
      //   - calcolato (rim_ini/rim_fin): media € storica
      //   - tutti gli altri (ricavi, costi variabili, costi fissi, imposte):
      //     ultimo esercizio storico importato arrotondato al centinaio.
      //     I costi variabili usano la stessa logica dei fissi così la
      //     colonna resta ferma quando si rettifica il fatturato.
      const isStraord = m && m.sezione === 'prov_oneri_straord';
      const isCalc = m && m.calcolato;
      const baseDisplay = isStraord ? 0
        : isCalc ? (dato.media_euro || 0)
        : (dato.ultimo_anno_euro || 0);
      const baseTitle   = isStraord
        ? 'Default 0 (voce di natura non ricorrente — usare l\'override per forzare un valore)'
        : isCalc
            ? 'Media storica degli importi €'
            : `Ultimo anno storico arrotondato al centinaio${b.ultimo_anno ? ' (' + b.ultimo_anno + ')' : ''}`;
      const mediaTriDisplay = (dato.media_euro || 0);

      const note = (progetto.budget && progetto.budget.note) || {};
      const notaTesto = (note[r.id] || '').trim();
      const notaPresente = notaTesto.length > 0;
      const notaAperta = _budgetNoteAperte.has(r.id);

      // Badge "var"/"fisso": mostrato solo quando il comportamento
      // diverge dalla convenzione del gruppo (voce nei Fissi trattata da
      // variabile, o nei Variabili trattata da fissa). Spiega a colpo
      // d'occhio perché una riga dei Costi fissi scala col fatturato (o
      // viceversa).
      const _diverge = r.togglable && (
        (r.sezione === 'fissi'     && r.varFisso === 'variabile') ||
        (r.sezione === 'variabili' && r.varFisso === 'fisso'));
      const badge = !_diverge ? '' : (r.varFisso === 'variabile'
        ? `<span class="ab-budget-badge ab-budget-badge-var" title="Comportamento variabile: stagionalizzato coi ricavi (% sul fatturato), pur restando nel gruppo Costi fissi e fuori dal costo del venduto.">var</span>`
        : `<span class="ab-budget-badge ab-budget-badge-fix" title="Comportamento fisso: importo € pro-rata sul tempo, pur restando nel gruppo Costi variabili (dentro il costo del venduto).">fisso</span>`);

      html += `<tr class="${fonteCls}${notaPresente ? ' ab-budget-row-has-note' : ''}">
        <td>${_escapeHtml(r.label)}${badge}</td>
        <td class="num" title="${_escapeHtml(mediaHeaderTitle)}">${_fmtEuroInt(mediaTriDisplay)}</td>
        <td class="num">${_fmtPct(dato.media_pct)}</td>
        <td class="num" title="${baseTitle}">${_fmtEuroInt(baseDisplay)}</td>
        <td class="ab-comp-col">${r.togglable ? _renderFvToggle(r) : ''}</td>
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

    html += '</tbody></table>';
    html += _renderSociBlock(progetto, b);
    html += '</div>';
    c.innerHTML = html;
  }

  /**
   * Pannello "Budget da dati in corso d'anno" — seed del fatturato per
   * società senza storico. Visibile solo quando ci sono mesi consuntivati
   * (seed.disponibile). Consente di scegliere il mese di avvio attività e
   * di annualizzare il run-rate su due orizzonti (primo anno parziale /
   * anno a regime), scrivendo il valore su fatturato_ipotizzato.
   */
  function _renderSeedPanel(progetto, seed, b) {
    if (!seed || !seed.disponibile) return '';

    const meseAvvio = seed.mese_avvio || 1;
    const opts = _MESI.map((nome, i) =>
      `<option value="${i + 1}"${(i + 1) === meseAvvio ? ' selected' : ''}>${nome}</option>`
    ).join('');

    // Se l'avvio è a gennaio, primo-anno e regime coincidono (12 mesi):
    // mostriamo un solo bottone di annualizzazione. Altrimenti entrambi.
    const parziale = seed.seed_parziale;
    const regime   = seed.seed_regime;
    const unMese   = meseAvvio === 1 || parziale === regime;

    const btnParziale = `<div class="ab-seed-btn" role="button" tabindex="0"
           title="Imposta il fatturato ipotizzato = run-rate × mesi da avvio a dicembre (${seed.mesi_operativi_anno} mesi)"
           onclick="BudgetUI.applicaSeed('parziale')"
           onkeydown="BudgetUI.seedBtnKeyDown(event, 'parziale')">
        <span class="ab-seed-btn-label">Primo anno (avvio→dic, ${seed.mesi_operativi_anno} mesi)</span>
        <span class="ab-seed-btn-val">${_fmtEuroInt(parziale)}</span>
      </div>`;
    const btnRegime = `<div class="ab-seed-btn" role="button" tabindex="0"
           title="Imposta il fatturato ipotizzato = run-rate × 12 mesi (anno intero a regime)"
           onclick="BudgetUI.applicaSeed('regime')"
           onkeydown="BudgetUI.seedBtnKeyDown(event, 'regime')">
        <span class="ab-seed-btn-label">${unMese ? 'Annualizza (×12)' : 'Anno a regime (×12)'}</span>
        <span class="ab-seed-btn-val">${_fmtEuroInt(regime)}</span>
      </div>`;

    return `
      <div class="ab-seed-panel">
        <div class="ab-seed-head">
          <span class="ab-seed-title">Budget da dati in corso d'anno</span>
          <span class="ab-seed-hint text-muted">Società senza storico: annualizza i mesi già inseriti nel Consuntivo per proporre il fatturato di budget.</span>
        </div>
        <div class="ab-seed-body">
          <div class="ab-seed-field">
            <label class="ab-seed-label">Mese di avvio attività</label>
            <select class="form-select ab-seed-select"
                    onchange="BudgetUI.cambiaMeseAvvio(this.value)">${opts}</select>
          </div>
          <div class="ab-seed-info text-muted">
            Consuntivato <strong>${_fmtEuroInt(seed.fatturato_ytd)}</strong> su <strong>${seed.mesi_attivi}</strong> ${seed.mesi_attivi === 1 ? 'mese' : 'mesi'} operativi → run-rate <strong>${_fmtEuroInt(seed.run_rate_mensile)}</strong>/mese
          </div>
          <div class="ab-seed-actions">
            ${unMese ? btnRegime : btnParziale + btnRegime}
          </div>
        </div>
      </div>`;
  }

  /**
   * Blocco "Reddito normalizzato — lavoro dei soci". Imputa un costo
   * figurativo (ore × tariffa) al lavoro dei soci non retribuiti, tenuto
   * SEPARATO dal CE civilistico e dalle imposte. Mostra:
   *   Utile netto − costo figurativo = reddito normalizzato
   * più i KPI di produttività oraria (ricavi/ora, MdC/ora) e il break-even
   * che remunera anche i soci. Tutti i valori derivano dall'engine
   * (b.lavoro_soci, b.reddito_normalizzato, ...).
   */
  function _renderSociBlock(progetto, b) {
    const soci = b.lavoro_soci || { attivo: false, righe: [], ore_totali: 0, costo_figurativo: 0 };
    const attivo = soci.attivo;
    const righe = soci.righe || [];

    let righeHtml = '';
    righe.forEach(r => {
      const id = _escapeHtml(r.id);
      righeHtml += `<tr class="ab-soci-riga">
        <td>
          <div class="amount-field ab-soci-input ab-soci-input-nome"
               contenteditable="true"
               data-socio-id="${id}" data-socio-campo="nome"
               data-placeholder="Nome socio"
               onblur="BudgetUI.socioBlur(this)"
               onkeydown="BudgetUI.budgetKeyDown(event)">${_escapeHtml(r.nome || '')}</div>
        </td>
        <td class="num">
          <div class="amount-field ab-soci-input"
               contenteditable="true"
               data-socio-id="${id}" data-socio-campo="ore"
               data-placeholder="0"
               onblur="BudgetUI.socioBlur(this)"
               onkeydown="BudgetUI.budgetKeyDown(event)">${r.ore ? _fmtNum0(r.ore) : ''}</div>
        </td>
        <td class="num">
          <div class="amount-field ab-soci-input"
               contenteditable="true"
               data-socio-id="${id}" data-socio-campo="tariffa"
               data-placeholder="0"
               onblur="BudgetUI.socioBlur(this)"
               onkeydown="BudgetUI.budgetKeyDown(event)">${r.tariffa ? _fmtEuro(r.tariffa) : ''}</div>
        </td>
        <td class="num ab-soci-costo">${_fmtEuroInt(r.costo || 0)}</td>
        <td class="ab-soci-del">
          <span class="ab-soci-del-btn" role="button" tabindex="0"
                title="Elimina questo socio"
                onclick="BudgetUI.eliminaSocio('${id}')"
                onkeydown="BudgetUI.eliminaSocioKeyDown(event, '${id}')">🗑</span>
        </td>
      </tr>`;
    });

    const costo = soci.costo_figurativo || 0;
    const reddito = b.reddito_normalizzato;
    const redditoCls = reddito >= 0 ? 'ab-kpi-verde' : 'ab-kpi-rosso';

    const kpiOra = (attivo && soci.ore_totali > 0) ? `
      <div class="ab-soci-kpi-row">
        <div class="ab-soci-kpi"><span class="ab-soci-kpi-label">Ore totali</span><span class="ab-soci-kpi-val">${_fmtNum0(soci.ore_totali)}</span></div>
        <div class="ab-soci-kpi"><span class="ab-soci-kpi-label">Ricavi / ora</span><span class="ab-soci-kpi-val">${_fmtEuroInt(b.ricavi_ora)}</span></div>
        <div class="ab-soci-kpi"><span class="ab-soci-kpi-label">MdC / ora</span><span class="ab-soci-kpi-val">${_fmtEuroInt(b.mdc_ora)}</span></div>
        <div class="ab-soci-kpi"><span class="ab-soci-kpi-label">Break-even coi soci</span><span class="ab-soci-kpi-val">${b.break_even_soci != null ? _fmtEuroInt(b.break_even_soci) : '—'}</span></div>
      </div>` : '';

    const corpo = attivo ? `
      <div class="ab-soci-desc text-muted">Costo figurativo del lavoro dei soci (ore × tariffa oraria). Non entra nel Conto Economico civilistico né incide sulle imposte: serve solo a valutare la redditività al netto di un giusto compenso al lavoro dei soci.</div>
      <table class="ab-soci-tab">
        <thead>
          <tr>
            <th>Socio</th>
            <th class="num">Ore</th>
            <th class="num">€/ora</th>
            <th class="num">Costo figurativo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${righeHtml || `<tr class="ab-soci-empty"><td colspan="5" class="text-muted">Nessun socio inserito. Aggiungi un socio per conteggiare il costo figurativo del lavoro.</td></tr>`}
        </tbody>
      </table>
      <div class="ab-soci-add" role="button" tabindex="0"
           onclick="BudgetUI.aggiungiSocio()"
           onkeydown="BudgetUI.aggiungiSocioKeyDown(event)">+ Aggiungi socio</div>

      <div class="ab-soci-summary">
        <div class="ab-soci-sum-row"><span>Utile netto (da budget)</span><span class="num">${_fmtEuroInt(b.utileNetto)}</span></div>
        <div class="ab-soci-sum-row"><span>− Costo figurativo lavoro soci</span><span class="num">${_fmtEuroInt(costo)}</span></div>
        <div class="ab-soci-sum-row ab-soci-sum-tot ${redditoCls}"><span>= Reddito normalizzato</span><span class="num">${_fmtEuroInt(reddito)}</span></div>
      </div>
      ${kpiOra}
    ` : `
      <div class="ab-soci-desc text-muted">Per società i cui unici lavoratori sono i soci non retribuiti (costo del personale civilistico = 0), attiva questo blocco per imputare un costo figurativo al loro lavoro (ore × tariffa) e ottenere il reddito normalizzato. Non modifica il CE né le imposte.</div>
      <div class="ab-soci-add" role="button" tabindex="0"
           onclick="BudgetUI.aggiungiSocio()"
           onkeydown="BudgetUI.aggiungiSocioKeyDown(event)">+ Aggiungi socio e attiva</div>
    `;

    return `
      <div class="ab-soci-block">
        <div class="ab-soci-head">
          <div class="ab-soci-title">Reddito normalizzato — lavoro dei soci</div>
          <div class="ab-soci-switch ${attivo ? 'ab-soci-switch-on' : ''}"
               role="button" tabindex="0"
               title="${attivo ? 'Disattiva il conteggio del costo figurativo' : 'Attiva il conteggio del costo figurativo'}"
               onclick="BudgetUI.toggleLavoroSoci()"
               onkeydown="BudgetUI.toggleLavoroSociKeyDown(event)">${attivo ? 'Attivo' : 'Disattivato'}</div>
        </div>
        ${corpo}
      </div>`;
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

  /**
   * Controllo segmentato Fisso/Var per il comportamento della voce di
   * costo, mostrato nella colonna "Comportamento" del budget.
   *   Fisso = importo € pro-rata sul tempo
   *   Var   = variabile stagionalizzato coi ricavi (% sul fatturato)
   * Cambia solo il comportamento di calcolo: la voce resta nel suo gruppo
   * (Variabili/Fissi) e quindi la sua appartenenza al costo del venduto
   * non cambia. Vedi Projects.impostaComportamentoMacro e il badge di
   * divergenza sulla riga.
   */
  function _renderFvToggle(r) {
    const isVar = r.varFisso === 'variabile';
    const idEsc = _escapeHtml(r.id);
    return `<div class="ab-fv" role="group" aria-label="Comportamento costo: fisso o variabile">
      <span class="ab-fv-seg${!isVar ? ' ab-fv-seg-active' : ''}"
            role="button" tabindex="0"
            title="Tratta come costo fisso: importo € ancorato allo storico, pro-rata sul tempo"
            aria-label="Fisso" aria-pressed="${!isVar}"
            onclick="BudgetUI.impostaComportamento('${idEsc}','fisso')"
            onkeydown="BudgetUI.comportamentoKeyDown(event,'${idEsc}','fisso')">Fisso</span>
      <span class="ab-fv-seg${isVar ? ' ab-fv-seg-active' : ''}"
            role="button" tabindex="0"
            title="Tratta come variabile stagionalizzato: % sul fatturato, scala coi ricavi"
            aria-label="Variabile" aria-pressed="${isVar}"
            onclick="BudgetUI.impostaComportamento('${idEsc}','variabile')"
            onkeydown="BudgetUI.comportamentoKeyDown(event,'${idEsc}','variabile')">Var</span>
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

  /* ──────────────────────────────────────────────────────────
     Seed budget (società senza storico) + lavoro soci
     ────────────────────────────────────────────────────────── */

  /** Cambia il mese di avvio attività e ricalcola il budget. */
  function cambiaMeseAvvio(value) {
    const m = parseInt(value, 10);
    Projects.aggiornaMetaAB('mese_avvio', m);
    UI.aggiornaStatusBar('modificato');
    renderBudget();
  }

  /**
   * Applica il seed del fatturato: scrive su fatturato_ipotizzato il valore
   * annualizzato dai mesi consuntivati. modo = 'parziale' (avvio→dic) |
   * 'regime' (×12). Chiede conferma se sovrascrive un valore già impostato.
   */
  function applicaSeed(modo) {
    const progetto = Projects.getProgetto();
    if (!progetto) return;
    const seed = BudgetEngine.calcolaSeedFatturato(progetto);
    if (!seed.disponibile) return;
    const val = modo === 'parziale' ? seed.seed_parziale : seed.seed_regime;
    const cur = progetto.budget && progetto.budget.fatturato_ipotizzato;
    if (typeof cur === 'number' && isFinite(cur) && cur > 0 && cur !== val) {
      if (!confirm(`Il fatturato ipotizzato attuale (${_fmtEuroInt(cur)} €) verrà sostituito con ${_fmtEuroInt(val)} €. Procedere?`)) return;
    }
    Projects.aggiornaBudget('fatturato_ipotizzato', val);
    UI.aggiornaStatusBar('modificato');
    renderBudget();
  }

  function seedBtnKeyDown(e, modo) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      applicaSeed(modo);
    }
  }

  /** Attiva/disattiva il blocco costo figurativo soci. */
  function toggleLavoroSoci() {
    const progetto = Projects.getProgetto();
    if (!progetto) return;
    const cur = progetto.lavoro_soci && progetto.lavoro_soci.attivo;
    Projects.lavoroSociToggle(!cur);
    UI.aggiornaStatusBar('modificato');
    renderBudget();
  }

  function toggleLavoroSociKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleLavoroSoci();
    }
  }

  /** Aggiunge una riga socio e mette il focus sul nome. */
  function aggiungiSocio() {
    const id = Projects.lavoroSociAddRiga();
    UI.aggiornaStatusBar('modificato');
    renderBudget();
    if (id) {
      const el = document.querySelector('[data-socio-id="' + id + '"][data-socio-campo="nome"]');
      if (el) el.focus();
    }
  }

  function aggiungiSocioKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      aggiungiSocio();
    }
  }

  /** Elimina una riga socio. */
  function eliminaSocio(id) {
    Projects.lavoroSociRemoveRiga(id);
    UI.aggiornaStatusBar('modificato');
    renderBudget();
  }

  function eliminaSocioKeyDown(e, id) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      eliminaSocio(id);
    }
  }

  /**
   * Salva il blur di una cella socio. campo = 'nome' (testo) |
   * 'ore' | 'tariffa' (numeri, parse € tollerante ai separatori).
   */
  function socioBlur(el) {
    const id = el.dataset.socioId;
    const campo = el.dataset.socioCampo;
    const txt = (el.textContent || '').trim();
    const val = campo === 'nome' ? txt : _parseEuro(txt);
    Projects.lavoroSociUpdateRiga(id, campo, val);
    UI.aggiornaStatusBar('modificato');
    renderBudget();
  }

  /**
   * Imposta il comportamento (Fisso/Variabile) di una voce di costo dal
   * toggle F/V del budget. Forza il blur del campo attivo prima del
   * re-render (regola UI del progetto), così eventuali override appena
   * digitati non vengono persi. L'override € e quello % restano
   * memorizzati separatamente per id: cambiando comportamento si passa
   * dall'uno all'altro senza perdere il valore inserito nell'altra unità.
   */
  function impostaComportamento(macroId, varFisso) {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    const ok = Projects.impostaComportamentoMacro(macroId, varFisso);
    if (ok) {
      UI.aggiornaStatusBar('modificato');
      renderBudget();
    }
  }

  function comportamentoKeyDown(e, macroId, varFisso) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      impostaComportamento(macroId, varFisso);
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

    // Opzioni mese di avvio attività (1-12). Con avvio > gennaio i mesi
    // precedenti sono "pre-avvio": non editabili e non conteggiati.
    const avvioOpts = _MESI.map((nome, i) =>
      `<option value="${i + 1}"${(i + 1) === pre.mese_avvio ? ' selected' : ''}>${nome}</option>`
    ).join('');
    const denomOperativi = pre.periodi_operativi != null ? pre.periodi_operativi : pre.periodi_totali;

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
              <div class="ab-freq-selector"
                   title="Lineare: la proiezione fine anno estrapola il consuntivato in proporzione al tempo trascorso. Stagionalizzata: per i periodi aperti usa il valore atteso inserito a mano nella riga 'Ricavi attesi', adatto alle attività stagionali.">
                <span class="text-muted">Distribuzione ricavi:</span>
                <div class="ab-freq-toggle">
                  <div class="ab-freq-opt ${pre.modalita_proiezione === 'lineare' ? 'active' : ''}"
                       onclick="BudgetUI.cambiaModalitaProiezione('lineare')">Lineare</div>
                  <div class="ab-freq-opt ${pre.modalita_proiezione === 'stagionalizzata' ? 'active' : ''}"
                       onclick="BudgetUI.cambiaModalitaProiezione('stagionalizzata')">Stagionalizzata</div>
                </div>
                ${pre.modalita_proiezione === 'stagionalizzata' ? `
                <span class="ab-distrib-pct-trigger"
                      role="button" tabindex="0"
                      title="Apri la distribuzione per percentuali: pesi % che sommano 100, applicati al fatturato di budget per riempire i periodi della riga 'Ricavi attesi'."
                      onclick="BudgetUI.apriDistribuisciPct()"
                      onkeydown="BudgetUI.distribuisciPctKeyDown(event)">⇩ Distribuisci da %</span>
                ` : ''}
              </div>
              <div class="ab-freq-selector"
                   title="Mese di avvio attività. Per società costituite in corso d'anno: i mesi precedenti non esistono e non concorrono al calcolo (run-rate e costi pro-rata partono dall'avvio).">
                <span class="text-muted">Avvio attività:</span>
                <select class="form-select ab-avvio-select"
                        onchange="BudgetUI.cambiaMeseAvvioConsuntivo(this.value)">${avvioOpts}</select>
              </div>
              <div class="ab-consuntivo-stats text-muted">
                <span title="Periodi operativi trascorsi da avvio fino all'ultimo mese con ricavo inserito: i mesi intermedi a ricavo zero contano comunque come trascorsi (i loro costi fissi sono conteggiati); i mesi precedenti all'avvio e quelli successivi all'orizzonte non sono conteggiati."><strong>${pre.periodi_chiusi}</strong> / ${denomOperativi} periodi operativi</span>
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
                const vp = pre.per_periodo[k] || {};
                const isChiuso = vp.inserito;
                const preAvvio = vp.pre_avvio;
                return `<th class="num ab-col-periodo ${preAvvio ? 'ab-col-periodo-preavvio' : ''} ${isChiuso ? 'ab-col-periodo-chiuso' : ''}" title="${preAvvio ? 'Precedente all\'avvio attività' : _escapeHtml(periodi[i])}">${_escapeHtml(periodiBrevi[i])}</th>`;
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
        const preAvvio = vp.pre_avvio;
        const periodCls = `num ab-col-periodo ${preAvvio ? 'ab-col-periodo-preavvio' : ''} ${isChiuso ? 'ab-col-periodo-chiuso' : ''}`;
        // Mesi precedenti all'avvio: cella non editabile e non valorizzata.
        if (preAvvio) {
          return `<td class="${periodCls}" title="Precedente all'avvio attività">—</td>`;
        }
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

      // Riga "Ricavi attesi" — visibile solo in modalità stagionalizzata,
      // posizionata subito sotto la macro ricavi. Le celle per periodo sono
      // editabili (€ atteso); le colonne sticky mostrano: budget annuale
      // (riferimento), somma degli attesi inseriti, scostamento vs budget.
      // Un piccolo bottone "Distribuisci da %" apre una modale che spalma
      // il fatturato budget sui periodi secondo pesi % che devono fare 100.
      const isRicaviMacro = r.tipo === 'macro' && r.id === 'ricavi';
      if (isRicaviMacro && pre.modalita_proiezione === 'stagionalizzata') {
        const attesoTot   = pre.fatturato_atteso_tot || 0;
        const budgetFatt  = pre.budget.fatturato || 0;
        const dAtteso     = _delta(attesoTot, budgetFatt);
        const celleAtt = periodiKeys.map(k => {
          const vp = pre.per_periodo[k] || {};
          // Mesi precedenti all'avvio: cella attesa non editabile.
          if (vp.pre_avvio) {
            return `<td class="num ab-col-periodo ab-col-periodo-preavvio ab-col-periodo-atteso" title="Precedente all'avvio attività">—</td>`;
          }
          const valore = vp.atteso;
          const display = (typeof valore === 'number' && valore > 0) ? _fmtEuroInt(valore) : '';
          const periodCls = `num ab-col-periodo ab-col-periodo-atteso`;
          return `<td class="${periodCls}">
            <div class="amount-field ab-periodo-input-cell ab-periodo-input-atteso"
                 contenteditable="true"
                 data-cons-field="fatturato_atteso.${k}"
                 data-input-type="euro"
                 data-placeholder="0"
                 onblur="BudgetUI.attesoBlur(this)"
                 onkeydown="BudgetUI.budgetKeyDown(event)">${display}</div>
          </td>`;
        }).join('');
        html += `<tr class="ab-consuntivo-atteso-row">
          <td class="ab-col-stick ab-col-stick-1">
            <span class="ab-consuntivo-atteso-label">Ricavi attesi (€)</span>
          </td>
          <td class="num ab-col-stick ab-col-stick-2 ab-cell-muted">${_fmtEuroInt(budgetFatt)}</td>
          <td class="num ab-col-stick ab-col-stick-3">${attesoTot > 0 ? _fmtEuroInt(attesoTot) : ''}</td>
          <td class="num ab-col-stick ab-col-stick-4">${attesoTot > 0 ? _fmtDelta(dAtteso, +1, true) : ''}</td>
          ${celleAtt}
        </tr>`;
      }
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

  /**
   * Cambia il mese di avvio attività dalla vista Consuntivo, preservando
   * lo scroll orizzontale della tabella.
   */
  function cambiaMeseAvvioConsuntivo(value) {
    const m = parseInt(value, 10);
    Projects.aggiornaMetaAB('mese_avvio', m);
    UI.aggiornaStatusBar('modificato');
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

    // Conferma prima di azzerare i valori inseriti (fatturato consuntivo
    // o attesi stagionalizzati: hanno entrambi indici di periodo distinti
    // tra mensile e trimestrale).
    const c = progetto.consuntivo || {};
    const haCons = c.fatturato && Object.values(c.fatturato).some(v => v > 0);
    const haAtt  = c.fatturato_atteso && Object.values(c.fatturato_atteso).some(v => v > 0);
    if (haCons || haAtt) {
      if (!confirm('Cambiando frequenza i valori già inseriti (consuntivo e attesi) verranno azzerati. Procedere?')) return;
    }

    Projects.aggiornaConsuntivo('frequenza', freq);
    UI.aggiornaStatusBar('modificato');
    renderConsuntivo();
  }

  /**
   * Cambia la modalità di proiezione del fatturato:
   *   'lineare'         → estrapolazione yt-d / frazione_anno (default)
   *   'stagionalizzata' → mix consuntivo (periodi chiusi) + attesi inseriti
   *                       a mano (periodi aperti). Adatto ai casi stagionali.
   * Il toggle è sempre disponibile: lo switch non azzera i valori, così
   * l'operatore può confrontare a colpo d'occhio l'effetto sulle KPI.
   */
  function cambiaModalitaProiezione(mod) {
    const progetto = Projects.getProgetto();
    if (!progetto) return;
    const cur = (progetto.consuntivo && progetto.consuntivo.modalita_proiezione) || 'lineare';
    if (cur === mod) return;
    Projects.aggiornaConsuntivo('modalita_proiezione', mod);
    UI.aggiornaStatusBar('modificato');
    renderConsuntivo();
  }

  /**
   * Salva il blur di una cella "Ricavi attesi (€)" e ri-rendera il
   * consuntivo conservando la posizione di scroll orizzontale.
   */
  function attesoBlur(el) {
    const field = el.dataset.consField;
    const txt = (el.textContent || '').trim();
    const parsed = _parseEuro(txt);
    Projects.aggiornaConsuntivo(field, parsed);
    UI.aggiornaStatusBar('modificato');
    const scroller = document.querySelector('.ab-consuntivo-tab-scroll');
    const scrollLeft = scroller ? scroller.scrollLeft : 0;
    renderConsuntivo();
    if (scrollLeft) {
      const newScroller = document.querySelector('.ab-consuntivo-tab-scroll');
      if (newScroller) newScroller.scrollLeft = scrollLeft;
    }
  }

  function distribuisciPctKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      apriDistribuisciPct();
    }
  }

  /* ──────────────────────────────────────────────────────────
     MODALE "DISTRIBUISCI DA %"

     Inserimento dei pesi % di stagionalità (12 mesi o 4 trimestri).
     I pesi devono sommare 100; il salvataggio è bloccato finché la
     somma non è esattamente 100 (vincolo voluto dall'operatore per
     evitare distribuzioni accidentalmente parziali). All'applicazione
     ogni cella "Ricavi attesi" viene riempita con peso% × fatturato
     di budget; gli importi restano poi editabili a mano per fare
     ritocchi mirati.
     ────────────────────────────────────────────────────────── */

  function apriDistribuisciPct() {
    const progetto = Projects.getProgetto();
    if (!progetto) return;
    const cons = progetto.consuntivo || {};
    const freq = cons.frequenza === 'trimestrale' ? 'trimestrale' : 'mensile';
    const periodiKeys = freq === 'trimestrale'
      ? ['1','2','3','4']
      : ['01','02','03','04','05','06','07','08','09','10','11','12'];
    const labels = freq === 'trimestrale'
      ? ['1° trim.','2° trim.','3° trim.','4° trim.']
      : ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

    const budget = BudgetEngine.calcolaBudget(progetto);
    const fattBudget = budget.fatturato || 0;

    // Pesi iniziali: se ci sono già attesi inseriti, derivarli come
    // proporzioni della loro somma; altrimenti distribuire uniforme.
    // In entrambi i casi facciamo assorbire al primo periodo l'eventuale
    // residuo da arrotondamento al centesimo, così la somma iniziale è
    // esattamente 100,00% (necessario perché il vincolo di apply è 100%
    // e la cifra che l'operatore vede è quella troncata al centesimo).
    const atteso = cons.fatturato_atteso || {};
    const sommaAtteso = periodiKeys.reduce((s, k) => s + (Number(atteso[k]) || 0), 0);
    const N = periodiKeys.length;
    const round2 = x => Math.round(x * 100) / 100;
    const pesiIniziali = {};
    if (sommaAtteso > 0) {
      let accum = 0;
      periodiKeys.forEach((k, i) => {
        if (i < N - 1) {
          pesiIniziali[k] = round2(((Number(atteso[k]) || 0) / sommaAtteso) * 100);
          accum += pesiIniziali[k];
        } else {
          pesiIniziali[k] = round2(100 - accum);
        }
      });
    } else {
      const base = round2(100 / N);
      let accum = 0;
      periodiKeys.forEach((k, i) => {
        if (i < N - 1) { pesiIniziali[k] = base; accum += base; }
        else           { pesiIniziali[k] = round2(100 - accum); }
      });
    }

    // Costruzione modale (overlay + box centrale)
    const old = document.getElementById('ab-distrib-pct-modal');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    const overlay = document.createElement('div');
    overlay.id = 'ab-distrib-pct-modal';
    overlay.className = 'ab-modal-overlay';

    const _fmtPctInput = p => (Math.round(p * 100) / 100).toString().replace('.', ',');

    const rowsHtml = periodiKeys.map((k, i) => `
      <tr>
        <td class="ab-distrib-label">${_escapeHtml(labels[i])}</td>
        <td class="num">
          <div class="amount-field ab-distrib-pct-input"
               contenteditable="true"
               data-periodo="${k}"
               data-input-type="pct"
               onblur="BudgetUI.distribuisciPctBlur(this)"
               onkeydown="BudgetUI.budgetKeyDown(event)">${_fmtPctInput(pesiIniziali[k])}</div>
        </td>
      </tr>`).join('');

    overlay.innerHTML = `
      <div class="ab-modal-box ab-distrib-pct-box" role="dialog" aria-modal="true" aria-labelledby="ab-distrib-pct-title">
        <div class="ab-modal-head">
          <h3 id="ab-distrib-pct-title">Distribuisci ricavi attesi per ${freq === 'trimestrale' ? 'trimestre' : 'mese'}</h3>
          <span class="ab-modal-close" role="button" tabindex="0"
                title="Chiudi senza applicare"
                onclick="BudgetUI.chiudiDistribuisciPct()"
                onkeydown="BudgetUI.distribuisciPctChiudiKeyDown(event)">✕</span>
        </div>
        <div class="ab-modal-body">
          <p class="text-muted ab-distrib-pct-intro">
            Inserisci la quota % di ciascun ${freq === 'trimestrale' ? 'trimestre' : 'mese'}. La somma deve fare <strong>100%</strong>.
            All'applicazione le celle "Ricavi attesi" verranno riempite con <em>peso × fatturato di budget</em>
            (<strong>${_fmtEuro(fattBudget)}</strong>). Potrai poi ritoccare i singoli importi a mano.
          </p>
          <table class="ab-distrib-pct-tab">
            <thead>
              <tr><th>${freq === 'trimestrale' ? 'Trimestre' : 'Mese'}</th><th class="num">Peso %</th></tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot>
              <tr class="ab-distrib-pct-foot">
                <th>Totale</th>
                <th class="num"><span id="ab-distrib-pct-sum">0,00</span>%</th>
              </tr>
            </tfoot>
          </table>
          <div id="ab-distrib-pct-warning" class="ab-distrib-pct-warning" hidden></div>
        </div>
        <div class="ab-modal-foot">
          <span class="ab-modal-btn ab-modal-btn-ghost"
                role="button" tabindex="0"
                onclick="BudgetUI.chiudiDistribuisciPct()"
                onkeydown="BudgetUI.distribuisciPctChiudiKeyDown(event)">Annulla</span>
          <span class="ab-modal-btn ab-modal-btn-primary"
                id="ab-distrib-pct-apply"
                role="button" tabindex="0"
                onclick="BudgetUI.applicaDistribuisciPct()"
                onkeydown="BudgetUI.distribuisciPctApplyKeyDown(event)">Applica</span>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Bind handler globale per il calcolo della somma e per la
    // chiusura su Esc/click sull'overlay. Il riferimento al fatturato
    // budget e ai periodi viene conservato sul dataset del box per
    // l'apply.
    const box = overlay.querySelector('.ab-distrib-pct-box');
    box.dataset.fattBudget = String(fattBudget);
    box.dataset.frequenza  = freq;

    overlay.addEventListener('click', e => {
      if (e.target === overlay) chiudiDistribuisciPct();
    });
    document.addEventListener('keydown', _distribuisciPctEscHandler, true);

    _aggiornaSommaDistribPct();
  }

  function _distribuisciPctEscHandler(e) {
    if (e.key === 'Escape') {
      chiudiDistribuisciPct();
    }
  }

  function chiudiDistribuisciPct() {
    const el = document.getElementById('ab-distrib-pct-modal');
    if (el && el.parentNode) el.parentNode.removeChild(el);
    document.removeEventListener('keydown', _distribuisciPctEscHandler, true);
  }

  function distribuisciPctChiudiKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      chiudiDistribuisciPct();
    }
  }
  function distribuisciPctApplyKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      applicaDistribuisciPct();
    }
  }

  function distribuisciPctBlur(el) {
    // Normalizza l'input: parse %, ricomponi il display formattato.
    const parsed = _parsePct(el.textContent || '');
    const pct = parsed != null ? parsed * 100 : 0;
    el.textContent = (Math.round(pct * 100) / 100).toString().replace('.', ',');
    _aggiornaSommaDistribPct();
  }

  function _aggiornaSommaDistribPct() {
    const overlay = document.getElementById('ab-distrib-pct-modal');
    if (!overlay) return;
    const inputs = overlay.querySelectorAll('.ab-distrib-pct-input');
    let somma = 0;
    inputs.forEach(inp => {
      const p = _parsePct(inp.textContent || '');
      somma += (p != null ? p * 100 : 0);
    });
    const sumEl = overlay.querySelector('#ab-distrib-pct-sum');
    if (sumEl) sumEl.textContent = (Math.round(somma * 100) / 100).toString().replace('.', ',');
    const eps = 0.005; // tolleranza arrotondamento al centesimo
    const valido = Math.abs(somma - 100) < eps;
    const applyBtn = overlay.querySelector('#ab-distrib-pct-apply');
    if (applyBtn) {
      applyBtn.classList.toggle('ab-modal-btn-disabled', !valido);
      applyBtn.setAttribute('aria-disabled', valido ? 'false' : 'true');
    }
    const warnEl = overlay.querySelector('#ab-distrib-pct-warning');
    if (warnEl) {
      if (valido) {
        warnEl.hidden = true;
        warnEl.textContent = '';
      } else {
        warnEl.hidden = false;
        const delta = 100 - somma;
        const verso = delta > 0 ? 'mancano' : 'eccedono';
        warnEl.textContent = `Somma attuale: ${(Math.round(somma * 100) / 100).toString().replace('.', ',')}%. ${verso} ${(Math.round(Math.abs(delta) * 100) / 100).toString().replace('.', ',')} punti per arrivare a 100%.`;
      }
    }
  }

  function applicaDistribuisciPct() {
    const overlay = document.getElementById('ab-distrib-pct-modal');
    if (!overlay) return;
    const box = overlay.querySelector('.ab-distrib-pct-box');
    const fattBudget = Number(box.dataset.fattBudget) || 0;
    const inputs = overlay.querySelectorAll('.ab-distrib-pct-input');

    // Verifica vincolo somma = 100% (il bottone Applica è già visivamente
    // disabilitato in caso contrario, ma proteggiamo anche da chi spara
    // Invio sulla tastiera saltando il blur dell'ultimo campo).
    let somma = 0;
    const pesi = {};
    inputs.forEach(inp => {
      const p = _parsePct(inp.textContent || '');
      const pct = p != null ? p * 100 : 0;
      pesi[inp.dataset.periodo] = pct;
      somma += pct;
    });
    if (Math.abs(somma - 100) >= 0.005) {
      // Forza un refresh dell'avviso e blocca l'apply.
      _aggiornaSommaDistribPct();
      return;
    }
    if (fattBudget <= 0) {
      alert('Impossibile distribuire: il fatturato di budget è 0. Imposta prima il fatturato ipotizzato nello Step Budget.');
      return;
    }

    // Applica: scrive ogni periodo come peso × fatturato budget. Importi
    // <= 0 sono trattati come "vuoti" da aggiornaConsuntivo (vengono
    // cancellati dal progetto).
    Object.keys(pesi).forEach(k => {
      const euro = Math.round((pesi[k] / 100) * fattBudget);
      Projects.aggiornaConsuntivo('fatturato_atteso.' + k, euro);
    });

    chiudiDistribuisciPct();
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
    const fattBase = b.fatturato_ultimo_arrotondato;
    const deltaFattBase = fattBase > 0 ? (b.fatturato - fattBase) / fattBase : 0;
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

    const colspanTot = 6;
    let body = '';

    // Totali "Base storica" (stessa logica della vista a video).
    const baseTot = _calcolaBaseStoricaTotali(progetto, b);

    // Medie storiche in € dei derivati per la colonna "Media": stesso
    // filtro della vista a video (solo anni con ricavi > 0).
    const totaliStoricoPdf = _calcolaTotaliStorico(progetto);
    const anniRealiPdf = (b.anni_reali && b.anni_reali.length > 0)
      ? b.anni_reali
      : ((progetto.meta && progetto.meta.anni_storici) || []).filter(a => (totaliStoricoPdf[a] || {}).fatturato > 0);
    const medieEuroDerivPdf = {};
    ['fatturato','cdv','totVar','mdc','fissi','totCosti','provOneriStraordNetto','utileAnteImposte','imposte','utileNetto'].forEach(k => {
      const vals = anniRealiPdf.map(a => (totaliStoricoPdf[a] || {})[k] || 0);
      medieEuroDerivPdf[k] = vals.length > 0 ? vals.reduce((s,v) => s+v, 0) / vals.length : 0;
    });
    const yyPdf = y => "'" + String(y).slice(-2);
    const mediaHeaderPdf = anniRealiPdf.length === 0
      ? 'Media'
      : anniRealiPdf.length === 1
        ? 'Solo ' + yyPdf(anniRealiPdf[0])
        : 'Media ' + anniRealiPdf.map(yyPdf).join('–');

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
        const valMediaTri = medieEuroDerivPdf[r.id] || 0;
        const cls = `ab-prospetto-tot ab-prospetto-tot-${r.evidenza || 'arancio'}`;
        body += `<tr class="${cls}">
          <td>${_escapeHtml(r.label)}</td>
          <td class="num">${_fmtEuroInt(valMediaTri * segno)}</td>
          <td class="num">${_fmtPct(pctBase * segno)}</td>
          <td class="num">${_fmtEuroInt(valBase * segno)}</td>
          <td class="num">${_fmtEuroInt(valBudget * segno)}</td>
          <td class="num">${_fmtPct(pctBudget * segno)}</td>
        </tr>`;
        continue;
      }

      const m = (progetto.macro_sezioni || []).find(x => x.id === r.id);
      const dato = b.valori[r.id] || { valore: 0, pct: 0, media_euro: 0, media_pct: 0 };
      if (r.nascondiSeZero && Math.abs(dato.media_euro) < 0.005 && Math.abs(dato.valore) < 0.005) continue;

      const isStraord = m && m.sezione === 'prov_oneri_straord';
      const isCalc = m && m.calcolato;
      const baseDisplay = isStraord ? 0
        : isCalc ? (dato.media_euro || 0)
        : (dato.ultimo_anno_euro || 0);
      const mediaTriDisplay = (dato.media_euro || 0);

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
        <td class="num">${_fmtEuroInt(mediaTriDisplay)}</td>
        <td class="num">${_fmtPct(dato.media_pct)}</td>
        <td class="num">${_fmtEuroInt(baseDisplay)}</td>
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
          <div class="ab-pdf-kpi-sub">Ultimo fatturato${b.ultimo_anno ? ' (' + b.ultimo_anno + ')' : ''} arrotondato: ${_fmtEuroInt(fattBase)} € ${fattBase > 0 ? '(' + _fmtPctSigned(deltaFattBase) + ' vs ipotizzato)' : ''}</div>
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
    const annoEsRange = anniRealiPdf.length > 0
      ? (anniRealiPdf.length === 1 ? anniRealiPdf[0] : `${anniRealiPdf[0]}–${anniRealiPdf[anniRealiPdf.length - 1]}`)
      : '';
    const noteMetodo = [
      `<strong>${_escapeHtml(mediaHeaderPdf)}</strong> — media in € degli importi degli esercizi storici importati${annoEsRange ? ' (' + annoEsRange + ')' : ''}: riferimento informativo per ponderare correzioni manuali al budget.`,
      '<strong>Ultimo anno €</strong> — riferimento storico fisso, indipendente dal fatturato ipotizzato: ricavi, costi variabili, costi fissi e imposte = ultimo esercizio importato arrotondato al centinaio; rimanenze = media € storica; proventi/oneri straordinari = 0 per natura non ricorrente.',
      '<strong>% storica</strong> — incidenza media sul fatturato calcolata come media delle incidenze % di ciascun anno storico importato (non come media degli importi diviso media del fatturato).',
      '<strong>Budget €</strong> — costi variabili: % budget × fatturato ipotizzato. Costi fissi e imposte: ultimo anno o override utente. Proventi/oneri straordinari: 0 di default o override utente. Rimanenze: media € storica o override €.',
      '<strong>Costo del venduto</strong> = Mat. prime + Altri costi variabili + Rimanenze iniziali − Rimanenze finali.',
      `<strong>Fatturato di break-even</strong> = (Rim. iniziali − Rim. finali + Σ costi fissi) / (1 − Σ % costi variabili). ${b.break_even != null ? 'Differenza vs ipotizzato: ' + _fmtPctSigned(deltaFattBe || 0) : 'Non calcolabile (denominatore non positivo o costi fissi nulli).'}`
    ];

    // HTML completo
    let html = '';
    html += _pdfHeader(progetto, 'Budget anno');
    html += kpiHtml;
    html += '<table class="ab-pdf-tab"><thead><tr>'
         +    '<th>Macroarea</th>'
         +    `<th class="num">${_escapeHtml(mediaHeaderPdf)}</th>`
         +    '<th class="num">% storica</th>'
         +    '<th class="num">Ultimo anno €</th>'
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
      // Etichetta su due righe per non far esplodere la larghezza
      // delle 4 colonne nella pagina PDF: il numero del trimestre
      // sopra ("1° trim."), il range mesi sotto in font ridotto
      // ("gen-mar"). Mantiene l'informazione completa stando in ~9
      // caratteri di larghezza tipografica massima.
      const labels = [
        { label: '1° trim.', subLabel: 'gen-mar' },
        { label: '2° trim.', subLabel: 'apr-giu' },
        { label: '3° trim.', subLabel: 'lug-set' },
        { label: '4° trim.', subLabel: 'ott-dic' }
      ];
      return pre.periodi_keys.map((k, i) => ({
        key: k,
        label: labels[i].label,
        subLabel: labels[i].subLabel,
        chiuso: !!(pre.per_periodo[k] && pre.per_periodo[k].inserito),
        valori: pre.per_periodo[k] ? pre.per_periodo[k].valori : {},
        totali: pre.per_periodo[k] || {}
      }));
    }

    // Mensile: cumulato gen→ultimo mese con ricavo (orizzonte consuntivo).
    // L'orizzonte è calcolato una sola volta dal motore: i mesi intermedi a
    // ricavo zero rientrano nel cumulato (i loro fissi vanno contati), i mesi
    // oltre l'orizzonte hanno vista vuota e non concorrono.
    const meseLabels = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    const lastIdx = pre.ultimo_periodo_con_dati;

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
          <div class="ab-pdf-kpi-sub">${pre.periodi_chiusi}/${pre.periodi_totali} periodi trascorsi · ${(pre.frazione_anno * 100).toFixed(0)}% dell'anno</div>
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
      const sub   = col.subLabel ? `<div class="ab-pdf-col-sublabel">${_escapeHtml(col.subLabel)}</div>` : '';
      return `<th class="num">${_escapeHtml(col.label)}${sub}${stato}</th>`;
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
    classificaMastroChange:    classificaMastroChange,
    toggleRimanenze:           toggleRimanenze,
    annullaModaleClassifica:   annullaModaleClassifica,
    confermaModaleClassifica:  confermaModaleClassifica,
    cambiaMacroarea:    cambiaMacroarea,
    valoreSottocontoBlur:    valoreSottocontoBlur,
    valoreSottocontoKeyDown: valoreSottocontoKeyDown,
    budgetBlur:         budgetBlur,
    budgetKeyDown:      budgetKeyDown,
    cambiaMeseAvvio:    cambiaMeseAvvio,
    applicaSeed:        applicaSeed,
    seedBtnKeyDown:     seedBtnKeyDown,
    toggleLavoroSoci:   toggleLavoroSoci,
    toggleLavoroSociKeyDown: toggleLavoroSociKeyDown,
    aggiungiSocio:      aggiungiSocio,
    aggiungiSocioKeyDown: aggiungiSocioKeyDown,
    eliminaSocio:       eliminaSocio,
    eliminaSocioKeyDown: eliminaSocioKeyDown,
    socioBlur:          socioBlur,
    impostaComportamento:  impostaComportamento,
    comportamentoKeyDown:  comportamentoKeyDown,
    toggleNota:         toggleNota,
    notaToggleKeyDown:  notaToggleKeyDown,
    notaBlur:           notaBlur,
    notaKeyDown:        notaKeyDown,
    eliminaNota:        eliminaNota,
    eliminaNotaKeyDown: eliminaNotaKeyDown,
    consuntivoBlur:     consuntivoBlur,
    cambiaMeseAvvioConsuntivo: cambiaMeseAvvioConsuntivo,
    cambiaFrequenza:    cambiaFrequenza,
    cambiaModalitaProiezione:   cambiaModalitaProiezione,
    attesoBlur:                 attesoBlur,
    apriDistribuisciPct:        apriDistribuisciPct,
    chiudiDistribuisciPct:      chiudiDistribuisciPct,
    distribuisciPctKeyDown:     distribuisciPctKeyDown,
    distribuisciPctChiudiKeyDown: distribuisciPctChiudiKeyDown,
    distribuisciPctApplyKeyDown:  distribuisciPctApplyKeyDown,
    distribuisciPctBlur:        distribuisciPctBlur,
    applicaDistribuisciPct:     applicaDistribuisciPct,
    esportaPdfBudget:   esportaPdfBudget,
    esportaPdfConsuntivo: esportaPdfConsuntivo
  };

})();
