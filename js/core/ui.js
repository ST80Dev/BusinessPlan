/**
 * ui.js
 * Rendering interfaccia, navigazione, eventi UI.
 *
 * Fase 1: shell applicazione — home, sidebar, modali, drag & drop.
 * Fase 2: sezione dati storici — tabelle SP/CE, collasso, rapida/analitica, quadratura.
 *
 * Dipende da: schema.js, engine.js, projects.js
 */

'use strict';

const UI = (() => {

  /* ──────────────────────────────────────────────────────────
     Stato UI
     ────────────────────────────────────────────────────────── */

  let _sezioneCorrente = 'home';
  let _collapsed = new Set();
  let _datiTab = 'tab-sp';

  /* ──────────────────────────────────────────────────────────
     Inizializzazione
     ────────────────────────────────────────────────────────── */

  function init() {
    renderHome();
    _setupDragDrop();
    _setupBeforeUnload();
    _setupKeyboard();
    _setupAutoSelect();
  }

  /* ──────────────────────────────────────────────────────────
     Navigazione sidebar
     ────────────────────────────────────────────────────────── */

  /**
   * Naviga a una sezione. Le sezioni diverse da 'home' sono
   * abilitate solo quando un progetto e aperto.
   * @param {string} sezione
   */
  function navigate(sezione) {
    // Se non c'e progetto aperto, solo home e accessibile
    if (sezione !== 'home' && !Projects.getProgetto()) return;

    // Forza commit di eventuali campi editabili ancora attivi
    // (il blur potrebbe non scattare in tempo su contenteditable)
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }

    // Conferma ritorno alla Home se ci sono modifiche non salvate
    // (la Home chiude di fatto il progetto a livello UI: si perderebbero
    // i dati non scaricati come JSON)
    if (sezione === 'home' && _sezioneCorrente !== 'home'
        && Projects.getProgetto() && Projects.haModifiche()) {
      const ok = window.confirm(
        'Ci sono modifiche non salvate.\n\n' +
        'Tornando alla Home il progetto corrente verrà chiuso e le modifiche andranno perse.\n\n' +
        'Continuare comunque? (Annulla per restare e salvare prima il progetto)'
      );
      if (!ok) return;
    }

    // Cleanup chart dashboard prima di cambiare sezione
    _destroyDashboardCharts();

    _sezioneCorrente = sezione;

    // Aggiorna sidebar
    document.querySelectorAll('.sidebar-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.section === sezione);
    });

    // Aggiorna header (titolo e sottotitolo per la sezione corrente)
    _aggiornaHeaderSezione(sezione);

    // Aggiorna header actions
    _renderHeaderActions(sezione);

    // Aggiorna azioni di pagina nel footer (es. Esporta PDF)
    _renderFooterActions(sezione);

    // Render contenuto
    const content = document.getElementById('content');
    if (!content) return;

    switch (sezione) {
      case 'home':
        renderHome();
        break;
      case 'importa':
        _renderImportaBilancio();
        break;
      case 'dati-partenza':
        _renderDatiPartenza();
        break;
      case 'driver':
        _renderDriver();
        break;
      case 'prospetti':
        _renderProspetti();
        break;
      case 'eventi':
        _renderEventi();
        break;
      case 'dashboard':
        _renderDashboard();
        break;
      case 'ab-importa-ce':
        BudgetUI.renderImportaCE();
        break;
      case 'ab-mappatura':
        BudgetUI.renderMacroSezioni();
        break;
      case 'ab-storico':
        BudgetUI.renderStorico();
        break;
      case 'ab-budget':
        BudgetUI.renderBudget();
        break;
      case 'ab-consuntivo':
        BudgetUI.renderConsuntivo();
        break;
      case 'imp-anagrafica':
        ImposteUI.renderAnagrafica();
        break;
      case 'imp-conto-economico':
        ImposteUI.renderContoEconomico();
        break;
      case 'imp-storico':
        ImposteUI.renderStorico();
        break;
      case 'imp-variazioni-ires':
      case 'imp-rol':
      case 'imp-perdite-ace':
      case 'imp-cpb':
      case 'imp-irap':
      case 'imp-deduzione-irap':
      case 'imp-riepilogo':
        content.innerHTML = _renderPlaceholder(_SEZIONI_HEADER[sezione].titolo);
        break;
      default:
        content.innerHTML = '';
    }
  }

  /* ──────────────────────────────────────────────────────────
     Header — titolo, sottotitolo, cliente
     ────────────────────────────────────────────────────────── */

  /* Titolo lungo + descrizione sintetica per ogni sezione: la
     descrizione è nell'header, così le pagine non duplicano più
     <h2> e paragrafo di intro. */
  const _SEZIONI_HEADER = {
    'home':            { titolo: 'Home',                                 sub: '' },
    'importa':         { titolo: 'Importa bilancio',                     sub: 'Carica un bilancio storico per popolare SP/CE.' },
    'dati-partenza':   { titolo: 'Dati di partenza',                     sub: 'SP e CE storici dell\'anno base — input manuale o import.' },
    'driver':          { titolo: 'Driver & Parametri',                   sub: 'Ricavi, stagionalità, DSO/DPO/DIO, magazzino, fiscale.' },
    'eventi':          { titolo: 'Eventi',                               sub: 'Mutui, investimenti, variazioni strutturali, operazioni soci.' },
    'prospetti':       { titolo: 'Prospetti futuri',                     sub: 'SP, CE, rendiconto e cruscotto previsionali pluriennali.' },
    'dashboard':       { titolo: 'Dashboard KPI',                        sub: 'Grafici di sintesi e KPI cards sull\'orizzonte di previsione.' },
    'ab-importa-ce':   { titolo: 'Importa CE da bilancio di verifica',   sub: 'Carica l\'Excel del bilancio di verifica: il sistema estrae i sottoconti CE e li pre-mappa alle macroaree.' },
    'ab-mappatura':    { titolo: 'Mappatura sottoconti → macroaree',     sub: 'Trascina i sottoconti sui box della mini-CE per riassegnarli; multi-selezione con Shift/Ctrl.' },
    'ab-storico':      { titolo: 'Storico CE per macroarea',             sub: 'Importi per anno e media % sul fatturato — base per la proiezione del budget.' },
    'ab-budget':       { titolo: 'Budget anno',                          sub: 'Proietta i costi sull\'anno corrente partendo dal fatturato ipotizzato e dalle medie storiche.' },
    'ab-consuntivo':   { titolo: 'Consuntivo & preconsuntivo',           sub: 'Inserisci il fatturato realizzato per periodo: il sistema proietta a fine anno e confronta col budget.' },
    'imp-anagrafica':       { titolo: 'Anagrafica e flag',                            sub: 'Cliente, regione, anno d\'imposta e flag di scenario (trasparente, CPB, ISA).' },
    'imp-conto-economico':  { titolo: 'Conto economico',                              sub: 'Risultato ante imposte e voci A/B necessarie per la base IRAP.' },
    'imp-variazioni-ires':  { titolo: 'Variazioni IRES',                              sub: 'Variazioni in aumento (RF6-RF31) e diminuzione (RF34-RF55) al risultato civilistico.' },
    'imp-rol':              { titolo: 'Interessi passivi (ROL)',                      sub: 'Prospetto art. 96 TUIR: ROL fiscale, deducibilità interessi, riporti a nuovo.' },
    'imp-perdite-ace':      { titolo: 'Perdite e ACE',                                sub: 'Stock perdite piene/limitate (art. 84) ed eccedenza ACE residua.' },
    'imp-cpb':              { titolo: 'Concordato Preventivo Biennale',               sub: 'Reddito concordato rettificato e imposta sostitutiva (D.Lgs. 13/2024).' },
    'imp-irap':             { titolo: 'IRAP — variazioni e deduzioni',                sub: 'Variazioni IC43-IC57, cuneo fiscale, deduzione forfettaria, aliquota regionale.' },
    'imp-deduzione-irap':   { titolo: 'Deduzione IRAP da IRES',                       sub: 'Quota analitica costo personale + 10% forfettaria su oneri finanziari.' },
    'imp-storico':          { titolo: 'Storico (riporti pluriennali)',                sub: 'Plus rateizzate, manutenzioni 5%, ROL/IP, perdite, ACE, crediti residui.' },
    'imp-riepilogo':        { titolo: 'Riepilogo & F24',                              sub: 'Sintesi imposte, F24 alle scadenze 30/06-30/07-30/11, scritture contabili.' }
  };

  function _aggiornaHeaderSezione(sezione) {
    const titoloEl = document.getElementById('header-title');
    const subEl    = document.getElementById('header-subtitle');
    const clienteEl = document.getElementById('header-cliente');
    const cfg = _SEZIONI_HEADER[sezione] || { titolo: sezione, sub: '' };

    if (titoloEl) titoloEl.textContent = cfg.titolo;
    if (subEl) {
      if (cfg.sub) {
        subEl.textContent = cfg.sub;
        subEl.classList.remove('hidden');
      } else {
        subEl.textContent = '';
        subEl.classList.add('hidden');
      }
    }

    // Cliente in alto a sinistra: sempre visibile se c'è un progetto aperto,
    // anche per la home (così il contesto resta evidente).
    if (clienteEl) {
      const progetto = Projects.getProgetto();
      if (progetto && progetto.meta && progetto.meta.cliente) {
        clienteEl.textContent = progetto.meta.cliente;
        clienteEl.classList.remove('hidden');
      } else {
        clienteEl.textContent = '';
        clienteEl.classList.add('hidden');
      }
    }
  }

  /* ──────────────────────────────────────────────────────────
     Header actions
     ────────────────────────────────────────────────────────── */

  function _renderHeaderActions(sezione) {
    const badges = document.getElementById('header-badges');
    const actions = document.getElementById('header-actions');
    if (!badges || !actions) return;

    badges.innerHTML = '';
    actions.innerHTML = '';

    const progetto = Projects.getProgetto();
    if (!progetto) return;

    if (progetto.meta.modulo === 'ab') {
      badges.innerHTML = `
        <span class="header-badge header-badge-scenario">Analisi Costi &amp; Budget</span>
        <span class="header-badge header-badge-anno">Anno: ${progetto.meta.anno_corrente}</span>
      `;
    } else if (progetto.meta.modulo === 'imposte') {
      const flag = progetto.flag || {};
      const scenarioLabel = flag.cpb_attivo ? 'CPB' : (flag.societa_trasparente ? 'Trasparente' : 'Calcolo Imposte');
      badges.innerHTML = `
        <span class="header-badge header-badge-scenario">${_escapeHtml(scenarioLabel)}</span>
        <span class="header-badge header-badge-anno">Anno d'imposta: ${progetto.meta.anno_imposta}</span>
      `;
    } else {
      const scenarioLabels = { sp_ce: 'SP + CE', sp_only: 'Solo SP', costituenda: 'Costituenda' };
      badges.innerHTML = `
        <span class="header-badge header-badge-scenario">${scenarioLabels[progetto.meta.scenario] || progetto.meta.scenario}</span>
        <span class="header-badge header-badge-anno">${progetto.meta.scenario === 'costituenda' ? 'Inizio' : 'Base'}: ${progetto.meta.anno_base}</span>
      `;
    }

    actions.innerHTML = `
      <div class="btn btn-ghost btn-sm" onclick="UI.navigate('home')" title="Torna alla home">⌂ Home</div>
      <div class="btn btn-primary btn-sm" onclick="Projects.salvaProgetto()">Salva progetto</div>
    `;
  }

  /* Azioni di pagina nel footer: per ora un singolo "Esporta PDF" che
     vale per la sezione corrente (Budget AB, Consuntivo AB). Mantiene
     i pulsanti fuori dal contenuto, dove rubavano spazio al prospetto.
     Estendibile aggiungendo case per altre sezioni che vogliano un
     pulsante di azione contestuale. */
  function _renderFooterActions(sezione) {
    const c = document.getElementById('footer-actions');
    if (!c) return;
    let html = '';
    switch (sezione) {
      case 'ab-budget':
        html = `<div class="btn btn-secondary btn-sm" onclick="BudgetUI.esportaPdfBudget()" title="Esporta il prospetto budget in PDF">📄 Esporta PDF</div>`;
        break;
      case 'ab-consuntivo':
        html = `<div class="btn btn-secondary btn-sm" onclick="BudgetUI.esportaPdfConsuntivo()" title="Esporta il consuntivo in PDF">📄 Esporta PDF</div>`;
        break;
    }
    c.innerHTML = html;
  }

  /* ──────────────────────────────────────────────────────────
     Home — lista progetti
     ────────────────────────────────────────────────────────── */

  function renderHome() {
    const content = document.getElementById('content');
    if (!content) return;

    _sezioneCorrente = 'home';

    // In home la sidebar mostra solo le voci comuni (data-modulo="*"):
    // tutte le voci specifiche di un modulo (BP, AB, …) vengono nascoste.
    document.querySelectorAll('.sidebar-nav-item').forEach(el => {
      const m = el.dataset.modulo;
      if (m && m !== '*') el.classList.add('hidden');
      el.classList.toggle('active', el.dataset.section === 'home');
    });

    _aggiornaHeaderSezione('home');

    // Header actions per home
    const badges = document.getElementById('header-badges');
    const actions = document.getElementById('header-actions');
    if (badges) badges.innerHTML = '';
    if (actions) actions.innerHTML = '';

    // Reset stato sidebar progetto (siamo tornati alla home: nessun progetto attivo a livello UI)
    const nameEl = document.getElementById('sidebar-project-name');
    const metaEl = document.getElementById('sidebar-project-meta');
    const editEl = document.getElementById('sidebar-project-edit');
    if (nameEl) {
      nameEl.textContent = 'Nessun progetto';
      nameEl.classList.add('text-muted');
    }
    if (metaEl) metaEl.textContent = '—';
    if (editEl) editEl.classList.add('hidden');

    let html = `
      <div class="home-welcome">
        <div class="home-eyebrow">Strumenti di analisi bilancio</div>
        <h1>Studio AnaBil</h1>
        <p>Scegli lo strumento. Ogni modulo ha proprio formato di progetto e propria interfaccia operativa.</p>
      </div>

      <div class="home-modules">
        ${_renderModuleCard({
          tipo: 'bp',
          titolo: 'Business Plan',
          descrizione: 'Bilancio storico SP/CE → proiezioni pluriennali → SP, CE, rendiconto, dashboard KPI.',
          ctaLabel: '+ Nuovo business plan',
          ctaOnclick: "UI.openModal('modal-nuovo-progetto')",
          aprilLabel: 'Apri file JSON',
          apriOnclick: "Projects.apriProgetto()"
        })}
        ${_renderModuleCard({
          tipo: 'ab',
          titolo: 'Analisi Costi & Budget',
          descrizione: 'CE storico Excel → medie % sul fatturato → budget annuale, fatturato di break-even, monitoraggio consuntivo.',
          ctaLabel: '+ Nuova analisi',
          ctaOnclick: "UI.openModal('modal-nuova-analisi')",
          aprilLabel: 'Apri file JSON',
          apriOnclick: "Projects.apriProgetto()"
        })}
        ${_renderModuleCard({
          tipo: 'imposte',
          titolo: 'Calcolo Imposte SRL',
          descrizione: 'IRES, IRAP, imposta sostitutiva CPB e relativi acconti. Quadri RF/IC, ROL art. 96, perdite, ACE residua, F24.',
          ctaLabel: '+ Nuovo calcolo',
          ctaOnclick: "UI.openModal('modal-nuove-imposte')",
          aprilLabel: 'Apri file JSON',
          apriOnclick: "Projects.apriProgetto()"
        })}
      </div>
    `;

    content.innerHTML = html;
  }

  /**
   * Card "modulo" della landing (BP o AB).
   */
  function _renderModuleCard(opts) {
    return (
      '<div class="home-module-card home-module-' + opts.tipo + '">' +
        '<div class="home-module-title">' + _escapeHtml(opts.titolo) + '</div>' +
        '<div class="home-module-desc">' + _escapeHtml(opts.descrizione) + '</div>' +
        '<div class="home-module-actions">' +
          '<div class="btn btn-primary" onclick="' + opts.ctaOnclick + '">' + _escapeHtml(opts.ctaLabel) + '</div>' +
          '<div class="btn btn-secondary" onclick="' + opts.apriOnclick + '">' + _escapeHtml(opts.aprilLabel) + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /* ──────────────────────────────────────────────────────────
     Progetto aperto — callback da Projects
     ────────────────────────────────────────────────────────── */

  /**
   * Chiamato da Projects quando un progetto viene creato o caricato.
   * Aggiorna sidebar, abilita navigazione, mostra dati di partenza.
   * @param {Object} progetto
   */
  function onProgettoAperto(progetto) {
    const modulo = progetto.meta.modulo || 'bp';

    // Aggiorna sidebar info progetto
    const nameEl = document.getElementById('sidebar-project-name');
    const metaEl = document.getElementById('sidebar-project-meta');
    if (nameEl) {
      nameEl.textContent = progetto.meta.cliente;
      nameEl.classList.remove('text-muted');
    }
    if (metaEl) {
      if (modulo === 'ab') {
        metaEl.textContent = `Analisi Costi · ${progetto.meta.anno_corrente}`;
      } else if (modulo === 'imposte') {
        const reg = progetto.meta.regione ? ` · ${progetto.meta.regione}` : '';
        metaEl.textContent = `Imposte · ${progetto.meta.anno_imposta}${reg}`;
      } else {
        const scenarioLabels = { sp_ce: 'SP + CE', sp_only: 'Solo SP', costituenda: 'Costituenda' };
        metaEl.textContent = `${progetto.meta.anno_base} · ${scenarioLabels[progetto.meta.scenario] || progetto.meta.scenario}`;
      }
    }

    // Pulsante modifica anagrafica: visibile per BP, AB e Imposte. L'etichetta
    // e il modale aperto cambiano in base al modulo.
    const editEl = document.getElementById('sidebar-project-edit');
    if (editEl) {
      if (modulo === 'imposte') {
        // L'anagrafica del progetto Imposte si modifica direttamente nella
        // sezione "Anagrafica e flag" (non c'è un modale dedicato): nascondo
        // il pulsante per ora.
        editEl.classList.add('hidden');
      } else {
        editEl.classList.remove('hidden');
        if (modulo === 'ab') {
          editEl.textContent = '✎ Anagrafica';
          editEl.title = 'Modifica ragione sociale, anno e note libere mostrate negli export';
        } else {
          editEl.textContent = '✎ Modifica dati base';
          editEl.title = 'Modifica ragione sociale, anno base e orizzonte anni';
        }
      }
    }

    // Mostra solo le voci sidebar del modulo corrente, abilitate.
    // data-modulo="*" → sempre visibile (Home).
    document.querySelectorAll('.sidebar-nav-item').forEach(el => {
      const m = el.dataset.modulo;
      const visible = (m === '*' || m === modulo);
      el.classList.toggle('hidden', !visible);
      if (visible) el.classList.remove('disabled');
    });

    aggiornaStatusBar('pronto');
    _aggiornaIndicatoriSidebar();

    // Naviga alla prima sezione del modulo
    if (modulo === 'ab')      navigate('ab-importa-ce');
    else if (modulo === 'imposte') navigate('imp-anagrafica');
    else                     navigate('dati-partenza');

    mostraNotifica('Progetto "' + progetto.meta.cliente + '" aperto.', 'success');
  }

  /* ──────────────────────────────────────────────────────────
     Placeholder sezioni future
     ────────────────────────────────────────────────────────── */

  function _renderPlaceholder(titolo) {
    return `
      <div class="tab-disabled-notice">
        <div class="tab-disabled-notice-icon">🚧</div>
        <div class="tab-disabled-notice-title">${_escapeHtml(titolo)}</div>
        <div class="tab-disabled-notice-desc">
          Questa sezione sarà disponibile nelle prossime fasi di sviluppo.
        </div>
      </div>
    `;
  }

  /* ──────────────────────────────────────────────────────────
     Modali
     ────────────────────────────────────────────────────────── */

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  /* ──────────────────────────────────────────────────────────
     Modifica dati cliente
     ────────────────────────────────────────────────────────── */

  /**
   * Apre il modale di modifica dati cliente, pre-compilato con i valori attuali.
   */
  function apriModificaCliente() {
    const progetto = Projects.getProgetto();
    if (!progetto) return;

    const meta = progetto.meta;

    // Pre-compila i campi
    const clienteEl = document.getElementById('mc-cliente');
    const annoEl    = document.getElementById('mc-anno-base');
    const anniEl    = document.getElementById('mc-anni-prev');

    if (clienteEl) clienteEl.textContent = meta.cliente || '';
    if (annoEl)    annoEl.textContent    = meta.anno_base;
    if (anniEl)    anniEl.textContent    = meta.anni_previsione ? meta.anni_previsione.length : 3;

    // Aggiorna label anno in base allo scenario
    const labelEl = document.getElementById('mc-anno-label');
    const hintEl  = document.getElementById('mc-anno-hint');
    const anniHint = document.getElementById('mc-anni-hint');

    if (meta.scenario === 'costituenda') {
      if (labelEl) labelEl.textContent = 'Anno di inizio attività *';
      if (hintEl)  hintEl.textContent  = 'Primo anno operativo della nuova società';
      if (anniHint) anniHint.textContent = 'Da 1 a 8 anni di previsione';
    } else {
      if (labelEl) labelEl.textContent = 'Anno base (storico) *';
      if (hintEl)  hintEl.textContent  = "Anno dell'ultimo bilancio approvato";
      if (anniHint) anniHint.textContent = 'Da 1 a 8 anni oltre l\'anno base';
    }

    // Mostra/nascondi e pre-seleziona mese avvio
    const meseAvvioGroup = document.getElementById('mc-mese-avvio-group');
    const meseAvvioSel = document.getElementById('mc-mese-avvio');
    if (meta.scenario === 'costituenda') {
      if (meseAvvioGroup) meseAvvioGroup.classList.remove('hidden');
      if (meseAvvioSel) meseAvvioSel.value = String(meta.mese_avvio || 1);
    } else {
      if (meseAvvioGroup) meseAvvioGroup.classList.add('hidden');
    }

    // Rimuovi errori precedenti
    const prev = document.getElementById('modal-mc-error');
    if (prev) prev.remove();

    openModal('modal-modifica-cliente');
  }

  /* ──────────────────────────────────────────────────────────
     Anagrafica AB — modale modifica dati ditta + note libere
     ────────────────────────────────────────────────────────── */

  /**
   * Router del pulsante "Modifica dati base" della sidebar: apre
   * il modale corretto in base al modulo del progetto corrente.
   */
  function apriModificaDati() {
    const p = Projects.getProgetto();
    if (!p || !p.meta) return;
    if (p.meta.modulo === 'ab') apriAnagraficaAB();
    else                        apriModificaCliente();
  }

  /**
   * Apre il modale anagrafica AB pre-compilato con i valori correnti
   * (ditta, settore, anno corrente, note libere).
   */
  function apriAnagraficaAB() {
    const p = Projects.getProgetto();
    if (!p || !p.meta || p.meta.modulo !== 'ab') return;

    const m = p.meta;
    const cli  = document.getElementById('aab-cliente');
    const sett = document.getElementById('aab-settore');
    const anno = document.getElementById('aab-anno-corrente');
    if (cli)  cli.textContent  = m.cliente || '';
    if (sett) sett.textContent = m.settore || '';
    if (anno) anno.textContent = m.anno_corrente != null ? String(m.anno_corrente) : '';

    // Rimuovi un eventuale errore precedente
    const prev = document.getElementById('modal-aab-error');
    if (prev) prev.remove();

    _renderNoteAnagraficaList(Array.isArray(m.note_anagrafica) ? m.note_anagrafica : []);
    openModal('modal-anagrafica-ab');
  }

  /**
   * Rende l'elenco delle note anagrafiche nel modale.
   * @param {Array<{titolo:string,testo:string}>} note
   */
  function _renderNoteAnagraficaList(note) {
    const list = document.getElementById('aab-note-list');
    if (!list) return;
    if (!note || note.length === 0) {
      list.innerHTML = '<div class="ab-note-list-empty">Nessuna nota. Usa "+ Aggiungi nota" per inserirne una.</div>';
      return;
    }
    let html = '';
    note.forEach((n, i) => {
      html += '<div class="ab-note-row" data-idx="' + i + '">'
            +   '<div class="form-field" contenteditable="true" data-field="titolo" '
            +        'data-placeholder="Titolo (es. P.IVA)" spellcheck="false">' + _escapeHtml(n.titolo || '') + '</div>'
            +   '<div class="form-field" contenteditable="true" data-field="testo" '
            +        'data-placeholder="Testo (es. 12345678901)" spellcheck="false">' + _escapeHtml(n.testo || '') + '</div>'
            +   '<div class="ab-note-row-del" onclick="UI.rimuoviNotaAnagrafica(' + i + ')" title="Rimuovi nota">×</div>'
            + '</div>';
    });
    list.innerHTML = html;
  }

  /**
   * Legge le note attualmente presenti nel DOM del modale.
   * @returns {Array<{titolo:string,testo:string}>}
   */
  function _leggiNoteAnagraficaDom() {
    const list = document.getElementById('aab-note-list');
    if (!list) return [];
    const rows = list.querySelectorAll('.ab-note-row');
    const out = [];
    rows.forEach(r => {
      const t = r.querySelector('[data-field="titolo"]');
      const x = r.querySelector('[data-field="testo"]');
      out.push({
        titolo: (t && t.textContent || '').trim(),
        testo:  (x && x.textContent || '').trim()
      });
    });
    return out;
  }

  /**
   * Aggiunge una riga note vuota in coda.
   */
  function aggiungiNotaAnagrafica() {
    const note = _leggiNoteAnagraficaDom();
    note.push({ titolo: '', testo: '' });
    _renderNoteAnagraficaList(note);
    // Focus al titolo della nuova riga per inserimento immediato
    const list = document.getElementById('aab-note-list');
    if (list) {
      const rows = list.querySelectorAll('.ab-note-row');
      const last = rows[rows.length - 1];
      if (last) {
        const t = last.querySelector('[data-field="titolo"]');
        if (t) t.focus();
      }
    }
  }

  /**
   * Rimuove la riga nota all'indice indicato.
   * @param {number} idx
   */
  function rimuoviNotaAnagrafica(idx) {
    const note = _leggiNoteAnagraficaDom();
    if (idx < 0 || idx >= note.length) return;
    note.splice(idx, 1);
    _renderNoteAnagraficaList(note);
  }

  /**
   * Espone la lettura DOM al modulo Projects (chiamata da salvaAnagraficaAB).
   * @returns {Array<{titolo:string,testo:string}>}
   */
  function leggiNoteAnagraficaCorrenti() {
    return _leggiNoteAnagraficaDom();
  }

  /* ──────────────────────────────────────────────────────────
     Stepper (anni previsionali)
     ────────────────────────────────────────────────────────── */

  /**
   * Incrementa/decrementa lo stepper.
   * @param {string} id   - id dell'elemento stepper-value
   * @param {number} delta - +1 o -1
   */
  function stepperChange(id, delta) {
    const el = document.getElementById(id);
    if (!el) return;
    let val = parseInt(el.textContent, 10) || 1;
    const min = parseInt(el.dataset.min, 10);
    const max = parseInt(el.dataset.max, 10);
    const lo = Number.isFinite(min) ? min : 1;
    const hi = Number.isFinite(max) ? max : 8;
    val = Math.max(lo, Math.min(hi, val + delta));
    el.textContent = val;
  }

  /* ──────────────────────────────────────────────────────────
     Radio e Toggle
     ────────────────────────────────────────────────────────── */

  /**
   * Seleziona un radio item in un gruppo.
   * @param {string}      groupId
   * @param {HTMLElement}  el
   */
  function radioSelect(groupId, el) {
    const group = document.getElementById(groupId);
    if (!group) return;
    group.querySelectorAll('.radio-item').forEach(item => item.classList.remove('selected'));
    el.classList.add('selected');
  }

  /**
   * Seleziona un toggle item in un gruppo.
   * @param {string}      groupId
   * @param {HTMLElement}  el
   */
  function toggleSelect(groupId, el) {
    const group = document.getElementById(groupId);
    if (!group) return;
    group.querySelectorAll('.toggle-item').forEach(item => item.classList.remove('active'));
    el.classList.add('active');
  }

  /**
   * Aggiorna etichette anno nel modale nuovo progetto in base allo scenario.
   * Per costituenda: "Anno di inizio attività" invece di "Anno base (storico)".
   * @param {string} scenario
   */
  function aggiornaLabelAnno(scenario) {
    var labelEl = document.getElementById('np-anno-label');
    var hintEl  = document.getElementById('np-anno-hint');
    var anniHint = document.getElementById('np-anni-hint');
    var annoField = document.getElementById('np-anno-base');
    var meseGroup = document.getElementById('np-mese-avvio-group');

    if (scenario === 'costituenda') {
      if (labelEl) labelEl.textContent = 'Anno di inizio attività *';
      if (hintEl)  hintEl.textContent  = 'Primo anno operativo della nuova società';
      if (anniHint) anniHint.textContent = 'Da 1 a 8 anni di previsione';
      if (annoField) annoField.dataset.placeholder = 'Es. 2025';
      if (meseGroup) meseGroup.classList.remove('hidden');
    } else {
      if (labelEl) labelEl.textContent = 'Anno base (storico) *';
      if (hintEl)  hintEl.textContent  = "Anno dell'ultimo bilancio approvato";
      if (anniHint) anniHint.textContent = "Da 1 a 8 anni oltre l'anno base";
      if (annoField) annoField.dataset.placeholder = 'Es. 2024';
      if (meseGroup) meseGroup.classList.add('hidden');
    }
  }

  /* ──────────────────────────────────────────────────────────
     Status bar
     ────────────────────────────────────────────────────────── */

  /**
   * Aggiorna la status bar nel footer.
   * @param {'pronto'|'modified'|'saved'|'error'} stato
   */
  function aggiornaStatusBar(stato) {
    const dot  = document.getElementById('footer-dot');
    const text = document.getElementById('footer-status-text');
    if (!dot || !text) return;

    dot.className = 'footer-status-dot';

    const labels = {
      pronto:   'Pronto',
      modified: 'Modifiche non salvate',
      saved:    'Salvato',
      error:    'Errore'
    };

    dot.classList.add(stato);
    text.textContent = labels[stato] || stato;
  }

  /* ──────────────────────────────────────────────────────────
     Notifiche temporanee (toast)
     ────────────────────────────────────────────────────────── */

  /**
   * Mostra una notifica temporanea in basso a destra.
   * @param {string} messaggio
   * @param {'info'|'success'|'warning'|'error'} tipo
   */
  function mostraNotifica(messaggio, tipo) {
    tipo = tipo || 'info';

    // Rimuovi eventuali notifiche precedenti
    const prev = document.getElementById('ui-toast');
    if (prev) prev.remove();

    const colori = {
      info:    { bg: 'var(--color-info-bg)',    border: 'var(--color-info)',    text: 'var(--color-info)' },
      success: { bg: 'var(--color-success-bg)', border: 'var(--color-success)', text: 'var(--color-success)' },
      warning: { bg: 'var(--color-warning-bg)', border: 'var(--color-warning)', text: 'var(--color-warning)' },
      error:   { bg: 'var(--color-error-bg)',   border: 'var(--color-error)',   text: 'var(--color-error)' }
    };

    const c = colori[tipo] || colori.info;

    const toast = document.createElement('div');
    toast.id = 'ui-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 52px;
      right: 24px;
      padding: 10px 18px;
      border-radius: 6px;
      font-family: var(--font-ui);
      font-size: 13px;
      font-weight: 500;
      z-index: 2000;
      max-width: 400px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
      background: ${c.bg};
      border: 1px solid ${c.border};
      color: ${c.text};
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.2s, transform 0.2s;
    `;
    toast.textContent = messaggio;
    document.body.appendChild(toast);

    // Animazione in entrata
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    // Auto-rimozione
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }

  /* ──────────────────────────────────────────────────────────
     Drag & drop file JSON
     ────────────────────────────────────────────────────────── */

  function _setupDragDrop() {
    const content = document.getElementById('content');
    if (!content) return;

    // Previeni il comportamento default su tutta la pagina
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => e.preventDefault());

    content.addEventListener('dragover', e => {
      e.preventDefault();
      content.style.outline = '2px dashed var(--color-accent)';
      content.style.outlineOffset = '-8px';
    });

    content.addEventListener('dragleave', () => {
      content.style.outline = '';
      content.style.outlineOffset = '';
    });

    content.addEventListener('drop', e => {
      e.preventDefault();
      content.style.outline = '';
      content.style.outlineOffset = '';

      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        Projects.caricaDaFile(file);
      }
    });
  }

  /* ──────────────────────────────────────────────────────────
     beforeunload — avviso modifiche non salvate
     ────────────────────────────────────────────────────────── */

  function _setupBeforeUnload() {
    window.addEventListener('beforeunload', e => {
      if (Projects.haModifiche()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /* ──────────────────────────────────────────────────────────
     Scorciatoie tastiera
     ────────────────────────────────────────────────────────── */

  function _setupKeyboard() {
    document.addEventListener('keydown', e => {
      // Ctrl+S / Cmd+S — salva progetto
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (Projects.getProgetto()) {
          Projects.salvaProgetto();
        }
      }

      // Escape — chiudi modali aperte
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(el => {
          el.classList.add('hidden');
        });
      }
    });
  }

  // Al focus su un campo editabile, seleziona tutto il contenuto cosi' da
  // poter sovrascrivere digitando direttamente senza cancellare manualmente.
  function _setupAutoSelect() {
    document.addEventListener('focusin', e => {
      const el = e.target;
      if (!el || el.getAttribute('contenteditable') !== 'true') return;
      if (!el.classList.contains('amount-field') && !el.classList.contains('form-field')) return;
      // setTimeout differisce la selezione dopo l'eventuale mouseup che
      // posizionerebbe il cursore sul punto cliccato, annullandola.
      setTimeout(() => {
        if (document.activeElement !== el) return;
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }, 0);
    });
  }

  /* ──────────────────────────────────────────────────────────
     Utilità HTML
     ────────────────────────────────────────────────────────── */

  function _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function _escapeAttr(str) {
    return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  /* ══════════════════════════════════════════════════════════
     Sezione Importa bilancio — PDF → schema SP/CE
     ══════════════════════════════════════════════════════════ */

  const _importState = {
    righe: [],                    // output annotato da pdf-import.estraiRighe()
    schemaFlatSP: [],             // lista piatta { id, label } voci SP
    schemaFlatCE: [],             // lista piatta { id, label } voci CE
    boundarySpCe: -1,             // indice prima riga CE (-1 = tutto SP)
    regoleGlobali: null,          // dizionario dal file repo (lazy load)
    regoleLocali: null,           // dizionario da localStorage
    statusMsg: 'Carica un PDF di bilancio per iniziare.',
    pdfModule: null,              // modulo js/modules/bp/pdf-import.js (lazy load)
    pdfjsLib: null,               // libreria PDF.js (lazy load)
    loading: false
  };

  const _IMPORT_REGOLE_PATH = 'data/bp/regole-import-conti.json';
  const _IMPORT_REGOLE_LOCAL_KEY = 'bp_pdf_mapping';

  async function _importLoadModuli() {
    if (!_importState.pdfModule) {
      _importState.pdfModule = await import('../modules/bp/pdf-import.js');
    }
    if (!_importState.pdfjsLib) {
      _importState.pdfjsLib = await import('../../lib/pdf.min.mjs');
      _importState.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.mjs';
    }
  }

  async function _importLoadRegoleGlobali() {
    if (_importState.regoleGlobali !== null) return _importState.regoleGlobali;
    try {
      const res = await fetch(_IMPORT_REGOLE_PATH, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      _importState.regoleGlobali = data && data.regole ? data.regole : {};
    } catch (err) {
      console.warn('Regole globali non caricate:', err.message);
      _importState.regoleGlobali = {};
    }
    return _importState.regoleGlobali;
  }

  function _importLoadRegoleLocali() {
    if (_importState.regoleLocali !== null) return _importState.regoleLocali;
    try {
      const raw = localStorage.getItem(_IMPORT_REGOLE_LOCAL_KEY);
      _importState.regoleLocali = raw ? JSON.parse(raw) : {};
    } catch (e) {
      _importState.regoleLocali = {};
    }
    return _importState.regoleLocali;
  }

  function _importSaveRegoleLocali() {
    try {
      localStorage.setItem(_IMPORT_REGOLE_LOCAL_KEY, JSON.stringify(_importState.regoleLocali || {}));
    } catch (e) {
      console.warn('Salvataggio regole locali fallito:', e.message);
    }
  }

  function _importMergedMapping() {
    // Locale vince sul globale (l'operatore ha l'ultima parola sul proprio PC)
    return Object.assign({}, _importState.regoleGlobali || {}, _importState.regoleLocali || {});
  }

  async function _renderImportaBilancio() {
    const content = document.getElementById('content');
    const progetto = Projects.getProgetto();
    if (!content || !progetto) return;

    // Costruisci schemi piatti SP/CE una volta per progetto (per i dropdown)
    if (_importState.schemaFlatSP.length === 0) {
      try {
        await _importLoadModuli();
        const builtSP = _importState.pdfModule.buildDictionary([
          Schema.SP_ATTIVO, Schema.SP_PASSIVO
        ]);
        _importState.schemaFlatSP = builtSP.flatList;
        const builtCE = _importState.pdfModule.buildDictionary([Schema.CE]);
        _importState.schemaFlatCE = builtCE.flatList;
      } catch (err) {
        content.innerHTML = '<div class="section-pad"><div class="callout callout-warn">Errore caricamento modulo PDF: ' + _escapeHtml(err.message) + '</div></div>';
        return;
      }
    }

    // Carica regole in parallelo (fetch + localStorage)
    await _importLoadRegoleGlobali();
    _importLoadRegoleLocali();

    const hasRighe = _importState.righe.length > 0;
    const cntG = Object.keys(_importState.regoleGlobali || {}).length;
    const cntL = Object.keys(_importState.regoleLocali || {}).length;

    content.innerHTML = `
      <div class="section-pad">
        <div class="import-intro">
          <h2 class="import-title">Importa bilancio da PDF</h2>
          <p class="import-desc">
            Carica un PDF di bilancio civilistico del cliente. Il tool estrae i testi e gli importi,
            propone un mapping verso le voci dello Stato Patrimoniale (art. 2424 c.c.) e ti permette
            di confermare o correggere ogni riga.
          </p>
          <p class="import-desc">
            Le regole di mapping confermate vengono salvate localmente e usate nei prossimi import.
            Il tool si avvia anche con un dizionario globale condiviso sul repository
            (${cntG} regole globali, ${cntL} regole locali).
          </p>
        </div>

        <div id="import-dropzone" class="import-dropzone">
          <div class="import-dropzone-icon">⇪</div>
          <div class="import-dropzone-title">Trascina qui il PDF del bilancio</div>
          <div class="import-dropzone-sub">oppure clicca per selezionare un file</div>
          <input type="file" id="import-file" accept="application/pdf" class="hidden">
        </div>

        <div id="import-status" class="import-status">${_escapeHtml(_importState.statusMsg)}</div>

        <div id="import-table-wrap" class="${hasRighe ? '' : 'hidden'}">
          <div class="import-table-header">
            <h3 class="import-table-title">Mapping proposto</h3>
            <div class="import-table-actions">
              <div class="btn btn-primary btn-sm" onclick="UI.importaSalvaRegole()" title="Salva i mapping confermati in localStorage">Salva regole</div>
            </div>
          </div>
          <div class="import-table-scroll">
            <table class="import-table">
              <thead>
                <tr>
                  <th>Testo PDF</th>
                  <th class="num">Importo</th>
                  <th>Voce schema SP</th>
                  <th>Stato</th>
                  <th class="import-col-actions" title="Elimina voce dalla lista"></th>
                </tr>
              </thead>
              <tbody id="import-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    _importBindDropzone();
    if (hasRighe) _importRenderTable();
  }

  function _importBindDropzone() {
    const dz = document.getElementById('import-dropzone');
    const fi = document.getElementById('import-file');
    if (!dz || !fi) return;

    dz.addEventListener('click', () => fi.click());
    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('dragover');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) _importHandleFile(f);
    });
    fi.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) _importHandleFile(f);
    });
  }

  async function _importHandleFile(file) {
    if (!file || file.type !== 'application/pdf') {
      _importSetStatus('Seleziona un PDF valido.', 'warn');
      return;
    }
    if (_importState.loading) return;
    _importState.loading = true;
    _importSetStatus('Estrazione in corso…');

    try {
      await _importLoadModuli();
      const buffer = await file.arrayBuffer();
      const savedMapping = _importMergedMapping();
      _importState.boundarySpCe = -1;
      _importState.righe = await _importState.pdfModule.estraiRighe(buffer, {
        pdfjsLib: _importState.pdfjsLib,
        schemaRoots: {
          sp: [Schema.SP_ATTIVO, Schema.SP_PASSIVO],
          ce: [Schema.CE]
        },
        savedMapping,
        soloConImporto: true,
        onBoundary: (idx) => { _importState.boundarySpCe = idx; }
      });

      const auto = _importState.righe.filter(r => r.status === 'auto').length;
      const partial = _importState.righe.filter(r => r.status === 'partial').length;
      const manual = _importState.righe.filter(r => r.status === 'manual').length;
      const none = _importState.righe.length - auto - partial - manual;

      _importSetStatus(
        `Estratte ${_importState.righe.length} righe. ` +
        `Auto ${auto} · Parziali ${partial} · Salvate ${manual} · Da mappare ${none}.`
      );

      document.getElementById('import-table-wrap').classList.remove('hidden');
      _importRenderTable();
    } catch (err) {
      console.error(err);
      _importSetStatus('Errore: ' + err.message, 'warn');
    } finally {
      _importState.loading = false;
    }
  }

  function _importSetStatus(msg, variant) {
    _importState.statusMsg = msg;
    const el = document.getElementById('import-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('import-status-warn', variant === 'warn');
  }

  function _importColumnLabel(sezione, column) {
    if (sezione === 'ce') return column === 'left' ? 'Costi' : 'Ricavi';
    return column === 'left' ? 'Attivo' : 'Passivo';
  }

  function _importOptionsHtmlPerSezione(sezione) {
    const flat = sezione === 'ce' ? _importState.schemaFlatCE : _importState.schemaFlatSP;
    return '<option value="">— non mappato —</option>' +
      flat.map(n =>
        `<option value="${_escapeHtml(n.id)}">${_escapeHtml(n.id)} · ${_escapeHtml(n.label)}</option>`
      ).join('');
  }

  function _importRenderTable() {
    const tbody = document.getElementById('import-tbody');
    if (!tbody) return;

    const optsHtmlCache = { sp: null, ce: null };
    const optsHtml = (sezione) => {
      if (!optsHtmlCache[sezione]) optsHtmlCache[sezione] = _importOptionsHtmlPerSezione(sezione);
      return optsHtmlCache[sezione];
    };

    let lastSezione = null;
    let lastColumn = null;
    tbody.innerHTML = _importState.righe.map((r, idx) => {
      const sezione = r.sezione || 'sp';
      const badge = r.status === 'auto' ? 'badge-auto'
                  : r.status === 'partial' ? 'badge-partial'
                  : r.status === 'manual' ? 'badge-manual' : 'badge-none';
      const badgeTxt = r.status === 'auto' ? 'Auto'
                     : r.status === 'partial' ? 'Parziale'
                     : r.status === 'manual' ? 'Salvato' : 'Da mappare';
      const valueFmt = r.value != null
        ? (_importState.pdfModule ? _importState.pdfModule.formatItalianNumber(r.value) : String(r.value))
        : '';
      const baseOpts = optsHtml(sezione);
      const opts = r.schemaId ? baseOpts.replace(
        `value="${_escapeHtml(r.schemaId)}"`,
        `value="${_escapeHtml(r.schemaId)}" selected`
      ) : baseOpts;
      const boldCls = r.bold ? ' import-row-bold' : '';

      let headers = '';
      if (sezione !== lastSezione) {
        const title = sezione === 'ce' ? 'Conto Economico' : 'Stato Patrimoniale';
        headers += `<tr class="import-section-header import-section-prospetto import-prospetto-${sezione}">
          <td colspan="5">${title}</td>
        </tr>`;
        lastSezione = sezione;
        lastColumn = null; // forza ristampa header colonna per la nuova sezione
      }
      if (r.column !== lastColumn) {
        const label = _importColumnLabel(sezione, r.column);
        const sideLabel = r.column === 'left' ? 'Colonna sinistra' : 'Colonna destra';
        headers += `<tr class="import-section-header import-section-${r.column}">
          <td colspan="5">${sideLabel} — ${label}</td>
        </tr>`;
        lastColumn = r.column;
      }

      const ceHereBtn = (sezione === 'sp')
        ? `<div class="import-btn-boundary" onclick="UI.importaImpostaBoundary(${idx})" title="Segnala che da qui in poi inizia il Conto Economico">⇓ CE</div>`
        : '';

      return headers + `<tr class="import-row status-${r.status}${boldCls}" data-idx="${idx}">
        <td class="import-cell-text" title="${_escapeHtml(r.fullText)}">${_escapeHtml(r.text)}</td>
        <td class="import-cell-value num">${valueFmt}</td>
        <td>
          <select data-idx="${idx}" onchange="UI.importaCambiaVoce(${idx}, this.value)">
            ${opts}
          </select>
        </td>
        <td><span class="import-badge ${badge}">${badgeTxt}</span></td>
        <td class="import-col-actions">
          ${ceHereBtn}
          <div class="import-btn-remove" onclick="UI.importaRimuoviRiga(${idx})" title="Elimina questa voce dalla lista">×</div>
        </td>
      </tr>`;
    }).join('');
  }

  function importaRimuoviRiga(idx) {
    if (idx == null || !_importState.righe[idx]) return;
    _importState.righe.splice(idx, 1);
    _importRenderTable();
  }

  function importaImpostaBoundary(idx) {
    if (idx == null || !_importState.righe[idx]) return;
    _importState.boundarySpCe = idx;
    const saved = _importMergedMapping();
    // Ricostruisci i dizionari (utilizzati per il re-matching delle righe CE)
    const builtSP = _importState.pdfModule.buildDictionary([Schema.SP_ATTIVO, Schema.SP_PASSIVO]);
    const builtCE = _importState.pdfModule.buildDictionary([Schema.CE]);

    _importState.righe = _importState.righe.map((r, i) => {
      const isCE = i >= idx;
      const sezione = isCE ? 'ce' : 'sp';
      const flat = isCE ? builtCE.flatList : builtSP.flatList;

      // Se l'utente aveva gia' confermato un mapping manuale e punta a una voce
      // ancora valida nella nuova sezione, preservalo. Altrimenti rimatcha.
      if (r.status === 'manual' && flat.some(n => n.id === r.schemaId)) {
        return { ...r, sezione };
      }
      const dict = isCE ? builtCE.dict : builtSP.dict;
      const match = _importState.pdfModule.findBestMatch(r.text, dict, flat, saved);
      return {
        ...r,
        sezione,
        schemaId: match ? match.id : '',
        schemaLabel: match ? match.label : '',
        status: match ? match.status : 'none'
      };
    });
    _importRenderTable();
  }

  function importaCambiaVoce(idx, schemaId) {
    const r = _importState.righe[idx];
    if (!r) return;
    r.schemaId = schemaId || '';
    if (schemaId) {
      const flat = r.sezione === 'ce' ? _importState.schemaFlatCE : _importState.schemaFlatSP;
      const node = flat.find(n => n.id === schemaId);
      r.schemaLabel = node ? node.label : '';
      r.status = 'manual';
    } else {
      r.schemaLabel = '';
      r.status = 'none';
    }
    _importRenderTable();
  }

  function importaSalvaRegole() {
    _importLoadRegoleLocali();
    let nuove = 0;
    for (const r of _importState.righe) {
      if (!r.schemaId || !r.text) continue;
      const key = r.text;
      if (_importState.regoleLocali[key] !== r.schemaId) {
        _importState.regoleLocali[key] = r.schemaId;
        nuove++;
      }
    }
    _importSaveRegoleLocali();
    mostraNotifica(
      nuove > 0
        ? `Salvate ${nuove} nuove regole nel dizionario locale.`
        : 'Nessuna nuova regola da salvare.',
      nuove > 0 ? 'success' : 'info'
    );
  }

  /* ══════════════════════════════════════════════════════════
     FASE 2 — Sezione Dati di partenza
     ══════════════════════════════════════════════════════════ */

  /* ── Render principale ───────────────────────────────────── */

  function _renderDatiPartenza() {
    const content = document.getElementById('content');
    const progetto = Projects.getProgetto();
    if (!content || !progetto) return;

    const scenario = progetto.meta.scenario;
    const modalita = progetto.meta.modalita || 'rapida';
    const anno = progetto.meta.anno_base;

    // Banner scenario
    const bannerCfg = {
      sp_ce:       { cls: 'sp-ce',       icon: '📊', text: 'SP + CE storici — Inserimento completo art. 2424/2425' },
      sp_only:     { cls: 'sp-only',     icon: '📋', text: 'Solo SP storico — Il CE viene costruito dai driver' },
      costituenda: { cls: 'costituenda', icon: '🏗', text: 'Società costituenda — SP semplificato di avvio' }
    };
    const bc = bannerCfg[scenario] || bannerCfg.sp_ce;

    // CE disabilitato?
    const ceDisabled = scenario === 'sp_only' || scenario === 'costituenda';

    let html = '';

    // Banner
    html += `<div class="scenario-banner ${bc.cls}">
      <span class="scenario-banner-icon">${bc.icon}</span>
      <span class="scenario-banner-text">${bc.text}</span>
    </div>`;

    // Tabs con indicatori completamento
    var st = progetto.storico[String(anno)];
    var spDot = '', ceDot = '';

    if (scenario === 'costituenda') {
      if (st && st.sp_avvio && _haValoriNonZero(st.sp_avvio)) spDot = '<span class="tab-dot complete"></span>';
    } else {
      if (st && st.sp) {
        var spHaDati = _haValoriNonZero(st.sp.attivo) || _haValoriNonZero(st.sp.passivo);
        if (spHaDati) {
          var totAtt = _sommaValori(st.sp.attivo);
          var totPass = _sommaValori(st.sp.passivo);
          spDot = Math.abs(totAtt - totPass) > 1
            ? '<span class="tab-dot error"></span>'
            : '<span class="tab-dot complete"></span>';
        }
      }
    }
    if (!ceDisabled && st && st.ce && _haValoriNonZero(st.ce)) {
      ceDot = '<span class="tab-dot complete"></span>';
    }

    html += `<div class="tabs" id="dati-tabs">
      <div class="tab-item${_datiTab === 'tab-sp' ? ' active' : ''}" data-tab="tab-sp" onclick="UI.switchDatiTab('tab-sp')">Stato Patrimoniale${spDot}</div>
      <div class="tab-item${_datiTab === 'tab-ce' ? ' active' : ''}${ceDisabled ? ' disabled' : ''}" data-tab="tab-ce" onclick="UI.switchDatiTab('tab-ce')">Conto Economico${ceDot}</div>
    </div>`;

    // Toolbar
    html += `<div class="section-toolbar">
      <div class="section-toolbar-left">
        <span class="header-badge header-badge-anno">${scenario === 'costituenda' ? 'Avvio' : 'Anno'}: ${anno}</span>
        <div class="btn btn-ghost btn-sm" onclick="UI.expandAll()">Espandi tutto</div>
        <div class="btn btn-ghost btn-sm" onclick="UI.collapseAll()">Comprimi tutto</div>
      </div>
      <div class="section-toolbar-right">
        <div class="toggle-group" id="tg-modalita">
          <div class="toggle-item${modalita === 'rapida' ? ' active' : ''}" data-value="rapida" onclick="UI.toggleModalita('rapida')">Rapida</div>
          <div class="toggle-item${modalita === 'analitica' ? ' active' : ''}" data-value="analitica" onclick="UI.toggleModalita('analitica')">Analitica</div>
        </div>
      </div>
    </div>`;

    // Tab SP
    html += `<div class="tab-pane${_datiTab === 'tab-sp' ? ' active' : ''}" id="tab-sp">`;
    html += _renderSPContent(progetto);
    html += `</div>`;

    // Tab CE
    html += `<div class="tab-pane${_datiTab === 'tab-ce' ? ' active' : ''}" id="tab-ce">`;
    if (ceDisabled) {
      html += _renderTabDisabled(scenario);
    } else {
      html += _renderCEContent(progetto);
    }
    html += `</div>`;

    content.innerHTML = html;
    _aggiornaQuadratura();
  }

  function _renderTabDisabled(scenario) {
    const msg = scenario === 'costituenda'
      ? 'Società costituenda — il primo CE viene generato interamente dal motore.'
      : 'CE storico non disponibile — il primo CE viene costruito dai driver.';
    return `<div class="tab-disabled-notice">
      <div class="tab-disabled-notice-icon">📄</div>
      <div class="tab-disabled-notice-title">Conto Economico non inseribile</div>
      <div class="tab-disabled-notice-desc">${msg}</div>
    </div>`;
  }

  /* ── Rendering SP ────────────────────────────────────────── */

  function _renderSPContent(progetto) {
    const scenario = progetto.meta.scenario;
    if (scenario === 'costituenda') {
      return _renderSPCostitutenda(progetto);
    }
    const anno = String(progetto.meta.anno_base);
    const modalita = progetto.meta.modalita || 'rapida';
    const annoData = progetto.storico[anno];
    if (!annoData || !annoData.sp) return '<p class="text-muted">Dati non disponibili.</p>';

    let html = '<div class="sp-bilancio-grid">';

    // Colonna ATTIVO
    html += '<div class="sp-bilancio-col">';
    html += '<h3 class="sp-bilancio-header">ATTIVO</h3>';
    html += '<table class="schema-table" id="table-sp-attivo"><colgroup><col class="col-label"><col class="col-amount"></colgroup><tbody>';
    html += _buildTreeRows(Schema.SP_ATTIVO, annoData.sp.attivo, 'sp', 'attivo', modalita, 0, []);
    html += '</tbody></table>';
    html += '</div>';

    // Colonna PASSIVO
    html += '<div class="sp-bilancio-col">';
    html += '<h3 class="sp-bilancio-header">PASSIVO E PATRIMONIO NETTO</h3>';
    html += '<table class="schema-table" id="table-sp-passivo"><colgroup><col class="col-label"><col class="col-amount"></colgroup><tbody>';
    html += _buildTreeRows(Schema.SP_PASSIVO, annoData.sp.passivo, 'sp', 'passivo', modalita, 0, []);
    html += '</tbody></table>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function _renderSPCostitutenda(progetto) {
    const anno = String(progetto.meta.anno_base);
    const annoData = progetto.storico[anno];
    if (!annoData || !annoData.sp_avvio) return '<p class="text-muted">Dati non disponibili.</p>';

    // Dividi nodi schema in ATTIVO (prima di spc._PAS) e PASSIVO (dopo spc._PAS)
    var nodiAttivo = [], nodiPassivo = [], dopoSeparatore = false;
    for (var i = 0; i < Schema.SP_COSTITUENDA.length; i++) {
      var nodo = Schema.SP_COSTITUENDA[i];
      if (nodo.id === 'spc._PAS') { dopoSeparatore = true; continue; }
      if (nodo.id === 'spc._ATT') continue; // skip separatore attivo
      if (dopoSeparatore) nodiPassivo.push(nodo);
      else nodiAttivo.push(nodo);
    }

    var html = '<div class="sp-bilancio-grid">';

    // Colonna ATTIVO
    html += '<div class="sp-bilancio-col">';
    html += '<h3 class="sp-bilancio-header">ATTIVO</h3>';
    html += '<table class="schema-table" id="table-sp-avvio-att"><colgroup><col class="col-label"><col class="col-amount"></colgroup><tbody>';
    html += _buildTreeRows(nodiAttivo, annoData.sp_avvio, 'sp_avvio', '', 'analitica', 0, []);
    html += '</tbody></table>';
    html += '</div>';

    // Colonna PASSIVO
    html += '<div class="sp-bilancio-col">';
    html += '<h3 class="sp-bilancio-header">PASSIVO</h3>';
    html += '<table class="schema-table" id="table-sp-avvio-pas"><colgroup><col class="col-label"><col class="col-amount"></colgroup><tbody>';
    html += _buildTreeRows(nodiPassivo, annoData.sp_avvio, 'sp_avvio', '', 'analitica', 0, []);
    html += '</tbody></table>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  /* ── Rendering CE ────────────────────────────────────────── */

  function _renderCEContent(progetto) {
    const anno = String(progetto.meta.anno_base);
    const modalita = progetto.meta.modalita || 'rapida';
    const annoData = progetto.storico[anno];
    if (!annoData || !annoData.ce) return '<p class="text-muted">Dati non disponibili.</p>';

    let html = `<table class="schema-table" id="table-ce"><colgroup><col class="col-label"><col class="col-amount"></colgroup><tbody>`;
    html += _buildTreeRows(Schema.CE, annoData.ce, 'ce', '', modalita, 0, []);
    html += `</tbody></table>`;
    return html;
  }

  /* ── Costruzione righe tabella (ricorsivo) ───────────────── */

  function _buildTreeRows(nodes, dati, sez, lato, modalita, depth, parentIds) {
    let html = '';
    for (const nodo of nodes) {
      html += _buildNodeHtml(nodo, dati, sez, lato, modalita, depth, parentIds);
    }
    return html;
  }

  function _buildNodeHtml(nodo, dati, sez, lato, modalita, depth, parentIds) {
    // Separatore — riga visiva non editabile (es. ── ATTIVO ── / ── PASSIVO ──)
    if (nodo.tipo === 'separatore') {
      var hidden = _isHidden(parentIds) ? ' row-collapsed' : '';
      var parStr = parentIds.join(' ');
      return '<tr class="row-separatore' + hidden + '" data-node-id="' + nodo.id + '" data-parents="' + parStr + '"><td colspan="2">' + _escapeHtml(nodo.label) + '</td></tr>\n';
    }

    // Totale — sempre visibile
    if (nodo.tipo === 'totale') {
      return _totaleRowHtml(nodo, dati, sez, lato, modalita, parentIds);
    }

    const isRapida = modalita === 'rapida';
    const rapidaList = _getRapidaList(sez, lato);
    const inRapida = isRapida && rapidaList && rapidaList.includes(nodo.id);
    const hasChildren = nodo.children && nodo.children.length > 0;

    let html = '';

    if (isRapida) {
      if (inRapida) {
        // Nodo nella lista rapida: mostra come editabile, nascondi figli
        html += _editableRowHtml(nodo, dati, sez, lato, depth, parentIds, modalita);
      } else if (hasChildren) {
        // Nodo genitore con figli nella lista rapida: mostra come header calcolato
        html += _computedRowHtml(nodo, dati, sez, lato, modalita, depth, parentIds);
        const newParents = parentIds.concat(nodo.id);
        html += _buildTreeRows(nodo.children, dati, sez, lato, modalita, depth + 1, newParents);
      }
      // Nodi non in lista e senza figli rilevanti: saltati
    } else {
      // Analitica
      if (hasChildren) {
        html += _computedRowHtml(nodo, dati, sez, lato, modalita, depth, parentIds);
        const newParents = parentIds.concat(nodo.id);
        html += _buildTreeRows(nodo.children, dati, sez, lato, modalita, depth + 1, newParents);
      } else {
        html += _editableRowHtml(nodo, dati, sez, lato, depth, parentIds, modalita);
      }
    }

    return html;
  }

  /* ── Righe HTML singole ──────────────────────────────────── */

  function _rowClass(depth) {
    if (depth === 0) return 'row-mastro';
    if (depth === 1) return 'row-sottomastro';
    return 'row-conto';
  }

  function _isHidden(parentIds) {
    return parentIds.some(function(pid) { return _collapsed.has(pid); });
  }

  function _editableRowHtml(nodo, dati, sez, lato, depth, parentIds, modalita) {
    const cls = _rowClass(depth);
    const hidden = _isHidden(parentIds) ? ' row-collapsed' : '';
    const parStr = parentIds.join(' ');
    const pad = 12 + depth * 12;

    // Controlla se ha conti custom figli
    const contiCustom = _getContiCustom();
    const figli = contiCustom.filter(function(cc) { return cc.parent_id === nodo.id; });
    const haFigli = figli.length > 0;
    const isAnalitica = modalita === 'analitica';

    let html = '';

    if (haFigli && isAnalitica) {
      // Nodo diventa computed (somma dei figli custom)
      const isCol = _collapsed.has(nodo.id);
      const val = Engine.calcolaValore(nodo, dati, modalita, contiCustom);
      const valCls = val < 0 ? ' negative' : (val === 0 ? ' zero' : '');

      html += `<tr class="${cls}${hidden}${isCol ? ' collapsed' : ''}" data-node-id="${nodo.id}" data-parents="${parStr}">
        <td style="padding-left:${pad}px"><span class="collapse-icon" onclick="UI.toggleCollapse('${nodo.id}')">▾</span> ${_escapeHtml(nodo.label)}</td>
        <td class="cell-amount"><span class="amount-computed${valCls}" data-nodo-id="${nodo.id}" data-sez="${sez}" data-lato="${lato}">${_formatImporto(val)}</span></td>
      </tr>\n`;

      // Righe conti custom
      const childPar = parentIds.concat(nodo.id).join(' ');
      const childHidden = _isHidden(parentIds.concat(nodo.id)) ? ' row-collapsed' : '';
      const childPad = pad + 12;
      for (const cc of figli) {
        const ccVal = dati[cc.id] || 0;
        const ccDisplay = ccVal !== 0 ? _formatImporto(ccVal) : '';
        html += `<tr class="row-conto${childHidden}" data-node-id="${cc.id}" data-parents="${childPar}" data-custom="1">
          <td style="padding-left:${childPad}px"><div class="amount-field" contenteditable="true" style="text-align:left;font-family:var(--font-ui);min-width:150px" data-custom-id="${cc.id}" onblur="UI._handleCustomLabelBlur(this)">${_escapeHtml(cc.label)}</div></td>
          <td class="cell-amount"><div class="amount-field" contenteditable="true" data-conto-id="${cc.id}" data-sez="${sez}" data-lato="${lato}" data-placeholder="0" onblur="UI._handleAmountBlur(this)" onkeydown="UI._handleAmountKey(event)">${ccDisplay}</div></td>
        </tr>\n`;
      }

      // Pulsante aggiungi conto
      html += `<tr class="add-conto-row${childHidden}" data-parents="${childPar}">
        <td style="padding-left:${childPad}px" colspan="2"><div class="add-conto-btn" onclick="UI.aggiungiContoCustom('${nodo.id}','${sez}','${lato}')">+ Aggiungi conto</div></td>
      </tr>\n`;
    } else if (_isImmobilizzazione(nodo.id) && isAnalitica && sez === 'sp') {
      // Immobilizzazione in analitica: mostra costo storico, fondo, netto, aliquota
      html += _immobilizzazioneRowHtml(nodo, dati, sez, lato, depth, parentIds);
    } else if (!nodo.editabile && nodo.computed) {
      // Non-editable computed leaf (e.g. spc.CRED.1): show as read-only auto-calculated
      const val = dati[nodo.id] || 0;
      const valCls = val < 0 ? ' negative' : (val === 0 ? ' zero' : '');
      html += `<tr class="${cls}${hidden}" data-node-id="${nodo.id}" data-parents="${parStr}">
        <td style="padding-left:${pad}px;font-style:italic;color:var(--color-text-secondary)">${_escapeHtml(nodo.label)}</td>
        <td class="cell-amount"><span class="amount-computed${valCls}" data-nodo-id="${nodo.id}" data-sez="${sez}" data-lato="${lato}">${_formatImporto(val)}</span></td>
      </tr>\n`;
    } else {
      // Nodo foglia semplice
      const val = dati[nodo.id] || 0;
      const display = val !== 0 ? _formatImporto(val) : '';
      const notaStyle = nodo.nota_info ? ' style="font-style:italic;color:var(--color-text-secondary)"' : '';
      const notaLabelStyle = nodo.nota_info ? ';font-style:italic;color:var(--color-text-secondary)' : '';
      html += `<tr class="${cls}${hidden}${nodo.nota_info ? ' row-nota-info' : ''}" data-node-id="${nodo.id}" data-parents="${parStr}">
        <td style="padding-left:${pad}px${notaLabelStyle}">${_escapeHtml(nodo.label)}</td>
        <td class="cell-amount"><div class="amount-field" contenteditable="true" data-conto-id="${nodo.id}" data-sez="${sez}" data-lato="${lato}" data-placeholder="0" onblur="UI._handleAmountBlur(this)" onkeydown="UI._handleAmountKey(event)"${notaStyle}>${display}</div></td>
      </tr>\n`;

      // In analitica, mostra sempre il pulsante aggiungi conto (per nodi foglia CE e SP)
      if (isAnalitica && nodo.tipo === 'conto') {
        const childPar = parentIds.concat(nodo.id).join(' ');
        const childHidden = _isHidden(parentIds.concat(nodo.id)) ? ' row-collapsed' : '';
        html += `<tr class="add-conto-row${childHidden}" data-parents="${childPar}" style="display:none" data-add-for="${nodo.id}">
          <td style="padding-left:${pad + 12}px" colspan="2"><div class="add-conto-btn" onclick="UI.aggiungiContoCustom('${nodo.id}','${sez}','${lato}')">+ Aggiungi conto</div></td>
        </tr>\n`;
      }
    }

    return html;
  }

  function _computedRowHtml(nodo, dati, sez, lato, modalita, depth, parentIds) {
    const cls = _rowClass(depth);
    const hidden = _isHidden(parentIds) ? ' row-collapsed' : '';
    const isCol = _collapsed.has(nodo.id);
    const parStr = parentIds.join(' ');
    const val = Engine.calcolaValore(nodo, dati, modalita, _getContiCustom());
    const valCls = val < 0 ? ' negative' : (val === 0 ? ' zero' : '');
    const pad = 12 + depth * 12;

    return `<tr class="${cls}${hidden}${isCol ? ' collapsed' : ''}" data-node-id="${nodo.id}" data-parents="${parStr}">
      <td style="padding-left:${pad}px"><span class="collapse-icon" onclick="UI.toggleCollapse('${nodo.id}')">▾</span> ${_escapeHtml(nodo.label)}</td>
      <td class="cell-amount"><span class="amount-computed${valCls}" data-nodo-id="${nodo.id}" data-sez="${sez}" data-lato="${lato}">${_formatImporto(val)}</span></td>
    </tr>\n`;
  }

  function _totaleRowHtml(nodo, dati, sez, lato, modalita, parentIds) {
    const hidden = _isHidden(parentIds) ? ' row-collapsed' : '';
    const parStr = parentIds.join(' ');
    const val = Engine.calcolaValore(nodo, dati, modalita, _getContiCustom());
    const valCls = val < 0 ? ' negative' : (val === 0 ? ' zero' : '');

    return `<tr class="row-totale${hidden}" data-node-id="${nodo.id}" data-parents="${parStr}">
      <td>${_escapeHtml(nodo.label)}</td>
      <td class="cell-amount"><span class="amount-computed${valCls}" data-nodo-id="${nodo.id}" data-sez="${sez}" data-lato="${lato}">${_formatImporto(val)}</span></td>
    </tr>\n`;
  }

  /* ── Rapida: lista nodi visibili ─────────────────────────── */

  function _getRapidaList(sez, lato) {
    if (sez === 'sp' && lato === 'attivo')  return Schema.SP_RAPIDA_ATTIVO;
    if (sez === 'sp' && lato === 'passivo') return Schema.SP_RAPIDA_PASSIVO;
    if (sez === 'ce')                       return Schema.CE_RAPIDA;
    return null;
  }

  /** Restituisce i conti custom del progetto corrente (o array vuoto). */
  function _getContiCustom() {
    var p = Projects.getProgetto();
    return (p && p.conti_custom) ? p.conti_custom : [];
  }

  /* ── Tab switching ───────────────────────────────────────── */

  function switchDatiTab(tabId) {
    _datiTab = tabId;
    document.querySelectorAll('#dati-tabs .tab-item').forEach(function(el) {
      el.classList.toggle('active', el.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(function(el) {
      el.classList.toggle('active', el.id === tabId);
    });
  }

  /* ── Toggle modalita rapida/analitica ────────────────────── */

  function toggleModalita(modo) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    if (progetto.meta.modalita === modo) return; // gia in questa modalita

    var daRapida = progetto.meta.modalita === 'rapida' && modo === 'analitica';
    var daAnalitica = progetto.meta.modalita === 'analitica' && modo === 'rapida';

    var msg = '';
    if (daRapida) {
      msg = '<strong>Passaggio da Rapida ad Analitica</strong><br><br>' +
        'I valori inseriti a livello aggregato (sottomastri SP e macro-voci CE) ' +
        'resteranno salvati ma potrebbero non corrispondere alla somma dei conti ' +
        'foglia dettagliati, che partono da zero.<br><br>' +
        '<strong>Sezioni interessate:</strong><br>' +
        '• SP Attivo: immobilizzazioni (B.I, B.II, B.III), circolante (C.I-C.IV)<br>' +
        '• SP Passivo: patrimonio netto (A), debiti (D.1-D.14)<br>' +
        '• CE: valore produzione (A), costi (B.6-B.14), area finanziaria (C, D)';
    } else if (daAnalitica) {
      msg = '<strong>Passaggio da Analitica a Rapida</strong><br><br>' +
        'I conti foglia dettagliati e i conti personalizzati resteranno salvati ' +
        'ma non saranno visibili. I totali dei sottomastri verranno mostrati ' +
        'come valori aggregati editabili.<br><br>' +
        '<strong>Sezioni interessate:</strong><br>' +
        '• SP: i dettagli interni dei mastri saranno nascosti<br>' +
        '• CE: le sotto-voci di Personale (B.9), Ammortamenti (B.10) e le voci ' +
        'personalizzate aggiunte saranno nascoste<br>' +
        '• Immobilizzazioni: il dettaglio costo/fondo/aliquota non sarà visibile';
    }

    // Mostra modale conferma
    _pendingModalita = modo;
    var overlay = document.getElementById('modal-cambio-modalita');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'modal-cambio-modalita';
      overlay.className = 'modal-overlay';
      var modal = document.createElement('div');
      modal.className = 'modal';
      modal.style.width = '480px';
      modal.id = 'modal-cambio-modalita-inner';
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    } else {
      overlay.classList.remove('hidden');
    }

    document.getElementById('modal-cambio-modalita-inner').innerHTML =
      '<div class="modal-header"><span class="modal-title">Cambio modalità</span>' +
      '<div class="modal-close" onclick="UI.closeModal(\'modal-cambio-modalita\')">✕</div></div>' +
      '<div class="modal-body"><div style="font-size:13px;color:var(--color-text-secondary);line-height:1.6">' + msg + '</div></div>' +
      '<div class="modal-footer">' +
      '<div class="btn btn-secondary" onclick="UI.closeModal(\'modal-cambio-modalita\')">Annulla</div>' +
      '<div class="btn btn-primary" onclick="UI._confermaToggleModalita()">Conferma</div></div>';
  }

  var _pendingModalita = null;

  function _confermaToggleModalita() {
    var progetto = Projects.getProgetto();
    if (!progetto || !_pendingModalita) return;
    progetto.meta.modalita = _pendingModalita;
    _pendingModalita = null;
    Projects.segnaModificato();
    _collapsed.clear();
    closeModal('modal-cambio-modalita');
    _renderDatiPartenza();
  }

  /* ── Collasso/espansione ─────────────────────────────────── */

  function toggleCollapse(nodeId) {
    if (_collapsed.has(nodeId)) {
      _collapsed.delete(nodeId);
    } else {
      _collapsed.add(nodeId);
    }
    _applyCollapse();
  }

  function expandAll() {
    _collapsed.clear();
    _applyCollapse();
  }

  function collapseAll() {
    // Collassa tutti i nodi che hanno figli (mastri e sottomastri)
    document.querySelectorAll('.schema-table tr[data-node-id]').forEach(function(tr) {
      if (tr.querySelector('.collapse-icon')) {
        _collapsed.add(tr.dataset.nodeId);
      }
    });
    _applyCollapse();
  }

  function _applyCollapse() {
    document.querySelectorAll('.schema-table tr[data-parents]').forEach(function(tr) {
      var nodeId = tr.dataset.nodeId;
      var parents = (tr.dataset.parents || '').split(' ').filter(Boolean);

      // Aggiorna icona collasso sulla riga stessa (solo se ha un nodeId)
      if (nodeId) {
        if (_collapsed.has(nodeId)) {
          tr.classList.add('collapsed');
        } else {
          tr.classList.remove('collapsed');
        }
      }

      // Nascondi se un qualsiasi antenato e collassato
      if (parents.length > 0 && parents.some(function(pid) { return _collapsed.has(pid); })) {
        tr.classList.add('row-collapsed');
      } else if (parents.length > 0) {
        tr.classList.remove('row-collapsed');
      }
    });
  }

  /* ── Gestione input importi ──────────────────────────────── */

  function _handleAmountBlur(el) {
    const contoId = el.dataset.contoId;
    const sez = el.dataset.sez;
    const lato = el.dataset.lato || null;
    const valore = _parseImporto(el.textContent);

    const progetto = Projects.getProgetto();
    if (!progetto) return;

    Projects.setValoreStorico(progetto.meta.anno_base, sez, lato, contoId, valore);

    // Aggiorna display formattato
    el.textContent = valore !== 0 ? _formatImporto(valore) : '';

    _ricalcolaTotali();
    _aggiornaQuadratura();
    _scheduleAggiornaIndicatori();
  }

  function _handleAmountKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
  }

  /* ── Ricalcolo totali ────────────────────────────────────── */

  function _ricalcolaTotali() {
    const progetto = Projects.getProgetto();
    if (!progetto) return;
    const anno = String(progetto.meta.anno_base);
    const modalita = progetto.meta.modalita || 'rapida';
    const annoData = progetto.storico[anno];
    if (!annoData) return;

    document.querySelectorAll('.amount-computed[data-nodo-id]').forEach(function(span) {
      const nodoId = span.dataset.nodoId;
      const sez = span.dataset.sez;
      const lato = span.dataset.lato || null;

      const nodo = Schema.trovaNodo(nodoId);
      if (!nodo) return;

      var dati = null;
      if (sez === 'sp' && lato === 'attivo')  dati = annoData.sp && annoData.sp.attivo;
      if (sez === 'sp' && lato === 'passivo') dati = annoData.sp && annoData.sp.passivo;
      if (sez === 'ce')                       dati = annoData.ce;
      if (sez === 'sp_avvio')                 dati = annoData.sp_avvio;
      if (!dati) return;

      const val = Engine.calcolaValore(nodo, dati, modalita, _getContiCustom());
      span.textContent = _formatImporto(val);
      span.className = 'amount-computed' + (val < 0 ? ' negative' : (val === 0 ? ' zero' : ''));
    });
  }

  /* ── Quadratura SP ───────────────────────────────────────── */

  function _aggiornaQuadratura() {
    const progetto = Projects.getProgetto();
    const qEl = document.getElementById('footer-quadratura');
    const qText = document.getElementById('footer-quadratura-text');
    if (!qEl || !qText) return;

    if (!progetto) { qEl.classList.add('hidden'); return; }

    const anno = String(progetto.meta.anno_base);
    const annoData = progetto.storico[anno];

    if (progetto.meta.scenario === 'costituenda') {
      // Quadratura SP costituenda: ATTIVO vs PASSIVO
      if (!annoData || !annoData.sp_avvio) { qEl.classList.add('hidden'); return; }
      var av = annoData.sp_avvio;
      var totAtt = (av['spc.CRED.1'] || 0) +
        (av['spc.INV.1'] || 0) + (av['spc.INV.2'] || 0) + (av['spc.INV.3'] || 0) +
        (av['spc.SPESE.1'] || 0) + (av['spc.SPESE.2'] || 0) +
        (av['spc.LIQ.1'] || 0);
      var totPass = (av['spc.PN.1'] || 0) + (av['spc.PN.3'] || 0) +
        (av['spc.FIN.1'] || 0) + (av['spc.FIN.2'] || 0);
      var diff = totAtt - totPass;

      qEl.classList.remove('hidden');
      if (Math.abs(diff) < 0.01) {
        qEl.className = 'footer-quadratura ok';
        qText.textContent = 'SP quadrato: Attivo ' + _formatImporto(totAtt) + ' = Passivo ' + _formatImporto(totPass);
      } else {
        qEl.className = 'footer-quadratura error';
        qText.textContent = 'SP NON quadrato — Attivo: ' + _formatImporto(totAtt) + ' / Passivo: ' + _formatImporto(totPass) + ' (diff: ' + _formatImporto(diff) + ')';
      }
      return;
    }

    const modalita = progetto.meta.modalita || 'rapida';
    if (!annoData || !annoData.sp) { qEl.classList.add('hidden'); return; }

    const nodoAtt = Schema.trovaNodo('sp.TOT_ATT');
    const nodoPass = Schema.trovaNodo('sp.TOT_PASS');
    if (!nodoAtt || !nodoPass) return;

    const cc = _getContiCustom();
    const totAttSP  = Engine.calcolaValore(nodoAtt, annoData.sp.attivo, modalita, cc);
    const totPassSP = Engine.calcolaValore(nodoPass, annoData.sp.passivo, modalita, cc);
    const diffSP = totAttSP - totPassSP;

    qEl.classList.remove('hidden');

    if (Math.abs(diffSP) < 0.01) {
      qEl.className = 'footer-quadratura ok';
      qText.textContent = 'SP quadrato: ' + _formatImporto(totAttSP);
    } else {
      qEl.className = 'footer-quadratura error';
      qText.textContent = 'SP NON quadrato — diff: ' + _formatImporto(diffSP);
    }
  }

  /* ── Formattazione importi ───────────────────────────────── */

  function _formatImporto(val) {
    if (val === 0 || val === undefined || val === null) return '0';
    var neg = val < 0;
    var abs = Math.abs(val);
    // Separa parte intera e decimale
    var intPart = Math.floor(abs);
    var decPart = abs - intPart;
    // Separatore migliaia manuale (il toLocaleString puo non funzionare ovunque)
    var str = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    // Mostra i decimali (virgola) solo se presenti
    if (decPart > 0.00001) {
      // Arrotonda a 2 decimali per evitare errori floating point
      var dec = Math.round(decPart * 100);
      if (dec >= 100) { intPart += 1; dec = 0; str = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
      if (dec > 0) {
        str += ',' + (dec < 10 ? '0' + dec : String(dec));
      }
    }
    return neg ? '-' + str : str;
  }

  function _parseImporto(str) {
    if (!str || str.trim() === '') return 0;
    var clean = str.replace(/\./g, '').replace(',', '.').trim();
    var val = parseFloat(clean);
    if (isNaN(val)) return 0;
    // Preserva i decimali (arrotonda a 2 cifre per evitare errori floating point)
    return Math.round(val * 100) / 100;
  }

  /* ══════════════════════════════════════════════════════════
     FASE 3 — Driver & Parametri
     ══════════════════════════════════════════════════════════ */

  let _driverTab = 'drv-ricavi';

  /* ── Render principale ───────────────────────────────────── */

  function _renderDriver() {
    var content = document.getElementById('content');
    var progetto = Projects.getProgetto();
    if (!content || !progetto) return;

    var html = '';

    // Tabs
    html += '<div class="tabs" id="driver-tabs">';
    html += _driverTabItem('drv-ricavi', 'Ricavi', progetto);
    html += _driverTabItem('drv-costi', 'Costi', progetto);
    html += _driverTabItem('drv-personale', 'Personale', progetto);
    html += _driverTabItem('drv-circolante', 'Circolante', progetto);
    html += _driverTabItem('drv-magazzino', 'Magazzino', progetto);
    html += _driverTabItem('drv-patrimoniali', 'Patrimoniali', progetto);
    html += _driverTabItem('drv-fiscale', 'Fiscale', progetto);
    html += '</div>';

    // Tab panes
    html += '<div class="tab-pane' + (_driverTab === 'drv-ricavi' ? ' active' : '') + '" id="drv-ricavi">';
    html += _renderDriverRicavi(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_driverTab === 'drv-costi' ? ' active' : '') + '" id="drv-costi">';
    html += _renderDriverCosti(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_driverTab === 'drv-personale' ? ' active' : '') + '" id="drv-personale">';
    html += _renderPannelloPersonale(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_driverTab === 'drv-circolante' ? ' active' : '') + '" id="drv-circolante">';
    html += _renderDriverCircolante(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_driverTab === 'drv-magazzino' ? ' active' : '') + '" id="drv-magazzino">';
    html += _renderDriverMagazzino(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_driverTab === 'drv-patrimoniali' ? ' active' : '') + '" id="drv-patrimoniali">';
    html += _renderDriverPatrimoniali(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_driverTab === 'drv-fiscale' ? ' active' : '') + '" id="drv-fiscale">';
    html += _renderDriverFiscale(progetto);
    html += '</div>';

    content.innerHTML = html;
  }

  function _driverTabDot(progetto, id) {
    var d = progetto.driver;
    var spCompilato = _isSpCompilato(progetto);

    switch (id) {
      case 'drv-ricavi': {
        var ok = d.ricavi && d.ricavi.some(function(r) { return r.base_annuale > 0; });
        if (ok) return '<span class="tab-dot complete"></span>';
        return spCompilato ? '<span class="tab-dot partial"></span>' : '';
      }
      case 'drv-costi': {
        var ok = d.costi && d.costi.some(function(c) { return c.importo_fisso > 0 || c.pct_ricavi > 0; });
        if (ok) return '<span class="tab-dot complete"></span>';
        return spCompilato ? '<span class="tab-dot partial"></span>' : '';
      }
      case 'drv-personale': {
        // Personale è sempre "compilata" — 0 dipendenti è un valore valido
        return d.personale ? '<span class="tab-dot complete"></span>' : '';
      }
      case 'drv-patrimoniali':
        return (d.finanziamenti_essere && d.finanziamenti_essere.length > 0) ? '<span class="tab-dot complete"></span>' : '';
      default:
        return '';
    }
  }

  function _driverTabItem(id, label, progetto) {
    var dot = progetto ? _driverTabDot(progetto, id) : '';
    return '<div class="tab-item' + (_driverTab === id ? ' active' : '') + '" data-tab="' + id + '" onclick="UI.switchDriverTab(\'' + id + '\')">' + label + dot + '</div>';
  }

  function switchDriverTab(tabId) {
    _driverTab = tabId;
    document.querySelectorAll('#driver-tabs .tab-item').forEach(function(el) {
      el.classList.toggle('active', el.dataset.tab === tabId);
    });
    document.querySelectorAll('#content > .tab-pane').forEach(function(el) {
      el.classList.toggle('active', el.id === tabId);
    });
  }

  /* ── Tab RICAVI ──────────────────────────────────────────── */

  function _renderDriverRicavi(progetto) {
    var ricavi = progetto.driver.ricavi;
    var anniPrev = progetto.meta.anni_previsione || [];
    var nAnni = anniPrev.length;
    var fisc = progetto.driver.fiscale || {};
    var ivaRicaviPct = fisc.iva_ricavi == null ? 0.22 : fisc.iva_ricavi;
    var html = '';

    // Parametri globali dei ricavi: aliquota IVA media + stagionalità
    html += '<div style="display:flex;align-items:center;gap:24px;margin-bottom:16px;flex-wrap:wrap">';

    html += '<div style="display:flex;align-items:center;gap:8px">';
    html += '<span style="font-size:13px;font-weight:600;color:var(--color-text-secondary)">Aliquota IVA media ricavi:</span>';
    html += '<div class="form-field" contenteditable="true" style="width:80px;text-align:right;font-family:var(--font-mono)" data-placeholder="0%" onblur="UI._handleFiscaleField(this,\'iva_ricavi\')" onkeydown="UI._handleAmountKey(event)" title="IVA applicata ai ricavi per calcolo debito IVA">' + _formatPct(ivaRicaviPct) + '</div>';
    html += '</div>';

    var stagAttiva = progetto.driver.stagionalita_attiva || false;
    html += '<div style="display:flex;align-items:center;gap:8px">';
    html += '<span style="font-size:13px;font-weight:600;color:var(--color-text-secondary)">Stagionalità:</span>';
    html += '<div class="toggle-group" style="width:120px">';
    html += '<div class="toggle-item' + (stagAttiva ? ' active' : '') + '" onclick="UI.toggleStagionalita(true)">Sì</div>';
    html += '<div class="toggle-item' + (!stagAttiva ? ' active' : '') + '" onclick="UI.toggleStagionalita(false)">No</div>';
    html += '</div>';
    if (stagAttiva) {
      html += '<div class="btn btn-ghost btn-sm" onclick="UI.editProfiloStagionale()">Configura profilo mensile</div>';
    }
    html += '</div>';

    html += '</div>';

    // Toolbar
    html += '<div class="section-toolbar"><div class="section-toolbar-left">';
    html += '<span style="font-size:13px;font-weight:600;color:var(--color-text-secondary)">Voci di ricavo</span>';
    html += '</div><div class="section-toolbar-right">';
    html += '<div class="btn btn-primary btn-sm" onclick="UI.aggiungiRicavo()">+ Aggiungi voce</div>';
    if (progetto.meta.scenario === 'sp_ce') {
      html += ' <div class="btn btn-secondary btn-sm" onclick="UI.importaRicaviDaCE()">Importa da CE</div>';
    }
    html += '</div></div>';

    if (ricavi.length === 0) {
      html += '<div class="projects-empty" style="padding:32px"><p>Nessuna voce di ricavo configurata.</p></div>';
      return html;
    }

    // Griglia ricavi: Voce | Tipo | Base | Inflaz. | Anno1 | Anno2 | ... | ✕
    var isCostitutenda = progetto.meta.scenario === 'costituenda';
    var colW = Math.max(70, Math.floor(400 / nAnni));
    html += '<div style="overflow-x:auto"><table class="schema-table"><colgroup><col style="width:auto"><col style="width:80px"><col style="width:130px"><col style="width:60px">';
    for (var c = 0; c < nAnni; c++) html += '<col style="width:' + colW + 'px">';
    html += '<col style="width:40px"></colgroup>';

    // Header: anni con pulsante "↓ applica a tutte"
    html += '<thead><tr class="row-mastro"><td>Voce</td><td class="cell-amount">Tipo</td><td class="cell-amount">Base importo</td><td class="cell-amount" title="Inflazione — se attiva, i ricavi crescono automaticamente del tasso di inflazione annuo oltre alla crescita impostata anno per anno. Disattiva per modelli reali o scenari con prezzi di vendita rigidi (es. contratti pluriennali a prezzo fisso).">Inflaz.</td>';
    for (var h = 0; h < nAnni; h++) {
      if (isCostitutenda && h === 0) {
        html += '<td class="cell-amount" style="font-size:12px;color:var(--color-text-muted)">' + anniPrev[h] + '</td>';
      } else {
        html += '<td class="cell-amount" style="font-size:12px">' + anniPrev[h] + '<br>';
        html += '<div class="add-conto-btn" style="font-size:10px;display:inline-flex;margin-top:2px" onclick="UI.applicaCrescitaColonna(' + h + ')">↓ a tutte</div>';
        html += '</td>';
      }
    }
    html += '<td></td></tr></thead><tbody>';

    // Righe ricavi
    for (var i = 0; i < ricavi.length; i++) {
      var r = ricavi[i];
      var crescita = (typeof r.crescita_annua === 'object' && r.crescita_annua) ? r.crescita_annua : {};
      var baseTipoR = r.base_tipo || 'annuale';
      var baseTipoLabelR = baseTipoR === 'mensile' ? 'Mensile' : 'Annuale';

      var rid = r.id; // id stabile del driver ricavo
      html += '<tr class="row-conto">';
      // Label
      html += '<td><div class="amount-field" contenteditable="true" style="text-align:left;min-width:150px;font-family:var(--font-ui)" onblur="UI._handleDriverField(this,\'ricavi\',\'' + rid + '\',\'label\')">' + _escapeHtml(r.label) + '</div></td>';
      // Tipo toggle (Annuale/Mensile)
      html += '<td class="cell-amount"><div class="btn btn-ghost btn-sm" onclick="UI.ciclaBaseTipo(\'ricavi\',\'' + rid + '\')">' + baseTipoLabelR + '</div></td>';
      // Base annuale
      html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleDriverField(this,\'ricavi\',\'' + rid + '\',\'base_annuale\')" onkeydown="UI._handleAmountKey(event)">' + (r.base_annuale ? _formatImporto(r.base_annuale) : '') + '</div></td>';
      // Inflaz. toggle (default true per retrocompatibilità)
      var inflazAttiva = r.soggetto_inflazione !== false;
      var inflIcon = inflazAttiva ? '✓' : '✕';
      var inflColor = inflazAttiva ? 'var(--color-success)' : 'var(--color-text-muted)';
      html += '<td class="cell-amount"><div class="btn btn-ghost btn-sm" style="color:' + inflColor + '" onclick="UI.toggleInflazioneRicavo(\'' + rid + '\')">' + inflIcon + '</div></td>';
      // % per ogni anno + pulsante "→ a tutti gli anni"
      for (var a = 0; a < nAnni; a++) {
        var annoStr = String(anniPrev[a]);
        var pctAnno = crescita[annoStr] || 0;
        if (isCostitutenda && a === 0) {
          // Per costituenda, il primo anno non ha crescita (la base E' il primo anno)
          html += '<td class="cell-amount"><span class="text-muted" style="font-size:11px">—</span></td>';
        } else {
          html += '<td class="cell-amount"><div style="display:flex;align-items:center;gap:2px">';
          html += '<div class="amount-field" contenteditable="true" style="width:50px" data-placeholder="0%" onblur="UI._handleRicavoCrescitaAnno(this,\'' + rid + '\',\'' + annoStr + '\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(pctAnno) + '</div>';
          if (a === 0 || (isCostitutenda && a === 1)) {
            html += '<div class="add-conto-btn" style="font-size:10px;padding:1px 3px" onclick="UI.applicaCrescitaRiga(\'' + rid + '\',\'' + annoStr + '\')" title="Applica a tutti gli anni">→</div>';
          }
          html += '</div></td>';
        }
      }
      // Elimina
      html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviDriver(\'ricavi\',\'' + rid + '\')">✕</div></td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';

    return html;
  }

  function aggiungiRicavo() {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var drv = Projects.creaDriverRicavo(null, 'Nuova voce ricavo', 0);
    progetto.driver.ricavi.push(drv);
    Projects.segnaModificato();
    _renderDriver();
  }

  function toggleStagionalita(val) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    progetto.driver.stagionalita_attiva = val;
    Projects.segnaModificato();
    _renderDriver();
  }

  /** Cicla base_tipo tra 'annuale' e 'mensile' per driver ricavi o costi. */
  function ciclaBaseTipo(tipo, idOrIdx) {
    var idx = _findDriverIdx(tipo, idOrIdx);
    var progetto = Projects.getProgetto();
    if (!progetto || idx < 0) return;
    var arr = progetto.driver[tipo];
    arr[idx].base_tipo = arr[idx].base_tipo === 'mensile' ? 'annuale' : 'mensile';
    Projects.segnaModificato();
    _renderDriver();
  }

  function _handleRicavoCrescitaAnno(el, idOrIdx, annoStr) {
    var idx = _findDriverIdx('ricavi', idOrIdx);
    var progetto = Projects.getProgetto();
    if (!progetto || idx < 0) return;
    var r = progetto.driver.ricavi[idx];
    if (typeof r.crescita_annua !== 'object' || !r.crescita_annua) r.crescita_annua = {};
    var val = _parsePct(el.textContent);
    r.crescita_annua[annoStr] = val;
    el.textContent = _formatPct(val);
    Projects.segnaModificato();
  }

  /** Applica la % del primo anno a tutti gli anni per una voce ricavo. */
  function applicaCrescitaRiga(idOrIdx, primoAnnoStr) {
    var idx = _findDriverIdx('ricavi', idOrIdx);
    var progetto = Projects.getProgetto();
    if (!progetto || idx < 0) return;
    var r = progetto.driver.ricavi[idx];
    if (typeof r.crescita_annua !== 'object' || !r.crescita_annua) r.crescita_annua = {};
    var val = r.crescita_annua[primoAnnoStr] || 0;
    (progetto.meta.anni_previsione || []).forEach(function(a) {
      r.crescita_annua[String(a)] = val;
    });
    Projects.segnaModificato();
    _renderDriver();
  }

  /** Applica la % della prima voce a tutte le voci per un anno. */
  function applicaCrescitaColonna(annoIdx) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var anniPrev = progetto.meta.anni_previsione || [];
    var annoStr = String(anniPrev[annoIdx]);
    var ricavi = progetto.driver.ricavi;
    if (ricavi.length === 0) return;

    // Prendi il valore della prima voce per quell'anno
    var prima = ricavi[0];
    var crescitaPrima = (typeof prima.crescita_annua === 'object' && prima.crescita_annua) ? prima.crescita_annua : {};
    var val = crescitaPrima[annoStr] || 0;

    // Applica a tutte le voci
    ricavi.forEach(function(r) {
      if (typeof r.crescita_annua !== 'object' || !r.crescita_annua) r.crescita_annua = {};
      r.crescita_annua[annoStr] = val;
    });
    Projects.segnaModificato();
    _renderDriver();
  }

  function importaRicaviDaCE() {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var anno = String(progetto.meta.anno_base);
    var annoData = progetto.storico[anno];
    if (!annoData || !annoData.ce) { mostraNotifica('Nessun dato CE storico disponibile.', 'warning'); return; }

    // Sincronizza valori base dei driver esistenti + importa conti custom
    var nuovi = Projects.sincronizzaDriverDaCE() || 0;

    // Importa anche voci standard non ancora presenti
    var nodoA = Schema.trovaNodo('ce.A');
    if (nodoA && nodoA.children) {
      var esistenti = progetto.driver.ricavi.map(function(r) { return r.voce_ce; });
      nodoA.children.forEach(function(figlio) {
        var val = annoData.ce[figlio.id] || 0;
        if (esistenti.indexOf(figlio.id) === -1) {
          var drv = Projects.creaDriverRicavo(figlio.id, figlio.label, val);
          progetto.driver.ricavi.push(drv);
          nuovi++;
        }
      });
    }

    Projects.segnaModificato();
    mostraNotifica('Driver ricavi sincronizzati dal CE storico.', 'success');
    _renderDriver();
  }

  /* ── Tab COSTI ───────────────────────────────────────────── */

  function _renderDriverCosti(progetto) {
    // Filtra le voci personale (gestite dal pannello dedicato)
    var costi = progetto.driver.costi.filter(function(c) { return !c.usa_var_personale; });
    var html = '';

    // ── Voci costo (non personale) ──
    html += '<div class="section-toolbar"><div class="section-toolbar-left">';
    html += '<span style="font-size:13px;font-weight:600;color:var(--color-text-secondary)">Altre voci di costo</span>';
    html += '</div><div class="section-toolbar-right">';
    if (progetto.meta.scenario === 'sp_ce') {
      html += '<div class="btn btn-secondary btn-sm" onclick="UI.importaCostiDaCE()">Importa da CE</div>';
    }
    html += '</div></div>';

    // Categorie CE per raggruppamento (mostrate sempre, anche vuote)
    var categorie = [
      { id: 'ce.B.6',  label: 'B.6 — Materie prime' },
      { id: 'ce.B.7',  label: 'B.7 — Servizi' },
      { id: 'ce.B.8',  label: 'B.8 — Godimento beni di terzi' },
      { id: 'ce.B.11', label: 'B.11 — Variazione rimanenze' },
      { id: 'ce.B.12', label: 'B.12 — Accantonamenti rischi' },
      { id: 'ce.B.13', label: 'B.13 — Altri accantonamenti' },
      { id: 'ce.B.14', label: 'B.14 — Oneri diversi di gestione' },
      { id: '_altro',  label: 'Altre voci' }
    ];

    // Raggruppa i costi per categoria
    var costiAll = progetto.driver.costi;
    var gruppi = {};
    categorie.forEach(function(cat) { gruppi[cat.id] = []; });

    for (var i = 0; i < costiAll.length; i++) {
      var c = costiAll[i];
      if (c.usa_var_personale) continue;
      var catId = _categoriaCosto(c.voce_ce);
      if (!gruppi[catId]) gruppi[catId] = gruppi['_altro'];
      gruppi[catId].push({ drv: c, idx: i });
    }
    // Ordina alfabeticamente per label dentro ogni sezione
    categorie.forEach(function(cat) {
      if (gruppi[cat.id]) {
        gruppi[cat.id].sort(function(a, b) { return (a.drv.label || '').localeCompare(b.drv.label || ''); });
      }
    });

    html += '<table class="schema-table"><colgroup><col style="width:auto"><col style="width:90px"><col style="width:110px"><col style="width:90px"><col style="width:60px"><col style="width:45px"><col style="width:60px"><col style="width:40px"></colgroup>';

    for (var ci = 0; ci < categorie.length; ci++) {
      var cat = categorie[ci];
      var items = gruppi[cat.id];
      if (!items) items = [];
      if (cat.id === '_altro' && items.length === 0) continue;

      // Header categoria
      html += '<thead><tr class="row-sottomastro"><td colspan="8" style="padding:8px 12px;font-weight:700">' + cat.label + '</td></tr>';
      if (items.length > 0) {
        html += '<tr style="font-size:11px;color:var(--color-text-muted)"><td></td><td class="cell-amount">Tipo</td><td class="cell-amount">Valore</td><td class="cell-amount" title="Variazione annua della percentuale sui ricavi. Modalità pp (assoluta): somma di punti percentuali all&#39;anno. Modalità rel (relativa): crescita moltiplicativa della pct (utile per modellare inflazione su costi variabili con prezzi di vendita rigidi). Clic sul badge pp/rel per cambiare.">Var. %/anno</td><td class="cell-amount">Inflaz.</td><td class="cell-amount" title="Costo del venduto — attiva per costi (variabili o fissi) direttamente attribuibili alla produzione/erogazione del prodotto o servizio venduto (es. materie prime, hosting, licenze software produttive, canoni leasing di strumenti di delivery). Escludi spese commerciali, generali, amministrative o di rappresentanza.">CDV</td><td class="cell-amount">IVA</td><td></td></tr>';
      }
      html += '</thead><tbody>';

      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        var cc = item.drv;
        var did = cc.id; // id stabile del driver (non cambia con splice)
        html += '<tr class="row-conto">';
        html += '<td><div class="amount-field" contenteditable="true" style="text-align:left;min-width:160px;font-family:var(--font-ui)" onblur="UI._handleDriverField(this,\'costi\',\'' + did + '\',\'label\')">' + _escapeHtml(cc.label) + '</div></td>';

        var tipoLabel = cc.tipo_driver === 'pct_ricavi' ? '% ricavi' : 'Fisso';
        html += '<td class="cell-amount"><div class="btn btn-ghost btn-sm" onclick="UI.ciclaTipoCosto(\'' + did + '\')">' + tipoLabel + '</div></td>';

        if (cc.tipo_driver === 'pct_ricavi') {
          html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0%" onblur="UI._handleDriverField(this,\'costi\',\'' + did + '\',\'pct_ricavi\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(cc.pct_ricavi) + '</div></td>';
          // Var. %/anno con toggle modalità: 'pp' (assoluta, additiva) | 'rel' (relativa, moltiplicativa)
          var varMode = cc.var_pct_annua_mode === 'relativa' ? 'relativa' : 'assoluta';
          var varModeLabel = varMode === 'relativa' ? 'rel' : 'pp';
          var varModeTitle = varMode === 'relativa'
            ? 'Relativa: pct cresce moltiplicativamente (es. 30% × 1,02 → 30,6% → 31,21% con +2%/anno). Utile per inflazione costi con prezzi di vendita rigidi.'
            : 'Assoluta: pct cresce additivamente in punti percentuali (es. 30% + 0,6pp → 30,6% → 31,2% con +0,6pp/anno).';
          html += '<td class="cell-amount"><div style="display:flex;align-items:center;gap:2px;justify-content:flex-end">';
          html += '<div class="btn btn-ghost btn-sm" style="font-size:10px;padding:1px 4px" onclick="UI.ciclaVarPctMode(\'' + did + '\')" title="' + varModeTitle + '">' + varModeLabel + '</div>';
          html += '<div class="amount-field" contenteditable="true" style="width:50px" data-placeholder="0%" onblur="UI._handleDriverField(this,\'costi\',\'' + did + '\',\'var_pct_annua\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(cc.var_pct_annua) + '</div>';
          html += '</div></td>';
        } else {
          var baseTipoC = cc.base_tipo || 'annuale';
          var baseTipoLabelC = baseTipoC === 'mensile' ? 'Mens.' : 'Ann.';
          html += '<td class="cell-amount"><div style="display:flex;align-items:center;gap:2px">';
          html += '<div class="btn btn-ghost btn-sm" style="font-size:10px;padding:1px 4px" onclick="UI.ciclaBaseTipo(\'costi\',\'' + did + '\')">' + baseTipoLabelC + '</div>';
          html += '<div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleDriverField(this,\'costi\',\'' + did + '\',\'importo_fisso\')" onkeydown="UI._handleAmountKey(event)">' + (cc.importo_fisso ? _formatImporto(cc.importo_fisso) : '') + '</div>';
          html += '</div></td>';
          html += '<td class="cell-amount"><span class="text-muted" style="font-size:12px">—</span></td>';
        }

        if (cc.tipo_driver === 'pct_ricavi') {
          html += '<td class="cell-amount"><span class="text-muted" style="font-size:11px">n/a</span></td>';
        } else {
          var flagIcon = cc.soggetto_inflazione ? '✓' : '✕';
          var flagColor = cc.soggetto_inflazione ? 'var(--color-success)' : 'var(--color-text-muted)';
          html += '<td class="cell-amount"><div class="btn btn-ghost btn-sm" style="color:' + flagColor + '" onclick="UI.toggleInflazione(\'' + did + '\')">' + flagIcon + '</div></td>';
        }

        // CDV toggle (Costo del venduto) — attivabile su costi variabili e fissi
        // direttamente attribuibili al prodotto/servizio venduto
        var isB6 = cc.voce_ce && cc.voce_ce.indexOf('ce.B.6') === 0;
        if (isB6) {
          // B.6 is always CDV, show non-toggleable indicator
          html += '<td class="cell-amount"><span style="color:var(--color-success);font-size:12px" title="B.6 sempre nel Costo del venduto">✓</span></td>';
        } else {
          var cdvIcon = cc.costo_venduto ? '✓' : '✕';
          var cdvColor = cc.costo_venduto ? 'var(--color-success)' : 'var(--color-text-muted)';
          html += '<td class="cell-amount"><div class="btn btn-ghost btn-sm" style="color:' + cdvColor + '" onclick="UI.toggleCostoVenduto(\'' + did + '\')">' + cdvIcon + '</div></td>';
        }

        // IVA % (toggle button)
        var ivaPct = cc.iva_pct !== undefined ? cc.iva_pct : 0.22;
        var ivaLabel = Math.round(ivaPct * 100) + '%';
        html += '<td class="cell-amount"><div class="btn btn-ghost btn-sm" onclick="UI.ciclaIva(\'costi\',\'' + did + '\')" ondblclick="UI.editIvaManuale(\'costi\',\'' + did + '\')" oncontextmenu="event.preventDefault();UI.editIvaManuale(\'costi\',\'' + did + '\')">' + ivaLabel + '</div></td>';

        html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviDriver(\'costi\',\'' + did + '\')">✕</div></td>';
        html += '</tr>';
      }
      // Pulsante "Aggiungi" in fondo alla sezione
      html += '<tr><td colspan="8" style="padding:4px 12px"><div class="add-conto-btn" onclick="UI.aggiungiCosto(\'' + cat.id + '\')" style="display:inline-flex">+ Aggiungi</div></td></tr>';
      html += '</tbody>';
    }
    html += '</table>';

    return html;
  }

  function _toggleCatMenu() {
    var menu = document.getElementById('cat-menu');
    if (menu) menu.classList.toggle('hidden');
  }

  /** Determina la categoria CE di una voce costo dal suo voce_ce o parent. */
  function _categoriaCosto(voceCe) {
    if (!voceCe) return '_altro';
    // Mappa i conti foglia alla categoria sottomastro
    if (voceCe.indexOf('ce.B.6') === 0) return 'ce.B.6';
    if (voceCe.indexOf('ce.B.7') === 0) return 'ce.B.7';
    if (voceCe.indexOf('ce.B.8') === 0) return 'ce.B.8';
    if (voceCe.indexOf('ce.B.11') === 0) return 'ce.B.11';
    if (voceCe.indexOf('ce.B.12') === 0) return 'ce.B.12';
    if (voceCe.indexOf('ce.B.13') === 0) return 'ce.B.13';
    if (voceCe.indexOf('ce.B.14') === 0) return 'ce.B.14';
    return '_altro';
  }

  function aggiungiCosto(catId) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;

    if (!catId) {
      // Mostra scelta categoria
      var cats = [
        { id: 'ce.B.6',  label: 'B.6 Materie prime' },
        { id: 'ce.B.7',  label: 'B.7 Servizi' },
        { id: 'ce.B.8',  label: 'B.8 Godimento beni terzi' },
        { id: 'ce.B.11', label: 'B.11 Var. rimanenze' },
        { id: 'ce.B.14', label: 'B.14 Oneri diversi' }
      ];
      var scelta = cats.map(function(c) { return c.label; }).join('\n');
      // Per ora cicla su B.7 (la piu comune)
      catId = 'ce.B.7';
    }

    var drv = Projects.creaDriverCosto(catId, 'Nuova voce costo', 'fisso');
    progetto.driver.costi.push(drv);
    Projects.segnaModificato();
    _renderDriver();
    // Scroll e focus sulla label della nuova voce
    setTimeout(function() {
      var fields = document.querySelectorAll('[onblur*="' + drv.id + '"][onblur*="label"]');
      if (fields.length > 0) {
        fields[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        fields[0].focus();
      }
    }, 50);
  }

  function importaCostiDaCE() {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var anno = String(progetto.meta.anno_base);
    var annoData = progetto.storico[anno];
    if (!annoData || !annoData.ce) { mostraNotifica('Nessun dato CE storico disponibile.', 'warning'); return; }

    // Sincronizza valori base + conti custom
    Projects.sincronizzaDriverDaCE();

    // Aggiorna i valori base dei costi esistenti dal CE
    progetto.driver.costi.forEach(function(drv) {
      if (drv.voce_ce && annoData.ce[drv.voce_ce] !== undefined) {
        var val = annoData.ce[drv.voce_ce] || 0;
        if (drv.tipo_driver !== 'pct_ricavi' && val > 0) {
          drv.importo_fisso = val;
        }
      }
    });

    Projects.segnaModificato();
    mostraNotifica('Driver costi sincronizzati dal CE storico.', 'success');
    _renderDriver();
  }

  /** Cicla tipo costo: solo pct_ricavi <-> fisso (personale gestito a parte). */
  function ciclaTipoDriver(idx) { ciclaTipoCosto(idx); }

  function ciclaTipoCosto(idOrIdx) {
    var idx = _findDriverIdx('costi', idOrIdx);
    var progetto = Projects.getProgetto();
    if (!progetto || idx < 0) return;
    var c = progetto.driver.costi[idx];
    if (c.usa_var_personale) return;

    if (c.tipo_driver === 'pct_ricavi') {
      c.tipo_driver = 'fisso';
      c.pct_ricavi = null;
      c.var_pct_annua = null;
      c.var_pct_annua_mode = null;
      c.importo_fisso = c.importo_fisso || 0;
      c.soggetto_inflazione = true;
    } else {
      c.tipo_driver = 'pct_ricavi';
      c.pct_ricavi = 0;
      c.var_pct_annua = 0;
      c.var_pct_annua_mode = c.var_pct_annua_mode || 'assoluta';
      c.importo_fisso = null;
      c.soggetto_inflazione = false;
    }
    Projects.segnaModificato();
    _renderDriver();
  }

  /* ── Pannello Personale (organico) ───────────────────────── */

  function _renderPannelloPersonale(progetto) {
    var pers = progetto.driver.personale || {};
    var anniPrev = progetto.meta.anni_previsione || [];
    var annoBase = progetto.meta.anno_base;
    var html = '';

    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Personale</h3>';
    html += '<div class="form-hint mb-8">I costi del personale (salari, oneri, TFR) sono calcolati automaticamente dall\'organico. Le voci ce.B.9a/9b/9c vengono alimentate da questo pannello.</div>';

    // Parametri base
    html += '<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:16px">';

    html += '<div class="form-group" style="min-width:120px"><span class="form-label">N. dipendenti</span>';
    html += '<div class="form-field" contenteditable="true" style="width:80px;text-align:right;font-family:var(--font-mono)" data-placeholder="0" onblur="UI._handlePersField(this,\'headcount\')" onkeydown="UI._handleAmountKey(event)">' + (pers.headcount || '') + '</div></div>';

    html += '<div class="form-group" style="min-width:150px"><span class="form-label">RAL media annua</span>';
    html += '<div class="form-field" contenteditable="true" style="width:120px;text-align:right;font-family:var(--font-mono)" data-placeholder="0" onblur="UI._handlePersField(this,\'ral_media\')" onkeydown="UI._handleAmountKey(event)">' + (pers.ral_media ? _formatImporto(pers.ral_media) : '') + '</div></div>';

    html += '<div class="form-group" style="min-width:120px"><span class="form-label">Coeff. oneri %</span>';
    html += '<div class="form-field" contenteditable="true" style="width:80px;text-align:right;font-family:var(--font-mono)" data-placeholder="32" onblur="UI._handlePersField(this,\'coeff_oneri\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(pers.coeff_oneri) + '</div></div>';

    var ha13 = pers.tredicesima !== false;
    var ha14 = pers.quattordicesima !== false;
    html += '<div class="form-group" style="min-width:80px"><span class="form-label">13ª mens.</span>';
    html += '<select style="width:60px;font-family:var(--font-mono);padding:4px" onchange="UI._handlePersToggle(\'tredicesima\',this.value)">';
    html += '<option value="1"' + (ha13 ? ' selected' : '') + '>SI</option><option value="0"' + (!ha13 ? ' selected' : '') + '>NO</option></select></div>';

    html += '<div class="form-group" style="min-width:80px"><span class="form-label">14ª mens.</span>';
    html += '<select style="width:60px;font-family:var(--font-mono);padding:4px" onchange="UI._handlePersToggle(\'quattordicesima\',this.value)">';
    html += '<option value="1"' + (ha14 ? ' selected' : '') + '>SI</option><option value="0"' + (!ha14 ? ' selected' : '') + '>NO</option></select></div>';

    html += '</div>';

    // Variazione RAL per anno
    html += '<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:16px">';
    var varRal = pers.var_ral_pct || {};
    for (var k = 0; k < anniPrev.length; k++) {
      var a = String(anniPrev[k]);
      html += '<div class="form-group" style="min-width:100px"><span class="form-label">Var. RAL % ' + a + '</span>';
      html += '<div class="form-field" contenteditable="true" style="width:70px;text-align:right;font-family:var(--font-mono)" data-placeholder="0" onblur="UI._handlePersRalAnno(this,\'' + a + '\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(varRal[a] || 0) + '</div></div>';
    }
    html += '</div>';

    html += '<div class="form-hint mb-8" style="margin-top:8px">Le variazioni di organico (+/- persone) si gestiscono nella sezione Eventi.</div>';

    // Riepilogo calcolato
    if (pers.headcount > 0 && pers.ral_media > 0) {
      html += '<div style="margin-top:16px;margin-bottom:8px;font-size:13px;font-weight:600;color:var(--color-text-secondary)">Riepilogo calcolato</div>';
      html += '<table class="schema-table" style="max-width:700px"><colgroup><col style="width:80px"><col style="width:70px"><col style="width:120px"><col style="width:120px"><col style="width:100px"><col style="width:120px"></colgroup>';
      html += '<thead><tr class="row-sottomastro"><td>Anno</td><td class="cell-amount">HC medio</td><td class="cell-amount">Salari</td><td class="cell-amount">Oneri sociali</td><td class="cell-amount">TFR</td><td class="cell-amount">Totale</td></tr></thead><tbody>';

      for (var pi = 0; pi < anniPrev.length; pi++) {
        var annoCalc = anniPrev[pi];
        var calc = Engine.calcolaPersonaleAnno(pers, annoCalc, annoBase, progetto.meta);
        html += '<tr class="row-conto">';
        html += '<td>' + annoCalc + '</td>';
        html += '<td class="cell-amount"><span class="amount-computed">' + calc.headcount_medio + '</span></td>';
        html += '<td class="cell-amount"><span class="amount-computed">' + _formatImporto(calc.salari) + '</span></td>';
        html += '<td class="cell-amount"><span class="amount-computed">' + _formatImporto(calc.oneri) + '</span></td>';
        html += '<td class="cell-amount"><span class="amount-computed">' + _formatImporto(calc.tfr) + '</span></td>';
        html += '<td class="cell-amount"><span class="amount-computed" style="font-weight:700">' + _formatImporto(calc.totale) + '</span></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }

    return html;
  }

  function _handlePersField(el, campo) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.driver.personale) return;
    var pers = progetto.driver.personale;
    if (campo === 'headcount') {
      pers.headcount = parseFloat((el.textContent || '').replace(',', '.')) || 0;
      pers.headcount = Math.round(pers.headcount * 10) / 10;
      el.textContent = pers.headcount || '';
    } else if (campo === 'ral_media') {
      pers.ral_media = _parseImporto(el.textContent);
      el.textContent = pers.ral_media ? _formatImporto(pers.ral_media) : '';
    } else if (campo === 'coeff_oneri') {
      pers.coeff_oneri = _parsePct(el.textContent);
      el.textContent = _formatPct(pers.coeff_oneri);
    }
    Projects.segnaModificato();
    _renderDriver();
    _scheduleAggiornaIndicatori();
  }

  function _handlePersToggle(campo, val) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.driver.personale) return;
    progetto.driver.personale[campo] = (val === '1');
    Projects.segnaModificato();
    _renderDriver();
    _scheduleAggiornaIndicatori();
  }

  function _handlePersRalAnno(el, anno) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.driver.personale) return;
    if (!progetto.driver.personale.var_ral_pct) progetto.driver.personale.var_ral_pct = {};
    progetto.driver.personale.var_ral_pct[anno] = _parsePct(el.textContent);
    el.textContent = _formatPct(progetto.driver.personale.var_ral_pct[anno]);
    Projects.segnaModificato();
    _renderDriver();
  }

  function aggiungiVarOrganico() {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.driver.personale) return;
    if (!progetto.driver.personale.variazioni_organico) progetto.driver.personale.variazioni_organico = [];
    var primoAnno = (progetto.meta.anni_previsione && progetto.meta.anni_previsione[0]) || (progetto.meta.anno_base + 1);
    progetto.driver.personale.variazioni_organico.push({ anno: primoAnno, delta: 0, da_mese: 1 });
    Projects.segnaModificato();
    _renderDriver();
  }

  function rimuoviVarOrganico(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.driver.personale || !progetto.driver.personale.variazioni_organico) return;
    progetto.driver.personale.variazioni_organico.splice(idx, 1);
    Projects.segnaModificato();
    _renderDriver();
  }

  function _handleVarOrgField(el, idx, campo) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.driver.personale || !progetto.driver.personale.variazioni_organico) return;
    var v = progetto.driver.personale.variazioni_organico[idx];
    if (!v) return;

    var val = parseInt((el.textContent || '').replace(/[^\d-]/g, ''), 10) || 0;
    v[campo] = val;
    if (campo === 'da_mese') v.da_mese = Math.max(1, Math.min(12, val));
    el.textContent = v[campo] || '';
    Projects.segnaModificato();
    _renderDriver();
  }

  function toggleInflazione(idOrIdx) {
    var idx = _findDriverIdx('costi', idOrIdx);
    var progetto = Projects.getProgetto();
    if (!progetto || idx < 0) return;
    var c = progetto.driver.costi[idx];
    c.soggetto_inflazione = !c.soggetto_inflazione;
    Projects.segnaModificato();
    _renderDriver();
  }

  function ciclaVarPctMode(idOrIdx) {
    var idx = _findDriverIdx('costi', idOrIdx);
    var progetto = Projects.getProgetto();
    if (!progetto || idx < 0) return;
    var c = progetto.driver.costi[idx];
    if (c.tipo_driver !== 'pct_ricavi') return;
    c.var_pct_annua_mode = c.var_pct_annua_mode === 'relativa' ? 'assoluta' : 'relativa';
    Projects.segnaModificato();
    _renderDriver();
  }

  function toggleInflazioneRicavo(idOrIdx) {
    var idx = _findDriverIdx('ricavi', idOrIdx);
    var progetto = Projects.getProgetto();
    if (!progetto || idx < 0) return;
    var r = progetto.driver.ricavi[idx];
    // default true: undefined → false, altrimenti toggle classico
    r.soggetto_inflazione = r.soggetto_inflazione === false ? true : false;
    Projects.segnaModificato();
    _renderDriver();
  }

  function toggleCostoVenduto(idOrIdx) {
    var idx = _findDriverIdx('costi', idOrIdx);
    var progetto = Projects.getProgetto();
    if (!progetto || idx < 0) return;
    var c = progetto.driver.costi[idx];
    c.costo_venduto = !c.costo_venduto;
    Projects.segnaModificato();
    _renderDriver();
  }

  /* ── Tab CIRCOLANTE ──────────────────────────────────────── */

  function _renderDriverCircolante(progetto) {
    var circ = progetto.driver.circolante;
    var html = '<div style="max-width:400px">';

    html += '<div style="margin-bottom:20px;font-size:13px;color:var(--color-text-secondary)">Indici di capitale circolante applicati a tutti gli anni previsionali. I parametri magazzino (DIO, tasso utilizzo) sono gestiti nel tab "Magazzino".</div>';

    html += _campoCircolante('DSO — Giorni medi incasso clienti', 'dso', circ.dso, 'gg');
    html += _campoCircolante('DPO — Giorni medi pagamento fornitori', 'dpo', circ.dpo, 'gg');

    html += '</div>';
    return html;
  }

  /* ── Tab MAGAZZINO ───────────────────────────────────────── */

  function _renderDriverMagazzino(progetto) {
    var circ = progetto.driver.circolante;
    var mag = progetto.driver.magazzino || { scostamento_mp_pct: {} };
    var anniPrev = (progetto.meta && progetto.meta.anni_previsione) || [];
    var html = '';

    html += '<div style="display:grid;grid-template-columns:minmax(320px,400px) 1fr;gap:40px;align-items:start">';

    // Colonna 1: DIO (indicatore di giacenza)
    html += '<div>';
    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 4px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Giacenza media (DIO)</h3>';
    html += '<div class="form-hint mb-8">Giorni medi di giacenza a magazzino. Con scostamento 0% guida il livello fisiologico delle rimanenze; con scostamento ≠ 0% è usato solo come valore di riferimento (non vincola il saldo).</div>';
    html += _campoCircolante('DIO — Giorni medi giacenza magazzino', 'dio', circ.dio, 'gg');
    html += '</div>';

    // Colonna 2: Scostamento acquisti MP per anno
    html += '<div>';
    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 4px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Scostamento acquisti MP</h3>';
    html += '<div class="form-hint mb-8">Punti percentuali sui ricavi in più (+) o in meno (−) rispetto al consumo standard dei driver B.6 (es. 50%). Il costo del venduto tecnico resta invariato; lo scostamento muove solo il magazzino. <b>0%</b> (default): acquisti = consumo standard. <b>Δ&gt;0</b>: extra acquisti che accumulano scorte. <b>Δ&lt;0</b>: minori acquisti, il consumo attinge alle rimanenze (capped al saldo disponibile).</div>';
    html += '<table class="schema-table" style="max-width:280px"><tbody>';
    html += '<tr class="row-sottomastro"><td>Anno</td><td class="cell-amount">Δ % ricavi</td></tr>';
    for (var i = 0; i < anniPrev.length; i++) {
      var a = String(anniPrev[i]);
      var val = mag.scostamento_mp_pct && (a in mag.scostamento_mp_pct) ? mag.scostamento_mp_pct[a] : 0;
      html += '<tr class="row-conto"><td>' + a + '</td>';
      html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0%" onblur="UI._handleMagazzinoAnnoField(this,\'' + a + '\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(val) + '</div></td></tr>';
    }
    html += '</tbody></table>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  function _campoCircolante(label, campo, valore, unita) {
    return '<div class="form-group">' +
      '<span class="form-label">' + label + '</span>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
      '<div class="form-field" contenteditable="true" style="width:100px;text-align:right;font-family:var(--font-mono)" data-placeholder="0" onblur="UI._handleCircolanteField(this,\'' + campo + '\')" onkeydown="UI._handleAmountKey(event)">' + (valore || '') + '</div>' +
      '<span class="text-muted" style="font-size:13px">' + unita + '</span>' +
      '</div></div>';
  }

  /* ── Tab PATRIMONIALI ─────────────────────────────────────── */

  function _renderDriverPatrimoniali(progetto) {
    var html = '';

    // ── Finanziamenti in essere ──
    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Finanziamenti in essere</h3>';
    html += '<div class="form-hint mb-8">Mutui e finanziamenti attivi alla data del bilancio storico. Generano automaticamente quota interessi (CE C.17), rimborso capitale (SP D.4) e uscita cassa mensile.</div>';

    var fin = progetto.driver.finanziamenti_essere || [];

    html += '<div class="section-toolbar"><div class="section-toolbar-right">';
    html += '<div class="btn btn-primary btn-sm" onclick="UI.aggiungiFinanziamento()">+ Aggiungi finanziamento</div>';
    html += '</div></div>';

    if (fin.length === 0) {
      html += '<div class="projects-empty" style="padding:24px"><p>Nessun finanziamento in essere. Clicca "Aggiungi finanziamento" se la società ha mutui o finanziamenti attivi.</p></div>';
    } else {
      html += '<table class="schema-table"><colgroup><col style="width:auto"><col style="width:120px"><col style="width:80px"><col style="width:80px"><col style="width:50px"></colgroup>';
      html += '<thead><tr class="row-mastro"><td>Descrizione</td><td class="cell-amount">Capitale residuo</td><td class="cell-amount">Tasso %</td><td class="cell-amount">Durata mesi</td><td></td></tr></thead><tbody>';

      for (var i = 0; i < fin.length; i++) {
        var f = fin[i];
        html += '<tr class="row-conto">';
        html += '<td><div class="amount-field" contenteditable="true" style="text-align:left;min-width:150px;font-family:var(--font-ui)" onblur="UI._handleFinField(this,' + i + ',\'descrizione\')">' + _escapeHtml(f.descrizione || '') + '</div></td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleFinField(this,' + i + ',\'capitale_residuo\')" onkeydown="UI._handleAmountKey(event)">' + (f.capitale_residuo ? _formatImporto(f.capitale_residuo) : '') + '</div></td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleFinField(this,' + i + ',\'tasso_annuo\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(f.tasso_annuo) + '</div></td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleFinField(this,' + i + ',\'durata_mesi\')" onkeydown="UI._handleAmountKey(event)">' + (f.durata_mesi || '') + '</div></td>';
        html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviFinanziamento(' + i + ')">✕</div></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }

    // ── Smobilizzo crediti/debiti ──
    html += '<h3 style="font-size:14px;font-weight:700;margin:28px 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Smobilizzo crediti e debiti storici</h3>';
    html += '<div class="form-hint mb-8">Indica in quanti mesi i crediti/debiti presenti nello SP dell\'anno base verranno incassati/pagati. Diverso da DSO/DPO che si applicano alle nuove operazioni.</div>';

    var smob = progetto.driver.smobilizzo || [];
    html += '<div class="section-toolbar"><div class="section-toolbar-right">';
    html += '<div class="btn btn-primary btn-sm" onclick="UI.aggiungiSmobilizzo()">+ Aggiungi voce</div>';
    if (progetto.meta.scenario !== 'costituenda') {
      html += ' <div class="btn btn-secondary btn-sm" onclick="UI.importaSmobilizzoDaSP()">Importa da SP</div>';
    }
    html += '</div></div>';

    if (smob.length === 0) {
      html += '<div class="projects-empty" style="padding:24px"><p>Nessuna voce di smobilizzo configurata. Clicca "Importa da SP" per popolare dai saldi patrimoniali.</p></div>';
    } else {
      html += '<table class="schema-table"><colgroup><col style="width:auto"><col style="width:130px"><col style="width:100px"><col style="width:50px"></colgroup>';
      html += '<thead><tr class="row-mastro"><td>Voce</td><td class="cell-amount">Saldo</td><td class="cell-amount">Mesi incasso/pag.</td><td></td></tr></thead><tbody>';

      for (var j = 0; j < smob.length; j++) {
        var s = smob[j];
        html += '<tr class="row-conto">';
        html += '<td style="font-size:13px">' + _escapeHtml(s.label || '') + '</td>';
        html += '<td class="cell-amount"><span class="amount-computed">' + _formatImporto(s.saldo || 0) + '</span></td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleSmobField(this,' + j + ',\'mesi_incasso\')" onkeydown="UI._handleAmountKey(event)">' + (s.mesi_incasso || '') + '</div></td>';
        html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviSmobilizzo(' + j + ')">✕</div></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }

    return html;
  }

  function aggiungiFinanziamento() {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    if (!progetto.driver.finanziamenti_essere) progetto.driver.finanziamenti_essere = [];
    progetto.driver.finanziamenti_essere.push({
      id: 'fin_' + Date.now(),
      descrizione: 'Nuovo finanziamento',
      capitale_residuo: 0,
      tasso_annuo: 0,
      durata_mesi: 60
    });
    Projects.segnaModificato();
    _renderDriver();
  }

  function rimuoviFinanziamento(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.driver.finanziamenti_essere) return;
    progetto.driver.finanziamenti_essere.splice(idx, 1);
    Projects.segnaModificato();
    _renderDriver();
  }

  function _handleFinField(el, idx, campo) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.driver.finanziamenti_essere) return;
    var f = progetto.driver.finanziamenti_essere[idx];
    if (!f) return;

    if (campo === 'descrizione') {
      f[campo] = (el.textContent || '').trim();
    } else if (campo === 'tasso_annuo') {
      f.tasso_annuo = _parsePct(el.textContent);
      el.textContent = _formatPct(f.tasso_annuo);
    } else if (campo === 'durata_mesi') {
      f.durata_mesi = parseInt((el.textContent || '').replace(/\D/g, ''), 10) || 0;
      el.textContent = f.durata_mesi || '';
    } else if (campo === 'capitale_residuo') {
      f.capitale_residuo = _parseImporto(el.textContent);
      el.textContent = f.capitale_residuo ? _formatImporto(f.capitale_residuo) : '';
    }
    Projects.segnaModificato();
  }

  function aggiungiSmobilizzo() {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    if (!progetto.driver.smobilizzo) progetto.driver.smobilizzo = [];
    progetto.driver.smobilizzo.push({
      voce_sp: '',
      label: 'Nuova voce',
      saldo: 0,
      mesi_incasso: 3
    });
    Projects.segnaModificato();
    _renderDriver();
  }

  function rimuoviSmobilizzo(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.driver.smobilizzo) return;
    progetto.driver.smobilizzo.splice(idx, 1);
    Projects.segnaModificato();
    _renderDriver();
  }

  function importaSmobilizzoDaSP() {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var anno = String(progetto.meta.anno_base);
    var annoData = progetto.storico[anno];
    if (!annoData || !annoData.sp) { mostraNotifica('Nessun dato SP disponibile.', 'warning'); return; }

    if (!progetto.driver.smobilizzo) progetto.driver.smobilizzo = [];
    var esistenti = progetto.driver.smobilizzo.map(function(s) { return s.voce_sp; });

    // Voci crediti da smobilizzare
    var vociCrediti = [
      { id: 'sp.CII.1',  label: 'Crediti verso clienti',   lato: 'attivo' },
      { id: 'sp.CII.5b', label: 'Crediti tributari',        lato: 'attivo' },
      { id: 'sp.CII.5q', label: 'Crediti verso altri',      lato: 'attivo' }
    ];
    // Voci debiti da smobilizzare
    var vociDebiti = [
      { id: 'sp.D_pass.7',  label: 'Debiti verso fornitori',      lato: 'passivo' },
      { id: 'sp.D_pass.12', label: 'Debiti tributari',             lato: 'passivo' },
      { id: 'sp.D_pass.13', label: 'Debiti previdenziali',         lato: 'passivo' }
    ];

    var aggiunti = 0;
    var tutte = vociCrediti.concat(vociDebiti);
    tutte.forEach(function(v) {
      if (esistenti.indexOf(v.id) !== -1) return;
      var saldo = (annoData.sp[v.lato] && annoData.sp[v.lato][v.id]) || 0;
      if (saldo !== 0) {
        progetto.driver.smobilizzo.push({
          voce_sp: v.id,
          label: v.label,
          saldo: saldo,
          mesi_incasso: 3
        });
        aggiunti++;
      }
    });

    if (aggiunti > 0) {
      Projects.segnaModificato();
      mostraNotifica(aggiunti + ' voci importate dallo SP.', 'success');
    } else {
      mostraNotifica('Nessuna voce con saldo da importare.', 'info');
    }
    _renderDriver();
  }

  function _handleSmobField(el, idx, campo) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.driver.smobilizzo) return;
    var s = progetto.driver.smobilizzo[idx];
    if (!s) return;
    s[campo] = parseInt((el.textContent || '').replace(/\D/g, ''), 10) || 0;
    el.textContent = s[campo] || '';
    Projects.segnaModificato();
  }

  /* ── Tab FISCALE ─────────────────────────────────────────── */

  function _renderDriverFiscale(progetto) {
    var fisc = progetto.driver.fiscale;
    var anniPrev = progetto.meta.anni_previsione;
    var H3 = '<h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">';
    var html = '';

    // ── Riga 1: Aliquote + IVA affiancate ────────────────────
    html += '<div style="display:grid;grid-template-columns:minmax(240px,320px) 1fr;gap:40px;align-items:start">';

    // Aliquote (colonna sinistra)
    html += '<div>';
    html += H3 + 'Aliquote</h3>';
    html += '<div style="display:flex;gap:16px">';
    html += '<div class="form-group"><span class="form-label">IRES %</span>';
    html += '<div class="form-field" contenteditable="true" style="width:100px;text-align:right;font-family:var(--font-mono)" onblur="UI._handleFiscaleField(this,\'aliquota_ires\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(fisc.aliquota_ires) + '</div></div>';
    html += '<div class="form-group"><span class="form-label">IRAP %</span>';
    html += '<div class="form-field" contenteditable="true" style="width:100px;text-align:right;font-family:var(--font-mono)" onblur="UI._handleFiscaleField(this,\'aliquota_irap\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(fisc.aliquota_irap) + '</div></div>';
    html += '</div>';
    html += '</div>';

    // IVA (colonna destra, aliquota media ricavi spostata nella tab Ricavi)
    html += '<div>';
    html += H3 + 'IVA</h3>';
    html += '<div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap">';

    html += '<div class="form-group"><span class="form-label">Liquidazione IVA</span>';
    var liqIva = fisc.liquidazione_iva || 'mensile';
    html += '<div class="toggle-group" id="tg-liq-iva" style="width:200px">';
    html += '<div class="toggle-item' + (liqIva === 'mensile' ? ' active' : '') + '" data-value="mensile" onclick="UI._handleFiscaleToggle(\'liquidazione_iva\',\'mensile\')">Mensile</div>';
    html += '<div class="toggle-item' + (liqIva === 'trimestrale' ? ' active' : '') + '" data-value="trimestrale" onclick="UI._handleFiscaleToggle(\'liquidazione_iva\',\'trimestrale\')">Trimestrale</div>';
    html += '</div></div>';

    html += '<div class="form-group"><span class="form-label">Rimborso IVA trimestrale</span>';
    var rimbIva = fisc.rimborso_iva_trim || false;
    html += '<div class="toggle-group" id="tg-rimb-iva" style="width:140px">';
    html += '<div class="toggle-item' + (rimbIva ? ' active' : '') + '" data-value="true" onclick="UI._handleFiscaleToggle(\'rimborso_iva_trim\',true)">Sì</div>';
    html += '<div class="toggle-item' + (!rimbIva ? ' active' : '') + '" data-value="false" onclick="UI._handleFiscaleToggle(\'rimborso_iva_trim\',false)">No</div>';
    html += '</div>';
    html += '<div class="form-hint">Per società con IVA strutturalmente a credito (art. 38-bis)</div></div>';

    html += '</div>'; // flex IVA
    html += '</div>'; // colonna IVA

    html += '</div>'; // grid riga 1

    // ── Riga 2: Inflazione + Variazione personale affiancate ─
    html += '<div style="display:grid;grid-template-columns:minmax(280px,380px) minmax(280px,380px);gap:40px;margin-top:20px;align-items:start">';

    // Inflazione
    html += '<div>';
    html += H3.replace('margin:0 0 12px', 'margin:0 0 4px') + 'Inflazione prevista %</h3>';
    html += '<div class="form-hint mb-8">Applicata automaticamente ai costi fissi soggetti a inflazione.</div>';
    html += '<table class="schema-table"><tbody>';
    for (var i = 0; i < anniPrev.length; i++) {
      var a = String(anniPrev[i]);
      var val = fisc.inflazione ? (fisc.inflazione[a] || 0) : 0;
      html += '<tr class="row-conto"><td>' + a + '</td>';
      html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0%" onblur="UI._handleFiscaleAnnoField(this,\'inflazione\',\'' + a + '\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(val) + '</div></td></tr>';
    }
    html += '</tbody></table>';
    html += '</div>';

    // Variazione costo personale
    html += '<div>';
    html += H3.replace('margin:0 0 12px', 'margin:0 0 4px') + 'Variazione costo personale %</h3>';
    html += '<div class="form-hint mb-8">Applicata alle voci costo di tipo "Personale" (indipendente dall\'inflazione).</div>';
    html += '<table class="schema-table"><tbody>';
    for (var j = 0; j < anniPrev.length; j++) {
      var a2 = String(anniPrev[j]);
      var val2 = fisc.var_personale ? (fisc.var_personale[a2] || 0) : 0;
      html += '<tr class="row-conto"><td>' + a2 + '</td>';
      html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0%" onblur="UI._handleFiscaleAnnoField(this,\'var_personale\',\'' + a2 + '\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(val2) + '</div></td></tr>';
    }
    html += '</tbody></table>';
    html += '</div>';

    html += '</div>'; // grid riga 2

    return html;
  }

  /* ── Profilo stagionale (modale inline) ──────────────────── */

  function editProfiloStagionale() {
    var progetto = Projects.getProgetto();
    if (!progetto) return;

    var mesi = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    var profilo = progetto.driver.profilo_stagionale || [];

    var html = '<div class="modal-header"><span class="modal-title">Profilo stagionale (globale)</span>';
    html += '<div class="modal-close" onclick="UI.closeModal(\'modal-profilo\')">✕</div></div>';

    html += '<div class="modal-body">';
    html += '<div class="form-hint mb-8">I 12 coefficienti devono sommare 100%. Profilo uniforme = 8,33% per mese.</div>';
    html += '<table class="schema-table" style="max-width:300px"><tbody>';

    for (var i = 0; i < 12; i++) {
      var val = profilo[i] !== undefined ? profilo[i] : (100 / 12);
      html += '<tr class="row-conto"><td>' + mesi[i] + '</td>';
      html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" id="profilo-m-' + i + '" data-placeholder="0" onkeydown="UI._handleAmountKey(event)">' + _formatDec(val) + '</div></td></tr>';
    }
    html += '</tbody></table>';
    html += '<div id="profilo-somma" style="margin-top:8px;font-size:12px;font-weight:600"></div>';
    html += '<div style="margin-top:12px"><div class="btn btn-ghost btn-sm" onclick="UI._resetProfiloUniforme()">Reset uniforme</div></div>';
    html += '</div>';

    html += '<div class="modal-footer">';
    html += '<div class="btn btn-secondary" onclick="UI.closeModal(\'modal-profilo\')">Annulla</div>';
    html += '<div class="btn btn-primary" onclick="UI._salvaProfiloStagionale()">Salva</div>';
    html += '</div>';

    // Crea modale se non esiste
    var overlay = document.getElementById('modal-profilo');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'modal-profilo';
      overlay.className = 'modal-overlay';
      var modal = document.createElement('div');
      modal.className = 'modal';
      modal.style.width = '380px';
      modal.id = 'modal-profilo-inner';
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    } else {
      overlay.classList.remove('hidden');
    }

    document.getElementById('modal-profilo-inner').innerHTML = html;
  }

  function _resetProfiloUniforme() {
    var val = _formatDec(100 / 12);
    for (var i = 0; i < 12; i++) {
      var el = document.getElementById('profilo-m-' + i);
      if (el) el.textContent = val;
    }
  }

  function _salvaProfiloStagionale() {
    var progetto = Projects.getProgetto();
    if (!progetto) return;

    var profilo = [];
    var somma = 0;
    for (var i = 0; i < 12; i++) {
      var el = document.getElementById('profilo-m-' + i);
      var val = el ? _parsePct(el.textContent) : (100 / 12);
      profilo.push(val);
      somma += val;
    }

    if (Math.abs(somma - 100) > 0.5) {
      mostraNotifica('La somma dei coefficienti deve essere 100% (attuale: ' + _formatDec(somma) + '%).', 'error');
      return;
    }

    progetto.driver.profilo_stagionale = profilo;
    Projects.segnaModificato();
    closeModal('modal-profilo');
    _renderDriver();
  }

  /* ── Handler campi driver ────────────────────────────────── */

  // Risolve un driver per id (stringa) o indice (numero) nell'array
  function _findDriverIdx(tipo, idOrIdx) {
    var progetto = Projects.getProgetto();
    if (!progetto) return -1;
    var arr = progetto.driver[tipo];
    if (!arr) return -1;
    if (typeof idOrIdx === 'number') return idOrIdx < arr.length ? idOrIdx : -1;
    // Cerca per id stringa
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === idOrIdx) return i;
    }
    return -1;
  }

  function _handleDriverField(el, tipo, idOrIdx, campo) {
    var idx = _findDriverIdx(tipo, idOrIdx);
    var progetto = Projects.getProgetto();
    if (!progetto || idx < 0) return;
    var arr = progetto.driver[tipo];
    if (!arr || !arr[idx]) return;

    if (campo === 'label') {
      arr[idx].label = (el.textContent || '').trim() || 'Senza nome';
    } else if (campo === 'base_annuale' || campo === 'importo_fisso') {
      var val = _parseImporto(el.textContent);
      arr[idx][campo] = val;
      el.textContent = val !== 0 ? _formatImporto(val) : '';
    } else if (campo === 'pct_ricavi' || campo === 'var_pct_annua' || campo === 'iva_pct') {
      var pct = _parsePct(el.textContent);
      arr[idx][campo] = pct;
      el.textContent = _formatPct(pct);
    }
    Projects.segnaModificato();
    _scheduleAggiornaIndicatori();
  }

  function _handleCircolanteField(el, campo) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var val = parseInt((el.textContent || '').replace(/\D/g, ''), 10) || 0;
    progetto.driver.circolante[campo] = val;
    el.textContent = val || '';
    Projects.segnaModificato();
    _scheduleAggiornaIndicatori();
  }

  function _handleMagazzinoAnnoField(el, anno) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    if (!progetto.driver.magazzino) progetto.driver.magazzino = { scostamento_mp_pct: {} };
    if (!progetto.driver.magazzino.scostamento_mp_pct) progetto.driver.magazzino.scostamento_mp_pct = {};
    var val = _parsePct(el.textContent);
    // Ammessi valori negativi (drawdown) e positivi (accumulo). Nessun clip.
    progetto.driver.magazzino.scostamento_mp_pct[anno] = val;
    el.textContent = _formatPct(val);
    Projects.segnaModificato();
    _scheduleAggiornaIndicatori();
  }

  function _handleFiscaleField(el, campo) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var val = _parsePct(el.textContent);
    progetto.driver.fiscale[campo] = val;
    el.textContent = _formatPct(val);
    Projects.segnaModificato();
  }

  function _handleFiscaleAnnoField(el, param, anno) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    if (!progetto.driver.fiscale[param]) progetto.driver.fiscale[param] = {};
    var val = _parsePct(el.textContent);
    progetto.driver.fiscale[param][anno] = val;
    el.textContent = _formatPct(val);
    Projects.segnaModificato();
  }

  function _handleFiscaleToggle(campo, valore) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    progetto.driver.fiscale[campo] = valore;
    Projects.segnaModificato();
    _renderDriver();
  }

  function rimuoviDriver(tipo, idOrIdx) {
    var idx = _findDriverIdx(tipo, idOrIdx);
    var progetto = Projects.getProgetto();
    if (!progetto || idx < 0) return;
    var arr = progetto.driver[tipo];
    arr.splice(idx, 1);
    Projects.segnaModificato();
    _renderDriver();
  }

  /* ══════════════════════════════════════════════════════════
     EVENTI — Pianificazione eventi futuri
     ══════════════════════════════════════════════════════════ */

  let _eventiTab = 'evt-finanziamenti';

  function _renderEventi() {
    var content = document.getElementById('content');
    var progetto = Projects.getProgetto();
    if (!content || !progetto) return;
    if (!progetto.eventi) progetto.eventi = [];

    var html = '';

    // Tabs
    html += '<div class="tabs" id="eventi-tabs">';
    html += _evtTabItem('evt-finanziamenti', 'Finanziamenti', progetto);
    html += _evtTabItem('evt-investimenti', 'Investimenti', progetto);
    html += _evtTabItem('evt-ricavi', 'Ricavi', progetto);
    html += _evtTabItem('evt-costi-mp', 'Mat. Prime', progetto);
    html += _evtTabItem('evt-costi-var', 'Costi Var.', progetto);
    html += _evtTabItem('evt-costi-gest', 'Costi Gest.', progetto);
    html += _evtTabItem('evt-personale', 'Personale', progetto);
    html += _evtTabItem('evt-magazzino', 'Magazzino', progetto);
    html += _evtTabItem('evt-soci', 'Soci', progetto);
    html += '</div>';

    // Tab panes
    html += '<div class="tab-pane' + (_eventiTab === 'evt-finanziamenti' ? ' active' : '') + '" id="evt-finanziamenti">';
    html += _renderEvtFinanziamenti(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_eventiTab === 'evt-investimenti' ? ' active' : '') + '" id="evt-investimenti">';
    html += _renderEvtInvestimenti(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_eventiTab === 'evt-ricavi' ? ' active' : '') + '" id="evt-ricavi">';
    html += _renderEvtRicavi(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_eventiTab === 'evt-costi-mp' ? ' active' : '') + '" id="evt-costi-mp">';
    html += _renderEvtCostiMP(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_eventiTab === 'evt-costi-var' ? ' active' : '') + '" id="evt-costi-var">';
    html += _renderEvtCostiVar(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_eventiTab === 'evt-costi-gest' ? ' active' : '') + '" id="evt-costi-gest">';
    html += _renderEvtCostiGestione(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_eventiTab === 'evt-personale' ? ' active' : '') + '" id="evt-personale">';
    html += _renderEvtPersonale(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_eventiTab === 'evt-magazzino' ? ' active' : '') + '" id="evt-magazzino">';
    html += _renderEvtMagazzino(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_eventiTab === 'evt-soci' ? ' active' : '') + '" id="evt-soci">';
    html += _renderEvtSoci(progetto);
    html += '</div>';

    content.innerHTML = html;
  }

  var _EVT_TAB_TIPI = {
    'evt-finanziamenti': ['nuovo_finanziamento'],
    'evt-investimenti':  ['nuovo_investimento'],
    'evt-ricavi':        ['variazione_ricavi'],
    'evt-costi-mp':      ['variazione_costi_mp'],
    'evt-costi-var':     ['variazione_costi_var'],
    'evt-costi-gest':    ['andamento_costo_gestione'],
    'evt-personale':     ['variazione_personale'],
    'evt-magazzino':     ['utilizzo_rimanenze'],
    'evt-soci':          ['operazione_soci']
  };

  function _contaEventiPerTab(progetto, tabId) {
    var tipi = _EVT_TAB_TIPI[tabId];
    if (!tipi || !progetto.eventi) return 0;
    var n = 0;
    for (var i = 0; i < progetto.eventi.length; i++) {
      if (tipi.indexOf(progetto.eventi[i].tipo) >= 0) n++;
    }
    return n;
  }

  function _evtTabItem(id, label, progetto) {
    var cnt = _contaEventiPerTab(progetto, id);
    var badge = cnt > 0 ? '<span class="tab-badge">' + cnt + '</span>' : '';
    return '<div class="tab-item tab-item-sm' + (_eventiTab === id ? ' active' : '') + '" data-tab="' + id + '" onclick="UI.switchEventiTab(\'' + id + '\')">' + label + badge + '</div>';
  }

  function switchEventiTab(tabId) {
    _eventiTab = tabId;
    document.querySelectorAll('#eventi-tabs .tab-item').forEach(function(el) {
      el.classList.toggle('active', el.dataset.tab === tabId);
    });
    document.querySelectorAll('#content > .tab-pane').forEach(function(el) {
      el.classList.toggle('active', el.id === tabId);
    });
  }

  /* ── Helper: filtra eventi per tipo ────────────────────── */

  function _eventiPerTipo(progetto, tipo) {
    var result = [];
    for (var i = 0; i < progetto.eventi.length; i++) {
      if (progetto.eventi[i].tipo === tipo) {
        result.push({ evt: progetto.eventi[i], idx: i });
      }
    }
    return result;
  }

  function aggiungiEvento(tipo) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    if (!progetto.eventi) progetto.eventi = [];
    progetto.eventi.push(Projects.creaEvento(tipo, progetto));
    Projects.segnaModificato();
    _renderEventi();
    _scheduleAggiornaIndicatori();
  }

  function rimuoviEvento(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi) return;
    progetto.eventi.splice(idx, 1);
    Projects.segnaModificato();
    _renderEventi();
    _scheduleAggiornaIndicatori();
  }

  function _handleEvtField(el, idx, campo) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi || !progetto.eventi[idx]) return;
    var evt = progetto.eventi[idx];
    var raw = (el.textContent || '').trim();

    if (campo === 'descrizione' || campo === 'data_inizio') {
      evt[campo] = raw;
    } else if (campo === 'anni_ammortamento') {
      var v = parseFloat(raw.replace(',', '.')) || 0;
      evt.anni_ammortamento = Math.round(v * 10) / 10;
      // retrocompat: aggiorna anche aliquota interna
      evt.aliquota_ammortamento = v > 0 ? 1 / v : 0;
      el.textContent = evt.anni_ammortamento || '';
    } else if (campo === 'tasso_annuo' || campo === 'variazione_pct' || campo === 'iva_pct') {
      evt[campo] = _parsePct(raw);
      el.textContent = _formatPct(evt[campo]);
    } else if (campo === 'pct_utilizzo') {
      evt[campo] = _parsePct(raw);
      el.textContent = _formatPct(evt[campo]);
    } else if (campo === 'delta') {
      var vd = parseFloat(raw.replace(',', '.')) || 0;
      evt[campo] = Math.round(vd * 10) / 10;
      el.textContent = evt[campo] || '';
    } else if (campo === 'anno' || campo === 'anno_fine' || campo === 'mese' || campo === 'durata_mesi') {
      var val = parseInt(raw, 10) || 0;
      if (campo === 'mese') val = Math.max(1, Math.min(12, val));
      evt[campo] = val;
      el.textContent = String(val);
    } else {
      // importo, importo_nuovo, ral_nuovi, etc.
      evt[campo] = _parseImporto(raw);
      el.textContent = _formatImporto(evt[campo]);
    }
    Projects.segnaModificato();
  }

  /* ── Helper: render data_inizio come due select mese/anno ── */

  function _renderEvtDataInizio(evt, idx, progetto) {
    var anniPrev = (progetto && progetto.meta && progetto.meta.anni_previsione) || [];
    var curMese = 1, curAnno = anniPrev[0] || new Date().getFullYear();
    if (evt.data_inizio) {
      var parts = String(evt.data_inizio).split('/');
      if (parts.length === 2) {
        curMese = parseInt(parts[0], 10) || 1;
        curAnno = parseInt(parts[1], 10) || curAnno;
      }
    }
    var html = '<div style="display:flex;gap:2px;align-items:center">';
    html += '<select class="form-select" style="width:55px;display:inline-block;font-size:11px;padding:2px" onchange="UI._handleEvtSelect(this,' + idx + ',\'data_inizio_mese\')">';
    for (var m = 1; m <= 12; m++) {
      html += '<option value="' + m + '"' + (m === curMese ? ' selected' : '') + '>' + m + '</option>';
    }
    html += '</select><span style="font-size:10px;color:var(--color-text-muted)">/</span>';
    html += '<select class="form-select" style="width:70px;display:inline-block;font-size:11px;padding:2px" onchange="UI._handleEvtSelect(this,' + idx + ',\'data_inizio_anno\')">';
    for (var ai = 0; ai < anniPrev.length; ai++) {
      html += '<option value="' + anniPrev[ai] + '"' + (anniPrev[ai] === curAnno ? ' selected' : '') + '>' + anniPrev[ai] + '</option>';
    }
    html += '</select></div>';
    return html;
  }

  /* (select helpers for anno/mese/categoria are defined below with _selectAnno/_selectMese/_selectCategoria) */

  /* ── IVA toggle e manual entry ─────────────────────────── */

  function ciclaIva(tipo, idOrIdx) {
    var idx = _findDriverIdx(tipo, idOrIdx);
    var progetto = Projects.getProgetto();
    if (!progetto || idx < 0) return;
    var arr = progetto.driver[tipo];
    var steps = [0.22, 0.10, 0.04, 0];
    var cur = arr[idx].iva_pct !== undefined ? arr[idx].iva_pct : 0.22;
    var pos = -1;
    for (var s = 0; s < steps.length; s++) {
      if (Math.abs(steps[s] - cur) < 0.001) { pos = s; break; }
    }
    arr[idx].iva_pct = steps[(pos + 1) % steps.length];
    Projects.segnaModificato();
    _renderDriver();
  }

  function editIvaManuale(tipo, idOrIdx) {
    var idx = _findDriverIdx(tipo, idOrIdx);
    var progetto = Projects.getProgetto();
    if (!progetto || idx < 0) return;
    var arr = progetto.driver[tipo];
    var cur = arr[idx].iva_pct !== undefined ? arr[idx].iva_pct : 0.22;
    var input = prompt('Inserisci aliquota IVA % (es. 22, 10, 4, 0):', String(Math.round(cur * 100)));
    if (input === null) return;
    var val = parseFloat(input.replace(',', '.').replace('%', ''));
    if (isNaN(val)) return;
    arr[idx].iva_pct = val / 100;
    Projects.segnaModificato();
    _renderDriver();
  }

  /* ── Dropdown handler per categorie/modalita/azione/sottotipo eventi ── */

  function _handleEvtCategoria(el, idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi || !progetto.eventi[idx]) return;
    progetto.eventi[idx].categoria = el.value;
    Projects.segnaModificato();
  }

  function _handleEvtModalita(el, idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi || !progetto.eventi[idx]) return;
    progetto.eventi[idx].modalita = el.value;
    Projects.segnaModificato();
  }

  function _handleEvtAzione(el, idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi || !progetto.eventi[idx]) return;
    progetto.eventi[idx].azione = el.value;
    Projects.segnaModificato();
  }

  function _handleEvtSottotipo(el, idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi || !progetto.eventi[idx]) return;
    progetto.eventi[idx].sottotipo = el.value;
    Projects.segnaModificato();
  }

  /* ── Bottoni ciclici per campi enum ────────────────────── */

  function ciclaEvtTipoAmm(idx) {
    // Solo ammortamento italiano supportato — no-op
  }

  function ciclaEvtModalita(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi[idx]) return;
    var evt = progetto.eventi[idx];
    evt.modalita = evt.modalita === 'strutturale' ? 'puntuale' : 'strutturale';
    Projects.segnaModificato();
    _renderEventi();
  }

  function ciclaEvtAzione(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi[idx]) return;
    var evt = progetto.eventi[idx];
    var azioni = ['variazione', 'cessato', 'aumentato', 'attivato'];
    var pos = azioni.indexOf(evt.azione);
    evt.azione = azioni[(pos + 1) % azioni.length];
    Projects.segnaModificato();
    _renderEventi();
  }

  function ciclaEvtSottotipo(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi[idx]) return;
    var evt = progetto.eventi[idx];
    var tipi = ['versamento_capitale', 'finanziamento_soci', 'rimborso_soci'];
    var pos = tipi.indexOf(evt.sottotipo);
    evt.sottotipo = tipi[(pos + 1) % tipi.length];
    Projects.segnaModificato();
    _renderEventi();
  }

  function ciclaEvtCategoria(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi[idx]) return;
    var evt = progetto.eventi[idx];
    var cats = Projects.CATEGORIE_INVESTIMENTO;
    var pos = 0;
    for (var c = 0; c < cats.length; c++) {
      if (cats[c].id === evt.categoria) { pos = c; break; }
    }
    evt.categoria = cats[(pos + 1) % cats.length].id;
    Projects.segnaModificato();
    _renderEventi();
  }

  function ciclaEvtDriver(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi[idx]) return;
    var evt = progetto.eventi[idx];
    var drivers;
    if (evt.tipo === 'variazione_costi_var') {
      drivers = (progetto.driver.costi || []).filter(function(d) { return d.tipo_driver === 'pct_ricavi'; });
    } else {
      drivers = (progetto.driver.costi || []).filter(function(d) { return d.tipo_driver === 'fisso' && !d.usa_var_personale; });
    }
    if (drivers.length === 0) return;
    var pos = -1;
    for (var d = 0; d < drivers.length; d++) {
      if (drivers[d].id === evt.driver_id) { pos = d; break; }
    }
    evt.driver_id = drivers[(pos + 1) % drivers.length].id;
    Projects.segnaModificato();
    _renderEventi();
  }

  function _labelDriverById(progetto, driverId) {
    if (!driverId) return '(seleziona)';
    var costi = progetto.driver.costi || [];
    for (var i = 0; i < costi.length; i++) {
      if (costi[i].id === driverId) return costi[i].label;
    }
    return '(seleziona)';
  }

  function _labelCategoria(catId) {
    var cats = Projects.CATEGORIE_INVESTIMENTO;
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].id === catId) return cats[i].label;
    }
    return catId;
  }

  var _SOTTOTIPO_LABELS = {
    versamento_capitale: 'Versamento c/capitale',
    finanziamento_soci: 'Finanziamento soci',
    rimborso_soci: 'Rimborso a soci'
  };

  var _AZIONE_LABELS = {
    variazione: 'Variazione %',
    cessato: 'Cessato',
    aumentato: 'Aumentato',
    attivato: 'Attivato'
  };

  /* ── Helper: dropdown anno per eventi ─────────────────── */

  var _MESI_LABEL = ['','Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

  function _selectAnno(idx, campo, valore, progetto) {
    var anni = progetto.meta.anni_previsione || [];
    var html = '<select class="form-select form-select-sm" onchange="UI._handleEvtSelect(this,' + idx + ',\'' + campo + '\')">';
    html += '<option value="">—</option>';
    for (var a = 0; a < anni.length; a++) {
      html += '<option value="' + anni[a] + '"' + (valore === anni[a] ? ' selected' : '') + '>' + anni[a] + '</option>';
    }
    html += '</select>';
    return html;
  }

  function _selectMese(idx, campo, valore) {
    var html = '<select class="form-select form-select-sm" onchange="UI._handleEvtSelect(this,' + idx + ',\'' + campo + '\')">';
    for (var m = 1; m <= 12; m++) {
      html += '<option value="' + m + '"' + (valore === m ? ' selected' : '') + '>' + _MESI_LABEL[m] + '</option>';
    }
    html += '</select>';
    return html;
  }

  function _selectAnnoFine(idx, valore, progetto) {
    var anni = progetto.meta.anni_previsione || [];
    var ultimo = anni.length > 0 ? anni[anni.length - 1] : '';
    var val = valore || ultimo;
    var html = '<select class="form-select form-select-sm" onchange="UI._handleEvtSelect(this,' + idx + ',\'anno_fine\')">';
    for (var a = 0; a < anni.length; a++) {
      html += '<option value="' + anni[a] + '"' + (val === anni[a] ? ' selected' : '') + '>' + anni[a] + '</option>';
    }
    html += '</select>';
    return html;
  }

  function _selectCategoria(idx, valore) {
    var cats = Projects.CATEGORIE_INVESTIMENTO;
    var html = '<select class="form-select form-select-sm" style="font-size:11px" onchange="UI._handleEvtSelect(this,' + idx + ',\'categoria\')">';
    for (var c = 0; c < cats.length; c++) {
      html += '<option value="' + cats[c].id + '"' + (valore === cats[c].id ? ' selected' : '') + '>' + _escapeHtml(cats[c].label) + '</option>';
    }
    html += '</select>';
    return html;
  }

  function _handleEvtSelect(el, idx, campo) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi || !progetto.eventi[idx]) return;
    var evt = progetto.eventi[idx];
    var raw = el.value;
    if (campo === 'data_inizio_mese' || campo === 'data_inizio_anno') {
      // Ricomponi data_inizio da mese/anno
      var curMese = 1, curAnno = '';
      if (evt.data_inizio) {
        var parts = String(evt.data_inizio).split('/');
        if (parts.length === 2) {
          curMese = parseInt(parts[0], 10) || 1;
          curAnno = parts[1];
        }
      }
      if (campo === 'data_inizio_mese') curMese = parseInt(raw, 10) || 1;
      if (campo === 'data_inizio_anno') curAnno = raw;
      evt.data_inizio = curMese + '/' + curAnno;
    } else if (campo === 'anno' || campo === 'anno_fine' || campo === 'mese') {
      evt[campo] = parseInt(raw, 10) || 0;
    } else if (campo === 'categoria' || campo === 'modalita' || campo === 'azione' || campo === 'sottotipo') {
      evt[campo] = raw;
    }
    Projects.segnaModificato();
  }

  /* ── Helper: IVA preset toggle ──────────────────────────── */

  var _IVA_PRESETS = [0, 0.04, 0.10, 0.22];

  function ciclaIvaPct(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi[idx]) return;
    var evt = progetto.eventi[idx];
    var cur = evt.iva_pct || 0;
    // Find next preset
    var nextIdx = 0;
    for (var i = 0; i < _IVA_PRESETS.length; i++) {
      if (Math.abs(cur - _IVA_PRESETS[i]) < 0.001) {
        nextIdx = (i + 1) % _IVA_PRESETS.length;
        break;
      }
    }
    evt.iva_pct = _IVA_PRESETS[nextIdx];
    Projects.segnaModificato();
    _renderEventi();
  }

  /* ── Tab 1: Nuovi Finanziamenti ────────────────────────── */

  function _renderEvtFinanziamenti(progetto) {
    var items = _eventiPerTipo(progetto, 'nuovo_finanziamento');
    var html = '';
    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Nuovi Finanziamenti</h3>';
    html += '<div class="form-hint mb-8">Mutui e finanziamenti che verranno accesi nel periodo previsionale. Impattano debiti finanziari (SP), interessi passivi (CE) e cash flow.</div>';

    html += '<div class="section-toolbar"><div class="section-toolbar-right">';
    html += '<div class="btn btn-primary btn-sm" onclick="UI.aggiungiEvento(\'nuovo_finanziamento\')">+ Aggiungi finanziamento</div>';
    html += '</div></div>';

    if (items.length === 0) {
      html += '<div class="projects-empty" style="padding:24px"><p>Nessun nuovo finanziamento pianificato.</p></div>';
    } else {
      html += '<table class="schema-table"><colgroup><col style="width:auto"><col style="width:120px"><col style="width:80px"><col style="width:80px"><col style="width:70px"><col style="width:70px"><col style="width:50px"></colgroup>';
      html += '<thead><tr class="row-mastro"><td>Descrizione</td><td class="cell-amount">Importo</td><td class="cell-amount">Tasso %</td><td class="cell-amount">Durata mesi</td><td class="cell-amount">Anno</td><td class="cell-amount">Mese</td><td></td></tr></thead><tbody>';

      for (var i = 0; i < items.length; i++) {
        var e = items[i].evt, idx = items[i].idx;
        html += '<tr class="row-conto">';
        html += '<td><div class="amount-field" contenteditable="true" style="text-align:left;min-width:150px;font-family:var(--font-ui)" onblur="UI._handleEvtField(this,' + idx + ',\'descrizione\')">' + _escapeHtml(e.descrizione || '') + '</div></td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleEvtField(this,' + idx + ',\'importo\')" onkeydown="UI._handleAmountKey(event)">' + (e.importo ? _formatImporto(e.importo) : '') + '</div></td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleEvtField(this,' + idx + ',\'tasso_annuo\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(e.tasso_annuo) + '</div></td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleEvtField(this,' + idx + ',\'durata_mesi\')" onkeydown="UI._handleAmountKey(event)">' + (e.durata_mesi || '') + '</div></td>';
        html += '<td class="cell-amount">' + _selectAnno(idx, 'anno', e.anno, progetto) + '</td>';
        html += '<td class="cell-amount">' + _selectMese(idx, 'mese', e.mese) + '</td>';
        html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviEvento(' + idx + ')">✕</div></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }
    return html;
  }

  /* ── Tab 2: Nuovi Investimenti ─────────────────────────── */

  function _renderEvtInvestimenti(progetto) {
    var items = _eventiPerTipo(progetto, 'nuovo_investimento');
    var ultimoAnno = _ultimoAnnoPiano(progetto);
    var html = '';
    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Nuovi Investimenti</h3>';
    html += '<div class="form-hint mb-8">Acquisti di beni strumentali nel periodo previsionale. Impattano immobilizzazioni (SP), ammortamenti (CE), IVA a credito e cash flow.</div>';

    html += '<div class="section-toolbar"><div class="section-toolbar-right">';
    html += '<div class="btn btn-primary btn-sm" onclick="UI.aggiungiEvento(\'nuovo_investimento\')">+ Aggiungi investimento</div>';
    html += '</div></div>';

    if (items.length === 0) {
      html += '<div class="projects-empty" style="padding:24px"><p>Nessun nuovo investimento pianificato.</p></div>';
    } else {
      html += '<table class="schema-table"><colgroup><col style="width:auto"><col style="width:160px"><col style="width:60px"><col style="width:60px"><col style="width:120px"><col style="width:70px"><col style="width:80px"><col style="width:50px"></colgroup>';
      html += '<thead><tr class="row-mastro"><td>Descrizione</td><td class="cell-amount">Categoria</td><td class="cell-amount">Anno</td><td class="cell-amount">Mese</td><td class="cell-amount">Importo</td><td class="cell-amount">IVA %</td><td class="cell-amount">Anni amm.</td><td></td></tr></thead><tbody>';

      for (var i = 0; i < items.length; i++) {
        var e = items[i].evt, idx = items[i].idx;
        html += '<tr class="row-conto">';
        html += '<td><div class="amount-field" contenteditable="true" style="text-align:left;min-width:120px;font-family:var(--font-ui)" onblur="UI._handleEvtField(this,' + idx + ',\'descrizione\')">' + _escapeHtml(e.descrizione || '') + '</div></td>';
        html += '<td class="cell-amount">' + _selectCategoria(idx, e.categoria) + '</td>';
        html += '<td class="cell-amount">' + _selectAnno(idx, 'anno', e.anno, progetto) + '</td>';
        html += '<td class="cell-amount">' + _selectMese(idx, 'mese', e.mese) + '</td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleEvtField(this,' + idx + ',\'importo\')" onkeydown="UI._handleAmountKey(event)">' + (e.importo ? _formatImporto(e.importo) : '') + '</div></td>';
        html += '<td class="cell-amount"><div class="btn btn-ghost btn-sm" onclick="UI.ciclaIvaPct(' + idx + ')">' + (_formatPct(e.iva_pct) || '0%') + '</div></td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleEvtField(this,' + idx + ',\'anni_ammortamento\')" onkeydown="UI._handleAmountKey(event)">' + (e.anni_ammortamento || e.aliquota_ammortamento ? (e.anni_ammortamento || (e.aliquota_ammortamento ? Math.round(1/e.aliquota_ammortamento*10)/10 : '')) : '') + '</div></td>';
        html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviEvento(' + idx + ')">✕</div></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }
    return html;
  }

  /* ── Tab 3: Variazione Ricavi ──────────────────────────── */

  function _renderEvtRicavi(progetto) {
    var items = _eventiPerTipo(progetto, 'variazione_ricavi');
    var ultimoAnno = _ultimoAnnoPiano(progetto);
    var html = '';
    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Variazione Ricavi</h3>';
    html += '<div class="form-hint mb-8">Aumento o diminuzione percentuale dei ricavi. <b>Puntuale</b>: effetto solo nell\'anno indicato. <b>Strutturale</b>: effetto permanente dal mese/anno indicato in poi.</div>';

    html += '<div class="section-toolbar"><div class="section-toolbar-right">';
    html += '<div class="btn btn-primary btn-sm" onclick="UI.aggiungiEvento(\'variazione_ricavi\')">+ Aggiungi variazione</div>';
    html += '</div></div>';

    if (items.length === 0) {
      html += '<div class="projects-empty" style="padding:24px"><p>Nessuna variazione ricavi pianificata.</p></div>';
    } else {
      html += '<table class="schema-table"><colgroup><col style="width:auto"><col style="width:60px"><col style="width:60px"><col style="width:100px"><col style="width:110px"><col style="width:90px"><col style="width:50px"></colgroup>';
      html += '<thead><tr class="row-mastro"><td>Descrizione</td><td class="cell-amount">Anno</td><td class="cell-amount">Mese</td><td class="cell-amount">Variazione %</td><td class="cell-amount">Modalità</td><td class="cell-amount">Fino a</td><td></td></tr></thead><tbody>';

      for (var i = 0; i < items.length; i++) {
        var e = items[i].evt, idx = items[i].idx;
        html += '<tr class="row-conto">';
        html += '<td><div class="amount-field" contenteditable="true" style="text-align:left;min-width:150px;font-family:var(--font-ui)" onblur="UI._handleEvtField(this,' + idx + ',\'descrizione\')">' + _escapeHtml(e.descrizione || '') + '</div></td>';
        html += '<td class="cell-amount">' + _selectAnno(idx, 'anno', e.anno, progetto) + '</td>';
        html += '<td class="cell-amount">' + _selectMese(idx, 'mese', e.mese) + '</td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0%" onblur="UI._handleEvtField(this,' + idx + ',\'variazione_pct\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(e.variazione_pct) + '</div></td>';
        html += '<td class="cell-amount"><select class="form-select" style="width:auto;display:inline-block;font-size:11px" onchange="UI._handleEvtSelect(this,' + idx + ',\'modalita\')">';
        html += '<option value="strutturale"' + (e.modalita !== 'puntuale' ? ' selected' : '') + '>Strutturale</option>';
        html += '<option value="puntuale"' + (e.modalita === 'puntuale' ? ' selected' : '') + '>Puntuale</option>';
        html += '</select></td>';
        html += '<td class="cell-amount">' + _selectAnnoFine(idx, e.anno_fine, progetto) + '</td>';
        html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviEvento(' + idx + ')">✕</div></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }
    return html;
  }

  /* ── Tab 4: Variazione Costi Materie Prime ─────────────── */

  function _renderEvtCostiMP(progetto) {
    var items = _eventiPerTipo(progetto, 'variazione_costi_mp');
    var ultimoAnno = _ultimoAnnoPiano(progetto);
    var html = '';
    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Variazione Costi Materie Prime</h3>';
    html += '<div class="form-hint mb-8">Aumento o diminuzione percentuale dei costi di acquisto materie prime e materiali (voci B.6 del CE). Incide sul costo del venduto.</div>';

    html += '<div class="section-toolbar"><div class="section-toolbar-right">';
    html += '<div class="btn btn-primary btn-sm" onclick="UI.aggiungiEvento(\'variazione_costi_mp\')">+ Aggiungi variazione</div>';
    html += '</div></div>';

    if (items.length === 0) {
      html += '<div class="projects-empty" style="padding:24px"><p>Nessuna variazione costi materie prime pianificata.</p></div>';
    } else {
      html += '<table class="schema-table"><colgroup><col style="width:auto"><col style="width:60px"><col style="width:60px"><col style="width:100px"><col style="width:110px"><col style="width:90px"><col style="width:50px"></colgroup>';
      html += '<thead><tr class="row-mastro"><td>Descrizione</td><td class="cell-amount">Anno</td><td class="cell-amount">Mese</td><td class="cell-amount">Variazione %</td><td class="cell-amount">Modalità</td><td class="cell-amount">Fino a</td><td></td></tr></thead><tbody>';

      for (var i = 0; i < items.length; i++) {
        var e = items[i].evt, idx = items[i].idx;
        html += '<tr class="row-conto">';
        html += '<td><div class="amount-field" contenteditable="true" style="text-align:left;min-width:150px;font-family:var(--font-ui)" onblur="UI._handleEvtField(this,' + idx + ',\'descrizione\')">' + _escapeHtml(e.descrizione || '') + '</div></td>';
        html += '<td class="cell-amount">' + _selectAnno(idx, 'anno', e.anno, progetto) + '</td>';
        html += '<td class="cell-amount">' + _selectMese(idx, 'mese', e.mese) + '</td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0%" onblur="UI._handleEvtField(this,' + idx + ',\'variazione_pct\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(e.variazione_pct) + '</div></td>';
        html += '<td class="cell-amount"><select class="form-select" style="width:auto;display:inline-block;font-size:11px" onchange="UI._handleEvtSelect(this,' + idx + ',\'modalita\')">';
        html += '<option value="strutturale"' + (e.modalita !== 'puntuale' ? ' selected' : '') + '>Strutturale</option>';
        html += '<option value="puntuale"' + (e.modalita === 'puntuale' ? ' selected' : '') + '>Puntuale</option>';
        html += '</select></td>';
        html += '<td class="cell-amount">' + _selectAnnoFine(idx, e.anno_fine, progetto) + '</td>';
        html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviEvento(' + idx + ')">✕</div></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }
    return html;
  }

  /* ── Tab 5: Variazione Costi Variabili ─────────────────── */

  function _renderEvtCostiVar(progetto) {
    var items = _eventiPerTipo(progetto, 'variazione_costi_var');
    var ultimoAnno = _ultimoAnnoPiano(progetto);
    var html = '';
    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Variazione Costi Variabili</h3>';
    html += '<div class="form-hint mb-8">Variazione % dei costi già categorizzati come variabili (% sul fatturato). Clicca sul nome del driver per selezionare la voce di costo da modificare.</div>';

    html += '<div class="section-toolbar"><div class="section-toolbar-right">';
    html += '<div class="btn btn-primary btn-sm" onclick="UI.aggiungiEvento(\'variazione_costi_var\')">+ Aggiungi variazione</div>';
    html += '</div></div>';

    if (items.length === 0) {
      html += '<div class="projects-empty" style="padding:24px"><p>Nessuna variazione costi variabili pianificata.</p></div>';
    } else {
      html += '<table class="schema-table"><colgroup><col style="width:auto"><col style="width:60px"><col style="width:60px"><col style="width:100px"><col style="width:110px"><col style="width:90px"><col style="width:50px"></colgroup>';
      html += '<thead><tr class="row-mastro"><td>Driver costo</td><td class="cell-amount">Anno</td><td class="cell-amount">Mese</td><td class="cell-amount">Variazione %</td><td class="cell-amount">Modalità</td><td class="cell-amount">Fino a</td><td></td></tr></thead><tbody>';

      for (var i = 0; i < items.length; i++) {
        var e = items[i].evt, idx = items[i].idx;
        html += '<tr class="row-conto">';
        html += '<td><div class="btn btn-ghost btn-sm" style="text-align:left;font-size:12px;white-space:nowrap" onclick="UI.ciclaEvtDriver(' + idx + ')">' + _escapeHtml(_labelDriverById(progetto, e.driver_id)) + '</div></td>';
        html += '<td class="cell-amount">' + _selectAnno(idx, 'anno', e.anno, progetto) + '</td>';
        html += '<td class="cell-amount">' + _selectMese(idx, 'mese', e.mese) + '</td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0%" onblur="UI._handleEvtField(this,' + idx + ',\'variazione_pct\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(e.variazione_pct) + '</div></td>';
        html += '<td class="cell-amount"><select class="form-select" style="width:auto;display:inline-block;font-size:11px" onchange="UI._handleEvtSelect(this,' + idx + ',\'modalita\')">';
        html += '<option value="strutturale"' + (e.modalita !== 'puntuale' ? ' selected' : '') + '>Strutturale</option>';
        html += '<option value="puntuale"' + (e.modalita === 'puntuale' ? ' selected' : '') + '>Puntuale</option>';
        html += '</select></td>';
        html += '<td class="cell-amount">' + _selectAnnoFine(idx, e.anno_fine, progetto) + '</td>';
        html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviEvento(' + idx + ')">✕</div></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }
    return html;
  }

  /* ── Tab 6: Andamento Costi di Gestione ────────────────── */

  function _renderEvtCostiGestione(progetto) {
    var items = _eventiPerTipo(progetto, 'andamento_costo_gestione');
    var ultimoAnno = _ultimoAnnoPiano(progetto);
    var html = '';
    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Andamento Costi di Gestione</h3>';
    html += '<div class="form-hint mb-8">Gestione puntuale dei singoli costi fissi (Servizi, Amministrativi, Locazioni, ecc.). Oltre all\'inflazione, è possibile definire la cessazione, l\'aumento, l\'attivazione o la variazione % di un costo specifico da un determinato mese/anno.</div>';

    html += '<div class="section-toolbar"><div class="section-toolbar-right">';
    html += '<div class="btn btn-primary btn-sm" onclick="UI.aggiungiEvento(\'andamento_costo_gestione\')">+ Aggiungi evento</div>';
    html += '</div></div>';

    if (items.length === 0) {
      html += '<div class="projects-empty" style="padding:24px"><p>Nessun evento su costi di gestione pianificato.</p></div>';
    } else {
      html += '<table class="schema-table"><colgroup><col style="width:auto"><col style="width:60px"><col style="width:60px"><col style="width:100px"><col style="width:110px"><col style="width:100px"><col style="width:90px"><col style="width:50px"></colgroup>';
      html += '<thead><tr class="row-mastro"><td>Driver costo</td><td class="cell-amount">Anno</td><td class="cell-amount">Mese</td><td class="cell-amount">Azione</td><td class="cell-amount">Nuovo importo</td><td class="cell-amount">Variazione %</td><td class="cell-amount">Fino a</td><td></td></tr></thead><tbody>';

      for (var i = 0; i < items.length; i++) {
        var e = items[i].evt, idx = items[i].idx;
        html += '<tr class="row-conto">';
        html += '<td><div class="btn btn-ghost btn-sm" style="text-align:left;font-size:12px;white-space:nowrap" onclick="UI.ciclaEvtDriver(' + idx + ')">' + _escapeHtml(_labelDriverById(progetto, e.driver_id)) + '</div></td>';
        html += '<td class="cell-amount">' + _selectAnno(idx, 'anno', e.anno, progetto) + '</td>';
        html += '<td class="cell-amount">' + _selectMese(idx, 'mese', e.mese) + '</td>';
        html += '<td class="cell-amount"><select class="form-select" style="width:auto;display:inline-block;font-size:11px" onchange="UI._handleEvtSelect(this,' + idx + ',\'azione\')">';
        var _azOpts = ['variazione', 'cessato', 'aumentato', 'attivato'];
        for (var az = 0; az < _azOpts.length; az++) { html += '<option value="' + _azOpts[az] + '"' + (e.azione === _azOpts[az] ? ' selected' : '') + '>' + (_AZIONE_LABELS[_azOpts[az]] || _azOpts[az]) + '</option>'; }
        html += '</select></td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleEvtField(this,' + idx + ',\'importo_nuovo\')" onkeydown="UI._handleAmountKey(event)">' + (e.importo_nuovo ? _formatImporto(e.importo_nuovo) : '') + '</div></td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0%" onblur="UI._handleEvtField(this,' + idx + ',\'variazione_pct\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(e.variazione_pct) + '</div></td>';
        html += '<td class="cell-amount">' + _selectAnnoFine(idx, e.anno_fine, progetto) + '</td>';
        html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviEvento(' + idx + ')">✕</div></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }
    return html;
  }

  /* ── Tab 7: Variazione Personale ───────────────────────── */

  function _renderEvtPersonale(progetto) {
    var items = _eventiPerTipo(progetto, 'variazione_personale');
    var ultimoAnno = _ultimoAnnoPiano(progetto);
    var html = '';
    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Variazione Personale</h3>';
    html += '<div class="form-hint mb-8">Aumento o diminuzione del numero di dipendenti dal mese/anno indicato. Il delta ammette decimali (es. 0.5 per un part-time).</div>';

    html += '<div class="section-toolbar"><div class="section-toolbar-right">';
    html += '<div class="btn btn-primary btn-sm" onclick="UI.aggiungiEvento(\'variazione_personale\')">+ Aggiungi variazione</div>';
    html += '</div></div>';

    if (items.length === 0) {
      html += '<div class="projects-empty" style="padding:24px"><p>Nessuna variazione di personale pianificata.</p></div>';
    } else {
      html += '<table class="schema-table"><colgroup><col style="width:auto"><col style="width:60px"><col style="width:60px"><col style="width:100px"><col style="width:90px"><col style="width:50px"></colgroup>';
      html += '<thead><tr class="row-mastro"><td>Descrizione</td><td class="cell-amount">Anno</td><td class="cell-amount">Mese</td><td class="cell-amount">Delta (+/-)</td><td class="cell-amount">Fino a</td><td></td></tr></thead><tbody>';

      for (var i = 0; i < items.length; i++) {
        var e = items[i].evt, idx = items[i].idx;
        html += '<tr class="row-conto">';
        html += '<td><div class="amount-field" contenteditable="true" style="text-align:left;min-width:150px;font-family:var(--font-ui)" onblur="UI._handleEvtField(this,' + idx + ',\'descrizione\')">' + _escapeHtml(e.descrizione || '') + '</div></td>';
        html += '<td class="cell-amount">' + _selectAnno(idx, 'anno', e.anno, progetto) + '</td>';
        html += '<td class="cell-amount">' + _selectMese(idx, 'mese', e.mese) + '</td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleEvtField(this,' + idx + ',\'delta\')" onkeydown="UI._handleAmountKey(event)">' + (e.delta || '') + '</div></td>';
        html += '<td class="cell-amount">' + _selectAnnoFine(idx, e.anno_fine, progetto) + '</td>';
        html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviEvento(' + idx + ')">✕</div></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }
    return html;
  }

  /* ── Tab 8: Magazzino (nota di migrazione) ────────────────── */

  function _renderEvtMagazzino(progetto) {
    var html = '';
    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Magazzino</h3>';
    html += '<div class="form-hint mb-8">La gestione del magazzino è stata spostata nel pannello <b>Driver → Magazzino</b>. Il tasso di utilizzo degli acquisti (default 100%) governa accumulo (&lt;100%) e drawdown (&gt;100%) delle rimanenze in modo continuativo per ogni anno, rendendo superflui gli eventi puntuali.</div>';

    // Avvisa se ci sono eventi legacy utilizzo_rimanenze
    var legacy = _eventiPerTipo(progetto, 'utilizzo_rimanenze');
    if (legacy.length > 0) {
      html += '<div class="projects-empty" style="padding:16px;margin-bottom:16px;border:1px solid var(--color-warning,#b45309);background:rgba(180,83,9,0.08)">';
      html += '<p style="margin:0 0 8px"><b>Eventi legacy rilevati</b>: ' + legacy.length + ' evento/i "Utilizzo rimanenze" configurati in una versione precedente. Sono ignorati dal motore di calcolo. Rimuovili oppure usa il driver Magazzino.</p>';
      html += '<div class="btn btn-ghost btn-sm" onclick="UI._rimuoviLegacyUtilizzoRimanenze()" style="color:var(--color-error)">Rimuovi eventi legacy</div>';
      html += '</div>';
    }

    html += '<div class="projects-empty" style="padding:24px"><p>Apri il tab <b>Driver → Magazzino</b> per configurare DIO e tasso utilizzo acquisti per ogni anno.</p></div>';
    return html;
  }

  function _rimuoviLegacyUtilizzoRimanenze() {
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.eventi) return;
    progetto.eventi = progetto.eventi.filter(function(e) { return e && e.tipo !== 'utilizzo_rimanenze'; });
    Projects.segnaModificato();
    _renderEventi();
  }

  /* ── Helper: cella "Fino a" per anno di fine evento ────── */

  function _renderAnnoFineCell(evt, idx, ultimoAnno) {
    var progetto = Projects.getProgetto();
    if (progetto) return '<td class="cell-amount">' + _selectAnnoFine(idx, evt.anno_fine, progetto) + '</td>';
    var val = evt.anno_fine || ultimoAnno || '';
    return '<td class="cell-amount">' + val + '</td>';
  }

  function _ultimoAnnoPiano(progetto) {
    var anni = progetto && progetto.meta && progetto.meta.anni_previsione;
    return (anni && anni.length > 0) ? anni[anni.length - 1] : '';
  }

  /* ── Tab 9: Versamenti/Finanziamenti Soci ──────────────── */

  function _renderEvtSoci(progetto) {
    var items = _eventiPerTipo(progetto, 'operazione_soci');
    var ultimoAnno = _ultimoAnnoPiano(progetto);
    var html = '';
    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Versamenti e Finanziamenti Soci</h3>';
    html += '<div class="form-hint mb-8">Versamenti in conto capitale (incrementano il patrimonio netto), finanziamenti soci (debiti verso soci) e rimborsi ai soci. Impattano SP e cash flow.</div>';

    html += '<div class="section-toolbar"><div class="section-toolbar-right">';
    html += '<div class="btn btn-primary btn-sm" onclick="UI.aggiungiEvento(\'operazione_soci\')">+ Aggiungi operazione</div>';
    html += '</div></div>';

    if (items.length === 0) {
      html += '<div class="projects-empty" style="padding:24px"><p>Nessuna operazione soci pianificata.</p></div>';
    } else {
      html += '<table class="schema-table"><colgroup><col style="width:auto"><col style="width:60px"><col style="width:60px"><col style="width:170px"><col style="width:120px"><col style="width:50px"></colgroup>';
      html += '<thead><tr class="row-mastro"><td>Descrizione</td><td class="cell-amount">Anno</td><td class="cell-amount">Mese</td><td class="cell-amount">Tipo operazione</td><td class="cell-amount">Importo</td><td></td></tr></thead><tbody>';

      for (var i = 0; i < items.length; i++) {
        var e = items[i].evt, idx = items[i].idx;
        html += '<tr class="row-conto">';
        html += '<td><div class="amount-field" contenteditable="true" style="text-align:left;min-width:150px;font-family:var(--font-ui)" onblur="UI._handleEvtField(this,' + idx + ',\'descrizione\')">' + _escapeHtml(e.descrizione || '') + '</div></td>';
        html += '<td class="cell-amount">' + _selectAnno(idx, 'anno', e.anno, progetto) + '</td>';
        html += '<td class="cell-amount">' + _selectMese(idx, 'mese', e.mese) + '</td>';
        html += '<td class="cell-amount"><select class="form-select" style="width:auto;display:inline-block;font-size:11px" onchange="UI._handleEvtSelect(this,' + idx + ',\'sottotipo\')">';
        var _stOpts = ['versamento_capitale', 'finanziamento_soci', 'rimborso_soci'];
        for (var st = 0; st < _stOpts.length; st++) { html += '<option value="' + _stOpts[st] + '"' + (e.sottotipo === _stOpts[st] ? ' selected' : '') + '>' + (_SOTTOTIPO_LABELS[_stOpts[st]] || _stOpts[st]) + '</option>'; }
        html += '</select></td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleEvtField(this,' + idx + ',\'importo\')" onkeydown="UI._handleAmountKey(event)">' + (e.importo ? _formatImporto(e.importo) : '') + '</div></td>';
        html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviEvento(' + idx + ')">✕</div></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }
    return html;
  }

  /* ══════════════════════════════════════════════════════════
     PROSPETTI FUTURI — Rendering proiezioni
     ══════════════════════════════════════════════════════════ */

  let _prospettiTab = 'prosp-ce';

  function _renderProspetti() {
    var content = document.getElementById('content');
    var progetto = Projects.getProgetto();
    if (!content || !progetto) return;

    // Ricalcola proiezioni
    Engine.calcolaProiezioni(progetto);
    _scheduleAggiornaIndicatori();

    var anniPrev = progetto.meta.anni_previsione || [];
    var proiezioni = progetto.proiezioni.annuali || {};

    var html = '';

    // Tabs
    html += '<div class="tabs" id="prosp-tabs">';
    html += '<div class="tab-item' + (_prospettiTab === 'prosp-ce' ? ' active' : '') + '" data-tab="prosp-ce" onclick="UI.switchProspTab(\'prosp-ce\')">Conto Economico</div>';
    html += '<div class="tab-item' + (_prospettiTab === 'prosp-sp' ? ' active' : '') + '" data-tab="prosp-sp" onclick="UI.switchProspTab(\'prosp-sp\')">Stato Patrimoniale</div>';
    html += '<div class="tab-item' + (_prospettiTab === 'prosp-cf' ? ' active' : '') + '" data-tab="prosp-cf" onclick="UI.switchProspTab(\'prosp-cf\')">Rendiconto Finanziario</div>';
    html += '<div class="tab-item' + (_prospettiTab === 'prosp-cruscotto' ? ' active' : '') + '" data-tab="prosp-cruscotto" onclick="UI.switchProspTab(\'prosp-cruscotto\')">Cruscotto</div>';
    html += '</div>';

    // CE previsionale
    html += '<div class="tab-pane' + (_prospettiTab === 'prosp-ce' ? ' active' : '') + '" id="prosp-ce">';
    html += _renderProspettoCE(anniPrev, proiezioni, progetto);
    html += '</div>';

    // SP previsionale
    html += '<div class="tab-pane' + (_prospettiTab === 'prosp-sp' ? ' active' : '') + '" id="prosp-sp">';
    html += _renderProspettoSP(anniPrev, proiezioni, progetto);
    html += '</div>';

    // Cash flow
    html += '<div class="tab-pane' + (_prospettiTab === 'prosp-cf' ? ' active' : '') + '" id="prosp-cf">';
    html += _renderProspettoCF(anniPrev, proiezioni, progetto);
    html += '</div>';

    // Cruscotto riepilogativo
    html += '<div class="tab-pane' + (_prospettiTab === 'prosp-cruscotto' ? ' active' : '') + '" id="prosp-cruscotto">';
    html += _renderCruscotto(anniPrev, proiezioni, progetto);
    html += '</div>';

    content.innerHTML = html;
    _initCEToggle();
    _initSPToggle();
  }

  function switchProspTab(tabId) {
    _prospettiTab = tabId;
    document.querySelectorAll('#prosp-tabs .tab-item').forEach(function(el) {
      el.classList.toggle('active', el.dataset.tab === tabId);
    });
    document.querySelectorAll('#content > .tab-pane').forEach(function(el) {
      el.classList.toggle('active', el.id === tabId);
    });
  }

  /* ── CE Previsionale ─────────────────────────────────────── */

  function _renderProspettoCE(anniPrev, proiezioni, progetto) {
    var nAnni = anniPrev.length;
    var colW = Math.max(100, Math.floor(600 / nAnni));
    var html = '';

    // Warning banner: tasso utilizzo > 100% con rimanenze insufficienti
    var magWarnings = [];
    for (var wa = 0; wa < anniPrev.length; wa++) {
      var wCe = proiezioni[String(anniPrev[wa])] && proiezioni[String(anniPrev[wa])].ce;
      if (wCe && wCe.warnings_magazzino && wCe.warnings_magazzino.length > 0) {
        for (var ww = 0; ww < wCe.warnings_magazzino.length; ww++) {
          magWarnings.push({ anno: anniPrev[wa], w: wCe.warnings_magazzino[ww] });
        }
      }
    }
    if (magWarnings.length > 0) {
      html += '<div style="padding:12px 14px;margin-bottom:12px;border-radius:4px;background:rgba(180,83,9,0.08);border:1px solid var(--color-warning,#b45309);font-size:13px">';
      html += '<b>Avvisi magazzino</b><ul style="margin:6px 0 0;padding-left:22px">';
      for (var mw = 0; mw < magWarnings.length; mw++) {
        html += '<li>Anno ' + magWarnings[mw].anno + ': ' + _escapeHtml(magWarnings[mw].w.messaggio) + '</li>';
      }
      html += '</ul></div>';
    }

    html += '<div class="prosp-scroll">';
    html += '<table class="schema-table schema-table-sticky" id="table-prosp-ce"><colgroup><col style="width:auto">';
    for (var c = 0; c < nAnni; c++) html += '<col style="width:' + colW + 'px">';
    html += '</colgroup>';

    // Header anni
    html += '<thead><tr class="row-mastro"><td>Conto Economico</td>';
    for (var h = 0; h < nAnni; h++) html += '<td class="cell-amount">' + anniPrev[h] + '</td>';
    html += '</tr></thead><tbody>';

    // Helper: riga CE standard
    function ceRow(key, label, opts) {
      opts = opts || {};
      var cls = opts.bold ? 'row-totale' : 'row-conto';
      var pad = opts.indent ? 'padding-left:' + (opts.indent * 24) + 'px' : '';
      var fKey = 'ce.' + key;
      // Use first year's trace for label tooltip (formula description)
      var firstTrace = proiezioni[String(anniPrev[0])] && proiezioni[String(anniPrev[0])]._trace;
      var tipAttr = _tipLabel(firstTrace && firstTrace[fKey], fKey);
      var toggle = opts.toggle ? ' class="ce-toggle" data-target="' + opts.toggle + '" style="cursor:pointer;' + pad + '"' + tipAttr : ' style="' + pad + '"' + tipAttr;
      var arrow = opts.toggle ? '<span class="ce-toggle-arrow" data-target="' + opts.toggle + '">&#9654;</span> ' : '';
      var r = '<tr class="' + cls + '"><td' + toggle + '>' + arrow + label + '</td>';
      for (var a = 0; a < nAnni; a++) {
        var annoData = proiezioni[String(anniPrev[a])];
        var ce = annoData && annoData.ce;
        var trace = annoData && annoData._trace;
        var val = ce ? (ce[key] || 0) : 0;
        var valCls = val < 0 ? ' negative' : (val === 0 ? ' zero' : '');
        var tipOpen = _tipValue(trace && trace[fKey]);
        var tipClose = tipOpen ? '</span>' : '';
        var pctHtml = '';
        if (opts.pct) {
          var ricavi = ce ? (ce.valore_produzione || 0) : 0;
          var pctVal = ricavi !== 0 ? val / ricavi : 0;
          pctHtml = '<div class="amount-pct">' + _formatPctValue(pctVal) + '</div>';
        }
        r += '<td class="cell-amount">' + tipOpen + '<span class="amount-computed' + valCls + '">' + _formatImporto(val) + '</span>' + tipClose + pctHtml + '</td>';
      }
      r += '</tr>\n';
      return r;
    }

    // Helper: riga dettaglio (nascosta, con stile secondario)
    function detRow(label, values, groupId, indentPx) {
      var r = '<tr class="row-conto ce-detail-row ' + groupId + '" style="display:none">';
      r += '<td style="padding-left:' + indentPx + 'px;font-size:13px;color:var(--color-text-primary)">' + _escapeHtml(label) + '</td>';
      for (var a = 0; a < nAnni; a++) {
        var val = values[a] || 0;
        var valCls = val < 0 ? ' negative' : (val === 0 ? ' zero' : '');
        r += '<td class="cell-amount"><span class="amount-computed' + valCls + '" style="font-size:13px;color:var(--color-text-primary)">' + _formatImporto(val) + '</span></td>';
      }
      r += '</tr>\n';
      return r;
    }

    // Helper: riga intestazione sottogruppo (nascosta)
    function subHeader(label, groupId) {
      return '<tr class="ce-detail-row ' + groupId + '" style="display:none"><td colspan="' + (nAnni + 1) + '" style="padding-left:36px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--color-text-secondary);padding-top:6px">' + label + '</td></tr>\n';
    }

    // Helper: riga subtotale sottogruppo (nascosta, con somma per anno)
    function subTotalRow(label, items, groupId) {
      var r = '<tr class="ce-detail-row ' + groupId + '" style="display:none"><td style="padding-left:52px;font-size:13px;font-weight:600;color:var(--color-text-primary)">' + _escapeHtml(label) + '</td>';
      for (var a = 0; a < nAnni; a++) {
        var sum = 0;
        for (var k = 0; k < items.length; k++) sum += (items[k].values[a] || 0);
        var valCls = sum < 0 ? ' negative' : (sum === 0 ? ' zero' : '');
        r += '<td class="cell-amount"><span class="amount-computed' + valCls + '" style="font-size:13px;font-weight:600;color:var(--color-text-primary)">' + _formatImporto(sum) + '</span></td>';
      }
      r += '</tr>\n';
      return r;
    }

    // Helper: raccogli voci dettaglio uniche per id, con valori per anno
    function collectDetail(detailKey) {
      var map = {};
      var order = [];
      for (var a = 0; a < nAnni; a++) {
        var ce = proiezioni[String(anniPrev[a])] && proiezioni[String(anniPrev[a])].ce;
        var det = ce ? ce[detailKey] : null;
        if (!det) continue;
        for (var d = 0; d < det.length; d++) {
          var item = det[d];
          if (!map[item.id]) {
            map[item.id] = { id: item.id, label: item.label, tipo_driver: item.tipo_driver, voce_ce: item.voce_ce, costo_venduto: item.costo_venduto || false, values: [] };
            order.push(item.id);
          }
          map[item.id].values[a] = item.importo || 0;
        }
      }
      return order.map(function(id) { return map[id]; });
    }

    // Helper: ha almeno un anno con valore non zero?
    function hasNonZero(values) {
      for (var i = 0; i < values.length; i++) { if (values[i] && values[i] !== 0) return true; }
      return false;
    }

    // ── A. Valore della produzione (con dettaglio ricavi) ──
    html += ceRow('valore_produzione', 'A. Valore della produzione', { bold: true, toggle: 'ce-det-ricavi' });
    var ricaviDet = collectDetail('ricavi_dettaglio');
    ricaviDet.sort(function(a, b) { return a.label.localeCompare(b.label); });
    for (var ri = 0; ri < ricaviDet.length; ri++) {
      if (!hasNonZero(ricaviDet[ri].values)) continue;
      html += detRow(ricaviDet[ri].label, ricaviDet[ri].values, 'ce-det-ricavi', 48);
    }

    // ── COSTO DEL VENDUTO (MP + Var. rimanenze + altri costi diretti attribuiti) ──
    var costiDet = collectDetail('costi_dettaglio');
    // Classifica in 3 gruppi:
    // 1. Costo del venduto: B.6 (materie prime) + driver con flag costo_venduto
    //    (sia variabili sia fissi direttamente attribuibili al prodotto/servizio)
    // 2. Altri costi variabili: pct_ricavi senza flag costo_venduto e non B.6
    // 3. Costi fissi: tipo_driver fisso senza flag costo_venduto
    var costiMP = [], costiVarCDV = [], altriCostiVar = [], costiFissi = [];
    for (var ci = 0; ci < costiDet.length; ci++) {
      var cd = costiDet[ci];
      if (!hasNonZero(cd.values)) continue;
      var voce = cd.voce_ce || '';
      if (voce.indexOf('ce.B.6') === 0) {
        costiMP.push(cd);
      } else if (cd.costo_venduto) {
        costiVarCDV.push(cd);
      } else if (cd.tipo_driver === 'pct_ricavi') {
        altriCostiVar.push(cd);
      } else {
        costiFissi.push(cd);
      }
    }
    costiMP.sort(function(a, b) { return a.label.localeCompare(b.label); });
    costiVarCDV.sort(function(a, b) { return a.label.localeCompare(b.label); });
    altriCostiVar.sort(function(a, b) { return a.label.localeCompare(b.label); });
    costiFissi.sort(function(a, b) { return a.label.localeCompare(b.label); });

    html += ceRow('costo_venduto', 'Costo del venduto', { indent: 1, toggle: 'ce-det-cdv' });
    if (costiMP.length > 0) {
      // Riga aggregata: somma di tutti i driver B.6 + eventuale scostamento
      // magazzino. Rappresenta gli acquisti di materie prime di periodo
      // (componente cash-out).
      var acquistiMPValues = anniPrev.map(function(a, idx) {
        var sum = 0;
        for (var mp = 0; mp < costiMP.length; mp++) sum += (costiMP[mp].values[idx] || 0);
        return sum;
      });
      html += detRow('Acquisti di materie prime, sussidiarie, di consumo e di merci', acquistiMPValues, 'ce-det-cdv', 52);
    }
    // Aumento/Utilizzo rimanenze (= B.11 Variazione delle rimanenze, art.
    // 2425 c.c.): rettifica civilistica per competenza economica (art.
    // 2423-bis, OIC 13). Segno civilistico: aumento rimanenze → valore
    // negativo (riduce costi, gli acquisti eccedenti sono asset a SP);
    // utilizzo rimanenze → valore positivo (aumenta costi, consumo da
    // scorte esistenti). Sommata agli acquisti dà il costo del venduto.
    var varRimValues = anniPrev.map(function(a) {
      var r = proiezioni[String(a)];
      return r && r.ce ? -(r.ce.variazione_rimanenze || 0) : 0;
    });
    var hasVarRim = varRimValues.some(function(v) { return v !== 0; });
    if (hasVarRim) {
      html += detRow('Aumento / Utilizzo rimanenze', varRimValues, 'ce-det-cdv', 52);
    }
    if (costiVarCDV.length > 0) {
      html += subHeader('Altri costi diretti attribuiti al venduto', 'ce-det-cdv');
      for (var cv = 0; cv < costiVarCDV.length; cv++) html += detRow(costiVarCDV[cv].label, costiVarCDV[cv].values, 'ce-det-cdv', 52);
      if (costiVarCDV.length > 1) html += subTotalRow('Tot. altri costi diretti', costiVarCDV, 'ce-det-cdv');
    }

    // ═══ MARGINE DI CONTRIBUZIONE ═══
    html += ceRow('margine_contribuzione', 'Margine di contribuzione', { bold: true, pct: true });

    // ── ALTRI COSTI VARIABILI (pct_ricavi, non vendita/acquisto) ──
    if (altriCostiVar.length > 0) {
      html += ceRow('altri_costi_variabili', 'Altri costi variabili', { indent: 1, toggle: 'ce-det-altrivar' });
      for (var acv = 0; acv < altriCostiVar.length; acv++) html += detRow(altriCostiVar[acv].label, altriCostiVar[acv].values, 'ce-det-altrivar', 52);
      if (altriCostiVar.length > 1) html += subTotalRow('Tot. Altri costi variabili', altriCostiVar, 'ce-det-altrivar');
    }

    // ── COSTI FISSI DI GESTIONE ──
    if (costiFissi.length > 0) {
      html += ceRow('costi_fissi', 'Costi fissi', { indent: 1, toggle: 'ce-det-fissi' });
      for (var cg = 0; cg < costiFissi.length; cg++) html += detRow(costiFissi[cg].label, costiFissi[cg].values, 'ce-det-fissi', 52);
      if (costiFissi.length > 1) html += subTotalRow('Tot. Costi fissi', costiFissi, 'ce-det-fissi');
    }

    // ── B.9 Personale (con dettaglio stipendi/oneri/tfr) ──
    html += ceRow('personale_totale', 'B.9 Costo del personale', { indent: 1, toggle: 'ce-det-pers' });
    var persVoci = [
      { key: 'salari', label: 'Stipendi e salari' },
      { key: 'oneri', label: 'Oneri sociali' },
      { key: 'tfr', label: 'TFR' }
    ];
    for (var pv = 0; pv < persVoci.length; pv++) {
      var pvals = [];
      for (var pa = 0; pa < nAnni; pa++) {
        var ceP = proiezioni[String(anniPrev[pa])] && proiezioni[String(anniPrev[pa])].ce;
        pvals[pa] = ceP && ceP.personale ? (ceP.personale[persVoci[pv].key] || 0) : 0;
      }
      if (hasNonZero(pvals)) html += detRow(persVoci[pv].label, pvals, 'ce-det-pers', 48);
    }

    // ── EBITDA ──
    html += ceRow('ebitda', 'EBITDA', { bold: true, pct: true });

    // ── B.10 Ammortamenti (con dettaglio materiali/immateriali) ──
    html += ceRow('ammortamenti', 'B.10 Ammortamenti', { indent: 1, toggle: 'ce-det-ammort' });
    var ammVoci = [
      { key: 'ammort_immateriali', label: 'Ammortamenti immateriali' },
      { key: 'ammort_materiali', label: 'Ammortamenti materiali' }
    ];
    for (var av = 0; av < ammVoci.length; av++) {
      var avals = [];
      for (var aa = 0; aa < nAnni; aa++) {
        var ceA = proiezioni[String(anniPrev[aa])] && proiezioni[String(anniPrev[aa])].ce;
        avals[aa] = ceA ? (ceA[ammVoci[av].key] || 0) : 0;
      }
      if (hasNonZero(avals)) html += detRow(ammVoci[av].label, avals, 'ce-det-ammort', 48);
    }

    // ── Resto CE ──
    html += ceRow('ebit', 'EBIT (A-B)', { bold: true, pct: true });
    html += ceRow('oneri_finanziari', 'C.17 Oneri finanziari', { indent: 1 });
    html += ceRow('risultato_ante_imposte', 'Risultato ante imposte', { bold: true, pct: true });
    html += ceRow('ires', 'IRES', { indent: 1 });
    html += ceRow('irap', 'IRAP', { indent: 1 });
    html += ceRow('utile_netto', 'Utile (perdita) netto', { bold: true, pct: true });

    html += '</tbody></table></div>';
    return html;
  }

  /** Gestisce click su toggle dettaglio CE (event delegation) */
  function _initCEToggle() {
    var table = document.getElementById('table-prosp-ce');
    if (!table) return;
    table.addEventListener('click', function(e) {
      var td = e.target.closest('.ce-toggle');
      if (!td) return;
      var target = td.dataset.target;
      if (!target) return;
      var rows = document.querySelectorAll('.' + target);
      var arrow = td.querySelector('.ce-toggle-arrow');
      var open = rows.length > 0 && rows[0].style.display !== 'none';
      rows.forEach(function(r) { r.style.display = open ? 'none' : ''; });
      if (arrow) arrow.innerHTML = open ? '&#9654;' : '&#9660;';
    });
  }

  /* ── SP Previsionale ─────────────────────────────────────── */

  function _renderProspettoSP(anniPrev, proiezioni, progetto) {
    var nAnni = anniPrev.length;
    var colW = Math.max(100, Math.floor(600 / nAnni));
    var html = '<div class="prosp-scroll">';
    html += '<table class="schema-table schema-table-sticky" id="table-prosp-sp"><colgroup><col style="width:auto">';
    for (var c = 0; c < nAnni; c++) html += '<col style="width:' + colW + 'px">';
    html += '</colgroup>';

    html += '<thead><tr class="row-mastro"><td>Stato Patrimoniale</td>';
    for (var h = 0; h < nAnni; h++) html += '<td class="cell-amount">' + anniPrev[h] + '</td>';
    html += '</tr></thead><tbody>';

    // Helper: estrae la serie annuale di un campo da proiezioni[anno].sp
    function spSeries(key) {
      var out = [];
      for (var a = 0; a < nAnni; a++) {
        var sp = proiezioni[String(anniPrev[a])] && proiezioni[String(anniPrev[a])].sp;
        out.push(sp ? (sp[key] || 0) : 0);
      }
      return out;
    }
    function anyNonZero(arr) {
      for (var i = 0; i < arr.length; i++) if (arr[i]) return true;
      return false;
    }

    var costoImmat = spSeries('immob_immateriali_costo');
    var fondoImmat = spSeries('immob_immateriali_fondo');
    var costoMat = spSeries('immob_materiali_costo');
    var fondoMat = spSeries('immob_materiali_fondo');
    var tfrApertura = spSeries('tfr_apertura');
    var tfrQuota = spSeries('tfr_quota');

    // Serie per-categoria (costo/fondo) dalla proiezione
    function catSeries(catId, campo) {
      var out = [];
      for (var a = 0; a < nAnni; a++) {
        var sp = proiezioni[String(anniPrev[a])] && proiezioni[String(anniPrev[a])].sp;
        var cat = sp && sp.immob_cat && sp.immob_cat[catId];
        out.push(cat ? (cat[campo] || 0) : 0);
      }
      return out;
    }

    var idsImmat = ['sp.BI.1','sp.BI.2','sp.BI.3','sp.BI.4','sp.BI.5','sp.BI.6','sp.BI.7'];
    var idsMat = ['sp.BII.1','sp.BII.2','sp.BII.3','sp.BII.4','sp.BII.5'];

    var hasImmatDet = anyNonZero(costoImmat) || anyNonZero(fondoImmat);
    var hasMatDet = anyNonZero(costoMat) || anyNonZero(fondoMat);
    var hasTfrDet = anyNonZero(tfrApertura) || anyNonZero(tfrQuota);

    var vociAtt = [
      { key: 'immob_immateriali_nette', label: 'B.I Immobilizzazioni immateriali', indent: 1, toggle: hasImmatDet ? 'sp-det-immat' : null },
      { key: 'immob_materiali_nette',   label: 'B.II Immobilizzazioni materiali',  indent: 1, toggle: hasMatDet ? 'sp-det-mat' : null },
      { key: 'immob_finanziarie',       label: 'B.III Immobilizzazioni finanziarie', indent: 1 },
      { key: 'immobilizzazioni_nette',  label: 'B. Totale immobilizzazioni',       bold: true },
      { key: 'rimanenze',              label: 'C.I Rimanenze',                     indent: 1 },
      { key: 'crediti_clienti',        label: 'C.II Crediti verso clienti',         indent: 1 },
      { key: 'crediti_tributari_iva',  label: 'C.II Crediti tributari (IVA)',       indent: 1 },
      { key: 'altri_crediti',          label: 'C.II Altri crediti',                 indent: 1 },
      { key: 'attivo_circolante',      label: 'C. Attivo circolante',              bold: true },
      { key: 'cassa_attivo',           label: 'C.IV Disponibilità liquide',         indent: 1 },
      { key: 'totale_attivo',          label: 'TOTALE ATTIVO',                     bold: true, highlight: true }
    ];

    var vociPass = [
      { key: 'patrimonio_netto',    label: 'A. Patrimonio netto',                bold: true },
      { key: 'capitale_sociale',    label: 'A.I Capitale sociale',               indent: 1 },
      { key: 'riserve',             label: 'A.II-VI Riserve',                    indent: 1 },
      { key: 'utili_portati_nuovo', label: 'A.VIII Utili (perdite) a nuovo',     indent: 1 },
      { key: 'utile_esercizio',     label: 'A.IX Utile (perdita) esercizio',     indent: 1 },
      { key: 'tfr',                 label: 'C. TFR',                             indent: 1, toggle: hasTfrDet ? 'sp-det-tfr' : null },
      { key: 'debiti_finanziari',   label: 'D.4 Debiti finanziari',              indent: 1 },
      { key: 'debiti_fornitori',    label: 'D.7 Debiti fornitori',               indent: 1 },
      { key: 'debiti_tributari',    label: 'D.12 Debiti tributari',              indent: 1 },
      { key: 'debiti_previdenziali',label: 'D.13 Debiti previdenziali',          indent: 1 },
      { key: 'fin_soci',           label: 'D.14 Finanziamenti soci',             indent: 1 },
      { key: 'altri_debiti_residui',label: 'Altre passività',                    indent: 1 },
      { key: 'cassa_passivo',       label: 'Scoperti di c/c (debiti vs banche)', indent: 1 },
      { key: 'totale_passivo',      label: 'TOTALE PASSIVO + PN',               bold: true, highlight: true }
    ];

    // Dettaglio per voce di immobilizzazione: per ogni categoria con valori
    // non-nulli mostra costo lordo e fondo, usando le label ufficiali dello schema.
    function catDetHtml(ids, groupId) {
      var inner = '';
      var any = false;
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var costo = catSeries(id, 'costo');
        var fondo = catSeries(id, 'fondo');
        if (!anyNonZero(costo) && !anyNonZero(fondo)) continue;
        any = true;
        var nodo = Schema.trovaNodo(id);
        var label = nodo ? nodo.label : id;
        inner += '<tr class="sp-detail-row ' + groupId + '" style="display:none"><td colspan="' + (nAnni + 1) + '" style="padding-left:48px;font-size:12px;font-weight:600;color:var(--color-text-secondary);padding-top:4px">' + _escapeHtml(label) + '</td></tr>\n';
        inner += _prospettoDetRow('— Costo lordo', costo, groupId, 60);
        inner += _prospettoDetRow('— Fondo ammortamento', fondo, groupId, 60);
      }
      if (!any) return '';
      return inner;
    }

    // Sezione Attivo
    html += '<tr class="row-sottomastro"><td colspan="' + (nAnni + 1) + '" style="font-weight:700">ATTIVO</td></tr>';
    vociAtt.forEach(function(v) {
      html += _prospettoRow(v, anniPrev, proiezioni, 'sp');
      if (v.key === 'immob_immateriali_nette' && hasImmatDet) {
        html += catDetHtml(idsImmat, 'sp-det-immat');
      }
      if (v.key === 'immob_materiali_nette' && hasMatDet) {
        html += catDetHtml(idsMat, 'sp-det-mat');
      }
    });

    // Sezione Passivo
    html += '<tr class="row-sottomastro"><td colspan="' + (nAnni + 1) + '" style="font-weight:700">PASSIVO E PATRIMONIO NETTO</td></tr>';
    vociPass.forEach(function(v) {
      html += _prospettoRow(v, anniPrev, proiezioni, 'sp');
      if (v.key === 'tfr' && hasTfrDet) {
        html += _prospettoDetRow('Saldo apertura', tfrApertura, 'sp-det-tfr', 48);
        html += _prospettoDetRow('Quota maturata nell\'anno', tfrQuota, 'sp-det-tfr', 48);
      }
    });

    html += '</tbody></table></div>';
    return html;
  }

  /** Gestisce click su toggle dettaglio SP (event delegation) */
  function _initSPToggle() {
    var table = document.getElementById('table-prosp-sp');
    if (!table) return;
    table.addEventListener('click', function(e) {
      var td = e.target.closest('.sp-toggle');
      if (!td) return;
      var target = td.dataset.target;
      if (!target) return;
      var rows = document.querySelectorAll('.' + target);
      var arrow = td.querySelector('.sp-toggle-arrow');
      var open = rows.length > 0 && rows[0].style.display !== 'none';
      rows.forEach(function(r) { r.style.display = open ? 'none' : ''; });
      if (arrow) arrow.innerHTML = open ? '&#9654;' : '&#9660;';
    });
  }

  /* ── Rendiconto Finanziario ──────────────────────────────── */

  function _renderProspettoCF(anniPrev, proiezioni, progetto) {
    var nAnni = anniPrev.length;
    var colW = Math.max(100, Math.floor(600 / nAnni));
    var html = '<div class="prosp-scroll">';
    html += '<table class="schema-table schema-table-sticky"><colgroup><col style="width:auto">';
    for (var c = 0; c < nAnni; c++) html += '<col style="width:' + colW + 'px">';
    html += '</colgroup>';

    html += '<thead><tr class="row-mastro"><td>Rendiconto Finanziario</td>';
    for (var h = 0; h < nAnni; h++) html += '<td class="cell-amount">' + anniPrev[h] + '</td>';
    html += '</tr></thead><tbody>';

    var voci = [
      { key: 'utile_netto',            label: 'Utile netto',                            bold: true },
      { key: 'imposte_competenza',     label: '+ Imposte di competenza (rettifica)',    indent: 1 },
      { key: 'ammortamenti',           label: '+ Ammortamenti',                         indent: 1 },
      { key: 'var_crediti',            label: '+/- Var. crediti clienti',               indent: 1 },
      { key: 'var_rimanenze',          label: '+/- Var. rimanenze',                     indent: 1 },
      { key: 'var_debiti_fornitori',   label: '+/- Var. debiti fornitori',              indent: 1 },
      { key: 'var_debiti_iva_altri',   label: '+/- Var. debiti IVA e altri',            indent: 1 },
      { key: 'var_tfr',                label: '+/- Var. TFR',                           indent: 1 },
      { key: 'imposte_pagate',         label: '- Imposte pagate (saldo + acconti)',     indent: 1 },
      { key: 'flusso_operativo',       label: 'Flusso area operativa',                  bold: true },
      { key: 'flusso_investimenti',    label: 'Flusso area investimenti',               bold: true },
      { key: 'nuovi_finanziamenti',    label: '+ Nuovi finanziamenti',                  indent: 1 },
      { key: 'rimborso_finanziamenti', label: '- Rimborso finanziamenti',               indent: 1 },
      { key: 'versamenti_soci',        label: '+ Versamenti soci / Aumento capitale',   indent: 1 },
      { key: 'rimborsi_soci',          label: '- Rimborsi soci',                        indent: 1 },
      { key: 'dividendi',              label: '- Dividendi',                            indent: 1 },
      { key: 'flusso_finanziario',     label: 'Flusso area finanziaria',                bold: true },
      { key: 'flusso_iva',             label: 'Flusso IVA',                             indent: 1 },
      { key: 'flusso_netto',           label: 'FLUSSO DI CASSA NETTO',                  bold: true, highlight: true }
    ];

    voci.forEach(function(v) { html += _prospettoRow(v, anniPrev, proiezioni, 'cash_flow'); });

    // Riga cassa finale
    html += '<tr class="row-totale"><td>Disponibilità liquide fine periodo</td>';
    for (var a = 0; a < nAnni; a++) {
      var sp = proiezioni[String(anniPrev[a])] && proiezioni[String(anniPrev[a])].sp;
      var val = sp ? sp.cassa : 0;
      var valCls = val < 0 ? ' negative' : '';
      html += '<td class="cell-amount"><span class="amount-computed' + valCls + '">' + _formatImporto(val) + '</span></td>';
    }
    html += '</tr>';

    html += '</tbody></table></div>';
    return html;
  }

  /* ── Cruscotto riepilogativo ───────────────────────────────── */

  function _renderCruscotto(anniPrev, proiezioni, progetto) {
    var nAnni = anniPrev.length;
    var colW = Math.max(110, Math.floor(600 / nAnni));
    var html = '<div style="overflow-x:auto">';

    // Helper per creare una sezione del cruscotto
    function sezione(titolo, righe) {
      var s = '<table class="schema-table cruscotto-table" style="margin-bottom:20px"><colgroup><col style="width:auto">';
      for (var c = 0; c < nAnni; c++) s += '<col style="width:' + colW + 'px">';
      s += '</colgroup>';
      s += '<thead><tr class="row-mastro row-cruscotto-header"><td class="cruscotto-header-cell cruscotto-header-title">' + titolo + '</td>';
      for (var h = 0; h < nAnni; h++) s += '<td class="cell-amount cruscotto-header-cell">' + anniPrev[h] + '</td>';
      s += '</tr></thead><tbody>';
      righe.forEach(function(r) {
        var cls = r.bold ? 'row-totale' : 'row-conto';
        var style = r.indent ? 'padding-left:20px' : '';
        s += '<tr class="' + cls + '"><td style="' + style + '">' + r.label + '</td>';
        for (var a = 0; a < nAnni; a++) {
          var val = typeof r.values === 'function' ? r.values(anniPrev[a]) : 0;
          var valCls = val < 0 ? ' negative' : (val === 0 ? ' zero' : '');
          var fmt = r.pct ? _formatPctValue(val) : _formatImporto(val);
          s += '<td class="cell-amount"><span class="amount-computed' + valCls + '">' + fmt + '</span></td>';
        }
        s += '</tr>';
      });
      s += '</tbody></table>';
      return s;
    }

    function g(anno, sez, key) {
      var d = proiezioni[String(anno)];
      return d && d[sez] ? (d[sez][key] || 0) : 0;
    }

    // CONTO ECONOMICO SINTETICO
    html += sezione('Conto Economico', [
      { label: 'Fatturato e altri ricavi', values: function(a) { return g(a,'ce','valore_produzione'); } },
      { label: 'Costo del venduto', indent: true, values: function(a) { return g(a,'ce','costo_venduto'); } },
      { label: 'Margine di contribuzione', bold: true, values: function(a) { return g(a,'ce','margine_contribuzione'); } },
      { label: 'Altri costi variabili', indent: true, values: function(a) { return g(a,'ce','altri_costi_variabili'); } },
      { label: 'Costi fissi', indent: true, values: function(a) { return g(a,'ce','costi_fissi'); } },
      { label: 'Costo del personale', indent: true, values: function(a) { return g(a,'ce','personale_totale'); } },
      { label: 'EBITDA', bold: true, values: function(a) { return g(a,'ce','ebitda'); } },
      { label: 'Ammortamenti', indent: true, values: function(a) { return g(a,'ce','ammortamenti'); } },
      { label: 'Reddito operativo (EBIT)', bold: true, values: function(a) { return g(a,'ce','ebit'); } },
      { label: 'Oneri finanziari', indent: true, values: function(a) { return g(a,'ce','oneri_finanziari'); } },
      { label: 'Imposte (IRES + IRAP)', indent: true, values: function(a) { return g(a,'ce','imposte'); } },
      { label: 'Reddito netto', bold: true, values: function(a) { return g(a,'ce','utile_netto'); } }
    ]);

    // FLUSSI FINANZIARI
    html += sezione('Flussi Finanziari', [
      { label: 'Flusso operativo', values: function(a) { return g(a,'cash_flow','flusso_operativo'); } },
      { label: 'Flusso investimenti', values: function(a) { return g(a,'cash_flow','flusso_investimenti'); } },
      { label: 'Flusso finanziario', values: function(a) { return g(a,'cash_flow','flusso_finanziario'); } },
      { label: 'Flusso IVA', values: function(a) { return g(a,'cash_flow','flusso_iva'); } },
      { label: 'Flusso netto', bold: true, values: function(a) { return g(a,'cash_flow','flusso_netto'); } },
      { label: 'Saldo finale banca', bold: true, values: function(a) { return g(a,'sp','cassa'); } }
    ]);

    // INDICI / DSCR
    html += sezione('Indici', [
      { label: 'EBITDA %', pct: true, values: function(a) {
        var ric = g(a,'ce','valore_produzione');
        return ric ? g(a,'ce','ebitda') / ric : 0;
      }},
      { label: 'ROE (Utile / PN)', pct: true, values: function(a) {
        var pn = g(a,'sp','patrimonio_netto');
        return pn ? g(a,'ce','utile_netto') / pn : 0;
      }},
      { label: 'ROI (EBIT / Totale Attivo)', pct: true, values: function(a) {
        var ta = g(a,'sp','totale_attivo');
        return ta ? g(a,'ce','ebit') / ta : 0;
      }},
      { label: 'PFN / EBITDA', values: function(a) {
        var ebitda = g(a,'ce','ebitda');
        var pfn = g(a,'sp','debiti_finanziari') - g(a,'sp','cassa');
        if (!ebitda || ebitda <= 0) return 0;
        return Math.round(pfn / ebitda * 10) / 10;
      }},
      { label: 'DSCR (Flusso oper. / Servizio debito)', values: function(a) {
        var flussoOp = g(a,'cash_flow','flusso_operativo');
        var servDebito = Math.abs(g(a,'cash_flow','rimborso_finanziamenti')) + g(a,'ce','oneri_finanziari');
        if (!servDebito) return 0;
        return Math.round(flussoOp / servDebito * 100) / 100;
      }}
    ]);

    // PATRIMONIALE SINTETICO
    html += sezione('Stato Patrimoniale', [
      { label: 'Cassa e banca', values: function(a) { return g(a,'sp','cassa'); } },
      { label: 'Crediti clienti', values: function(a) { return g(a,'sp','crediti_clienti'); } },
      { label: 'Rimanenze', values: function(a) { return g(a,'sp','rimanenze'); } },
      { label: 'Immobilizzazioni materiali', values: function(a) { return g(a,'sp','immob_materiali_nette'); } },
      { label: 'Immobilizzazioni immateriali', values: function(a) { return g(a,'sp','immob_immateriali_nette'); } },
      { label: 'Immobilizzazioni finanziarie', values: function(a) { return g(a,'sp','immob_finanziarie'); } },
      { label: 'TOTALE ATTIVO', bold: true, values: function(a) { return g(a,'sp','totale_attivo'); } },
      { label: 'Debiti finanziari', values: function(a) { return g(a,'sp','debiti_finanziari'); } },
      { label: 'Debiti fornitori', values: function(a) { return g(a,'sp','debiti_fornitori'); } },
      { label: 'Debiti tributari', values: function(a) { return g(a,'sp','debiti_tributari'); } },
      { label: 'TFR', values: function(a) { return g(a,'sp','tfr'); } },
      { label: 'Altre passività', values: function(a) { return g(a,'sp','altri_debiti'); } },
      { label: 'Capitale netto', bold: true, values: function(a) { return g(a,'sp','patrimonio_netto'); } },
      { label: 'TOTALE PASSIVO E PN', bold: true, values: function(a) { return g(a,'sp','totale_passivo'); } }
    ]);

    html += '</div>';
    return html;
  }

  /** Formatta un valore come percentuale per il cruscotto (es. 0.15 -> "15,0%") */
  function _formatPctValue(val) {
    if (val === 0 || val === undefined || val === null) return '0%';
    var pct = val * 100;
    return pct.toFixed(1).replace('.', ',') + '%';
  }

  /* ── Dashboard KPI ────────────────────────────────────────── */

  var _dashboardCharts = [];

  function _destroyDashboardCharts() {
    for (var i = 0; i < _dashboardCharts.length; i++) {
      if (_dashboardCharts[i]) _dashboardCharts[i].destroy();
    }
    _dashboardCharts = [];
  }

  function _getDashboardColors() {
    var s = getComputedStyle(document.documentElement);
    return {
      accent:  s.getPropertyValue('--color-accent').trim()  || '#2A7AC7',
      success: s.getPropertyValue('--color-success').trim() || '#27AE60',
      warning: s.getPropertyValue('--color-warning').trim() || '#E67E22',
      error:   s.getPropertyValue('--color-error').trim()   || '#C0392B',
      muted:   s.getPropertyValue('--color-text-muted').trim() || '#8492A6',
      sidebar: s.getPropertyValue('--color-sidebar-bg').trim() || '#1B3A5C',
      text:    s.getPropertyValue('--color-text').trim() || '#2C3E50'
    };
  }

  function _renderDashboard() {
    _destroyDashboardCharts();

    var content = document.getElementById('content');
    var progetto = Projects.getProgetto();
    if (!content || !progetto) return;

    // Ricalcola proiezioni
    Engine.calcolaProiezioni(progetto);
    _scheduleAggiornaIndicatori();

    var anniPrev = progetto.meta.anni_previsione || [];
    var proj = progetto.proiezioni.annuali || {};

    if (anniPrev.length === 0) {
      content.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-muted)">Nessuna proiezione disponibile. Compilare Dati di partenza e Driver prima.</div>';
      return;
    }

    // Helper dati
    function g(anno, sez, key) {
      var d = proj[String(anno)];
      return d && d[sez] ? (d[sez][key] || 0) : 0;
    }

    // Calcola KPI per ogni anno
    var kpis = [];
    for (var i = 0; i < anniPrev.length; i++) {
      var a = anniPrev[i];
      var ricavi = g(a, 'ce', 'valore_produzione');
      var ebitda = g(a, 'ce', 'ebitda');
      var ebit = g(a, 'ce', 'ebit');
      var utile = g(a, 'ce', 'utile_netto');
      var pn = g(a, 'sp', 'patrimonio_netto');
      var ta = g(a, 'sp', 'totale_attivo');
      var debFin = g(a, 'sp', 'debiti_finanziari');
      var cassa = g(a, 'sp', 'cassa');
      var flussoOp = g(a, 'cash_flow', 'flusso_operativo');
      var rimbFin = Math.abs(g(a, 'cash_flow', 'rimborso_finanziamenti'));
      var oneriFin = g(a, 'ce', 'oneri_finanziari');
      var crediti = g(a, 'sp', 'crediti_clienti');
      var debForn = g(a, 'sp', 'debiti_fornitori');
      var debTrib = g(a, 'sp', 'debiti_tributari');

      var pfn = debFin - cassa;
      var servDebito = rimbFin + oneriFin;
      var debBreve = debForn + debTrib;

      kpis.push({
        anno: a,
        ricavi: ricavi,
        ebitda: ebitda,
        ebitda_pct: ricavi ? ebitda / ricavi : 0,
        ebit: ebit,
        utile: utile,
        roe: pn ? utile / pn : 0,
        roi: ta ? ebit / ta : 0,
        pfn_ebitda: (ebitda > 0) ? Math.round(pfn / ebitda * 10) / 10 : 0,
        dscr: servDebito ? Math.round(flussoOp / servDebito * 100) / 100 : 0,
        liquidita: debBreve ? Math.round((cassa + crediti) / debBreve * 100) / 100 : 0,
        cassa: cassa,
        pfn: pfn,
        pn: pn,
        dso: progetto.driver.circolante.dso,
        dpo: progetto.driver.circolante.dpo
      });
    }

    var last = kpis[kpis.length - 1];
    var prev = kpis.length > 1 ? kpis[kpis.length - 2] : null;

    // ─── KPI summary cards ───
    function kpiCard(label, value, fmt, prevValue, alertClass) {
      var cls = 'dashboard-kpi-card';
      if (alertClass) cls += ' ' + alertClass;
      var valCls = 'dashboard-kpi-value';
      if (typeof value === 'number' && value < 0) valCls += ' negative';
      var deltaHtml = '';
      if (prev && prevValue !== undefined && prevValue !== null) {
        var diff = value - prevValue;
        var dcls = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');
        var arrow = diff > 0 ? '\u2191' : (diff < 0 ? '\u2193' : '\u2192');
        deltaHtml = '<span class="dashboard-kpi-delta ' + dcls + '">' + arrow + ' vs ' + prev.anno + '</span>';
      }
      return '<div class="' + cls + '">' +
        '<span class="dashboard-kpi-label">' + label + '</span>' +
        '<span class="' + valCls + '">' + fmt + '</span>' +
        deltaHtml + '</div>';
    }

    function fmtI(v) { return _formatImporto(v); }
    function fmtP(v) { return _formatPctValue(v); }
    function fmtN(v) { return v === 0 ? '0' : (v % 1 === 0 ? String(v) : v.toFixed(1).replace('.', ',')); }

    var html = '<div style="padding:20px">';

    // Alert checks
    var ebitdaAlert = last.ebitda < 0 ? 'alert-error' : '';
    var pfnAlert = last.pfn_ebitda > 4 ? 'alert-warning' : '';
    var pnAlert = last.pn < 0 ? 'alert-error' : '';
    var cassaAlert = last.cassa < 0 ? 'alert-error' : '';
    var dscrAlert = (last.dscr > 0 && last.dscr < 1) ? 'alert-warning' : '';

    html += '<div class="dashboard-kpi-row">';
    html += kpiCard('EBITDA', last.ebitda, fmtI(last.ebitda), prev ? prev.ebitda : null, ebitdaAlert);
    html += kpiCard('EBITDA %', last.ebitda_pct, fmtP(last.ebitda_pct), prev ? prev.ebitda_pct : null, ebitdaAlert);
    html += kpiCard('ROE', last.roe, fmtP(last.roe), prev ? prev.roe : null, '');
    html += kpiCard('ROI', last.roi, fmtP(last.roi), prev ? prev.roi : null, '');
    html += kpiCard('PFN/EBITDA', last.pfn_ebitda, fmtN(last.pfn_ebitda) + 'x', prev ? prev.pfn_ebitda : null, pfnAlert);
    html += kpiCard('DSCR', last.dscr, fmtN(last.dscr) + 'x', prev ? prev.dscr : null, dscrAlert);
    html += kpiCard('Liquidità', last.liquidita, fmtN(last.liquidita) + 'x', prev ? prev.liquidita : null, '');
    html += kpiCard('PN', last.pn, fmtI(last.pn), prev ? prev.pn : null, pnAlert);
    html += '</div>';

    // ─── Chart cards ───
    html += '<div class="dashboard-grid">';

    html += '<div class="dashboard-card"><div class="dashboard-card-title">Ricavi &amp; EBITDA</div><div class="dashboard-chart-container"><canvas id="chart-ricavi-ebitda"></canvas></div></div>';
    html += '<div class="dashboard-card"><div class="dashboard-card-title">Marginalità %</div><div class="dashboard-chart-container"><canvas id="chart-marginalita"></canvas></div></div>';
    html += '<div class="dashboard-card"><div class="dashboard-card-title">PFN / EBITDA</div><div class="dashboard-chart-container"><canvas id="chart-pfn"></canvas></div></div>';
    html += '<div class="dashboard-card"><div class="dashboard-card-title">Liquidità &amp; Cassa</div><div class="dashboard-chart-container"><canvas id="chart-cassa"></canvas></div></div>';
    html += '<div class="dashboard-card"><div class="dashboard-card-title">DSCR</div><div class="dashboard-chart-container"><canvas id="chart-dscr"></canvas></div></div>';
    html += '<div class="dashboard-card"><div class="dashboard-card-title">DSO vs DPO</div><div class="dashboard-chart-container"><canvas id="chart-dso-dpo"></canvas></div></div>';

    html += '</div></div>';

    content.innerHTML = html;

    // ─── Inizializza grafici ───
    _initDashboardCharts(anniPrev, kpis);
  }

  function _initDashboardCharts(anniPrev, kpis) {
    var C = _getDashboardColors();
    var labels = anniPrev.map(String);

    var commonOpts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { callbacks: { label: function(ctx) {
          var v = ctx.parsed.y;
          if (v === null || v === undefined) return '';
          if (Math.abs(v) >= 1000) return ctx.dataset.label + ': ' + _formatImporto(v);
          return ctx.dataset.label + ': ' + (v % 1 === 0 ? String(v) : v.toFixed(2).replace('.', ','));
        }}}
      },
      scales: {
        x: { grid: { display: false } },
        y: { ticks: { callback: function(v) {
          if (Math.abs(v) >= 1000000) return Math.round(v / 1000000) + 'M';
          if (Math.abs(v) >= 1000) return Math.round(v / 1000) + 'K';
          return v;
        }}}
      }
    };

    function pctOpts() {
      return {
        responsive: true, maintainAspectRatio: false,
        plugins: commonOpts.plugins,
        scales: {
          x: { grid: { display: false } },
          y: { ticks: { callback: function(v) { return (v * 100).toFixed(0) + '%'; } } }
        }
      };
    }

    // 1. Ricavi & EBITDA (bar + line)
    var ctx1 = document.getElementById('chart-ricavi-ebitda');
    if (ctx1) {
      _dashboardCharts.push(new Chart(ctx1, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Ricavi', data: kpis.map(function(k) { return k.ricavi; }), backgroundColor: C.accent + '66', borderColor: C.accent, borderWidth: 1, order: 2 },
            { label: 'EBITDA', data: kpis.map(function(k) { return k.ebitda; }), type: 'line', borderColor: C.success, backgroundColor: C.success + '22', fill: true, tension: 0.3, pointRadius: 4, order: 1 }
          ]
        },
        options: commonOpts
      }));
    }

    // 2. Marginalità %
    var ctx2 = document.getElementById('chart-marginalita');
    if (ctx2) {
      _dashboardCharts.push(new Chart(ctx2, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: 'EBITDA %', data: kpis.map(function(k) { return k.ebitda_pct; }), borderColor: C.accent, tension: 0.3, pointRadius: 4 },
            { label: 'ROE', data: kpis.map(function(k) { return k.roe; }), borderColor: C.success, tension: 0.3, pointRadius: 4 },
            { label: 'ROI', data: kpis.map(function(k) { return k.roi; }), borderColor: C.warning, tension: 0.3, pointRadius: 4 }
          ]
        },
        options: pctOpts()
      }));
    }

    // 3. PFN/EBITDA
    var ctx3 = document.getElementById('chart-pfn');
    if (ctx3) {
      _dashboardCharts.push(new Chart(ctx3, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'PFN/EBITDA', data: kpis.map(function(k) { return k.pfn_ebitda; }),
              backgroundColor: kpis.map(function(k) { return k.pfn_ebitda > 4 ? C.warning + 'AA' : C.sidebar + '88'; }),
              borderColor: kpis.map(function(k) { return k.pfn_ebitda > 4 ? C.warning : C.sidebar; }),
              borderWidth: 1 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            annotation: undefined
          },
          scales: {
            x: { grid: { display: false } },
            y: { ticks: { callback: function(v) { return v + 'x'; } } }
          }
        }
      }));
    }

    // 4. Cassa
    var ctx4 = document.getElementById('chart-cassa');
    if (ctx4) {
      _dashboardCharts.push(new Chart(ctx4, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: 'Saldo cassa', data: kpis.map(function(k) { return k.cassa; }),
              borderColor: C.accent, backgroundColor: kpis.map(function(k) { return k.cassa < 0 ? C.error + '33' : C.accent + '22'; }),
              fill: true, tension: 0.3, pointRadius: 5,
              pointBackgroundColor: kpis.map(function(k) { return k.cassa < 0 ? C.error : C.accent; }) }
          ]
        },
        options: commonOpts
      }));
    }

    // 5. DSCR
    var ctx5 = document.getElementById('chart-dscr');
    if (ctx5) {
      _dashboardCharts.push(new Chart(ctx5, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'DSCR', data: kpis.map(function(k) { return k.dscr; }),
              backgroundColor: kpis.map(function(k) { return k.dscr < 1 ? C.warning + 'AA' : C.success + '88'; }),
              borderColor: kpis.map(function(k) { return k.dscr < 1 ? C.warning : C.success; }),
              borderWidth: 1 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false } },
            y: { ticks: { callback: function(v) { return v + 'x'; } },
              suggestedMin: 0 }
          }
        }
      }));
    }

    // 6. DSO vs DPO
    var ctx6 = document.getElementById('chart-dso-dpo');
    if (ctx6) {
      _dashboardCharts.push(new Chart(ctx6, {
        type: 'bar',
        data: {
          labels: ['DSO (gg incasso)', 'DPO (gg pagamento)'],
          datasets: [{
            label: 'Giorni',
            data: [kpis[0].dso, kpis[0].dpo],
            backgroundColor: [C.accent + '88', C.sidebar + '88'],
            borderColor: [C.accent, C.sidebar],
            borderWidth: 1
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { callback: function(v) { return v + ' gg'; } }, suggestedMin: 0 },
            y: { grid: { display: false } }
          }
        }
      }));
    }
  }

  /* ── Formula registry per tooltip prospetti ────────────────── */
  // Ogni entry: { desc: 'formula testuale', components: [{key, label, sign, sez}] }
  // sign: '+' o '-'. sez: sezione dati (default = stessa del prospetto)
  var _formule = {
    // ── CE ──
    'ce.valore_produzione':       { desc: 'Ricavi (A) — la var. rimanenze materie prime/merci va in B.11 per art. 2425 c.c.',
      c: [{k:'ricavi_totale',l:'Ricavi',s:'+'}] },
    'ce.costo_venduto':           { desc: 'Materie prime (B.6) + Costi diretti (variabili o fissi) attribuiti alla produzione/erogazione − Var. rimanenze (B.11)',
      c: [{k:'costo_venduto',l:'Costo del venduto',s:'+'}] },
    'ce.margine_contribuzione':   { desc: 'Valore produzione - Costo del venduto',
      c: [{k:'valore_produzione',l:'Valore produzione',s:'+'},{k:'costo_venduto',l:'Costo venduto',s:'-'}] },
    'ce.altri_costi_variabili':   { desc: 'Costi variabili non legati a vendita/acquisto',
      c: [{k:'altri_costi_variabili',l:'Altri costi variabili',s:'+'}] },
    'ce.costi_fissi':             { desc: 'Costi fissi di gestione',
      c: [{k:'costi_fissi',l:'Costi fissi',s:'+'}] },
    'ce.costi_produzione':        { desc: 'Costi oper. + Personale + Ammortamenti − Var. rimanenze (B.11)',
      c: [{k:'costi_totale',l:'Costi operativi',s:'+'},{k:'personale_totale',l:'Personale',s:'+'},{k:'ammortamenti',l:'Ammortamenti',s:'+'},{k:'variazione_rimanenze',l:'Var. rimanenze (B.11)',s:'-'}] },
    'ce.ebitda':                  { desc: 'Valore produzione - Costi oper. + Var. rimanenze (B.11) - Personale',
      c: [{k:'valore_produzione',l:'Valore produzione',s:'+'},{k:'costi_totale',l:'Costi operativi',s:'-'},{k:'variazione_rimanenze',l:'Var. rimanenze (B.11)',s:'+'},{k:'personale_totale',l:'Personale',s:'-'}] },
    'ce.ebit':                    { desc: 'EBITDA - Ammortamenti',
      c: [{k:'ebitda',l:'EBITDA',s:'+'},{k:'ammortamenti',l:'Ammortamenti',s:'-'}] },
    'ce.risultato_ante_imposte':  { desc: 'EBIT - Oneri finanziari',
      c: [{k:'ebit',l:'EBIT',s:'+'},{k:'oneri_finanziari',l:'Oneri finanziari',s:'-'}] },
    'ce.imposte':                 { desc: 'IRES + IRAP',
      c: [{k:'ires',l:'IRES',s:'+'},{k:'irap',l:'IRAP',s:'+'}] },
    'ce.utile_netto':             { desc: 'Risultato ante imposte - Imposte',
      c: [{k:'risultato_ante_imposte',l:'Ris. ante imposte',s:'+'},{k:'imposte',l:'Imposte',s:'-'}] },
    // ── SP Attivo ──
    'sp.immobilizzazioni_nette':  { desc: 'Immob. immat. + Immob. mat. + Immob. finanz.',
      c: [{k:'immob_immateriali_nette',l:'Immob. immateriali',s:'+'},{k:'immob_materiali_nette',l:'Immob. materiali',s:'+'},{k:'immob_finanziarie',l:'Immob. finanziarie',s:'+'}] },
    'sp.attivo_circolante':       { desc: 'Crediti clienti + Crediti tributari IVA + Rimanenze + Altri crediti',
      c: [{k:'crediti_clienti',l:'Crediti clienti',s:'+'},{k:'crediti_tributari_iva',l:'Crediti tributari IVA',s:'+'},{k:'rimanenze',l:'Rimanenze',s:'+'},{k:'altri_crediti',l:'Altri crediti',s:'+'}] },
    'sp.crediti_clienti':         { desc: 'Ricavi × DSO / 360 + residuo storico' },
    'sp.debiti_fornitori':        { desc: '(Costi + Personale) × DPO / 360 + residuo storico' },
    'sp.rimanenze':               { desc: 'max(Costi × DIO / 360, rimanenze precedenti)' },
    'sp.totale_attivo':           { desc: 'Immobilizzazioni + Attivo circolante + Disponibilità liquide',
      c: [{k:'immobilizzazioni_nette',l:'Immobilizzazioni',s:'+'},{k:'attivo_circolante',l:'Attivo circolante',s:'+'},{k:'cassa_attivo',l:'Disponibilità liquide',s:'+'}] },
    // ── SP Passivo ──
    'sp.patrimonio_netto':        { desc: 'Capitale + Riserve + Utili a nuovo + Utile esercizio',
      c: [{k:'capitale_sociale',l:'Capitale sociale',s:'+'},{k:'riserve',l:'Riserve',s:'+'},{k:'utili_portati_nuovo',l:'Utili a nuovo',s:'+'},{k:'utile_esercizio',l:'Utile esercizio',s:'+'}] },
    'sp.utili_portati_nuovo':     { desc: 'Utili a nuovo prec. + Utile esercizio prec.' },
    'sp.cassa_attivo':            { desc: 'max(0, Totale passivo - Immobilizzazioni - Attivo circolante)' },
    'sp.cassa_passivo':           { desc: 'Scoperto: max(0, -(Totale passivo - Immobilizzazioni - Attivo circ.))' },
    'sp.totale_passivo':          { desc: 'PN + Debiti fin. + Deb. forn. + Deb. trib. + Deb. prev. + Fin. soci + Altre pass. + TFR + Scoperti c/c',
      c: [{k:'patrimonio_netto',l:'Patrimonio netto',s:'+'},{k:'debiti_finanziari',l:'Debiti finanziari',s:'+'},{k:'debiti_fornitori',l:'Debiti fornitori',s:'+'},{k:'debiti_tributari',l:'Debiti tributari',s:'+'},{k:'debiti_previdenziali',l:'Debiti previdenziali',s:'+'},{k:'fin_soci',l:'Fin. soci',s:'+'},{k:'altri_debiti_residui',l:'Altre passività',s:'+'},{k:'tfr',l:'TFR',s:'+'},{k:'cassa_passivo',l:'Scoperti c/c',s:'+'}] },
    // ── CF ──
    'cash_flow.flusso_operativo': { desc: 'Utile + Imposte competenza + Ammort. + Var. circolante − Imposte pagate',
      c: [{k:'utile_netto',l:'Utile netto',s:'+'},{k:'imposte_competenza',l:'Imposte competenza',s:'+'},{k:'ammortamenti',l:'Ammortamenti',s:'+'},{k:'var_crediti',l:'Var. crediti',s:'+'},{k:'var_rimanenze',l:'Var. rimanenze',s:'+'},{k:'var_debiti_fornitori',l:'Var. deb. fornitori',s:'+'},{k:'var_debiti_iva_altri',l:'Var. deb. IVA e altri',s:'+'},{k:'var_tfr',l:'Var. TFR',s:'+'},{k:'imposte_pagate',l:'Imposte pagate',s:'+'},{k:'var_altri',l:'Var. altri',s:'+'}] },
    'cash_flow.flusso_netto':     { desc: 'Fl. operativo + Fl. investimenti + Fl. finanziario',
      c: [{k:'flusso_operativo',l:'Flusso operativo',s:'+'},{k:'flusso_investimenti',l:'Flusso investimenti',s:'+'},{k:'flusso_finanziario',l:'Flusso finanziario',s:'+'}] }
  };

  /** Genera tooltip attr dal trace engine (stringa) o fallback _formule */
  function _tipLabel(traceStr, formulaKey) {
    var desc = traceStr || (formulaKey && _formule[formulaKey] ? _formule[formulaKey].desc : '');
    if (!desc) return '';
    return ' title="' + _escapeHtml(desc) + '"';
  }

  /** Genera tooltip wrapper con trace engine per il valore numerico */
  function _tipValue(traceStr) {
    if (!traceStr) return '';
    return '<span class="formula-tip"><span class="tip-box"><div class="tip-row"><span class="tip-label" style="white-space:normal">' + _escapeHtml(traceStr) + '</span></div></span>';
  }

  /* ── Helper riga prospetto ───────────────────────────────── */

  function _prospettoRow(v, anniPrev, proiezioni, sezione) {
    var cls = v.highlight ? 'row-totale' : (v.bold ? 'row-totale' : 'row-conto');
    var padStyle = v.indent ? 'padding-left:24px' : '';
    var fKey = sezione + '.' + v.key;
    var firstTrace = proiezioni[String(anniPrev[0])] && proiezioni[String(anniPrev[0])]._trace;
    var tipAttr = _tipLabel(firstTrace && firstTrace[fKey], fKey);
    var tdAttrs, labelPrefix;
    if (v.toggle) {
      tdAttrs = ' class="sp-toggle" data-target="' + v.toggle + '" style="cursor:pointer;' + padStyle + '"' + tipAttr;
      labelPrefix = '<span class="sp-toggle-arrow" data-target="' + v.toggle + '">&#9654;</span> ';
    } else {
      tdAttrs = ' style="' + padStyle + '"' + tipAttr;
      labelPrefix = '';
    }
    var html = '<tr class="' + cls + '"><td' + tdAttrs + '>' + labelPrefix + v.label + '</td>';
    for (var a = 0; a < anniPrev.length; a++) {
      var annoData = proiezioni[String(anniPrev[a])];
      var data = annoData && annoData[sezione];
      var trace = annoData && annoData._trace;
      var val = data ? (data[v.key] || 0) : 0;
      var valCls = val < 0 ? ' negative' : (val === 0 ? ' zero' : '');
      var tipOpen = _tipValue(trace && trace[fKey]);
      var tipClose = tipOpen ? '</span>' : '';
      html += '<td class="cell-amount">' + tipOpen + '<span class="amount-computed' + valCls + '">' + _formatImporto(val) + '</span>' + tipClose + '</td>';
    }
    html += '</tr>';
    return html;
  }

  /** Riga di dettaglio nel prospetto SP (nascosta di default). */
  function _prospettoDetRow(label, values, groupId, indentPx) {
    var r = '<tr class="row-conto sp-detail-row ' + groupId + '" style="display:none">';
    r += '<td style="padding-left:' + indentPx + 'px;font-size:13px;color:var(--color-text-primary)">' + _escapeHtml(label) + '</td>';
    for (var a = 0; a < values.length; a++) {
      var val = values[a] || 0;
      var valCls = val < 0 ? ' negative' : (val === 0 ? ' zero' : '');
      r += '<td class="cell-amount"><span class="amount-computed' + valCls + '" style="font-size:13px;color:var(--color-text-primary)">' + _formatImporto(val) + '</span></td>';
    }
    r += '</tr>\n';
    return r;
  }

  /* ── Immobilizzazioni dettaglio (lordo/fondo/netto) ────────── */

  /** Voci di immobilizzazione che mostrano costo storico + fondo. */
  function _isImmobilizzazione(id) {
    return id && (id.indexOf('sp.BI.') === 0 || id.indexOf('sp.BII.') === 0);
  }

  function _getImmob(nodoId) {
    var p = Projects.getProgetto();
    if (!p || !p.immobilizzazioni) return null;
    return p.immobilizzazioni[nodoId] || null;
  }

  function _immobilizzazioneRowHtml(nodo, dati, sez, lato, depth, parentIds) {
    var cls = _rowClass(depth);
    var hidden = _isHidden(parentIds) ? ' row-collapsed' : '';
    var parStr = parentIds.join(' ');
    var pad = 12 + depth * 12;
    var immob = _getImmob(nodo.id) || {};
    var costo = immob.costo_storico || 0;
    var fondo = immob.fondo_ammortamento || 0;
    var aliq  = immob.aliquota || 0;
    var netto = costo - fondo;

    // Aggiorna il valore netto nei dati SP
    dati[nodo.id] = netto;

    var isCol = _collapsed.has(nodo.id);
    var childPar = parentIds.concat(nodo.id).join(' ');
    var childHidden = _isHidden(parentIds.concat(nodo.id)) ? ' row-collapsed' : '';
    var childPad = pad + 12;

    var valCls = netto < 0 ? ' negative' : (netto === 0 ? ' zero' : '');

    var html = '';

    // Riga principale: label + valore netto (calcolato)
    html += '<tr class="' + cls + hidden + (isCol ? ' collapsed' : '') + '" data-node-id="' + nodo.id + '" data-parents="' + parStr + '">';
    html += '<td style="padding-left:' + pad + 'px"><span class="collapse-icon" onclick="UI.toggleCollapse(\'' + nodo.id + '\')">▾</span> ' + _escapeHtml(nodo.label) + '</td>';
    html += '<td class="cell-amount"><span class="amount-computed' + valCls + '" data-nodo-id="' + nodo.id + '" data-sez="' + sez + '" data-lato="' + lato + '">' + _formatImporto(netto) + '</span></td>';
    html += '</tr>\n';

    // Sotto-righe con layout compatto: Costo storico | Fondo | Aliquota su una riga
    html += '<tr class="row-conto' + childHidden + '" data-parents="' + childPar + '" style="background:var(--color-surface-alt)">';
    html += '<td colspan="2" style="padding-left:' + childPad + 'px;font-size:12px">';
    html += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">';

    html += '<span style="color:var(--color-text-muted);min-width:90px">Costo storico</span>';
    html += '<div class="amount-field" contenteditable="true" style="width:110px" data-placeholder="0" onblur="UI._handleImmobField(this,\'' + nodo.id + '\',\'costo_storico\')" onkeydown="UI._handleAmountKey(event)">' + (costo ? _formatImporto(costo) : '') + '</div>';

    html += '<span style="color:var(--color-text-muted);min-width:60px">Fondo</span>';
    html += '<div class="amount-field" contenteditable="true" style="width:110px" data-placeholder="0" onblur="UI._handleImmobField(this,\'' + nodo.id + '\',\'fondo_ammortamento\')" onkeydown="UI._handleAmountKey(event)">' + (fondo ? _formatImporto(fondo) : '') + '</div>';

    html += '<span style="color:var(--color-text-muted);min-width:50px">Anni amm.</span>';
    html += '<div class="amount-field" contenteditable="true" style="width:70px" data-placeholder="0" onblur="UI._handleImmobField(this,\'' + nodo.id + '\',\'anni_ammortamento\')" onkeydown="UI._handleAmountKey(event)">' + (immob.anni_ammortamento || (aliq ? Math.round(1/aliq*10)/10 : '')) + '</div>';

    html += '</div></td></tr>\n';

    return html;
  }

  function _handleImmobField(el, nodoId, campo) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    if (!progetto.immobilizzazioni) progetto.immobilizzazioni = {};
    if (!progetto.immobilizzazioni[nodoId]) {
      progetto.immobilizzazioni[nodoId] = { costo_storico: 0, fondo_ammortamento: 0, aliquota: 0 };
    }

    var immob = progetto.immobilizzazioni[nodoId];

    if (campo === 'anni_ammortamento') {
      var v = parseFloat((el.textContent || '').replace(',', '.')) || 0;
      immob.anni_ammortamento = Math.round(v * 10) / 10;
      immob.aliquota = v > 0 ? 1 / v : 0;
      el.textContent = immob.anni_ammortamento || '';
    } else {
      immob[campo] = _parseImporto(el.textContent);
      el.textContent = immob[campo] ? _formatImporto(immob[campo]) : '';
    }

    // Aggiorna valore netto nello SP
    var netto = (immob.costo_storico || 0) - (immob.fondo_ammortamento || 0);
    var anno = String(progetto.meta.anno_base);
    Projects.setValoreStorico(anno, 'sp', 'attivo', nodoId, netto);

    _ricalcolaTotali();
    _aggiornaQuadratura();
  }

  /* ── Conti custom ─────────────────────────────────────────── */

  var _nextCustomId = 1;

  function aggiungiContoCustom(parentId, sez, lato) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    if (!progetto.conti_custom) progetto.conti_custom = [];

    var id = 'cc_' + Date.now() + '_' + (_nextCustomId++);
    progetto.conti_custom.push({ id: id, parent_id: parentId, label: 'Nuovo conto' });

    // Inizializza valore a 0 nei dati storici
    var anno = String(progetto.meta.anno_base);
    var annoData = progetto.storico[anno];
    if (annoData) {
      if (sez === 'sp' && lato === 'attivo' && annoData.sp) annoData.sp.attivo[id] = 0;
      else if (sez === 'sp' && lato === 'passivo' && annoData.sp) annoData.sp.passivo[id] = 0;
      else if (sez === 'ce' && annoData.ce) annoData.ce[id] = 0;
      else if (sez === 'sp_avvio' && annoData.sp_avvio) annoData.sp_avvio[id] = 0;
    }

    Projects.segnaModificato();
    _renderDatiPartenza();
  }

  function _handleCustomLabelBlur(el) {
    var ccId = el.dataset.customId;
    var progetto = Projects.getProgetto();
    if (!progetto || !progetto.conti_custom) return;
    var cc = progetto.conti_custom.find(function(c) { return c.id === ccId; });
    if (cc) {
      cc.label = (el.textContent || '').trim() || 'Senza nome';
      Projects.segnaModificato();
    }
  }

  /* ── Formattazione percentuali ───────────────────────────── */

  function _formatPct(val) {
    if (val === null || val === undefined || val === 0) return '';
    // Storage sempre decimale (0.05 = 5%), display sempre *100
    var pct = val * 100;
    var str = pct % 1 === 0 ? String(pct) : pct.toFixed(2).replace('.', ',').replace(/,?0+$/, '');
    return str + '%';
  }

  function _parsePct(str) {
    if (!str || str.trim() === '') return 0;
    var clean = str.replace(/%/g, '').replace(',', '.').trim();
    var val = parseFloat(clean);
    if (isNaN(val)) return 0;
    // Input sempre in forma percentuale (es. "24" o "24%" -> 0.24, "150" -> 1.50)
    return val / 100;
  }

  function _formatDec(val) {
    if (val === null || val === undefined) return '';
    return val % 1 === 0 ? String(val) : val.toFixed(2).replace('.', ',');
  }

  /* ── Indicatori progresso sidebar ─────────────────────────── */

  var _sidebarTimer = null;

  /**
   * Valuta lo stato di completezza di una sezione del progetto.
   * @returns {{ status: 'empty'|'partial'|'complete'|'error', count: number }}
   */
  function _valutaCompletezzaSezione(sezione, progetto) {
    var m = progetto.meta;
    var anno = String(m.anno_base);
    var st = progetto.storico[anno];
    var d = progetto.driver;

    switch (sezione) {

      case 'dati-partenza': {
        var spOk = false, ceOk = false, ceApplicabile = (m.scenario === 'sp_ce');

        if (m.scenario === 'costituenda') {
          spOk = st && st.sp_avvio && _haValoriNonZero(st.sp_avvio);
        } else {
          spOk = st && st.sp && (_haValoriNonZero(st.sp.attivo) || _haValoriNonZero(st.sp.passivo));
          // Quadratura check
          if (spOk && st.sp) {
            var totAtt = _sommaValori(st.sp.attivo);
            var totPass = _sommaValori(st.sp.passivo);
            if (Math.abs(totAtt - totPass) > 1) return { status: 'error', count: 0 };
          }
        }
        if (ceApplicabile) {
          ceOk = st && st.ce && _haValoriNonZero(st.ce);
        }

        if (!spOk && (!ceApplicabile || !ceOk)) return { status: 'empty', count: 0 };
        if (ceApplicabile && (!spOk || !ceOk)) return { status: 'partial', count: 0 };
        return { status: 'complete', count: 0 };
      }

      case 'driver': {
        var hasRicavi = d.ricavi && d.ricavi.some(function(r) { return r.base_annuale > 0; });
        var hasCosti = d.costi && d.costi.some(function(c) { return c.importo_fisso > 0 || c.pct_ricavi > 0; });
        // Personale: 0 dipendenti è un valore valido, non conta come mancante
        var n = (hasRicavi ? 1 : 0) + (hasCosti ? 1 : 0);
        if (n === 2) return { status: 'complete', count: 2 };
        if (n > 0) return { status: 'partial', count: n };
        // Nessun driver: mostra warning se SP è già compilato
        if (_isSpCompilato(progetto)) return { status: 'partial', count: 0 };
        return { status: 'empty', count: 0 };
      }

      case 'eventi': {
        var cnt = progetto.eventi ? progetto.eventi.length : 0;
        return { status: cnt > 0 ? 'complete' : 'empty', count: cnt };
      }

      default:
        return { status: 'empty', count: 0 };
    }
  }

  /** Verifica se i dati di partenza SP sono stati compilati */
  function _isSpCompilato(progetto) {
    var anno = String(progetto.meta.anno_base);
    var st = progetto.storico[anno];
    if (!st) return false;
    if (progetto.meta.scenario === 'costituenda') {
      return st.sp_avvio && _haValoriNonZero(st.sp_avvio);
    }
    return st.sp && (_haValoriNonZero(st.sp.attivo) || _haValoriNonZero(st.sp.passivo));
  }

  /** Controlla se un oggetto flat contiene almeno un valore numerico != 0 */
  function _haValoriNonZero(obj) {
    if (!obj) return false;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (typeof v === 'number' && v !== 0) return true;
    }
    return false;
  }

  /** Somma tutti i valori numerici di un oggetto flat */
  function _sommaValori(obj) {
    if (!obj) return 0;
    var tot = 0;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (typeof v === 'number') tot += v;
    }
    return tot;
  }

  /** Genera HTML per l'indicatore status nella sidebar */
  function _renderStatusIndicator(info) {
    var html = '';
    // Badge contatore (per eventi) — se presente, mostra solo il badge, no dot
    if (info.count > 0) {
      return '<span class="sidebar-nav-badge">' + info.count + '</span>';
    }
    // Dot di stato: solo se non empty (sezioni facoltative non mostrano dot vuoto)
    if (info.status !== 'empty') {
      html += '<span class="sidebar-nav-dot ' + info.status + '"></span>';
    }
    return html;
  }

  /** Aggiorna tutti gli indicatori nella sidebar (debounced) */
  function _scheduleAggiornaIndicatori() {
    clearTimeout(_sidebarTimer);
    _sidebarTimer = setTimeout(_aggiornaIndicatoriSidebar, 300);
  }

  function _aggiornaIndicatoriSidebar() {
    var p = Projects.getProgetto();
    if (!p) return;
    // Le sezioni indicizzate qui sono BP-specific. Per progetti AB le voci
    // sidebar sono nascoste e non hanno semantica di completezza paragonabile:
    // saltiamo per evitare di leggere `progetto.driver` che non esiste.
    if (p.meta && p.meta.modulo === 'ab') return;
    if (p.meta && p.meta.modulo === 'imposte') return;
    var sezioni = ['dati-partenza', 'driver', 'eventi'];
    for (var i = 0; i < sezioni.length; i++) {
      var el = document.getElementById('nav-status-' + sezioni[i]);
      if (!el) continue;
      var info = _valutaCompletezzaSezione(sezioni[i], p);
      el.innerHTML = _renderStatusIndicator(info);
    }
  }

  /* ── API pubblica ────────────────────────────────────────── */
  return {
    init,
    navigate,
    renderHome,
    onProgettoAperto,
    openModal,
    closeModal,
    stepperChange,
    radioSelect,
    toggleSelect,
    aggiornaStatusBar,
    mostraNotifica,
    apriModificaCliente,
    apriModificaDati,
    apriAnagraficaAB,
    aggiungiNotaAnagrafica,
    rimuoviNotaAnagrafica,
    leggiNoteAnagraficaCorrenti,
    // Importa bilancio
    importaCambiaVoce,
    importaSalvaRegole,
    importaRimuoviRiga,
    importaImpostaBoundary,
    // Fase 2
    switchDatiTab,
    toggleModalita,
    _confermaToggleModalita,
    toggleCollapse,
    expandAll,
    collapseAll,
    _handleAmountBlur,
    _handleAmountKey,
    aggiornaLabelAnno,
    // Fase 3
    switchDriverTab,
    aggiungiRicavo,
    importaRicaviDaCE,
    aggiungiCosto,
    importaCostiDaCE,
    ciclaTipoDriver,
    toggleInflazione,
    toggleInflazioneRicavo,
    ciclaVarPctMode,
    toggleCostoVenduto,
    rimuoviDriver,
    editProfiloStagionale,
    _resetProfiloUniforme,
    _salvaProfiloStagionale,
    _handleDriverField,
    _handleCircolanteField,
    _handleMagazzinoAnnoField,
    _rimuoviLegacyUtilizzoRimanenze,
    _handleFiscaleField,
    _handleFiscaleAnnoField,
    _handleFiscaleToggle,
    // Conti custom
    aggiungiContoCustom,
    _handleCustomLabelBlur,
    // Immobilizzazioni
    _handleImmobField,
    // Ricavi
    toggleStagionalita,
    _handleRicavoCrescitaAnno,
    applicaCrescitaRiga,
    applicaCrescitaColonna,
    // Prospetti
    switchProspTab,
    // Costi
    ciclaTipoCosto,
    _toggleCatMenu,
    _handlePersField,
    _handlePersToggle,
    _handlePersRalAnno,
    aggiungiVarOrganico,
    rimuoviVarOrganico,
    _handleVarOrgField,
    // Driver patrimoniali
    aggiungiFinanziamento,
    rimuoviFinanziamento,
    _handleFinField,
    aggiungiSmobilizzo,
    rimuoviSmobilizzo,
    importaSmobilizzoDaSP,
    _handleSmobField,
    // Fase 4 — eventi
    switchEventiTab,
    aggiungiEvento,
    rimuoviEvento,
    _handleEvtField,
    ciclaEvtTipoAmm,
    ciclaEvtModalita,
    ciclaEvtAzione,
    ciclaEvtSottotipo,
    ciclaEvtCategoria,
    ciclaEvtDriver,
    ciclaBaseTipo,
    ciclaIvaPct,
    _handleEvtSelect,
    // New functions
    ciclaIva,
    editIvaManuale,
    _handleEvtCategoria,
    _handleEvtModalita,
    _handleEvtAzione,
    _handleEvtSottotipo
  };

})();
