/**
 * ui.js
 * Rendering interfaccia, navigazione, eventi UI.
 *
 * Fase 1: shell applicazione — home con lista progetti, sidebar,
 *         header, footer, modali, drag & drop, beforeunload.
 *
 * Dipende da: schema.js, engine.js, projects.js
 */

'use strict';

const UI = (() => {

  /* ──────────────────────────────────────────────────────────
     Stato UI
     ────────────────────────────────────────────────────────── */

  let _sezioneCorrente = 'home';

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
    _apriDaRecente
  };

})();
