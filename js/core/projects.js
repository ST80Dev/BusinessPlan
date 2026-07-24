/**
 * projects.js
 * Gestione progetti: creazione, salvataggio, caricamento,
 * eliminazione e persistenza della lista recenti via localStorage.
 *
 * Dipende da: schema.js
 * Non dipende da: ui.js, engine.js
 */

'use strict';

const Projects = (() => {

  /* ──────────────────────────────────────────────────────────
     Stato in memoria
     ────────────────────────────────────────────────────────── */

  /** Progetto attualmente aperto (null = nessuno) */
  let _progettoCorrente = null;

  /** Flag modifiche non salvate */
  let _modificato = false;

  /** Chiave localStorage per la lista dei progetti recenti */
  const LS_KEY_RECENTI = 'bp_tool_recenti';

  /* ──────────────────────────────────────────────────────────
     Struttura progetto vuoto
     ────────────────────────────────────────────────────────── */

  /**
   * Crea la struttura dati di un nuovo progetto.
   * @param {Object} meta - campi del form nuovo progetto
   * @returns {Object} progetto completo
   */
  function _creaStruttura(meta) {
    const oggi = new Date().toISOString().split('T')[0];
    const isCostitutenda = meta.scenario === 'costituenda';
    const anniPrev = [];

    // Per costituenda: anno_base = anno inizio attivita, le previsioni partono da li
    // Per sp_ce/sp_only: anno_base = ultimo bilancio, previsioni da anno_base + 1
    const primoAnnoPrev = isCostitutenda ? 0 : 1;
    for (let i = primoAnnoPrev; i < primoAnnoPrev + meta.anni_previsione; i++) {
      anniPrev.push(meta.anno_base + i);
    }

    // Dati storici vuoti (per costituenda: SP di avvio, non un bilancio storico)
    const storico = {};
    storico[meta.anno_base] = _creaAnnoVuoto(meta.scenario);

    const progetto = {
      meta: {
        cliente:            meta.cliente,
        settore:            meta.settore || '',
        anno_base:          meta.anno_base,
        anni_previsione:    anniPrev,
        scenario:           meta.scenario,       // 'sp_ce' | 'sp_only' | 'costituenda'
        modalita:           meta.modalita,        // 'rapida' | 'analitica'
        mese_avvio:         meta.mese_avvio || 1, // Mese di inizio attività (1-12, default gennaio)
        creato:             oggi,
        modificato:         oggi,
        stato:              'in_lavorazione'      // 'in_lavorazione' | 'completato'
      },
      storico,
      conti_custom: [],  // [{ id, parent_id, label }] — conti foglia personalizzati
      immobilizzazioni: {},  // { 'sp.BI.1': { costo_storico, fondo_ammortamento, aliquota } }
      eventi:    [],
      driver: {
        ricavi:     [],    // [{ id, voce_ce, label, base_annuale, crescita_annua:{anno:pct} }]
        stagionalita_attiva: false,
        profilo_stagionale:  [8.33, 8.33, 8.34, 8.33, 8.33, 8.34, 8.33, 8.33, 8.34, 8.33, 8.33, 8.34],
        costi:      [],    // [{ id, voce_ce, label, tipo_driver, pct_ricavi, var_pct_annua, importo_fisso, soggetto_inflazione, iva_pct }]
        personale: {
          headcount:          0,      // N. dipendenti anno base (decimale: 5.5 = 5 FT + 1 PT)
          ral_media:          0,      // Retribuzione annua lorda media
          coeff_oneri:        0.32,   // Coefficiente oneri sociali (default 32%)
          tredicesima:        true,   // 13ª mensilità (dicembre)
          quattordicesima:    true,   // 14ª mensilità (giugno)
          var_ral_pct:        _creaParamAnnuale(anniPrev, 0),  // Variazione RAL media % per anno
          variazioni_organico: []     // [{ anno, delta, da_mese }] es. { anno: 2025, delta: +0.5, da_mese: 6 }
        },
        finanziamenti_essere: [],
        smobilizzo: [],
        circolante: { dso: 60, dpo: 45, dio: 30 },
        magazzino: {
          // Scostamento % sui ricavi rispetto al consumo standard di materie
          // prime (pct_ricavi dei driver B.6). Default 0 = comportamento
          // classico: acquisti = consumo standard. Δ>0 → extra acquisti che
          // accumulano rimanenze. Δ<0 → minori acquisti, consumo attinge
          // dalle rimanenze esistenti (capped al saldo disponibile, warning
          // quando insufficiente).
          scostamento_mp_pct: _creaParamAnnuale(anniPrev, 0)
        },
        fiscale: {
          aliquota_ires: 0.24,
          aliquota_irap: 0.039,
          iva_ricavi:        0.22,        // Aliquota IVA media sui ricavi
          liquidazione_iva:  'mensile',   // 'mensile' | 'trimestrale'
          rimborso_iva_trim: false,       // Rimborso IVA trimestrale (art. 38-bis)
          inflazione:    _creaParamAnnuale(anniPrev, 0.02),
          var_personale: _creaParamAnnuale(anniPrev, 0)
        }
      },
      proiezioni: {
        mensili: {},
        annuali: {}
      }
    };

    // Pre-popola driver con struttura standard
    _prePopulaDriver(progetto, meta.scenario);

    return progetto;
  }

  /**
   * Crea la struttura dati vuota per un anno storico.
   * @param {string} scenario
   * @returns {Object}
   */
  function _creaAnnoVuoto(scenario) {
    if (scenario === 'costituenda') {
      return {
        sp_avvio: Schema.creaDataVuoto(Schema.SP_COSTITUENDA),
        ce: null
      };
    }
    return {
      sp: {
        attivo:  Schema.creaDataVuoto(Schema.SP_ATTIVO),
        passivo: Schema.creaDataVuoto(Schema.SP_PASSIVO)
      },
      ce: scenario === 'sp_ce' ? Schema.creaDataVuoto(Schema.CE) : null
    };
  }

  /**
   * Crea un oggetto { anno: valore } per ogni anno previsionale.
   * @param {Array}  anniPrev - es. [2025, 2026, 2027]
   * @param {number} valDefault
   * @returns {Object} es. { "2025": 0.02, "2026": 0.02, "2027": 0.02 }
   */
  function _creaParamAnnuale(anniPrev, valDefault) {
    const obj = {};
    anniPrev.forEach(function(a) { obj[String(a)] = valDefault; });
    return obj;
  }

  /* ──────────────────────────────────────────────────────────
     Categorie investimento (mapping voce SP → label)
     ────────────────────────────────────────────────────────── */

  const CATEGORIE_INVESTIMENTO = [
    { id: 'sp.BII.1', label: 'Terreni e fabbricati' },
    { id: 'sp.BII.2', label: 'Impianti e macchinari' },
    { id: 'sp.BII.3', label: 'Attrezzature industriali e commerciali' },
    { id: 'sp.BII.4', label: 'Altri beni materiali' },
    { id: 'sp.BI.1',  label: 'Costi d\'impianto e ampliamento' },
    { id: 'sp.BI.2',  label: 'Ricerca & Sviluppo' },
    { id: 'sp.BI.7',  label: 'Altre immobilizzazioni immateriali' }
  ];

  /* ──────────────────────────────────────────────────────────
     Creazione eventi
     ────────────────────────────────────────────────────────── */

  let _nextEvtId = 1;

  /**
   * Crea un evento con valori default per la tipologia indicata.
   * @param {string} tipo - tipo evento
   * @param {Object} progetto - progetto corrente (per anno base)
   * @returns {Object}
   */
  function creaEvento(tipo, progetto) {
    var anniPrev = (progetto && progetto.meta && progetto.meta.anni_previsione) || [];
    var primoAnno = anniPrev[0] || new Date().getFullYear();
    var ultimoAnno = anniPrev[anniPrev.length - 1] || primoAnno;
    var base = { tipo: tipo, id: 'evt_' + Date.now() + '_' + (_nextEvtId++), descrizione: '' };

    switch (tipo) {
      case 'nuovo_finanziamento':
        return Object.assign(base, {
          importo: 0, tasso_annuo: 0, durata_mesi: 60,
          tipo_ammortamento: 'italiano', anno: primoAnno, mese: 1
        });
      case 'nuovo_investimento':
        return Object.assign(base, {
          categoria: 'sp.BII.2', anno: primoAnno, mese: 1,
          importo: 0, iva_pct: 0.22, anni_ammortamento: 5
        });
      case 'variazione_ricavi':
        return Object.assign(base, {
          anno: primoAnno, anno_fine: ultimoAnno, mese: 1, variazione_pct: 0, modalita: 'strutturale'
        });
      case 'variazione_costi_mp':
        return Object.assign(base, {
          anno: primoAnno, anno_fine: ultimoAnno, mese: 1, variazione_pct: 0, modalita: 'strutturale'
        });
      case 'variazione_costi_var':
        return Object.assign(base, {
          driver_id: '', anno: primoAnno, anno_fine: ultimoAnno, mese: 1, variazione_pct: 0, modalita: 'strutturale'
        });
      case 'andamento_costo_gestione':
        return Object.assign(base, {
          driver_id: '', anno: primoAnno, anno_fine: ultimoAnno, mese: 1,
          azione: 'variazione', importo_nuovo: 0, variazione_pct: 0
        });
      case 'variazione_personale':
        return Object.assign(base, {
          anno: primoAnno, anno_fine: ultimoAnno, mese: 1, delta: 0
        });
      case 'operazione_soci':
        return Object.assign(base, {
          anno: primoAnno, anno_fine: ultimoAnno, mese: 1, importo: 0, sottotipo: 'versamento_capitale'
        });
      // 'utilizzo_rimanenze': deprecato. Sostituito dal driver Magazzino
      // (scostamento_mp_pct per anno, default 0). Gli eventi già presenti nei
      // progetti salvati vengono ignorati dall'engine.
      default:
        return base;
    }
  }

  /* ──────────────────────────────────────────────────────────
     Conti tipici di dettaglio per pre-popolamento
     ────────────────────────────────────────────────────────── */

  /** Voci ricavo tipiche (sotto ce.A) */
  const RICAVI_TIPICI = [
    { parent: 'ce.A.1', label: 'Vendita prodotti' },
    { parent: 'ce.A.1', label: 'Prestazione servizi' },
    { parent: 'ce.A.5', label: 'Altri ricavi e proventi' }
  ];

  /** Voci costo tipiche con dettaglio sotto le voci UE */
  const COSTI_TIPICI = [
    // B.6 Materie prime
    { parent: 'ce.B.6',  label: 'Materie prime',                tipo: 'pct_ricavi', costo_venduto: true },
    { parent: 'ce.B.6',  label: 'Materiali di consumo',         tipo: 'pct_ricavi', costo_venduto: true },
    // B.7 Servizi — costi variabili su vendite/acquisti (costo del venduto)
    { parent: 'ce.B.7',  label: 'Trasporti su acquisti',        tipo: 'pct_ricavi', costo_venduto: true },
    { parent: 'ce.B.7',  label: 'Trasporti su vendite',         tipo: 'pct_ricavi', costo_venduto: true },
    // B.7 Servizi — costi di gestione
    { parent: 'ce.B.7',  label: 'Utenze (acqua, luce, gas)',    tipo: 'fisso' },
    { parent: 'ce.B.7',  label: 'Pubblicità e marketing',       tipo: 'fisso' },
    { parent: 'ce.B.7',  label: 'Consulenze professionali',     tipo: 'fisso' },
    { parent: 'ce.B.7',  label: 'Assicurazioni',                tipo: 'fisso' },
    { parent: 'ce.B.7',  label: 'Manutenzioni e riparazioni',   tipo: 'fisso' },
    { parent: 'ce.B.7',  label: 'Compensi amministratori',      tipo: 'fisso' },
    // B.8 Godimento beni di terzi
    { parent: 'ce.B.8',  label: 'Affitti e locazioni',          tipo: 'fisso' },
    { parent: 'ce.B.8',  label: 'Canoni di leasing',            tipo: 'fisso' },
    { parent: 'ce.B.8',  label: 'Noleggi',                      tipo: 'fisso' },
    // B.9 Personale (voci standard schema)
    // B.9 Personale: gestito dal pannello organico (headcount × RAL)
    // B.11 Variazione rimanenze
    { parent: 'ce.B.11', label: 'Variazione rimanenze materie prime', tipo: 'fisso' },
    // B.14 Oneri diversi
    { parent: 'ce.B.14', label: 'Imposte e tasse diverse',      tipo: 'fisso' },
    { parent: 'ce.B.14', label: 'Cancelleria e materiale ufficio', tipo: 'fisso' }
  ];

  /**
   * Pre-popola i driver ricavi e costi alla creazione del progetto.
   * - Costituenda / sp_only: conti tipici dettagliati a 0
   * - sp_ce: struttura base dalle voci CE standard (senza dettaglio;
   *   l'utente userà "Importa da CE" dopo aver inserito i dati storici)
   */
  function _prePopulaDriver(progetto, scenario) {
    if (scenario === 'costituenda' || scenario === 'sp_only') {
      // Ricavi tipici
      RICAVI_TIPICI.forEach(function(r) {
        progetto.driver.ricavi.push(creaDriverRicavo(r.parent, r.label, 0));
      });
      // Costi tipici con dettaglio
      COSTI_TIPICI.forEach(function(c) {
        var drv = creaDriverCosto(c.parent, c.label, c.tipo, { costo_venduto: c.costo_venduto });
        progetto.driver.costi.push(drv);
      });
    } else {
      // sp_ce: struttura aggregata dalle voci CE principali
      // Ricavi: voci sotto ce.A
      var nodoA = Schema.trovaNodo('ce.A');
      if (nodoA && nodoA.children) {
        nodoA.children.forEach(function(figlio) {
          progetto.driver.ricavi.push(creaDriverRicavo(figlio.id, figlio.label, 0));
        });
      }
      // Costi: voci sotto ce.B (esclusi ammortamenti ce.B.10)
      var nodoB = Schema.trovaNodo('ce.B');
      if (nodoB && nodoB.children) {
        nodoB.children.forEach(function(figlio) {
          if (figlio.id === 'ce.B.10') return; // ammortamenti gestiti da investimenti
          if (figlio.id === 'ce.B.9') return;  // personale gestito dal pannello organico
          if (figlio.children) {
            // Sottomastro con figli
            figlio.children.forEach(function(sotto) {
              var drv = creaDriverCosto(sotto.id, sotto.label, 'fisso');
              progetto.driver.costi.push(drv);
            });
          } else {
            var drv = creaDriverCosto(figlio.id, figlio.label, 'fisso');
            progetto.driver.costi.push(drv);
          }
        });
      }
    }
  }

  /** Contatore incrementale per ID driver. */
  let _nextDriverId = 1;

  /**
   * Scorre tutti i driver esistenti e aggiorna _nextDriverId
   * per evitare collisioni con ID già in uso.
   * Ripara anche eventuali ID duplicati assegnandone di nuovi.
   */
  function _sincronizzaDriverIdCounter(progetto) {
    if (!progetto || !progetto.driver) return;
    var maxId = 0;
    var tuttiId = {};
    var arr = (progetto.driver.ricavi || []).concat(progetto.driver.costi || []);

    // Prima passata: trova il max e rileva duplicati
    for (var i = 0; i < arr.length; i++) {
      var drv = arr[i];
      if (!drv.id) continue;
      var match = drv.id.match(/^drv_[rc](\d+)$/);
      if (match) {
        var num = parseInt(match[1], 10);
        if (num > maxId) maxId = num;
      }
      if (tuttiId[drv.id]) {
        // ID duplicato — verrà riparato nella seconda passata
        tuttiId[drv.id].push(i);
      } else {
        tuttiId[drv.id] = [i];
      }
    }

    _nextDriverId = maxId + 1;

    // Seconda passata: ripara ID duplicati (assegna nuovo id a tutti tranne il primo)
    var riparati = 0;
    Object.keys(tuttiId).forEach(function(id) {
      var indices = tuttiId[id];
      if (indices.length <= 1) return;
      for (var j = 1; j < indices.length; j++) {
        var drv = arr[indices[j]];
        var prefisso = drv.id.indexOf('drv_r') === 0 ? 'drv_r' : 'drv_c';
        drv.id = _generaDriverId(prefisso);
        riparati++;
      }
    });
    if (riparati > 0) {
      segnaModificato();
    }
  }

  /**
   * Genera un ID univoco per un driver ricavo o costo.
   * @param {string} prefisso - 'drv_r' o 'drv_c'
   * @returns {string}
   */
  function _generaDriverId(prefisso) {
    return prefisso + (_nextDriverId++);
  }

  /**
   * Crea un driver ricavo con valori default.
   * @param {string|null} voceCe - id voce CE collegata (null se personalizzata)
   * @param {string} label
   * @param {number} baseAnnuale
   * @returns {Object}
   */
  function creaDriverRicavo(voceCe, label, baseAnnuale) {
    return {
      id:                  _generaDriverId('drv_r'),
      voce_ce:             voceCe,
      label:               label,
      base_annuale:        baseAnnuale || 0,
      base_tipo:           'annuale',   // 'annuale' | 'mensile'
      crescita_annua:      {},   // { "2026": 0.05, "2027": 0.05, ... } per anno
      soggetto_inflazione: true  // inflazione applicata ai ricavi (opt-out per modello reale o scenari rigidi)
    };
  }

  /**
   * Crea un driver costo con valori default.
   * @param {string|null} voceCe
   * @param {string} label
   * @param {string} tipoDriver - 'pct_ricavi' | 'fisso' | 'personale'
   * @returns {Object}
   */
  function creaDriverCosto(voceCe, label, tipoDriver, opts) {
    const isPersonale = tipoDriver === 'personale';
    opts = opts || {};
    // IVA default: 22% per costi con IVA, 0% per personale/ammortamenti/accantonamenti
    var ivaDefault = 0.22;
    if (isPersonale) ivaDefault = 0;
    if (voceCe && (voceCe.indexOf('ce.B.10') === 0 || voceCe.indexOf('ce.B.12') === 0 || voceCe.indexOf('ce.B.13') === 0)) ivaDefault = 0;
    return {
      id:                    _generaDriverId('drv_c'),
      voce_ce:               voceCe,
      label:                 label,
      tipo_driver:           isPersonale ? 'fisso' : tipoDriver,
      pct_ricavi:            tipoDriver === 'pct_ricavi' ? 0 : null,
      var_pct_annua:         tipoDriver === 'pct_ricavi' ? 0 : null,
      var_pct_annua_mode:    tipoDriver === 'pct_ricavi' ? 'assoluta' : null, // 'assoluta' (pp) | 'relativa' (moltiplicativa)
      importo_fisso:         tipoDriver !== 'pct_ricavi' ? 0 : null,
      base_tipo:             'annuale',   // 'annuale' | 'mensile'
      soggetto_inflazione:   !isPersonale && tipoDriver === 'fisso',
      usa_var_personale:     isPersonale,
      iva_pct:               ivaDefault,
      costo_venduto:         opts.costo_venduto || false
    };
  }

  /* ──────────────────────────────────────────────────────────
     Creazione progetto (chiamato dal modal)
     ────────────────────────────────────────────────────────── */

  /**
   * Legge i valori dal modale e crea il progetto.
   * Chiamato dal pulsante "Crea progetto" in index.html.
   */
  function creaProgetto() {
    // Lettura campi
    const clienteEl  = document.getElementById('np-cliente');
    const settoreEl  = document.getElementById('np-settore');
    const annoEl     = document.getElementById('np-anno-base');
    const anniEl     = document.getElementById('np-anni-prev');

    const cliente  = (clienteEl.textContent  || '').trim();
    const settore  = (settoreEl.textContent  || '').trim();
    const annoBase = parseInt((annoEl.textContent || '').trim(), 10);
    const anniPrev = parseInt((anniEl.textContent || '1').trim(), 10);

    // Scenario selezionato
    const scenarioEl = document.querySelector('#np-scenario .radio-item.selected');
    const scenario   = scenarioEl ? scenarioEl.dataset.value : 'sp_ce';

    // Modalità inserimento
    const modalitaEl = document.querySelector('#np-modalita .toggle-item.active');
    const modalita   = modalitaEl ? modalitaEl.dataset.value : 'rapida';

    // Mese avvio (solo costituenda)
    const meseAvvioEl = document.getElementById('np-mese-avvio');
    const meseAvvio = scenario === 'costituenda' ? parseInt((meseAvvioEl ? meseAvvioEl.value : '1'), 10) : 1;

    // Validazione
    const errori = [];
    if (!cliente) errori.push('Il nome cliente è obbligatorio.');
    if (isNaN(annoBase) || annoBase < 1900 || annoBase > 2100) errori.push('Anno base non valido.');
    if (anniPrev < 1 || anniPrev > 8) errori.push('Anni previsionali deve essere tra 1 e 8.');

    if (errori.length > 0) {
      _mostraErroreModal(errori.join('\n'));
      return;
    }

    const meta = { cliente, settore, anno_base: annoBase, anni_previsione: anniPrev, scenario, modalita, mese_avvio: meseAvvio };
    const progetto = _creaStruttura(meta);

    // Imposta come progetto corrente
    _progettoCorrente = progetto;
    _modificato = true;

    // Salva in lista recenti (solo metadata, non l'intero JSON)
    _aggiungiRecente(progetto);

    // Chiudi modale e naviga
    UI.closeModal('modal-nuovo-progetto');
    _resetFormNuovoProgetto();
    UI.onProgettoAperto(progetto);
  }

  /* ──────────────────────────────────────────────────────────
     Aggiornamento metadati cliente
     ────────────────────────────────────────────────────────── */

  /**
   * Aggiorna ragione sociale, anno base e orizzonte anni del progetto corrente.
   * Chiamato dal modale "Modifica dati cliente".
   */
  function aggiornaMetaDati() {
    if (!_progettoCorrente) return;

    const clienteEl = document.getElementById('mc-cliente');
    const annoEl    = document.getElementById('mc-anno-base');
    const anniEl    = document.getElementById('mc-anni-prev');
    const meseAvvioEl = document.getElementById('mc-mese-avvio');

    const cliente   = (clienteEl.textContent || '').trim();
    const annoBase  = parseInt((annoEl.textContent || '').trim(), 10);
    const anniPrev  = parseInt((anniEl.textContent || '1').trim(), 10);

    // Validazione
    const errori = [];
    if (!cliente) errori.push('Il nome cliente è obbligatorio.');
    if (isNaN(annoBase) || annoBase < 1900 || annoBase > 2100) errori.push('Anno base non valido.');
    if (anniPrev < 1 || anniPrev > 8) errori.push('Anni previsionali deve essere tra 1 e 8.');

    if (errori.length > 0) {
      _mostraErroreModifica(errori.join('\n'));
      return;
    }

    const meta = _progettoCorrente.meta;
    const vecchioAnno = meta.anno_base;
    const vecchiAnniPrev = meta.anni_previsione;
    const isCostitutenda = meta.scenario === 'costituenda';

    // Aggiorna ragione sociale
    meta.cliente = cliente;

    // Gestisci cambio anno base
    if (annoBase !== vecchioAnno) {
      // Sposta i dati storici dalla vecchia chiave alla nuova
      const vecchiaChiave = String(vecchioAnno);
      const nuovaChiave   = String(annoBase);
      if (_progettoCorrente.storico[vecchiaChiave]) {
        _progettoCorrente.storico[nuovaChiave] = _progettoCorrente.storico[vecchiaChiave];
        delete _progettoCorrente.storico[vecchiaChiave];
      }
      meta.anno_base = annoBase;
    }

    // Ricalcola anni previsionali
    const primoAnnoPrev = isCostitutenda ? 0 : 1;
    const nuoviAnniPrev = [];
    for (let i = primoAnnoPrev; i < primoAnnoPrev + anniPrev; i++) {
      nuoviAnniPrev.push(annoBase + i);
    }
    meta.anni_previsione = nuoviAnniPrev;

    // Aggiorna parametri annuali nei driver
    _aggiornaParamAnnuali(_progettoCorrente, vecchiAnniPrev, nuoviAnniPrev);

    if (meta.scenario === 'costituenda' && meseAvvioEl) {
      meta.mese_avvio = parseInt(meseAvvioEl.value, 10) || 1;
    }

    meta.modificato = new Date().toISOString().split('T')[0];

    _modificato = true;
    _aggiungiRecente(_progettoCorrente);

    UI.closeModal('modal-modifica-cliente');
    UI.onProgettoAperto(_progettoCorrente);
    UI.mostraNotifica('Dati base aggiornati.', 'success');
  }

  /**
   * Aggiorna gli oggetti parametro annuale (inflazione, var_ral, ecc.)
   * quando cambiano gli anni previsionali.
   */
  function _aggiornaParamAnnuali(progetto, vecchiAnni, nuoviAnni) {
    var driver = progetto.driver;
    if (!driver) return;

    // Helper: migra un oggetto {anno: valore} mantenendo valori esistenti
    function _migraParam(obj, valDefault) {
      if (!obj || typeof obj !== 'object') return _creaParamAnnuale(nuoviAnni, valDefault || 0);
      var nuovo = {};
      nuoviAnni.forEach(function(a) {
        var k = String(a);
        nuovo[k] = obj[k] !== undefined ? obj[k] : (valDefault || 0);
      });
      return nuovo;
    }

    // Driver personale
    if (driver.personale) {
      driver.personale.var_ral_pct = _migraParam(driver.personale.var_ral_pct, 0);
    }

    // Driver fiscale
    if (driver.fiscale) {
      driver.fiscale.inflazione    = _migraParam(driver.fiscale.inflazione, 0.02);
      driver.fiscale.var_personale = _migraParam(driver.fiscale.var_personale, 0);
    }

    // Driver magazzino: scostamento % sui ricavi vs consumo standard,
    // default 0. Legacy: elimina vecchio campo tasso_utilizzo se presente.
    if (!driver.magazzino) driver.magazzino = { scostamento_mp_pct: {} };
    if (driver.magazzino.tasso_utilizzo) delete driver.magazzino.tasso_utilizzo;
    driver.magazzino.scostamento_mp_pct = _migraParam(driver.magazzino.scostamento_mp_pct, 0);

    // Driver ricavi — crescita_annua
    if (driver.ricavi) {
      driver.ricavi.forEach(function(drv) {
        if (drv.crescita_annua) {
          drv.crescita_annua = _migraParam(drv.crescita_annua, 0);
        }
      });
    }
  }

  /**
   * Mostra errore nel modale modifica cliente.
   */
  function _mostraErroreModifica(msg) {
    var prev = document.getElementById('modal-mc-error');
    if (prev) prev.remove();

    var div = document.createElement('div');
    div.id = 'modal-mc-error';
    div.style.cssText = 'padding:10px 14px;border-radius:4px;font-size:13px;margin-bottom:12px;';
    div.className = 'text-error';
    div.style.background = 'var(--color-error-bg)';
    div.textContent = msg;

    var body = document.querySelector('#modal-modifica-cliente .modal-body');
    if (body) body.prepend(div);
  }

  /* ──────────────────────────────────────────────────────────
     Salvataggio (download JSON)
     ────────────────────────────────────────────────────────── */

  /**
   * Scarica il progetto corrente come file JSON.
   */
  function salvaProgetto() {
    if (!_progettoCorrente) return;

    _progettoCorrente.meta.modificato = new Date().toISOString().split('T')[0];

    const json     = JSON.stringify(_progettoCorrente, null, 2);
    const blob     = new Blob([json], { type: 'application/json' });
    const url      = URL.createObjectURL(blob);
    const nomeFile = _nomeFile(_progettoCorrente.meta);

    const a = document.createElement('a');
    a.href     = url;
    a.download = nomeFile;
    a.click();
    URL.revokeObjectURL(url);

    _modificato = false;
    _aggiungiRecente(_progettoCorrente);
    UI.aggiornaStatusBar('saved');
  }

  /**
   * Genera il nome del file JSON.
   * @param {Object} meta
   * @returns {string}
   */
  function _nomeFile(meta) {
    const nome = meta.cliente.replace(/[^a-zA-Z0-9À-ú\s_-]/g, '').replace(/\s+/g, '_');
    if (meta.modulo === 'ab') {
      return `AB_${nome}_${meta.anno_corrente}.json`;
    }
    if (meta.modulo === 'imposte') {
      return `IM_${nome}_${meta.anno_imposta}.json`;
    }
    return `BP_${nome}_${meta.anno_base}.json`;
  }

  /* ──────────────────────────────────────────────────────────
     Caricamento (da file JSON)
     ────────────────────────────────────────────────────────── */

  /**
   * Apre un file JSON tramite input[file] dialog.
   * Usa un input hidden creato dinamicamente, no elemento form nativo permanente.
   */
  function apriProgetto() {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json,application/json';

    input.onchange = function(e) {
      const file = e.target.files[0];
      if (!file) return;
      _leggiFile(file);
    };

    input.click();
  }

  /**
   * Legge un file drag&drop passato come File object.
   * @param {File} file
   */
  function caricaDaFile(file) {
    if (!file || file.type !== 'application/json' && !file.name.endsWith('.json')) {
      UI.mostraNotifica('Formato non valido. Caricare un file .json', 'error');
      return;
    }
    _leggiFile(file);
  }

  function _leggiFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const dati = JSON.parse(e.target.result);
        if (!_validaProgetto(dati)) {
          UI.mostraNotifica('File non valido: struttura progetto non riconosciuta.', 'error');
          return;
        }
        if (dati.meta && dati.meta.modulo === 'ab') _migraProgettoAB(dati);
        _progettoCorrente = dati;
        _sincronizzaDriverIdCounter(dati);
        _modificato = false;
        _aggiungiRecente(dati);
        UI.onProgettoAperto(dati);
      } catch (err) {
        UI.mostraNotifica('Errore nella lettura del file JSON: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  /**
   * Migrazione progetti AB:
   *  - sezione 'sotto_linea' → 'prov_oneri_straord' (rinomina semantica)
   *  - se sono presenti i sottoconti_ce, ricalcola lo storico con la
   *    nuova logica di aggregazione (saldo netto Dare−Avere orientato
   *    sulla macroarea), così che progetti salvati prima del cambio
   *    di regola si allineino senza richiedere all'utente di toccare
   *    la mappatura. Lo storico è derivato dai sottoconti, non viene
   *    editato a mano dall'utente: la sovrascrittura è sicura.
   */
  function _migraProgettoAB(dati) {
    if (Array.isArray(dati.macro_sezioni)) {
      dati.macro_sezioni.forEach(function(m) {
        if (m && m.sezione === 'sotto_linea') m.sezione = 'prov_oneri_straord';
      });
    }
    // Default retrocompatibili per progetti salvati prima dell'introduzione
    // del mese di avvio e del costo figurativo del lavoro dei soci.
    if (dati.meta && (dati.meta.mese_avvio == null || !isFinite(Number(dati.meta.mese_avvio)))) {
      dati.meta.mese_avvio = 1;
    }
    if (!dati.lavoro_soci || typeof dati.lavoro_soci !== 'object') {
      dati.lavoro_soci = { attivo: false, ragguaglio: true, righe: [] };
    } else {
      if (!Array.isArray(dati.lavoro_soci.righe)) dati.lavoro_soci.righe = [];
      // Ragguaglio ore al primo anno parziale: default attivo per i progetti
      // salvati prima della sua introduzione.
      if (dati.lavoro_soci.ragguaglio == null) dati.lavoro_soci.ragguaglio = true;
    }
    // Simulazione compenso amministratori (netto socio + costo azienda):
    // default disattivata, aliquote medie indicative (prelievo socio 35%,
    // ricarico azienda 20%) per i progetti precedenti alla feature.
    if (dati.lavoro_soci.simula_compenso == null) dati.lavoro_soci.simula_compenso = false;
    if (!dati.lavoro_soci.fisco || typeof dati.lavoro_soci.fisco !== 'object') {
      dati.lavoro_soci.fisco = { prelievo_socio_pct: 0.35, ricarico_azienda_pct: 0.20 };
    }
    if (Array.isArray(dati.sottoconti_ce) && dati.sottoconti_ce.length > 0
        && typeof ExcelImport !== 'undefined' && ExcelImport.ricalcolaStorico) {
      try {
        dati.storico = ExcelImport.ricalcolaStorico(dati);
      } catch (_e) { /* fallback: lascia lo storico esistente */ }
    }
  }

  /**
   * Validazione minima struttura progetto.
   * @param {Object} dati
   * @returns {boolean}
   */
  function _validaProgetto(dati) {
    if (!dati || typeof dati !== 'object' || !dati.meta) return false;
    if (typeof dati.meta.cliente !== 'string') return false;

    // Modulo AB
    if (dati.meta.modulo === 'ab') {
      return (
        typeof dati.meta.anno_corrente === 'number' &&
        Array.isArray(dati.meta.anni_storici) &&
        dati.macro_sezioni && dati.storico && dati.mapping !== undefined &&
        dati.budget && dati.consuntivo
      );
    }

    // Modulo Imposte (IRES/IRAP/CPB)
    if (dati.meta.modulo === 'imposte') {
      return (
        typeof dati.meta.anno_imposta === 'number' &&
        dati.flag && dati.ce && dati.ires && dati.irap &&
        dati.cpb !== undefined && dati.storico
      );
    }

    // Modulo BP (default per progetti senza meta.modulo, retrocompatibile)
    return (
      typeof dati.meta.anno_base === 'number' &&
      dati.storico &&
      dati.eventi !== undefined
    );
  }

  /* ──────────────────────────────────────────────────────────
     Lista recenti (localStorage)
     ────────────────────────────────────────────────────────── */

  /**
   * Aggiunge / aggiorna un progetto nella lista recenti.
   * Si salva solo un snapshot dei metadati, non l'intero progetto.
   * @param {Object} progetto
   */
  function _aggiungiRecente(progetto) {
    const recenti = leggiRecenti();
    const id = _idProgetto(progetto.meta);

    // Rimuovi eventuale duplicato
    const filtered = recenti.filter(r => r.id !== id);

    // Aggiungi in cima
    filtered.unshift({
      id,
      modulo:          progetto.meta.modulo || 'bp',
      cliente:         progetto.meta.cliente,
      settore:         progetto.meta.settore || '',
      anno_base:       progetto.meta.anno_base,
      anni_previsione: progetto.meta.anni_previsione,
      anno_corrente:   progetto.meta.anno_corrente,
      anni_storici:    progetto.meta.anni_storici,
      scenario:        progetto.meta.scenario,
      modalita:        progetto.meta.modalita,
      creato:          progetto.meta.creato,
      modificato:      progetto.meta.modificato,
      stato:           progetto.meta.stato
    });

    // Mantieni max 20 recenti
    const trimmed = filtered.slice(0, 20);
    try {
      localStorage.setItem(LS_KEY_RECENTI, JSON.stringify(trimmed));
    } catch (e) {
      // localStorage non disponibile (file:// su alcuni browser con impostazioni restrittive)
    }
  }

  /**
   * Legge la lista dei progetti recenti da localStorage.
   * @returns {Array}
   */
  function leggiRecenti() {
    try {
      const raw = localStorage.getItem(LS_KEY_RECENTI);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Genera un id stabile per un progetto dai suoi metadati.
   * @param {Object} meta
   * @returns {string}
   */
  function _idProgetto(meta) {
    const anno = meta.anno_base != null ? meta.anno_base : meta.anno_corrente;
    return `${meta.modulo || 'bp'}_${meta.cliente}_${anno}_${meta.creato}`.replace(/\s+/g, '_');
  }

  /* ──────────────────────────────────────────────────────────
     Eliminazione dalla lista recenti
     ────────────────────────────────────────────────────────── */

  /** id da eliminare — impostato prima di aprire la modale conferma */
  let _idDaEliminare = null;

  /**
   * Prepara e mostra la modale di conferma eliminazione.
   * @param {string} id
   * @param {string} nome
   */
  function richiediElimina(id, nome) {
    _idDaEliminare = id;
    const nomeEl = document.getElementById('modal-elimina-nome');
    if (nomeEl) nomeEl.textContent = nome;
    UI.openModal('modal-elimina');
  }

  /**
   * Esegue l'eliminazione dopo conferma.
   * Chiamato dal pulsante "Elimina" nella modale.
   */
  function confermaElimina() {
    if (!_idDaEliminare) return;
    const recenti = leggiRecenti().filter(r => r.id !== _idDaEliminare);
    try {
      localStorage.setItem(LS_KEY_RECENTI, JSON.stringify(recenti));
    } catch (e) { /* silent */ }

    _idDaEliminare = null;
    UI.closeModal('modal-elimina');
    UI.renderHome(); // Aggiorna la lista
  }

  /* ──────────────────────────────────────────────────────────
     Gestione modifiche non salvate
     ────────────────────────────────────────────────────────── */

  /** Marca il progetto come modificato e aggiorna la status bar. */
  function segnaModificato() {
    _modificato = true;
    UI.aggiornaStatusBar('modified');
  }

  /** @returns {boolean} */
  function haModifiche() { return _modificato; }

  /* ──────────────────────────────────────────────────────────
     Accesso al progetto corrente
     ────────────────────────────────────────────────────────── */

  /** @returns {Object|null} */
  function getProgetto() { return _progettoCorrente; }

  /**
   * Aggiorna un valore nei dati storici del progetto corrente.
   * @param {number} anno
   * @param {'sp'|'ce'|'sp_avvio'} sezione
   * @param {'attivo'|'passivo'|null} lato  - solo per sp
   * @param {string} contoId
   * @param {number} valore
   */
  function setValoreStorico(anno, sezione, lato, contoId, valore) {
    if (!_progettoCorrente) return;
    const annoStr = String(anno);
    if (!_progettoCorrente.storico[annoStr]) {
      _progettoCorrente.storico[annoStr] = _creaAnnoVuoto(_progettoCorrente.meta.scenario);
    }
    const annoData = _progettoCorrente.storico[annoStr];

    if (sezione === 'sp' && lato) {
      annoData.sp[lato][contoId] = valore;
    } else if (sezione === 'ce') {
      annoData.ce[contoId] = valore;
    } else if (sezione === 'sp_avvio') {
      annoData.sp_avvio[contoId] = valore;
    }

    segnaModificato();
  }

  /**
   * Legge un valore dai dati storici.
   * @returns {number}
   */
  function getValoreStorico(anno, sezione, lato, contoId) {
    if (!_progettoCorrente) return 0;
    const annoStr = String(anno);
    const annoData = _progettoCorrente.storico[annoStr];
    if (!annoData) return 0;

    if (sezione === 'sp' && lato) {
      return (annoData.sp && annoData.sp[lato] && annoData.sp[lato][contoId]) || 0;
    }
    if (sezione === 'ce') {
      return (annoData.ce && annoData.ce[contoId]) || 0;
    }
    if (sezione === 'sp_avvio') {
      return (annoData.sp_avvio && annoData.sp_avvio[contoId]) || 0;
    }
    return 0;
  }

  /**
   * Sincronizza i driver con i dati CE storici: aggiorna i valori base
   * dei driver esistenti che hanno un voce_ce collegata, e aggiunge i
   * conti custom come nuovi driver se non gia presenti.
   */
  function sincronizzaDriverDaCE() {
    if (!_progettoCorrente) return;
    var p = _progettoCorrente;
    var anno = String(p.meta.anno_base);
    var annoData = p.storico[anno];
    if (!annoData || !annoData.ce) return;

    var ce = annoData.ce;
    var aggiunti = 0;

    // Aggiorna ricavi esistenti con valori da CE
    p.driver.ricavi.forEach(function(drv) {
      if (drv.voce_ce && ce[drv.voce_ce] !== undefined) {
        drv.base_annuale = ce[drv.voce_ce] || 0;
      }
    });

    // Aggiorna costi esistenti con valori da CE
    p.driver.costi.forEach(function(drv) {
      if (drv.voce_ce && ce[drv.voce_ce] !== undefined) {
        var val = ce[drv.voce_ce] || 0;
        if (drv.tipo_driver === 'pct_ricavi') {
          // Non sovrascrivere la percentuale col valore assoluto
        } else {
          drv.importo_fisso = val;
        }
      }
    });

    // Aggiungi driver da conti custom non ancora presenti
    var driverVoci = {};
    p.driver.ricavi.forEach(function(d) { if (d.voce_ce) driverVoci[d.voce_ce] = true; });
    p.driver.costi.forEach(function(d) { if (d.voce_ce) driverVoci[d.voce_ce] = true; });

    (p.conti_custom || []).forEach(function(cc) {
      if (driverVoci[cc.id]) return;
      var val = ce[cc.id] || 0;
      // Determina se e ricavo o costo dal parent
      if (cc.parent_id && cc.parent_id.indexOf('ce.A') === 0) {
        var drv = creaDriverRicavo(cc.id, cc.label, val);
        p.driver.ricavi.push(drv);
        aggiunti++;
      } else if (cc.parent_id && cc.parent_id.indexOf('ce.B') === 0) {
        var isPersonale = cc.parent_id.indexOf('ce.B.9') === 0;
        var drv = creaDriverCosto(cc.id, cc.label, isPersonale ? 'personale' : 'fisso');
        if (drv.importo_fisso !== null) drv.importo_fisso = val;
        p.driver.costi.push(drv);
        aggiunti++;
      }
    });

    segnaModificato();
    return aggiunti;
  }

  /* ──────────────────────────────────────────────────────────
     Utility interne
     ────────────────────────────────────────────────────────── */

  function _mostraErroreModal(msg) {
    // Rimuovi eventuale errore precedente
    const prev = document.getElementById('modal-np-error');
    if (prev) prev.remove();

    const div = document.createElement('div');
    div.id = 'modal-np-error';
    div.style.cssText = 'padding:10px 14px;border-radius:4px;font-size:13px;margin-bottom:12px;';
    div.className = 'text-error';
    div.style.background = 'var(--color-error-bg)';
    div.textContent = msg;

    const body = document.querySelector('#modal-nuovo-progetto .modal-body');
    if (body) body.prepend(div);
  }

  function _resetFormNuovoProgetto() {
    const prev = document.getElementById('modal-np-error');
    if (prev) prev.remove();

    const clienteEl = document.getElementById('np-cliente');
    const settoreEl = document.getElementById('np-settore');
    const annoEl    = document.getElementById('np-anno-base');
    const anniEl    = document.getElementById('np-anni-prev');

    if (clienteEl) clienteEl.textContent = '';
    if (settoreEl) settoreEl.textContent = '';
    if (annoEl)    annoEl.textContent    = '';
    if (anniEl)    anniEl.textContent    = '3';

    // Reset radio
    document.querySelectorAll('#np-scenario .radio-item').forEach((el, i) => {
      el.classList.toggle('selected', i === 0);
    });
    // Reset toggle
    document.querySelectorAll('#np-modalita .toggle-item').forEach((el, i) => {
      el.classList.toggle('active', i === 0);
    });
  }

  /* ──────────────────────────────────────────────────────────
     Modulo Analisi Costi & Budget — creazione progetto AB
     ────────────────────────────────────────────────────────── */

  /**
   * Costruisce la struttura dati di un progetto AB.
   *
   *   meta.modulo === 'ab' è il discriminatore usato in apri/salva
   *   e dalla UI per scegliere sidebar e routing.
   *
   *   macro_sezioni è una copia profonda di MACROAREE_AB (schema fisso
   *   da budget-engine.js). Si copia per consentire eventuali override
   *   futuri specifici del progetto senza mutare la costante globale.
   *
   *   storico contiene una entry per ciascuno degli N anni precedenti
   *   l'anno corrente, vuota: { 'YYYY': {} } in cui le chiavi saranno
   *   gli id delle macroaree popolati dall'import CE (Step 3).
   *
   *   mapping è la tabella sottoconto_codice → macroarea_id, popolata
   *   dalla UI di mappatura (Step 4). Vuoto alla creazione.
   *
   *   budget e consuntivo restano vuoti, popolati negli Step 6 e 7.
   */
  function _creaStrutturaAB(meta) {
    const oggi = new Date().toISOString().split('T')[0];
    const annoCorr = meta.anno_corrente;
    const nAnni = meta.anni_storici;

    // nAnni = 0 → società neocostituita: nessuno storico (anniStorici vuoto).
    const anniStorici = [];
    for (let i = nAnni; i >= 1; i--) anniStorici.push(annoCorr - i);

    const storico = {};
    anniStorici.forEach(a => { storico[a] = {}; });

    // Mese di avvio attività (1-12). >1 = società costituita in corso d'anno
    // (primo esercizio parziale). Vedi engine.calcolaPreconsuntivo.
    const meseAvvio = Math.min(12, Math.max(1, parseInt(meta.mese_avvio, 10) || 1));

    return {
      meta: {
        modulo:          'ab',
        cliente:         meta.cliente,
        settore:         meta.settore || '',
        anno_corrente:   annoCorr,
        anni_storici:    anniStorici,
        mese_avvio:      meseAvvio,
        note_anagrafica: [],   // [{titolo, testo}] — esposte negli export
        creato:          oggi,
        modificato:      oggi,
        stato:           'in_lavorazione'
      },
      macro_sezioni: JSON.parse(JSON.stringify(BudgetEngine.MACROAREE_AB)),
      mapping:       {},          // { 'XX/XX/XXX': 'macroarea_id' }
      storico:       storico,     // { 'YYYY': { macroarea_id: importo } }
      budget:        {            // { fatturato_ipotizzato, override_pct: {}, override_fissi: {}, note: {} }
        fatturato_ipotizzato: null,
        override_pct:    {},
        override_fissi:  {},
        note:            {}        // { macroarea_id: 'testo nota libero' }
      },
      consuntivo: {
        frequenza: 'mensile',     // 'mensile' | 'trimestrale'
        fatturato: {}             // { '01': 1234, '02': ... }
      },
      lavoro_soci: {              // Costo figurativo lavoro soci (fuori dal CE
        attivo:     false,        // civilistico — vedi engine.calcolaLavoroSoci)
        ragguaglio: true,         // ragguaglia le ore annue al primo anno parziale
        righe:      [],           // [{ id, nome, ore, tariffa }] — ore annue a regime
        simula_compenso: false,   // simulazione compenso amministratori (netto/costo azienda)
        fisco: {                  // aliquote medie indicative (stima rapida)
          prelievo_socio_pct:   0.35,  // IRPEF + addizionali + INPS quota socio
          ricarico_azienda_pct: 0.20   // INPS 2/3 c/società + IRAP indeducibile
        }
      }
    };
  }

  function creaAnalisi() {
    const dittaEl   = document.getElementById('na-ditta');
    const settoreEl = document.getElementById('na-settore');
    const annoEl    = document.getElementById('na-anno-corrente');
    const anniEl    = document.getElementById('na-anni-storici');
    const meseEl    = document.getElementById('na-mese-avvio');

    const cliente   = (dittaEl   && dittaEl.textContent   || '').trim();
    const settore   = (settoreEl && settoreEl.textContent || '').trim();
    const annoCorr  = parseInt(((annoEl  && annoEl.textContent)  || '').trim(), 10);
    const nAnni     = parseInt(((anniEl  && anniEl.textContent)  || '3').trim(), 10);
    const meseAvvio = meseEl ? (parseInt(meseEl.value, 10) || 1) : 1;

    const errori = [];
    if (!cliente) errori.push('Il nome ditta è obbligatorio.');
    if (isNaN(annoCorr) || annoCorr < 1900 || annoCorr > 2100) errori.push('Anno corrente non valido.');
    // 0 anni = società neocostituita (nessuno storico): budget costruito dai
    // soli valori ipotizzati/override, senza import del CE.
    if (isNaN(nAnni) || nAnni < 0 || nAnni > 3) errori.push('Anni di storico deve essere tra 0 e 3.');

    if (errori.length > 0) {
      UI.mostraNotifica(errori.join(' '), 'error');
      return;
    }

    const progetto = _creaStrutturaAB({
      cliente, settore, anno_corrente: annoCorr, anni_storici: nAnni, mese_avvio: meseAvvio
    });

    _progettoCorrente = progetto;
    _modificato = true;
    _aggiungiRecente(progetto);

    UI.closeModal('modal-nuova-analisi');
    _resetFormNuovaAnalisi();
    UI.onProgettoAperto(progetto);
  }

  function _resetFormNuovaAnalisi() {
    const ids = ['na-ditta', 'na-settore', 'na-anno-corrente'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
    const anni = document.getElementById('na-anni-storici');
    if (anni) anni.textContent = '3';
    const mese = document.getElementById('na-mese-avvio');
    if (mese) mese.value = '1';
  }

  /* ──────────────────────────────────────────────────────────
     Modulo Imposte — creazione progetto IM
     ────────────────────────────────────────────────────────── */

  /**
   * Costruisce la struttura dati di un progetto Imposte coerente con
   * lo schema descritto in caratteristiche_modulo_imposte.md §17.
   *
   *   meta.modulo === 'imposte' è il discriminatore usato in apri/salva
   *   e dalla UI per scegliere sidebar e routing.
   */
  function _creaStrutturaImposte(meta) {
    const oggi = new Date().toISOString().split('T')[0];
    const annoImposta = meta.anno_imposta;
    return {
      meta: {
        modulo:            'imposte',
        cliente:           meta.cliente,
        p_iva:             meta.p_iva || '',
        ateco:             meta.ateco || '',
        regione:           meta.regione || '',
        anno_imposta:      annoImposta,
        anno_versamento:   annoImposta + 1,
        data_costituzione: meta.data_costituzione || '',
        creato:            oggi,
        modificato:        oggi,
        stato:             'in_lavorazione',
        chiuso:            false
      },
      flag: {
        societa_trasparente:    false,
        cpb_attivo:             false,
        soggetto_isa:           true,
        punteggio_isa:          null,
        data_versamento_saldo:  '30_giugno'
      },
      ce: {
        risultato_ante_imposte: 0,
        A_totale: 0, B_totale: 0,
        B9: 0, B10c: 0, B10d: 0, B12: 0, B13: 0,
        C_saldo: 0
      },
      lavoro_irap: {
        costo_dip_indeterminato_anno:                     0,
        costo_dip_indeterminato_anno_prec:                0,
        costo_amm_cocoo_anno:                             0,
        costo_amm_cocoo_anno_prec:                        0,
        saldo_irap_anno_prec_versato:                     0,
        acconti_irap_anno_versati:                        0,
        base_imp_irap_anno_prec:                          0,
        deduzioni_irap_anno_prec_no_occupazionali:        0
      },
      ires: {
        variazioni_aumento:    {},   // RF6..RF31_cod99_altre — popolate dalla UI
        variazioni_diminuzione:{},   // RF34..RF55_cod99
        crediti_e_ritenute:    0,
        detrazioni:            0,
        credito_anno_prec_residuo: 0,
        acconti_versati:       0,
        rol_input: {
          ip_anno: 0,
          ia_anno: 0,
          valori_a_b_fiscali: {
            A: 0, B: 0, amm_immateriali: 0, amm_materiali: 0,
            canoni_leasing: 0, dividendi_controllate_estere: 0,
            altri_componenti_periodi_precedenti: 0
          }
        }
      },
      irap: {
        variazioni_aumento:    {},   // IC43..IC51_cod99
        variazioni_diminuzione:{},   // IC53..IC57_cod99
        deduzioni: {
          IS1_inail:                    0,
          IS4_apprendisti_disabili_rd:  0,
          IS5_dipendenti_1850:          { n_dipendenti: 0, ricavi_totali: 0 },
          IS7_costo_personale_indet:    0,
          IS9_eccedenze:                0
        },
        aliquota_override:         null,
        credito_anno_prec_residuo: 0,
        acconti_versati:           0
      },
      cpb: {
        reddito_concordato:           0,
        reddito_ante_cpb_rettificato: 0,
        var_attive:                   0,
        var_passive:                  0,
        vp_concordato:                0,
        var_attive_irap:              0,
        var_passive_irap:             0
      },
      storico: {
        plusvalenze_rateizzate:       [],
        manutenzioni_eccedenti_5pct:  [],
        interessi_passivi_riporto:    0,
        rol_riporto:                  0,
        perdite_piene:                [],
        perdite_limitate:             [],
        ace_residua:                  0,
        credito_ires_residuo:         0,
        credito_irap_residuo:         0
      }
    };
  }

  function creaImposte() {
    const clienteEl = document.getElementById('ni-cliente');
    const pivaEl    = document.getElementById('ni-piva');
    const atecoEl   = document.getElementById('ni-ateco');
    const annoEl    = document.getElementById('ni-anno-imposta');
    const regioneEl = document.getElementById('ni-regione');
    const dataCostEl = document.getElementById('ni-data-costituzione');

    const cliente   = (clienteEl  && clienteEl.textContent || '').trim();
    const pIva      = (pivaEl     && pivaEl.textContent || '').trim();
    const ateco     = (atecoEl    && atecoEl.textContent || '').trim();
    const annoImp   = parseInt(((annoEl && annoEl.textContent) || '').trim(), 10);
    const regione   = (regioneEl  && regioneEl.textContent || '').trim();
    const dataCost  = (dataCostEl && dataCostEl.textContent || '').trim();

    const errori = [];
    if (!cliente) errori.push('La ragione sociale è obbligatoria.');
    if (isNaN(annoImp) || annoImp < 2000 || annoImp > 2100) errori.push('Anno d\'imposta non valido.');
    if (!regione) errori.push('La regione è obbligatoria.');
    if (dataCost && !/^\d{4}-\d{2}-\d{2}$/.test(dataCost)) {
      errori.push('Data costituzione: formato atteso YYYY-MM-DD.');
    }

    if (errori.length > 0) {
      UI.mostraNotifica(errori.join(' '), 'error');
      return;
    }

    const progetto = _creaStrutturaImposte({
      cliente:           cliente,
      p_iva:             pIva,
      ateco:             ateco,
      anno_imposta:      annoImp,
      regione:           regione,
      data_costituzione: dataCost
    });

    _progettoCorrente = progetto;
    _modificato = true;
    _aggiungiRecente(progetto);

    UI.closeModal('modal-nuove-imposte');
    _resetFormNuoveImposte();
    UI.onProgettoAperto(progetto);
  }

  function _resetFormNuoveImposte() {
    ['ni-cliente', 'ni-piva', 'ni-ateco', 'ni-anno-imposta', 'ni-regione', 'ni-data-costituzione']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
      });
  }

  /**
   * Applica al progetto AB corrente l'import CE già parsato e
   * mappato. Sovrascrive sottoconti_ce, mapping e storico.
   *
   *   - meta.cliente viene aggiornato con la ditta letta dal file
   *     se nessuno era stato impostato in fase di creazione.
   *   - meta.anni_storici viene riscritto con gli anni del file (può
   *     accadere che differisca dal valore ipotizzato in creazione,
   *     in tal caso il file vince perché è la fonte autoritativa).
   *   - storico viene rigenerato dalle aggregazioni.
   *
   * @param {Object} parsed   - output di ExcelImport.parseBilancioVerifica
   * @param {Object} mapping  - { codice_sottoconto: macroarea_id }
   * @param {Object} storico  - output di ExcelImport.calcolaStorico
   */
  function applicaImportCE(parsed, mapping, storico) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return;

    if (!_progettoCorrente.meta.cliente && parsed.ditta) {
      _progettoCorrente.meta.cliente = parsed.ditta;
    }
    _progettoCorrente.meta.anni_storici = parsed.anni.slice();

    _progettoCorrente.sottoconti_ce = parsed.sottoconti;
    _progettoCorrente.rimanenze     = parsed.rimanenze;
    _progettoCorrente.mapping       = mapping;
    _progettoCorrente.storico       = storico;

    _modificato = true;
  }

  /**
   * Import "infrannuale" per società NEOCOSTITUITE (anni_storici vuoto).
   *
   * A differenza di applicaImportCE (che archivia gli anni del file come
   * storico chiuso), qui l'anno più recente del file è l'ANNO IN CORSO, di
   * cui sono noti solo alcuni mesi (bilancio di verifica infrannuale). Da
   * quei dati parziali costruisce:
   *
   *   - Budget: incidenze % dei costi variabili (scale-free) come override_pct;
   *     costi fissi/imposte/proventi proiettati avvio→dic (× fattore) come
   *     override_fissi; fatturato_ipotizzato = ricavi proiettati avvio→dic.
   *     fattore = mesi_operativi / mesi_coperti, dove
   *       mesi_coperti   = mese_riferimento − mese_avvio + 1
   *       mesi_operativi = 12 − mese_avvio + 1
   *   - Consuntivo: il fatturato realizzato (ricavi YTD del file) ripartito in
   *     parti uguali sui mesi avvio→riferimento (poi override manuale).
   *
   * `anni_storici` resta vuoto (la società rimane neocostituita); i sottoconti
   * e il mapping vengono comunque salvati (Mappatura disponibile), lo storico
   * resta vuoto. Le rimanenze (stock) sono riportate as-is, non proiettate.
   *
   * @param {Object} parsed          - output del parser (sottoconti, anni, ...)
   * @param {Object} mapping         - sottoconto → macroarea
   * @param {Object} storicoPreview  - { anno: { macro_id: valore } } dell'anteprima
   * @param {number} meseRiferimento - mese (1-12) fino a cui i dati sono aggiornati
   */
  function applicaImportInfrannuale(parsed, mapping, storicoPreview, meseRiferimento) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return;
    const meta = _progettoCorrente.meta;
    if (!meta.cliente && parsed.ditta) meta.cliente = parsed.ditta;

    // Sottoconti/mapping sì; anni_storici resta vuoto (neocostituita): l'anno
    // importato è l'anno in corso, non uno storico chiuso.
    _progettoCorrente.sottoconti_ce = parsed.sottoconti;
    _progettoCorrente.rimanenze     = parsed.rimanenze;
    _progettoCorrente.mapping       = mapping;
    _progettoCorrente.storico       = {};
    meta.anni_storici               = [];

    const annoCorrente = Math.max.apply(null, parsed.anni);
    const vals = (storicoPreview && storicoPreview[annoCorrente]) || {};
    const ricaviYtd = Number(vals.ricavi) || 0;

    const meseAvvio = Math.min(12, Math.max(1, parseInt(meta.mese_avvio, 10) || 1));
    const meseRif   = Math.min(12, Math.max(meseAvvio, parseInt(meseRiferimento, 10) || meseAvvio));
    const mesiCoperti   = meseRif - meseAvvio + 1;
    const mesiOperativi = 12 - meseAvvio + 1;
    const fattore = mesiCoperti > 0 ? (mesiOperativi / mesiCoperti) : 1;

    // Budget: incidenze % (variabili) e valori proiettati avvio→dic (fissi).
    const budget = _progettoCorrente.budget
      || (_progettoCorrente.budget = { fatturato_ipotizzato: null, override_pct: {}, override_fissi: {}, note: {} });
    budget.override_pct   = {};
    budget.override_fissi = {};
    budget.fatturato_ipotizzato = Math.round(ricaviYtd * fattore);

    const macro = _progettoCorrente.macro_sezioni || BudgetEngine.MACROAREE_AB;
    macro.forEach(function(m) {
      if (m.id === 'ricavi') return;
      const v = Number(vals[m.id]) || 0;
      if (m.var_fisso === 'variabile' && !m.calcolato) {
        // Incidenza % sul fatturato: indipendente dall'orizzonte.
        if (ricaviYtd > 0) budget.override_pct[m.id] = v / ricaviYtd;
      } else if (m.calcolato) {
        // Rimanenze (stock): valore così com'è, non proiettato.
        if (v) budget.override_fissi[m.id] = v;
      } else if (v) {
        // Fissi / imposte / proventi-oneri: proiezione lineare avvio→dic.
        budget.override_fissi[m.id] = Math.round(v * fattore);
      }
    });

    // Consuntivo: fatturato realizzato ripartito in parti uguali sui mesi
    // avvio→riferimento (poi override manuale per singolo mese).
    const cons = _progettoCorrente.consuntivo
      || (_progettoCorrente.consuntivo = { frequenza: 'mensile', fatturato: {} });
    cons.frequenza = 'mensile';
    cons.fatturato = {};
    const quota = mesiCoperti > 0 ? (ricaviYtd / mesiCoperti) : 0;
    for (let mm = meseAvvio; mm <= meseRif; mm++) {
      const key = (mm < 10 ? '0' : '') + mm;
      if (quota) cons.fatturato[key] = Math.round(quota);
    }

    // Tracciabilità dell'import infrannuale.
    meta.import_infrannuale = { anno: annoCorrente, mese_riferimento: meseRif, mesi_coperti: mesiCoperti };

    _modificato = true;
  }

  /**
   * Aggiorna i campi del budget (fatturato ipotizzato, override e note).
   *
   *   field può essere:
   *     'fatturato_ipotizzato'   → value: number | null
   *     'override_pct.<id>'      → value: number (decimale, 0.12 = 12%) | null
   *     'override_fissi.<id>'    → value: number (€) | null
   *     'note.<id>'              → value: string | null
   *
   *   Passare value null/NaN/'' rimuove l'override o la nota
   *   (torna al default storico / nota assente).
   */
  function aggiornaBudget(field, value) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return;
    if (!_progettoCorrente.budget) {
      _progettoCorrente.budget = { fatturato_ipotizzato: null, override_pct: {}, override_fissi: {}, note: {} };
    }
    const b = _progettoCorrente.budget;
    if (!b.override_pct)   b.override_pct   = {};
    if (!b.override_fissi) b.override_fissi = {};
    if (!b.note)           b.note           = {};

    const isVuoto = value == null || (typeof value === 'number' && !isFinite(value));

    if (field === 'fatturato_ipotizzato') {
      b.fatturato_ipotizzato = isVuoto ? null : Number(value);
    } else if (field.indexOf('override_pct.') === 0) {
      const id = field.substring('override_pct.'.length);
      if (isVuoto) delete b.override_pct[id];
      else         b.override_pct[id] = Number(value);
    } else if (field.indexOf('override_fissi.') === 0) {
      const id = field.substring('override_fissi.'.length);
      if (isVuoto) delete b.override_fissi[id];
      else         b.override_fissi[id] = Number(value);
    } else if (field.indexOf('note.') === 0) {
      const id = field.substring('note.'.length);
      const testo = (typeof value === 'string') ? value.trim() : '';
      if (!testo) delete b.note[id];
      else        b.note[id] = testo;
    } else {
      return;
    }

    _modificato = true;
  }

  /**
   * Aggiorna i campi del consuntivo:
   *
   *   field può essere:
   *     'frequenza'                  → value: 'mensile' | 'trimestrale'
   *                                     (cambia anche reset del fatturato e
   *                                     dell'atteso per periodo perché gli
   *                                     indici cambiano significato)
   *     'fatturato.<periodo>'        → value: number | null (€ fatturato nel
   *                                     periodo, periodo è '01'..'12' per
   *                                     mensile o '1'..'4' per trimestrale)
   *     'modalita_proiezione'        → value: 'lineare' | 'stagionalizzata'
   *                                     (selezione della logica di proiezione
   *                                     fine anno: vedi engine.calcolaPreconsuntivo)
   *     'fatturato_atteso.<periodo>' → value: number | null (€ atteso nel
   *                                     periodo aperto, usato dalla modalità
   *                                     stagionalizzata per stimare i periodi
   *                                     non ancora consuntivati)
   */
  function aggiornaConsuntivo(field, value) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return;
    if (!_progettoCorrente.consuntivo) {
      _progettoCorrente.consuntivo = { frequenza: 'mensile', fatturato: {} };
    }
    const c = _progettoCorrente.consuntivo;
    if (!c.fatturato) c.fatturato = {};

    if (field === 'frequenza') {
      if (value === 'mensile' || value === 'trimestrale') {
        if (c.frequenza !== value) {
          c.frequenza = value;
          c.fatturato = {};
          c.fatturato_atteso = {};
        }
      }
    } else if (field === 'modalita_proiezione') {
      if (value === 'lineare' || value === 'stagionalizzata') {
        c.modalita_proiezione = value;
      }
    } else if (field === 'rim_distribuzione') {
      // Modalità di distribuzione delle rimanenze sui periodi del consuntivo:
      //   'lineare'    → quota proporzionale al tempo trascorso (default);
      //   'stagionale' → quota proporzionale agli acquisti (fatturato periodo).
      if (value === 'lineare' || value === 'stagionale') {
        c.rim_distribuzione = value;
      }
    } else if (field.indexOf('override_rim.') === 0) {
      // Rettifica manuale del valore di fine anno di una voce rimanenze
      // (rim_ini / rim_fin). Cella VUOTA (value null) → si torna al valore di
      // budget. Uno 0 esplicito è invece una rettifica valida (magazzino
      // azzerato a fine anno), quindi va conservato.
      if (!c.override_rim) c.override_rim = {};
      const voce = field.substring('override_rim.'.length);
      const isVuoto = value == null || (typeof value === 'number' && !isFinite(value));
      if (isVuoto) delete c.override_rim[voce];
      else         c.override_rim[voce] = Number(value);
    } else if (field.indexOf('fatturato.') === 0) {
      const periodo = field.substring('fatturato.'.length);
      const isVuoto = value == null || (typeof value === 'number' && (!isFinite(value) || value === 0));
      if (isVuoto) delete c.fatturato[periodo];
      else         c.fatturato[periodo] = Number(value);
    } else if (field.indexOf('fatturato_atteso.') === 0) {
      if (!c.fatturato_atteso) c.fatturato_atteso = {};
      const periodo = field.substring('fatturato_atteso.'.length);
      const isVuoto = value == null || (typeof value === 'number' && (!isFinite(value) || value === 0));
      if (isVuoto) delete c.fatturato_atteso[periodo];
      else         c.fatturato_atteso[periodo] = Number(value);
    } else {
      return;
    }

    _modificato = true;
  }

  /**
   * Aggiorna un campo di meta del progetto AB.
   *
   *   field === 'mese_avvio' → value: number 1-12 (mese di avvio attività;
   *     clampato a [1,12]). Determina i periodi operativi del consuntivo e
   *     il seed del budget per società costituite in corso d'anno.
   */
  function aggiornaMetaAB(field, value) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return;
    if (field === 'mese_avvio') {
      const m = Math.round(Number(value));
      _progettoCorrente.meta.mese_avvio = isFinite(m) ? Math.min(12, Math.max(1, m)) : 1;
      _modificato = true;
    }
  }

  /* ──────────────────────────────────────────────────────────
     Lavoro soci — costo figurativo (modulo AB)

     Struttura: progetto.lavoro_soci = { attivo, righe:[{id,nome,ore,tariffa}] }
     Il costo figurativo (Σ ore×tariffa) è calcolato dall'engine e resta
     FUORI dal CE civilistico: alimenta solo il "reddito normalizzato".
     ────────────────────────────────────────────────────────── */

  function _assicuraLavoroSoci() {
    if (!_progettoCorrente.lavoro_soci || typeof _progettoCorrente.lavoro_soci !== 'object') {
      _progettoCorrente.lavoro_soci = { attivo: false, ragguaglio: true, righe: [] };
    }
    if (!Array.isArray(_progettoCorrente.lavoro_soci.righe)) {
      _progettoCorrente.lavoro_soci.righe = [];
    }
    if (_progettoCorrente.lavoro_soci.ragguaglio == null) {
      _progettoCorrente.lavoro_soci.ragguaglio = true;
    }
    if (_progettoCorrente.lavoro_soci.simula_compenso == null) {
      _progettoCorrente.lavoro_soci.simula_compenso = false;
    }
    if (!_progettoCorrente.lavoro_soci.fisco || typeof _progettoCorrente.lavoro_soci.fisco !== 'object') {
      _progettoCorrente.lavoro_soci.fisco = { prelievo_socio_pct: 0.35, ricarico_azienda_pct: 0.20 };
    }
    return _progettoCorrente.lavoro_soci;
  }

  // ID socio stabile e privo di collisioni al caricamento: max numerico
  // esistente + 1 (formato 's<N>').
  function _nextSocioId(righe) {
    let max = 0;
    (righe || []).forEach(function(r) {
      const n = r && typeof r.id === 'string' ? parseInt(r.id.replace(/^s/, ''), 10) : NaN;
      if (isFinite(n) && n > max) max = n;
    });
    return 's' + (max + 1);
  }

  /** Attiva/disattiva il conteggio del costo figurativo dei soci. */
  function lavoroSociToggle(attivo) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return;
    const ls = _assicuraLavoroSoci();
    ls.attivo = !!attivo;
    _modificato = true;
  }

  /**
   * Attiva/disattiva il ragguaglio delle ore al primo anno parziale.
   * Quando attivo (e mese_avvio > 1) le ore annue a regime vengono ridotte
   * al fattore mesi_operativi/12 nel calcolo del costo figurativo.
   */
  function lavoroSociRagguaglio(attivo) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return;
    const ls = _assicuraLavoroSoci();
    ls.ragguaglio = !!attivo;
    _modificato = true;
  }

  /**
   * Attiva/disattiva la simulazione "compenso amministratori" (netto in tasca
   * al socio + costo pieno per l'azienda), mostrata come pannello nel blocco
   * soci del Budget.
   */
  function lavoroSociSimula(attivo) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return;
    const ls = _assicuraLavoroSoci();
    ls.simula_compenso = !!attivo;
    _modificato = true;
  }

  /**
   * Aggiorna un'aliquota media della simulazione compenso.
   * @param {'prelievo_socio_pct'|'ricarico_azienda_pct'} campo
   * @param {number} pct - percentuale in punti (es. 35 → 0,35). Clampata 0-100.
   */
  function lavoroSociFisco(campo, pct) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return;
    if (campo !== 'prelievo_socio_pct' && campo !== 'ricarico_azienda_pct') return;
    const ls = _assicuraLavoroSoci();
    let v = Number(pct);
    if (!isFinite(v) || v < 0) v = 0;
    if (v > 100) v = 100;
    ls.fisco[campo] = v / 100;
    _modificato = true;
  }

  /** Aggiunge una riga socio vuota e restituisce il suo id. */
  function lavoroSociAddRiga() {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return null;
    const ls = _assicuraLavoroSoci();
    const id = _nextSocioId(ls.righe);
    ls.righe.push({ id: id, nome: '', ore: 0, tariffa: 0 });
    ls.attivo = true;   // aggiungere un socio implica attivare il conteggio
    _modificato = true;
    return id;
  }

  /**
   * Aggiorna un campo di una riga socio.
   *   campo: 'nome' (string) | 'ore' (number) | 'tariffa' (number €/ora)
   */
  function lavoroSociUpdateRiga(id, campo, value) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return;
    const ls = _assicuraLavoroSoci();
    const riga = ls.righe.find(function(r) { return r.id === id; });
    if (!riga) return;
    if (campo === 'nome') {
      riga.nome = (typeof value === 'string') ? value.trim() : '';
    } else if (campo === 'ore' || campo === 'tariffa') {
      const n = Number(value);
      riga[campo] = isFinite(n) && n >= 0 ? n : 0;
    }
    _modificato = true;
  }

  /** Elimina una riga socio per id. */
  function lavoroSociRemoveRiga(id) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return;
    const ls = _assicuraLavoroSoci();
    ls.righe = ls.righe.filter(function(r) { return r.id !== id; });
    _modificato = true;
  }

  /**
   * Aggiorna la macroarea destinataria di un sottoconto e ricalcola
   * lo storico. Usato dalla UI di mappatura (Step 4).
   *
   *   macroarea_id può essere null/'' per rimuovere la mappatura
   *   (sottoconto "non mappato").
   */
  function aggiornaMappingSottoconto(codice, macroarea_id) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return;
    if (!_progettoCorrente.mapping) _progettoCorrente.mapping = {};

    if (macroarea_id) {
      _progettoCorrente.mapping[codice] = macroarea_id;
    } else {
      delete _progettoCorrente.mapping[codice];
    }

    _progettoCorrente.storico = ExcelImport.ricalcolaStorico(_progettoCorrente);
    _modificato = true;
  }

  /**
   * Modifica l'importo di un sottoconto CE per un anno direttamente
   * dalla mappatura, senza dover correggere e re-importare il file
   * Excel di origine (post-import di valori errati o rettifiche su
   * bilanci passati).
   *
   * L'importo passato è il valore "lordo" mostrato in tabella
   * (Math.max(dare, avere), sempre ≥ 0). Viene riscritto sul lato
   * contabile prevalente del sottoconto per quell'anno, preservando
   * la natura Dare/Avere del conto:
   *   - conto in Avere (o mappato a una macroarea di tipo ricavo)
   *     → nuovo importo in Avere;
   *   - altrimenti → in Dare.
   * `netto = dare − avere` viene aggiornato di conseguenza e lo
   * storico ricalcolato.
   *
   * @param {string} codice
   * @param {string|number} anno
   * @param {number|null} nuovoValore  (null/NaN ⇒ 0)
   * @returns {boolean} true se aggiornato
   */
  function aggiornaValoreSottoconto(codice, anno, nuovoValore) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return false;
    const sc = (_progettoCorrente.sottoconti_ce || []).find(s => s.codice === codice);
    if (!sc) return false;

    const val = (typeof nuovoValore === 'number' && isFinite(nuovoValore)) ? nuovoValore : 0;
    const importo = Math.abs(val);

    if (!sc.valori) sc.valori = {};
    const prec = sc.valori[anno] || { dare: 0, avere: 0, netto: 0 };

    // Lato prevalente da preservare: quello con l'importo maggiore.
    // Se il valore precedente è nullo/simmetrico, deduci il lato dal
    // tipo della macroarea mappata (ricavo ⇒ Avere, altrimenti Dare).
    let lato;
    if (prec.avere > prec.dare)      lato = 'avere';
    else if (prec.dare > prec.avere) lato = 'dare';
    else {
      const macroId = (_progettoCorrente.mapping || {})[codice];
      const macro = (_progettoCorrente.macro_sezioni || []).find(m => m.id === macroId);
      lato = (macro && macro.tipo === 'ricavo') ? 'avere' : 'dare';
    }

    sc.valori[anno] = (lato === 'avere')
      ? { dare: 0, avere: importo, netto: -importo }
      : { dare: importo, avere: 0, netto: importo };

    _progettoCorrente.storico = ExcelImport.ricalcolaStorico(_progettoCorrente);
    _modificato = true;
    return true;
  }

  /**
   * Rimuove un sottoconto CE dal progetto (es. conto a zero o
   * duplicato). Elimina anche la sua eventuale mappatura e ricalcola
   * lo storico. Non tocca il file Excel di origine.
   *
   * Nota: i sottoconti dei mastri di variazione rimanenze concorrono
   * al blocco `rimanenze` calcolato in fase di import; la UI ne
   * impedisce l'eliminazione (righe read-only), quindi qui non serve
   * ricalcolare le rimanenze.
   *
   * @param {string} codice
   * @returns {boolean} true se eliminato
   */
  function eliminaSottoconto(codice) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return false;
    const arr = _progettoCorrente.sottoconti_ce;
    if (!Array.isArray(arr)) return false;
    const idx = arr.findIndex(s => s.codice === codice);
    if (idx < 0) return false;

    arr.splice(idx, 1);
    if (_progettoCorrente.mapping) delete _progettoCorrente.mapping[codice];

    _progettoCorrente.storico = ExcelImport.ricalcolaStorico(_progettoCorrente);
    _modificato = true;
    return true;
  }

  /**
   * Aggiunge una nuova voce di conto (sottoconto) creata a mano, senza
   * dover re-importare l'Excel. Serve per rettifiche post-import e
   * soprattutto per voci che entreranno nell'anno da budgetare e prima
   * non c'erano (es. "Compenso soci", un nuovo costo/servizio):
   * la si crea qui a 0 sullo storico e poi la si valorizza per l'anno
   * di budget con l'override della sua macroarea (eventualmente un
   * "Nuovo gruppo" dedicato).
   *
   * L'importo iniziale è 0 su tutti gli anni (`valori: {}`): l'operatore
   * lo rettifica poi dalle celle editabili della mappatura se serve un
   * valore storico. Il conto è marcato `manuale: true` per distinguerlo
   * dalle voci importate.
   *
   * Se il codice ha forma NN/NN il mastro/sottomastro vengono dedotti
   * (utile per la colonna Mastro e la pre-mappatura); altrimenti restano
   * vuoti. Non è ammesso un codice sui mastri di variazione rimanenze
   * (61/80): quelle voci confluiscono nel blocco calcolato e non vanno
   * inserite a mano come righe normali.
   *
   * @param {string} codice       - codice conto (univoco, obbligatorio)
   * @param {string} descrizione  - descrizione libera
   * @param {string} [macroId]    - macroarea di destinazione (mapping);
   *                                 vuoto ⇒ resta "Non mappato"
   * @returns {{ok:boolean, codice?:string, err?:string}}
   */
  /**
   * Genera un codice segnaposto univoco per una voce manuale creata
   * senza codice (l'operatore potrebbe non conoscerlo prima di
   * contabilizzare l'anno). Formato "NUOVO-N": senza "/" così non viene
   * interpretato come mastro; modificabile in seguito via
   * rinominaSottoconto.
   */
  function _generaCodiceManuale() {
    const arr = (_progettoCorrente && _progettoCorrente.sottoconti_ce) || [];
    const esistenti = new Set(arr.map(s => s.codice));
    let n = 1;
    let cod;
    do { cod = 'NUOVO-' + n; n++; } while (esistenti.has(cod));
    return cod;
  }

  function aggiungiSottoconto(codice, descrizione, macroId) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return { ok: false, err: 'no_ab' };
    if (!Array.isArray(_progettoCorrente.sottoconti_ce)) _progettoCorrente.sottoconti_ce = [];

    // Codice opzionale: se assente si genera un segnaposto univoco
    // ("NUOVO-N"), modificabile in seguito. Se fornito, deve essere univoco.
    let cod = (codice || '').trim();
    if (!cod) {
      cod = _generaCodiceManuale();
    } else if (_progettoCorrente.sottoconti_ce.some(s => s.codice === cod)) {
      return { ok: false, err: 'duplicato' };
    }

    // Deduci mastro/sottomastro se il codice è nel formato NN/NN.
    let mastro = '', sottomastro = '';
    const mm = cod.match(/^(\d{1,3})\s*\/\s*(\d{1,4})$/);
    if (mm) { mastro = mm[1]; sottomastro = mm[2]; }

    // I mastri di variazione rimanenze non possono essere aggiunti a mano.
    if (typeof ExcelImport !== 'undefined'
        && Array.isArray(ExcelImport.MASTRI_VARIAZIONE_RIMANENZE)
        && ExcelImport.MASTRI_VARIAZIONE_RIMANENZE.indexOf(mastro) >= 0) {
      return { ok: false, err: 'mastro_rimanenze' };
    }

    _progettoCorrente.sottoconti_ce.push({
      codice:      cod,
      descrizione: (descrizione || '').trim(),
      mastro:      mastro,
      sottomastro: sottomastro,
      valori:      {},
      manuale:     true
    });

    // Mapping opzionale a una macroarea esistente non calcolata.
    if (macroId) {
      const macro = (_progettoCorrente.macro_sezioni || []).find(x => x.id === macroId && !x.calcolato);
      if (macro) {
        if (!_progettoCorrente.mapping) _progettoCorrente.mapping = {};
        _progettoCorrente.mapping[cod] = macroId;
      }
    }

    if (typeof ExcelImport !== 'undefined' && ExcelImport.ricalcolaStorico) {
      _progettoCorrente.storico = ExcelImport.ricalcolaStorico(_progettoCorrente);
    }
    _modificato = true;
    return { ok: true, codice: cod };
  }

  /**
   * Rinomina il CODICE di un sottoconto creato a mano (manuale:true).
   * I sottoconti importati restano immutabili (il codice viene dal file).
   * Il nuovo codice deve essere univoco; mastro/sottomastro vengono
   * ri-dedotti (formato NN/NN) e il mapping viene spostato sotto il nuovo
   * codice. Vietati i mastri di variazione rimanenze (61/80).
   *
   * @param {string} oldCodice
   * @param {string} newCodice
   * @returns {{ok:boolean, codice?:string, err?:string}}
   */
  function rinominaSottoconto(oldCodice, newCodice) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return { ok: false, err: 'no_ab' };
    const arr = _progettoCorrente.sottoconti_ce || [];
    const sc = arr.find(s => s.codice === oldCodice);
    if (!sc) return { ok: false, err: 'inesistente' };
    if (!sc.manuale) return { ok: false, err: 'non_manuale' };

    const nc = (newCodice || '').trim();
    if (!nc) return { ok: false, err: 'codice_vuoto' };
    if (nc === oldCodice) return { ok: true, codice: nc };
    if (arr.some(s => s.codice === nc)) return { ok: false, err: 'duplicato' };

    let mastro = '', sottomastro = '';
    const mm = nc.match(/^(\d{1,3})\s*\/\s*(\d{1,4})$/);
    if (mm) { mastro = mm[1]; sottomastro = mm[2]; }
    if (typeof ExcelImport !== 'undefined'
        && Array.isArray(ExcelImport.MASTRI_VARIAZIONE_RIMANENZE)
        && ExcelImport.MASTRI_VARIAZIONE_RIMANENZE.indexOf(mastro) >= 0) {
      return { ok: false, err: 'mastro_rimanenze' };
    }

    sc.codice = nc;
    sc.mastro = mastro;
    sc.sottomastro = sottomastro;

    // Sposta l'eventuale mapping sotto il nuovo codice.
    const map = _progettoCorrente.mapping || {};
    if (Object.prototype.hasOwnProperty.call(map, oldCodice)) {
      map[nc] = map[oldCodice];
      delete map[oldCodice];
    }

    if (typeof ExcelImport !== 'undefined' && ExcelImport.ricalcolaStorico) {
      _progettoCorrente.storico = ExcelImport.ricalcolaStorico(_progettoCorrente);
    }
    _modificato = true;
    return { ok: true, codice: nc };
  }

  /**
   * Aggiorna la DESCRIZIONE di un sottoconto creato a mano (manuale:true).
   * Non tocca lo storico (che dipende da importi/mapping, non dal nome).
   * @param {string} codice
   * @param {string} descrizione
   * @returns {boolean} true se aggiornata
   */
  function aggiornaDescrizioneSottoconto(codice, descrizione) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return false;
    const sc = (_progettoCorrente.sottoconti_ce || []).find(s => s.codice === codice);
    if (!sc || !sc.manuale) return false;
    sc.descrizione = (descrizione || '').trim();
    _modificato = true;
    return true;
  }

  /* ──────────────────────────────────────────────────────────
     Macroaree custom (gruppi definiti dall'utente)

     L'utente può creare gruppi propri dentro le sezioni
     'variabili', 'fissi' e 'prov_oneri_straord' per raccogliere
     sottoconti spostati manualmente — es. raggruppare alcuni
     servizi che si vogliono trattare come variabili anziché tra
     gli "Altri costi variabili".

     Le custom sono persistite direttamente in `macro_sezioni`
     accanto a quelle predefinite, marcate con `custom: true`.
     Tipo forzato a 'costo' (segno orientato dalla sezione di
     destinazione: cost-positive in Variabili/Fissi,
     result-negative in Prov./Oneri Straord., come 'straordinari').
     ────────────────────────────────────────────────────────── */

  const SEZIONI_CUSTOM = ['variabili', 'fissi', 'prov_oneri_straord'];

  function _generaIdCustom() {
    return 'cust_' + Math.random().toString(36).slice(2, 10);
  }

  function _varFissoPerSezione(sez) {
    if (sez === 'variabili') return 'variabile';
    if (sez === 'fissi')     return 'fisso';
    return null;  // prov_oneri_straord
  }

  /**
   * Crea una macroarea custom in una delle sezioni ammesse.
   * @param {string} sezione - 'variabili' | 'fissi' | 'prov_oneri_straord'
   * @param {string} label   - etichetta scelta dall'utente
   * @returns {string|null} id generato, o null se input non valido
   */
  function creaMacroareaCustom(sezione, label) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return null;
    if (SEZIONI_CUSTOM.indexOf(sezione) < 0) return null;
    const lbl = (label || '').trim();
    if (!lbl) return null;
    if (!Array.isArray(_progettoCorrente.macro_sezioni)) _progettoCorrente.macro_sezioni = [];
    const id = _generaIdCustom();
    _progettoCorrente.macro_sezioni.push({
      id,
      label:     lbl,
      sezione,
      tipo:      'costo',
      var_fisso: _varFissoPerSezione(sezione),
      mastri:    [],
      custom:    true
    });
    _modificato = true;
    return id;
  }

  /**
   * Rinomina una macroarea custom.
   * @returns {boolean} true se rinominata, false altrimenti
   */
  function rinominaMacroareaCustom(id, nuovoLabel) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return false;
    const m = (_progettoCorrente.macro_sezioni || []).find(x => x.id === id);
    if (!m || !m.custom) return false;
    const lbl = (nuovoLabel || '').trim();
    if (!lbl) return false;
    m.label = lbl;
    _modificato = true;
    return true;
  }

  /**
   * Elimina una macroarea custom. I sottoconti mappati al gruppo
   * eliminato tornano a "Non mappati"; lo storico viene ricalcolato.
   * @returns {boolean} true se eliminata, false altrimenti
   */
  function eliminaMacroareaCustom(id) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return false;
    const macro = _progettoCorrente.macro_sezioni || [];
    const idx = macro.findIndex(x => x.id === id);
    if (idx < 0 || !macro[idx].custom) return false;

    // Rimuovi la macroarea
    macro.splice(idx, 1);

    // I sottoconti mappati lì tornano a "Non mappati" (rimuovi mapping)
    const mapping = _progettoCorrente.mapping || {};
    for (const cod in mapping) {
      if (mapping[cod] === id) delete mapping[cod];
    }

    // Ricalcola storico (rimuovendo la chiave custom dai totali per anno)
    if (typeof ExcelImport !== 'undefined' && ExcelImport.ricalcolaStorico) {
      _progettoCorrente.storico = ExcelImport.ricalcolaStorico(_progettoCorrente);
    }

    // Pulizia override budget eventualmente legati al gruppo
    if (_progettoCorrente.budget) {
      if (_progettoCorrente.budget.override_pct)   delete _progettoCorrente.budget.override_pct[id];
      if (_progettoCorrente.budget.override_fissi) delete _progettoCorrente.budget.override_fissi[id];
      if (_progettoCorrente.budget.note)           delete _progettoCorrente.budget.note[id];
    }

    _modificato = true;
    return true;
  }

  /**
   * Imposta il comportamento di calcolo di una voce di costo:
   *   'variabile' → stagionalizzata coi ricavi (valore = % × fatturato)
   *   'fisso'     → importo € ancorato all'ultimo anno, pro-rata sul tempo
   *
   * NON tocca la `sezione` della voce: la collocazione visiva (gruppo
   * Variabili/Fissi) e quindi l'appartenenza al costo del venduto
   * restano invariate. Cambia solo il comportamento economico, così una
   * voce classificata tra i Fissi può essere trattata come variabile
   * stagionalizzata senza entrare nel costo del venduto (e viceversa).
   * Il break-even tiene già conto del comportamento effettivo
   * (vedi ab/engine.js — fissiBE).
   *
   * Ammesso solo su voci di costo delle sezioni 'variabili'/'fissi' non
   * calcolate (esclusi Ricavi, Rimanenze, Proventi/Oneri straordinari,
   * Imposte, dove il comportamento non è applicabile).
   *
   * @param {string} id        - id macroarea
   * @param {string} varFisso  - 'variabile' | 'fisso'
   * @returns {boolean} true se aggiornata, false altrimenti
   */
  function impostaComportamentoMacro(id, varFisso) {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return false;
    if (varFisso !== 'variabile' && varFisso !== 'fisso') return false;
    const m = (_progettoCorrente.macro_sezioni || []).find(x => x.id === id);
    if (!m) return false;
    // Solo costi delle sezioni sopra la linea, non calcolati.
    if (m.tipo !== 'costo') return false;
    if (m.sezione !== 'variabili' && m.sezione !== 'fissi') return false;
    if (m.calcolato) return false;
    if (m.var_fisso === varFisso) return false;
    m.var_fisso = varFisso;
    _modificato = true;
    return true;
  }

  /**
   * Aggiorna l'anagrafica del progetto AB (cliente, settore, anno
   * corrente, note libere). Le note sono lette dal DOM via
   * UI.leggiNoteAnagraficaCorrenti().
   *
   * Quando l'anno corrente cambia anche la lista degli anni storici
   * scorre di conseguenza, mantenendo invariato il numero di anni di
   * storico configurato. I dati storici già caricati (storico,
   * sottoconti_ce, mapping) NON vengono spostati: l'utente verrà
   * tipicamente a re-importare il bilancio. Questo evita migrazioni
   * automatiche su chiavi anno che potrebbero non corrispondere ai
   * nuovi periodi.
   */
  function salvaAnagraficaAB() {
    if (!_progettoCorrente || _progettoCorrente.meta.modulo !== 'ab') return;

    const cliEl  = document.getElementById('aab-cliente');
    const settEl = document.getElementById('aab-settore');
    const annoEl = document.getElementById('aab-anno-corrente');

    const cliente = (cliEl  && cliEl.textContent  || '').trim();
    const settore = (settEl && settEl.textContent || '').trim();
    const anno    = parseInt(((annoEl && annoEl.textContent) || '').trim(), 10);

    const errori = [];
    if (!cliente) errori.push('Il nome ditta è obbligatorio.');
    if (isNaN(anno) || anno < 1900 || anno > 2100) errori.push('Anno corrente non valido.');

    if (errori.length > 0) {
      _mostraErroreAnagraficaAB(errori.join(' '));
      return;
    }

    // Note libere — scartiamo righe completamente vuote
    let note = [];
    if (UI && typeof UI.leggiNoteAnagraficaCorrenti === 'function') {
      note = UI.leggiNoteAnagraficaCorrenti()
              .filter(n => (n.titolo || '').trim() || (n.testo || '').trim())
              .map(n => ({ titolo: (n.titolo || '').trim(), testo: (n.testo || '').trim() }));
    }

    const meta = _progettoCorrente.meta;
    meta.cliente = cliente;
    meta.settore = settore;

    if (anno !== meta.anno_corrente) {
      meta.anno_corrente = anno;
      // Ricalcola la lista degli anni storici mantenendo la cardinalità
      const n = Array.isArray(meta.anni_storici) && meta.anni_storici.length > 0
        ? meta.anni_storici.length : 3;
      const nuovi = [];
      for (let i = n; i >= 1; i--) nuovi.push(anno - i);
      meta.anni_storici = nuovi;
    }

    meta.note_anagrafica = note;
    meta.modificato = new Date().toISOString().split('T')[0];

    _modificato = true;
    _aggiungiRecente(_progettoCorrente);

    UI.closeModal('modal-anagrafica-ab');

    // Aggiorna sidebar info senza riportare l'utente alla prima sezione
    const nameEl = document.getElementById('sidebar-project-name');
    const metaEl = document.getElementById('sidebar-project-meta');
    if (nameEl) nameEl.textContent = meta.cliente;
    if (metaEl) metaEl.textContent = `Analisi Costi · ${meta.anno_corrente}`;

    // Aggiorna l'header (badge anno) lasciando invariata la sezione corrente
    const headerCliente = document.getElementById('header-cliente');
    if (headerCliente) headerCliente.textContent = meta.cliente;
    const badgeAnno = document.querySelector('#header-badges .header-badge-anno');
    if (badgeAnno) badgeAnno.textContent = `Anno: ${meta.anno_corrente}`;

    UI.mostraNotifica('Anagrafica aggiornata.', 'success');
  }

  /**
   * Mostra un messaggio di errore in cima al modale anagrafica AB.
   */
  function _mostraErroreAnagraficaAB(msg) {
    const prev = document.getElementById('modal-aab-error');
    if (prev) prev.remove();

    const div = document.createElement('div');
    div.id = 'modal-aab-error';
    div.style.cssText = 'padding:10px 14px;border-radius:4px;font-size:13px;margin-bottom:12px;';
    div.className = 'text-error';
    div.style.background = 'var(--color-error-bg)';
    div.textContent = msg;

    const body = document.querySelector('#modal-anagrafica-ab .modal-body');
    if (body) body.prepend(div);
  }

  /* ── API pubblica ────────────────────────────────────────── */
  return {
    creaProgetto,
    aggiornaMetaDati,
    salvaProgetto,
    apriProgetto,
    caricaDaFile,
    leggiRecenti,
    richiediElimina,
    confermaElimina,
    segnaModificato,
    haModifiche,
    getProgetto,
    setValoreStorico,
    getValoreStorico,
    // Fase 3 — driver
    creaDriverRicavo,
    creaDriverCosto,
    sincronizzaDriverDaCE,
    // Fase 4 — eventi
    creaEvento,
    CATEGORIE_INVESTIMENTO,
    // Modulo Analisi Costi & Budget
    creaAnalisi,
    applicaImportCE,
    applicaImportInfrannuale,
    aggiornaMappingSottoconto,
    aggiornaValoreSottoconto,
    eliminaSottoconto,
    aggiungiSottoconto,
    rinominaSottoconto,
    aggiornaDescrizioneSottoconto,
    aggiornaBudget,
    aggiornaConsuntivo,
    aggiornaMetaAB,
    lavoroSociToggle,
    lavoroSociRagguaglio,
    lavoroSociSimula,
    lavoroSociFisco,
    lavoroSociAddRiga,
    lavoroSociUpdateRiga,
    lavoroSociRemoveRiga,
    creaMacroareaCustom,
    rinominaMacroareaCustom,
    eliminaMacroareaCustom,
    impostaComportamentoMacro,
    salvaAnagraficaAB,
    // Modulo Imposte (IRES/IRAP/CPB)
    creaImposte
  };

})();
