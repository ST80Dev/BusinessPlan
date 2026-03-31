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
      <span class="header-badge header-badge-anno">${progetto.meta.anno_base}</span>
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
        <span class="header-badge header-badge-anno">Anno: ${anno}</span>
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
        html += _editableRowHtml(nodo, dati, sez, lato, depth, parentIds);
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
        html += _editableRowHtml(nodo, dati, sez, lato, depth, parentIds);
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

  function _editableRowHtml(nodo, dati, sez, lato, depth, parentIds) {
    const cls = _rowClass(depth);
    const hidden = _isHidden(parentIds) ? ' row-collapsed' : '';
    const parStr = parentIds.join(' ');
    const val = dati[nodo.id] || 0;
    const display = val !== 0 ? _formatImporto(val) : '';
    const pad = 12 + depth * 12;

    return `<tr class="${cls}${hidden}" data-node-id="${nodo.id}" data-parents="${parStr}">
      <td style="padding-left:${pad}px">${_escapeHtml(nodo.label)}</td>
      <td class="cell-amount"><div class="amount-field" contenteditable="true" data-conto-id="${nodo.id}" data-sez="${sez}" data-lato="${lato}" data-placeholder="0" onblur="UI._handleAmountBlur(this)" onkeydown="UI._handleAmountKey(event)">${display}</div></td>
    </tr>\n`;
  }

  function _computedRowHtml(nodo, dati, sez, lato, modalita, depth, parentIds) {
    const cls = _rowClass(depth);
    const hidden = _isHidden(parentIds) ? ' row-collapsed' : '';
    const isCol = _collapsed.has(nodo.id);
    const parStr = parentIds.join(' ');
    const val = Engine.calcolaValore(nodo, dati, modalita);
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
    const val = Engine.calcolaValore(nodo, dati, modalita);
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

      const val = Engine.calcolaValore(nodo, dati, modalita);
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

    const totAtt  = Engine.calcolaValore(nodoAtt, annoData.sp.attivo, modalita);
    const totPass = Engine.calcolaValore(nodoPass, annoData.sp.passivo, modalita);
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
    _handleAmountKey
  };

})();
