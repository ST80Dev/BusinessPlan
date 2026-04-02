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
      case 'utilizzo_rimanenze':
        return Object.assign(base, {
          anno: primoAnno, anno_fine: ultimoAnno, pct_utilizzo: 0
        });
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
    { parent: 'ce.B.6',  label: 'Materie prime',                tipo: 'pct_ricavi' },
    { parent: 'ce.B.6',  label: 'Materiali di consumo',         tipo: 'pct_ricavi' },
    // B.7 Servizi
    { parent: 'ce.B.7',  label: 'Utenze (acqua, luce, gas)',    tipo: 'fisso' },
    { parent: 'ce.B.7',  label: 'Pubblicità e marketing',       tipo: 'fisso' },
    { parent: 'ce.B.7',  label: 'Consulenze professionali',     tipo: 'fisso' },
    { parent: 'ce.B.7',  label: 'Assicurazioni',                tipo: 'fisso' },
    { parent: 'ce.B.7',  label: 'Manutenzioni e riparazioni',   tipo: 'fisso' },
    { parent: 'ce.B.7',  label: 'Trasporti e spedizioni',       tipo: 'pct_ricavi' },
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
        var drv = creaDriverCosto(c.parent, c.label, c.tipo);
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
      crescita_annua:      {}    // { "2026": 0.05, "2027": 0.05, ... } per anno
    };
  }

  /**
   * Crea un driver costo con valori default.
   * @param {string|null} voceCe
   * @param {string} label
   * @param {string} tipoDriver - 'pct_ricavi' | 'fisso' | 'personale'
   * @returns {Object}
   */
  function creaDriverCosto(voceCe, label, tipoDriver) {
    const isPersonale = tipoDriver === 'personale';
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
      importo_fisso:         tipoDriver !== 'pct_ricavi' ? 0 : null,
      base_tipo:             'annuale',   // 'annuale' | 'mensile'
      soggetto_inflazione:   !isPersonale && tipoDriver === 'fisso',
      usa_var_personale:     isPersonale,
      iva_pct:               ivaDefault
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
        _progettoCorrente = dati;
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
   * Validazione minima struttura progetto.
   * @param {Object} dati
   * @returns {boolean}
   */
  function _validaProgetto(dati) {
    return (
      dati &&
      typeof dati === 'object' &&
      dati.meta &&
      typeof dati.meta.cliente === 'string' &&
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
      cliente:         progetto.meta.cliente,
      settore:         progetto.meta.settore || '',
      anno_base:       progetto.meta.anno_base,
      anni_previsione: progetto.meta.anni_previsione,
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
    return `${meta.cliente}_${meta.anno_base}_${meta.creato}`.replace(/\s+/g, '_');
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
    CATEGORIE_INVESTIMENTO
  };

})();
