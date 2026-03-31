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

    _sezioneCorrente = sezione;

    // Aggiorna sidebar
    document.querySelectorAll('.sidebar-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.section === sezione);
    });

    // Aggiorna header
    const titoli = {
      'home':           'Home',
      'dati-partenza':  'Dati di partenza',
      'driver':         'Driver & Parametri',
      'eventi':         'Eventi',
      'prospetti':      'Prospetti futuri',
      'dashboard':      'Dashboard KPI'
    };
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) headerTitle.textContent = titoli[sezione] || sezione;

    // Aggiorna header actions
    _renderHeaderActions(sezione);

    // Render contenuto
    const content = document.getElementById('content');
    if (!content) return;

    switch (sezione) {
      case 'home':
        renderHome();
        break;
      case 'dati-partenza':
        _renderDatiPartenza();
        break;
      case 'driver':
        _renderDriver();
        break;
      case 'eventi':
      case 'prospetti':
      case 'dashboard':
        content.innerHTML = _renderPlaceholder(titoli[sezione]);
        break;
      default:
        content.innerHTML = '';
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

    // Badge scenario
    const scenarioLabels = { sp_ce: 'SP + CE', sp_only: 'Solo SP', costituenda: 'Costituenda' };
    badges.innerHTML = `
      <span class="header-badge header-badge-scenario">${scenarioLabels[progetto.meta.scenario] || progetto.meta.scenario}</span>
      <span class="header-badge header-badge-anno">${progetto.meta.scenario === 'costituenda' ? 'Inizio' : 'Base'}: ${progetto.meta.anno_base}</span>
    `;

    // Pulsanti salva
    actions.innerHTML = `
      <div class="btn btn-ghost btn-sm" onclick="UI.navigate('home')" title="Torna alla home">⌂ Home</div>
      <div class="btn btn-primary btn-sm" onclick="Projects.salvaProgetto()">Salva progetto</div>
    `;
  }

  /* ──────────────────────────────────────────────────────────
     Home — lista progetti
     ────────────────────────────────────────────────────────── */

  function renderHome() {
    const content = document.getElementById('content');
    if (!content) return;

    _sezioneCorrente = 'home';

    // Aggiorna sidebar
    document.querySelectorAll('.sidebar-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.section === 'home');
    });

    const headerTitle = document.getElementById('header-title');
    if (headerTitle) headerTitle.textContent = 'Home';

    // Header actions per home
    const badges = document.getElementById('header-badges');
    const actions = document.getElementById('header-actions');
    if (badges) badges.innerHTML = '';
    if (actions) actions.innerHTML = '';

    const recenti = Projects.leggiRecenti();

    let html = `
      <div class="home-welcome">
        <h1>Business Plan Tool</h1>
        <p>Elabora dati di bilancio storici e genera prospetti contabili previsionali pluriennali.</p>
      </div>

      <div class="home-actions">
        <div class="btn btn-primary" onclick="UI.openModal('modal-nuovo-progetto')">+ Nuovo progetto</div>
        <div class="btn btn-secondary" onclick="Projects.apriProgetto()">Apri file JSON</div>
      </div>
    `;

    if (recenti.length > 0) {
      html += `<div class="projects-section-title">Progetti recenti</div>`;
      html += `<div class="projects-grid">`;

      for (const r of recenti) {
        const scenarioLabels = { sp_ce: 'SP + CE', sp_only: 'Solo SP', costituenda: 'Costituenda' };
        const scenarioClass  = { sp_ce: 'tag-sp-ce', sp_only: 'tag-sp-only', costituenda: 'tag-costituenda' };
        const tagLabel = scenarioLabels[r.scenario] || r.scenario;
        const tagClass = scenarioClass[r.scenario] || 'tag-sp-ce';

        const anniPrev = Array.isArray(r.anni_previsione)
          ? r.anni_previsione.join(', ')
          : r.anni_previsione;

        html += `
          <div class="project-card" onclick="UI._apriDaRecente('${_escapeAttr(r.id)}')">
            <div class="project-card-name">${_escapeHtml(r.cliente)}</div>
            <div class="project-card-meta">
              <span>Anno base: ${r.anno_base}</span>
              <span>Prev: ${anniPrev}</span>
              ${r.settore ? '<span>' + _escapeHtml(r.settore) + '</span>' : ''}
            </div>
            <div>
              <span class="project-card-tag ${tagClass}">${tagLabel}</span>
            </div>
            <div class="project-card-date">
              Modificato: ${r.modificato || r.creato || '—'}
            </div>
            <div class="project-card-actions" onclick="event.stopPropagation()">
              <div class="btn btn-ghost btn-sm" onclick="Projects.richiediElimina('${_escapeAttr(r.id)}', '${_escapeAttr(r.cliente)}')">Elimina</div>
            </div>
          </div>
        `;
      }

      html += `</div>`;
    } else {
      html += `
        <div class="projects-section-title">Progetti recenti</div>
        <div class="projects-grid">
          <div class="projects-empty">
            <div class="projects-empty-icon">📂</div>
            <p>Nessun progetto recente.<br>Crea un nuovo progetto o apri un file JSON esistente.</p>
          </div>
        </div>
      `;
    }

    content.innerHTML = html;
  }

  /**
   * Apre un progetto dalla lista recenti.
   * I recenti contengono solo metadata, quindi mostra un prompt per caricare il file.
   * @param {string} id
   */
  function _apriDaRecente(id) {
    // I recenti sono solo metadata — serve il file JSON completo
    mostraNotifica('Per riaprire questo progetto, carica il file JSON corrispondente.', 'info');
    Projects.apriProgetto();
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
    // Aggiorna sidebar info progetto
    const nameEl = document.getElementById('sidebar-project-name');
    const metaEl = document.getElementById('sidebar-project-meta');
    if (nameEl) {
      nameEl.textContent = progetto.meta.cliente;
      nameEl.classList.remove('text-muted');
    }
    if (metaEl) {
      const scenarioLabels = { sp_ce: 'SP + CE', sp_only: 'Solo SP', costituenda: 'Costituenda' };
      metaEl.textContent = `${progetto.meta.anno_base} · ${scenarioLabels[progetto.meta.scenario] || progetto.meta.scenario}`;
    }

    // Abilita voci navigazione
    document.querySelectorAll('.sidebar-nav-item.disabled').forEach(el => {
      el.classList.remove('disabled');
    });

    // Aggiorna status bar
    aggiornaStatusBar('pronto');

    // Naviga alla sezione dati di partenza
    navigate('dati-partenza');

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
    val = Math.max(1, Math.min(8, val + delta));
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

    if (scenario === 'costituenda') {
      if (labelEl) labelEl.textContent = 'Anno di inizio attività *';
      if (hintEl)  hintEl.textContent  = 'Primo anno operativo della nuova società';
      if (anniHint) anniHint.textContent = 'Da 1 a 8 anni di previsione';
      if (annoField) annoField.dataset.placeholder = 'Es. 2025';
    } else {
      if (labelEl) labelEl.textContent = 'Anno base (storico) *';
      if (hintEl)  hintEl.textContent  = "Anno dell'ultimo bilancio approvato";
      if (anniHint) anniHint.textContent = "Da 1 a 8 anni oltre l'anno base";
      if (annoField) annoField.dataset.placeholder = 'Es. 2024';
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

    // Tabs
    html += `<div class="tabs" id="dati-tabs">
      <div class="tab-item${_datiTab === 'tab-sp' ? ' active' : ''}" data-tab="tab-sp" onclick="UI.switchDatiTab('tab-sp')">Stato Patrimoniale</div>
      <div class="tab-item${_datiTab === 'tab-ce' ? ' active' : ''}${ceDisabled ? ' disabled' : ''}" data-tab="tab-ce" onclick="UI.switchDatiTab('tab-ce')">Conto Economico</div>
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

    let html = '';

    // ATTIVO
    html += `<h3 style="font-size:14px;font-weight:700;margin:0 0 8px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em;">ATTIVO</h3>`;
    html += `<table class="schema-table" id="table-sp-attivo"><colgroup><col class="col-label"><col class="col-amount"></colgroup><tbody>`;
    html += _buildTreeRows(Schema.SP_ATTIVO, annoData.sp.attivo, 'sp', 'attivo', modalita, 0, []);
    html += `</tbody></table>`;

    // PASSIVO
    html += `<h3 style="font-size:14px;font-weight:700;margin:24px 0 8px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em;">PASSIVO E PATRIMONIO NETTO</h3>`;
    html += `<table class="schema-table" id="table-sp-passivo"><colgroup><col class="col-label"><col class="col-amount"></colgroup><tbody>`;
    html += _buildTreeRows(Schema.SP_PASSIVO, annoData.sp.passivo, 'sp', 'passivo', modalita, 0, []);
    html += `</tbody></table>`;

    return html;
  }

  function _renderSPCostitutenda(progetto) {
    const anno = String(progetto.meta.anno_base);
    const annoData = progetto.storico[anno];
    if (!annoData || !annoData.sp_avvio) return '<p class="text-muted">Dati non disponibili.</p>';

    let html = `<table class="schema-table" id="table-sp-avvio"><colgroup><col class="col-label"><col class="col-amount"></colgroup><tbody>`;
    html += _buildTreeRows(Schema.SP_COSTITUENDA, annoData.sp_avvio, 'sp_avvio', '', 'analitica', 0, []);
    html += `</tbody></table>`;
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
    } else {
      // Nodo foglia semplice
      const val = dati[nodo.id] || 0;
      const display = val !== 0 ? _formatImporto(val) : '';
      html += `<tr class="${cls}${hidden}" data-node-id="${nodo.id}" data-parents="${parStr}">
        <td style="padding-left:${pad}px">${_escapeHtml(nodo.label)}</td>
        <td class="cell-amount"><div class="amount-field" contenteditable="true" data-conto-id="${nodo.id}" data-sez="${sez}" data-lato="${lato}" data-placeholder="0" onblur="UI._handleAmountBlur(this)" onkeydown="UI._handleAmountKey(event)">${display}</div></td>
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
    const progetto = Projects.getProgetto();
    if (!progetto) return;
    progetto.meta.modalita = modo;
    Projects.segnaModificato();
    _collapsed.clear();
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
    document.querySelectorAll('.schema-table tr[data-node-id]').forEach(function(tr) {
      const nodeId = tr.dataset.nodeId;
      const parents = (tr.dataset.parents || '').split(' ').filter(Boolean);

      // Aggiorna icona collasso sulla riga stessa
      if (_collapsed.has(nodeId)) {
        tr.classList.add('collapsed');
      } else {
        tr.classList.remove('collapsed');
      }

      // Nascondi se un qualsiasi antenato e collassato
      if (parents.some(function(pid) { return _collapsed.has(pid); })) {
        tr.classList.add('row-collapsed');
      } else {
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

    if (!progetto || progetto.meta.scenario === 'costituenda') {
      qEl.classList.add('hidden');
      return;
    }

    const anno = String(progetto.meta.anno_base);
    const modalita = progetto.meta.modalita || 'rapida';
    const annoData = progetto.storico[anno];
    if (!annoData || !annoData.sp) { qEl.classList.add('hidden'); return; }

    const nodoAtt = Schema.trovaNodo('sp.TOT_ATT');
    const nodoPass = Schema.trovaNodo('sp.TOT_PASS');
    if (!nodoAtt || !nodoPass) return;

    const cc = _getContiCustom();
    const totAtt  = Engine.calcolaValore(nodoAtt, annoData.sp.attivo, modalita, cc);
    const totPass = Engine.calcolaValore(nodoPass, annoData.sp.passivo, modalita, cc);
    const diff = totAtt - totPass;

    qEl.classList.remove('hidden');

    if (Math.abs(diff) < 1) {
      qEl.className = 'footer-quadratura ok';
      qText.textContent = 'SP quadrato: ' + _formatImporto(totAtt);
    } else {
      qEl.className = 'footer-quadratura error';
      qText.textContent = 'SP NON quadrato — diff: ' + _formatImporto(diff);
    }
  }

  /* ── Formattazione importi ───────────────────────────────── */

  function _formatImporto(val) {
    if (val === 0 || val === undefined || val === null) return '0';
    var neg = val < 0;
    var abs = Math.abs(Math.round(val));
    var str = abs.toLocaleString('it-IT');
    return neg ? '-' + str : str;
  }

  function _parseImporto(str) {
    if (!str || str.trim() === '') return 0;
    var clean = str.replace(/\./g, '').replace(',', '.').trim();
    var val = parseFloat(clean);
    return isNaN(val) ? 0 : Math.round(val);
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
    html += _driverTabItem('drv-ricavi', 'Ricavi');
    html += _driverTabItem('drv-costi', 'Costi');
    html += _driverTabItem('drv-circolante', 'Circolante');
    html += _driverTabItem('drv-fiscale', 'Fiscale');
    html += '</div>';

    // Tab panes
    html += '<div class="tab-pane' + (_driverTab === 'drv-ricavi' ? ' active' : '') + '" id="drv-ricavi">';
    html += _renderDriverRicavi(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_driverTab === 'drv-costi' ? ' active' : '') + '" id="drv-costi">';
    html += _renderDriverCosti(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_driverTab === 'drv-circolante' ? ' active' : '') + '" id="drv-circolante">';
    html += _renderDriverCircolante(progetto);
    html += '</div>';

    html += '<div class="tab-pane' + (_driverTab === 'drv-fiscale' ? ' active' : '') + '" id="drv-fiscale">';
    html += _renderDriverFiscale(progetto);
    html += '</div>';

    content.innerHTML = html;
  }

  function _driverTabItem(id, label) {
    return '<div class="tab-item' + (_driverTab === id ? ' active' : '') + '" data-tab="' + id + '" onclick="UI.switchDriverTab(\'' + id + '\')">' + label + '</div>';
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
    var html = '';

    html += '<div class="section-toolbar"><div class="section-toolbar-left">';
    html += '<span style="font-size:13px;font-weight:600;color:var(--color-text-secondary)">Voci di ricavo previsionali</span>';
    html += '</div><div class="section-toolbar-right">';
    html += '<div class="btn btn-primary btn-sm" onclick="UI.aggiungiRicavo()">+ Aggiungi voce</div>';
    if (progetto.meta.scenario === 'sp_ce') {
      html += ' <div class="btn btn-secondary btn-sm" onclick="UI.importaRicaviDaCE()">Importa da CE</div>';
    }
    html += '</div></div>';

    if (ricavi.length === 0) {
      html += '<div class="projects-empty" style="padding:32px"><p>Nessuna voce di ricavo configurata.<br>';
      if (progetto.meta.scenario === 'sp_ce') {
        html += 'Clicca "Importa da CE" per popolare dai dati storici, oppure "Aggiungi voce" per crearne una nuova.';
      } else {
        html += 'Clicca "Aggiungi voce" per creare la prima voce di ricavo.';
      }
      html += '</p></div>';
      return html;
    }

    // Tabella ricavi
    html += '<table class="schema-table"><colgroup><col style="width:auto"><col style="width:140px"><col style="width:100px"><col style="width:120px"><col style="width:60px"></colgroup>';
    html += '<thead><tr class="row-mastro"><td>Voce</td><td class="cell-amount">Base annuale</td><td class="cell-amount">Crescita %/anno</td><td class="cell-amount">Profilo</td><td></td></tr></thead><tbody>';

    for (var i = 0; i < ricavi.length; i++) {
      var r = ricavi[i];
      var profiloLabel = _isProfiloUniforme(r.profilo_stagionale) ? 'Uniforme' : 'Personalizzato';
      html += '<tr class="row-conto" data-driver-idx="' + i + '">';
      html += '<td><div class="amount-field" contenteditable="true" style="text-align:left;min-width:200px;font-family:var(--font-ui)" data-field="label" data-idx="' + i + '" onblur="UI._handleDriverField(this,\'ricavi\',' + i + ',\'label\')">' + _escapeHtml(r.label) + '</div></td>';
      html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-field="base_annuale" data-idx="' + i + '" data-placeholder="0" onblur="UI._handleDriverField(this,\'ricavi\',' + i + ',\'base_annuale\')" onkeydown="UI._handleAmountKey(event)">' + (r.base_annuale ? _formatImporto(r.base_annuale) : '') + '</div></td>';
      html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-field="crescita_annua" data-idx="' + i + '" data-placeholder="0" onblur="UI._handleDriverField(this,\'ricavi\',' + i + ',\'crescita_annua\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(r.crescita_annua) + '</div></td>';
      html += '<td class="cell-amount"><div class="btn btn-ghost btn-sm" onclick="UI.editProfiloStagionale(' + i + ')">' + profiloLabel + '</div></td>';
      html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviDriver(\'ricavi\',' + i + ')">✕</div></td>';
      html += '</tr>';
    }
    html += '</tbody></table>';

    return html;
  }

  function _isProfiloUniforme(profilo) {
    if (!profilo || profilo.length !== 12) return true;
    var ref = 100 / 12;
    return profilo.every(function(v) { return Math.abs(v - ref) < 0.1; });
  }

  function aggiungiRicavo() {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var drv = Projects.creaDriverRicavo(null, 'Nuova voce ricavo', 0);
    progetto.driver.ricavi.push(drv);
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
    var costi = progetto.driver.costi;
    var html = '';

    html += '<div class="section-toolbar"><div class="section-toolbar-left">';
    html += '<span style="font-size:13px;font-weight:600;color:var(--color-text-secondary)">Voci di costo previsionali</span>';
    html += '</div><div class="section-toolbar-right">';
    html += '<div class="btn btn-primary btn-sm" onclick="UI.aggiungiCosto()">+ Aggiungi voce</div>';
    if (progetto.meta.scenario === 'sp_ce') {
      html += ' <div class="btn btn-secondary btn-sm" onclick="UI.importaCostiDaCE()">Importa da CE</div>';
    }
    html += '</div></div>';

    if (costi.length === 0) {
      html += '<div class="projects-empty" style="padding:32px"><p>Nessuna voce di costo configurata.<br>';
      if (progetto.meta.scenario === 'sp_ce') {
        html += 'Clicca "Importa da CE" per popolare dai dati storici, oppure "Aggiungi voce".';
      } else {
        html += 'Clicca "Aggiungi voce" per creare la prima voce di costo.';
      }
      html += '</p></div>';
      return html;
    }

    // Tabella costi
    html += '<table class="schema-table"><colgroup><col style="width:auto"><col style="width:120px"><col style="width:130px"><col style="width:110px"><col style="width:90px"><col style="width:60px"></colgroup>';
    html += '<thead><tr class="row-mastro"><td>Voce</td><td class="cell-amount">Tipo driver</td><td class="cell-amount">Valore</td><td class="cell-amount">Var. %/anno</td><td class="cell-amount">Inflaz.</td><td></td></tr></thead><tbody>';

    for (var i = 0; i < costi.length; i++) {
      var c = costi[i];
      html += '<tr class="row-conto">';

      // Label
      html += '<td><div class="amount-field" contenteditable="true" style="text-align:left;min-width:180px;font-family:var(--font-ui)" onblur="UI._handleDriverField(this,\'costi\',' + i + ',\'label\')">' + _escapeHtml(c.label) + '</div></td>';

      // Tipo driver (select simulato)
      var tipoLabel = c.usa_var_personale ? 'Personale' : (c.tipo_driver === 'pct_ricavi' ? '% ricavi' : 'Fisso');
      html += '<td class="cell-amount"><div class="btn btn-ghost btn-sm" onclick="UI.ciclaTipoDriver(' + i + ')">' + tipoLabel + '</div></td>';

      // Valore
      if (c.tipo_driver === 'pct_ricavi') {
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0%" onblur="UI._handleDriverField(this,\'costi\',' + i + ',\'pct_ricavi\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(c.pct_ricavi) + '</div></td>';
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0%" onblur="UI._handleDriverField(this,\'costi\',' + i + ',\'var_pct_annua\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(c.var_pct_annua) + '</div></td>';
      } else {
        html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0" onblur="UI._handleDriverField(this,\'costi\',' + i + ',\'importo_fisso\')" onkeydown="UI._handleAmountKey(event)">' + (c.importo_fisso ? _formatImporto(c.importo_fisso) : '') + '</div></td>';
        html += '<td class="cell-amount"><span class="text-muted" style="font-size:12px">' + (c.usa_var_personale ? 'Param. ded.' : '—') + '</span></td>';
      }

      // Flag inflazione
      if (c.tipo_driver === 'pct_ricavi' || c.usa_var_personale) {
        html += '<td class="cell-amount"><span class="text-muted" style="font-size:11px">n/a</span></td>';
      } else {
        var flagIcon = c.soggetto_inflazione ? '✓' : '✕';
        var flagColor = c.soggetto_inflazione ? 'var(--color-success)' : 'var(--color-text-muted)';
        html += '<td class="cell-amount"><div class="btn btn-ghost btn-sm" style="color:' + flagColor + '" onclick="UI.toggleInflazione(' + i + ')">' + flagIcon + '</div></td>';
      }

      html += '<td><div class="btn btn-ghost btn-sm" style="color:var(--color-error)" onclick="UI.rimuoviDriver(\'costi\',' + i + ')">✕</div></td>';
      html += '</tr>';
    }
    html += '</tbody></table>';

    return html;
  }

  function aggiungiCosto() {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var drv = Projects.creaDriverCosto(null, 'Nuova voce costo', 'fisso');
    progetto.driver.costi.push(drv);
    Projects.segnaModificato();
    _renderDriver();
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

  function ciclaTipoDriver(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var c = progetto.driver.costi[idx];
    if (!c) return;

    // Cicla: pct_ricavi -> fisso -> personale -> pct_ricavi
    if (c.tipo_driver === 'pct_ricavi') {
      c.tipo_driver = 'fisso';
      c.pct_ricavi = null;
      c.var_pct_annua = null;
      c.importo_fisso = c.importo_fisso || 0;
      c.soggetto_inflazione = true;
      c.usa_var_personale = false;
    } else if (!c.usa_var_personale) {
      // fisso -> personale
      c.usa_var_personale = true;
      c.soggetto_inflazione = false;
    } else {
      // personale -> pct_ricavi
      c.tipo_driver = 'pct_ricavi';
      c.pct_ricavi = 0;
      c.var_pct_annua = 0;
      c.importo_fisso = null;
      c.soggetto_inflazione = false;
      c.usa_var_personale = false;
    }
    Projects.segnaModificato();
    _renderDriver();
  }

  function toggleInflazione(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var c = progetto.driver.costi[idx];
    if (!c) return;
    c.soggetto_inflazione = !c.soggetto_inflazione;
    Projects.segnaModificato();
    _renderDriver();
  }

  /* ── Tab CIRCOLANTE ──────────────────────────────────────── */

  function _renderDriverCircolante(progetto) {
    var circ = progetto.driver.circolante;
    var html = '<div style="max-width:400px">';

    html += '<div style="margin-bottom:20px;font-size:13px;color:var(--color-text-secondary)">Indici di capitale circolante applicati a tutti gli anni previsionali.</div>';

    html += _campoCircolante('DSO — Giorni medi incasso clienti', 'dso', circ.dso, 'gg');
    html += _campoCircolante('DPO — Giorni medi pagamento fornitori', 'dpo', circ.dpo, 'gg');
    html += _campoCircolante('DIO — Giorni medi giacenza magazzino', 'dio', circ.dio, 'gg');

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

  /* ── Tab FISCALE ─────────────────────────────────────────── */

  function _renderDriverFiscale(progetto) {
    var fisc = progetto.driver.fiscale;
    var anniPrev = progetto.meta.anni_previsione;
    var html = '';

    // Aliquote
    html += '<div style="max-width:500px">';
    html += '<h3 style="font-size:14px;font-weight:700;margin:0 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Aliquote</h3>';

    html += '<div class="form-row">';
    html += '<div class="form-group"><span class="form-label">IRES %</span>';
    html += '<div class="form-field" contenteditable="true" style="width:100px;text-align:right;font-family:var(--font-mono)" onblur="UI._handleFiscaleField(this,\'aliquota_ires\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(fisc.aliquota_ires) + '</div></div>';
    html += '<div class="form-group"><span class="form-label">IRAP %</span>';
    html += '<div class="form-field" contenteditable="true" style="width:100px;text-align:right;font-family:var(--font-mono)" onblur="UI._handleFiscaleField(this,\'aliquota_irap\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(fisc.aliquota_irap) + '</div></div>';
    html += '</div>';

    // Inflazione per anno
    html += '<h3 style="font-size:14px;font-weight:700;margin:24px 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Inflazione prevista %</h3>';
    html += '<div class="form-hint mb-8">Applicata automaticamente ai costi fissi soggetti a inflazione.</div>';

    html += '<table class="schema-table" style="max-width:400px"><tbody>';
    for (var i = 0; i < anniPrev.length; i++) {
      var a = String(anniPrev[i]);
      var val = fisc.inflazione ? (fisc.inflazione[a] || 0) : 0;
      html += '<tr class="row-conto"><td>' + a + '</td>';
      html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0%" onblur="UI._handleFiscaleAnnoField(this,\'inflazione\',\'' + a + '\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(val) + '</div></td></tr>';
    }
    html += '</tbody></table>';

    // Variazione personale per anno
    html += '<h3 style="font-size:14px;font-weight:700;margin:24px 0 12px;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:0.05em">Variazione costo personale %</h3>';
    html += '<div class="form-hint mb-8">Applicata alle voci costo di tipo "Personale" (indipendente dall\'inflazione).</div>';

    html += '<table class="schema-table" style="max-width:400px"><tbody>';
    for (var j = 0; j < anniPrev.length; j++) {
      var a2 = String(anniPrev[j]);
      var val2 = fisc.var_personale ? (fisc.var_personale[a2] || 0) : 0;
      html += '<tr class="row-conto"><td>' + a2 + '</td>';
      html += '<td class="cell-amount"><div class="amount-field" contenteditable="true" data-placeholder="0%" onblur="UI._handleFiscaleAnnoField(this,\'var_personale\',\'' + a2 + '\')" onkeydown="UI._handleAmountKey(event)">' + _formatPct(val2) + '</div></td></tr>';
    }
    html += '</tbody></table>';

    html += '</div>';
    return html;
  }

  /* ── Profilo stagionale (modale inline) ──────────────────── */

  function editProfiloStagionale(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var r = progetto.driver.ricavi[idx];
    if (!r) return;

    var mesi = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    var profilo = r.profilo_stagionale || [];

    var html = '<div class="modal-header"><span class="modal-title">Profilo stagionale — ' + _escapeHtml(r.label) + '</span>';
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
    html += '<div class="btn btn-primary" onclick="UI._salvaProfiloStagionale(' + idx + ')">Salva</div>';
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

  function _salvaProfiloStagionale(idx) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var r = progetto.driver.ricavi[idx];
    if (!r) return;

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

    r.profilo_stagionale = profilo;
    Projects.segnaModificato();
    closeModal('modal-profilo');
    _renderDriver();
  }

  /* ── Handler campi driver ────────────────────────────────── */

  function _handleDriverField(el, tipo, idx, campo) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var arr = progetto.driver[tipo];
    if (!arr || !arr[idx]) return;

    if (campo === 'label') {
      arr[idx].label = (el.textContent || '').trim() || 'Senza nome';
    } else if (campo === 'base_annuale' || campo === 'importo_fisso') {
      var val = _parseImporto(el.textContent);
      arr[idx][campo] = val;
      el.textContent = val !== 0 ? _formatImporto(val) : '';
    } else if (campo === 'crescita_annua' || campo === 'pct_ricavi' || campo === 'var_pct_annua') {
      var pct = _parsePct(el.textContent);
      arr[idx][campo] = pct;
      el.textContent = _formatPct(pct);
    }
    Projects.segnaModificato();
  }

  function _handleCircolanteField(el, campo) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var val = parseInt((el.textContent || '').replace(/\D/g, ''), 10) || 0;
    progetto.driver.circolante[campo] = val;
    el.textContent = val || '';
    Projects.segnaModificato();
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

  function rimuoviDriver(tipo, idx) {
    var progetto = Projects.getProgetto();
    if (!progetto) return;
    var arr = progetto.driver[tipo];
    if (!arr) return;
    arr.splice(idx, 1);
    Projects.segnaModificato();
    _renderDriver();
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
    // Mostra come percentuale: 0.24 -> "24" oppure 2.5 -> "2,5"
    // Se il valore e gia in forma percentuale (>1 o <-1 per valori grandi), lo mostra diretto
    // Convenzione: valori < 1 in forma decimale (0.24 = 24%), valori >= 1 gia percentuali
    var pct = Math.abs(val) < 1 ? val * 100 : val;
    var str = pct % 1 === 0 ? String(pct) : pct.toFixed(2).replace('.', ',').replace(/,?0+$/, '');
    return str;
  }

  function _parsePct(str) {
    if (!str || str.trim() === '') return 0;
    var clean = str.replace(/%/g, '').replace(',', '.').trim();
    var val = parseFloat(clean);
    if (isNaN(val)) return 0;
    // Restituisce in forma decimale se sembra una percentuale (es. "24" -> 0.24)
    return Math.abs(val) > 1 ? val / 100 : val;
  }

  function _formatDec(val) {
    if (val === null || val === undefined) return '';
    return val % 1 === 0 ? String(val) : val.toFixed(2).replace('.', ',');
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
    _apriDaRecente,
    // Fase 2
    switchDatiTab,
    toggleModalita,
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
    rimuoviDriver,
    editProfiloStagionale,
    _resetProfiloUniforme,
    _salvaProfiloStagionale,
    _handleDriverField,
    _handleCircolanteField,
    _handleFiscaleField,
    _handleFiscaleAnnoField,
    // Conti custom
    aggiungiContoCustom,
    _handleCustomLabelBlur
  };

})();
