/**
 * imposte/ui.js
 * Rendering UI per il modulo "Calcolo Imposte" (IRES/IRAP/CPB).
 *
 * Le sotto-sezioni (Anagrafica, CE, Variazioni, ROL, Perdite/ACE, CPB,
 * IRAP, IRAP da IRES, Storico, Riepilogo) sono gestite qui per non far
 * gonfiare js/core/ui.js. Ogni renderXxx() scrive in #content.
 *
 * Dipende da: projects.js, imposte/engine.js, imposte/schema.js,
 * imposte/regole-loader.js, ui.js (helper notifica/status).
 *
 * Stato (PR #7): implementate le 3 sezioni di pure input — Anagrafica,
 * Conto economico, Storico. Le altre sezioni continuano a usare il
 * placeholder della shell e saranno completate nelle PR successive.
 */
'use strict';

const ImposteUI = (() => {

  /* ──────────────────────────────────────────────────────────
     Helper di formato e parsing
     ────────────────────────────────────────────────────────── */

  function _fmtEuro(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
  }

  function _fmtEuroInt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return Math.round(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: 'always' });
  }

  function _escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  /** Parse di un importo da contenteditable: accetta separatore migliaia "." e decimali "," */
  function _parseEuro(s) {
    if (s == null) return 0;
    const clean = String(s).replace(/[€\s.]/g, '').replace(',', '.').trim();
    if (clean === '' || clean === '-') return 0;
    const n = parseFloat(clean);
    return isFinite(n) ? n : 0;
  }

  /** Parse di un intero (anno, n. dipendenti, …). */
  function _parseInt(s) {
    if (s == null) return 0;
    const clean = String(s).replace(/\s/g, '').trim();
    if (clean === '' || clean === '-') return 0;
    const n = parseInt(clean, 10);
    return isFinite(n) ? n : 0;
  }

  /* ──────────────────────────────────────────────────────────
     Salvataggio: aggiorna il progetto e segnala modifica
     ────────────────────────────────────────────────────────── */

  /** Imposta una proprietà su un sotto-oggetto del progetto; segna modificato. */
  function _setProgettoValue(path, value) {
    const p = Projects.getProgetto();
    if (!p) return;
    const parts = path.split('.');
    let obj = p;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (obj[k] == null || typeof obj[k] !== 'object') obj[k] = {};
      obj = obj[k];
    }
    obj[parts[parts.length - 1]] = value;
    Projects.segnaModificato();
  }

  /** Onblur per campo numerico (Euro): commit e re-render del valore formattato. */
  function onBlurEuro(el) {
    if (!el) return;
    const path = el.dataset.path;
    if (!path) return;
    const n = _parseEuro(el.textContent);
    _setProgettoValue(path, n);
    el.textContent = _fmtEuro(n);
  }

  /** Onblur per campo intero (anno, n. dipendenti). */
  function onBlurInt(el) {
    if (!el) return;
    const path = el.dataset.path;
    if (!path) return;
    const n = _parseInt(el.textContent);
    _setProgettoValue(path, n);
    el.textContent = String(n || '');
  }

  /** Onblur per campo testo libero. */
  function onBlurText(el) {
    if (!el) return;
    const path = el.dataset.path;
    if (!path) return;
    _setProgettoValue(path, (el.textContent || '').trim());
  }

  /** Toggle "pill" per flag booleani. */
  function togglePill(el, path, value) {
    if (!el) return;
    _setProgettoValue(path, value);
    // Aggiorna stato visivo dei fratelli
    const wrap = el.parentElement;
    if (wrap) {
      wrap.querySelectorAll('.imp-pill').forEach(p => p.classList.toggle('active', p === el));
    }
  }

  /** Auto-select del contenuto quando si entra in un campo editabile. */
  function _autoSelect(el) {
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* ──────────────────────────────────────────────────────────
     Componenti UI riusabili
     ────────────────────────────────────────────────────────── */

  /** Riga "label: campo testo" editabile, salva su path. */
  function _campoTesto(label, path, value, hint) {
    return `
      <div class="imp-form-group">
        <span class="imp-form-label">${_escapeHtml(label)}</span>
        <div class="imp-form-field" contenteditable="true" spellcheck="false"
             data-path="${_escapeHtml(path)}"
             onblur="ImposteUI.onBlurText(this)"
             onfocus="ImposteUI._autoSelect(this)">${_escapeHtml(value || '')}</div>
        ${hint ? `<div class="imp-form-hint">${_escapeHtml(hint)}</div>` : ''}
      </div>
    `;
  }

  /** Riga "label: campo intero". */
  function _campoIntero(label, path, value, hint) {
    return `
      <div class="imp-form-group">
        <span class="imp-form-label">${_escapeHtml(label)}</span>
        <div class="imp-form-field imp-form-num" contenteditable="true" spellcheck="false"
             data-path="${_escapeHtml(path)}"
             onblur="ImposteUI.onBlurInt(this)"
             onfocus="ImposteUI._autoSelect(this)">${value ? _escapeHtml(String(value)) : ''}</div>
        ${hint ? `<div class="imp-form-hint">${_escapeHtml(hint)}</div>` : ''}
      </div>
    `;
  }

  /** Riga "label: campo importo". */
  function _campoEuro(label, path, value, hint) {
    return `
      <div class="imp-form-group">
        <span class="imp-form-label">${_escapeHtml(label)}</span>
        <div class="imp-form-field imp-form-num" contenteditable="true" spellcheck="false"
             data-path="${_escapeHtml(path)}"
             onblur="ImposteUI.onBlurEuro(this)"
             onfocus="ImposteUI._autoSelect(this)">${_fmtEuro(Number(value) || 0)}</div>
        ${hint ? `<div class="imp-form-hint">${_escapeHtml(hint)}</div>` : ''}
      </div>
    `;
  }

  /** Coppia di pill SI/NO per un flag booleano. */
  function _flagPill(label, path, value, hint) {
    const yes = !!value;
    return `
      <div class="imp-form-group">
        <span class="imp-form-label">${_escapeHtml(label)}</span>
        <div class="imp-pill-group">
          <div class="imp-pill ${yes ? 'active' : ''}" onclick="ImposteUI.togglePill(this, '${_escapeHtml(path)}', true)">SI</div>
          <div class="imp-pill ${!yes ? 'active' : ''}" onclick="ImposteUI.togglePill(this, '${_escapeHtml(path)}', false)">NO</div>
        </div>
        ${hint ? `<div class="imp-form-hint">${_escapeHtml(hint)}</div>` : ''}
      </div>
    `;
  }

  /** Pill multi-opzione (per stringhe come data_versamento_saldo). */
  function _enumPill(label, path, value, options, hint) {
    const optsHtml = options.map(o => {
      const active = (o.value === value) ? 'active' : '';
      return `<div class="imp-pill ${active}" onclick="ImposteUI.togglePill(this, '${_escapeHtml(path)}', '${_escapeHtml(o.value)}')">${_escapeHtml(o.label)}</div>`;
    }).join('');
    return `
      <div class="imp-form-group">
        <span class="imp-form-label">${_escapeHtml(label)}</span>
        <div class="imp-pill-group">${optsHtml}</div>
        ${hint ? `<div class="imp-form-hint">${_escapeHtml(hint)}</div>` : ''}
      </div>
    `;
  }

  /* ──────────────────────────────────────────────────────────
     ANAGRAFICA E FLAG
     ────────────────────────────────────────────────────────── */

  function renderAnagrafica() {
    const c = document.getElementById('content');
    if (!c) return;
    const p = Projects.getProgetto();
    if (!p) { c.innerHTML = ''; return; }

    const meta = p.meta || {};
    const flag = p.flag || {};

    const html = `
      <div class="imp-page">

        <div class="imp-card">
          <div class="imp-card-title">Dati anagrafici</div>
          <div class="imp-grid-2col">
            ${_campoTesto('Ragione sociale', 'meta.cliente', meta.cliente, 'Compare nell\'header e nel nome del file di progetto.')}
            ${_campoTesto('Partita IVA', 'meta.p_iva', meta.p_iva)}
            ${_campoTesto('Codice ATECO', 'meta.ateco', meta.ateco)}
            ${_campoTesto('Regione (sede legale)', 'meta.regione', meta.regione, 'Determina l\'aliquota IRAP regionale (Marche 4,73% / Emilia-Romagna 3,90% / DEFAULT).')}
            ${_campoIntero('Anno d\'imposta', 'meta.anno_imposta', meta.anno_imposta)}
            ${_campoTesto('Data costituzione', 'meta.data_costituzione', meta.data_costituzione, 'Formato YYYY-MM-DD. Le perdite dei primi 3 esercizi sono "piene" (utilizzo 100%).')}
          </div>
        </div>

        <div class="imp-card">
          <div class="imp-card-title">Flag di scenario</div>
          <div class="imp-grid-2col">
            ${_flagPill('Società trasparente (art. 115 TUIR)', 'flag.societa_trasparente', flag.societa_trasparente,
              'Se SI: l\'IRES è in capo ai soci; la società mantiene il calcolo dell\'imponibile ma non versa IRES.')}
            ${_flagPill('Concordato Preventivo Biennale (CPB)', 'flag.cpb_attivo', flag.cpb_attivo,
              'Se SI: l\'imponibile IRES e IRAP è forzato al reddito/VP concordato rettificato (D.Lgs. 13/2024).')}
            ${_flagPill('Soggetto ISA', 'flag.soggetto_isa', flag.soggetto_isa,
              'Se SI: split acconti 50/50; se NO: 40/60.')}
            ${_campoEuro('Punteggio ISA (1-10)', 'flag.punteggio_isa', flag.punteggio_isa,
              'Necessario solo se CPB attivo e si opta per l\'imposta sostitutiva: ≥8→10%, 6-8→12%, <6→15%.')}
          </div>
          <div class="imp-form-group">
            ${_enumPill('Termine versamento saldo', 'flag.data_versamento_saldo', flag.data_versamento_saldo || '30_giugno', [
              { value: '30_giugno', label: '30 giugno' },
              { value: '30_luglio_con_maggiorazione', label: '30 luglio (+0,40%)' }
            ], 'L\'opzione "30 luglio" applica una maggiorazione dello 0,40% al saldo + I acconto.')}
          </div>
        </div>

      </div>
    `;
    c.innerHTML = html;
  }

  /* ──────────────────────────────────────────────────────────
     STORICO (riporti pluriennali)
     ────────────────────────────────────────────────────────── */

  /** Aggiunge una riga vuota a un array dello storico e re-renderizza. */
  function aggiungiRigaStorico(tipo) {
    const p = Projects.getProgetto();
    if (!p) return;
    p.storico = p.storico || {};
    const annoCorr = (p.meta && p.meta.anno_imposta) || new Date().getFullYear();
    switch (tipo) {
      case 'plus':
        (p.storico.plusvalenze_rateizzate = p.storico.plusvalenze_rateizzate || [])
          .push({ anno_realizzo: annoCorr - 1, importo: 0, rate: 5, imputate: [] });
        break;
      case 'manut':
        (p.storico.manutenzioni_eccedenti_5pct = p.storico.manutenzioni_eccedenti_5pct || [])
          .push({ anno: annoCorr - 1, importo: 0 });
        break;
      case 'piene':
        (p.storico.perdite_piene = p.storico.perdite_piene || [])
          .push({ anno: annoCorr - 1, importo: 0 });
        break;
      case 'limitate':
        (p.storico.perdite_limitate = p.storico.perdite_limitate || [])
          .push({ anno: annoCorr - 1, importo: 0 });
        break;
    }
    Projects.segnaModificato();
    renderStorico();
  }

  /** Rimuove la riga `idx` dall'array dello storico identificato da `tipo`. */
  function rimuoviRigaStorico(tipo, idx) {
    const p = Projects.getProgetto();
    if (!p || !p.storico) return;
    const map = {
      plus: 'plusvalenze_rateizzate',
      manut: 'manutenzioni_eccedenti_5pct',
      piene: 'perdite_piene',
      limitate: 'perdite_limitate'
    };
    const key = map[tipo];
    if (!key || !Array.isArray(p.storico[key])) return;
    p.storico[key].splice(idx, 1);
    Projects.segnaModificato();
    renderStorico();
  }

  function _renderTabellaPlusvalenze(plus) {
    const annoCorr = (Projects.getProgetto().meta || {}).anno_imposta || 0;
    let righe = '';
    (plus || []).forEach((p, i) => {
      const ultimoAnno = (Number(p.anno_realizzo) || 0) + (Number(p.rate) || 5) - 1;
      const stato = (annoCorr > ultimoAnno) ? 'esaurita' : 'attiva';
      const imputateLen = Array.isArray(p.imputate) ? p.imputate.length : 0;
      righe += `
        <tr>
          <td><div class="imp-form-field imp-form-num" contenteditable="true" spellcheck="false"
                  data-path="storico.plusvalenze_rateizzate.${i}.anno_realizzo"
                  onblur="ImposteUI.onBlurInt(this)" onfocus="ImposteUI._autoSelect(this)">${_escapeHtml(String(p.anno_realizzo || ''))}</div></td>
          <td><div class="imp-form-field imp-form-num" contenteditable="true" spellcheck="false"
                  data-path="storico.plusvalenze_rateizzate.${i}.importo"
                  onblur="ImposteUI.onBlurEuro(this)" onfocus="ImposteUI._autoSelect(this)">${_fmtEuro(Number(p.importo) || 0)}</div></td>
          <td><div class="imp-form-field imp-form-num" contenteditable="true" spellcheck="false"
                  data-path="storico.plusvalenze_rateizzate.${i}.rate"
                  onblur="ImposteUI.onBlurInt(this)" onfocus="ImposteUI._autoSelect(this)">${_escapeHtml(String(p.rate || 5))}</div></td>
          <td class="imp-form-num">${imputateLen} / ${p.rate || 5}</td>
          <td><span class="imp-tag imp-tag-${stato}">${stato}</span></td>
          <td><div class="imp-icon-btn" onclick="ImposteUI.rimuoviRigaStorico('plus', ${i})" title="Rimuovi">✕</div></td>
        </tr>
      `;
    });
    return `
      <table class="imp-table">
        <thead>
          <tr>
            <th>Anno realizzo</th>
            <th>Importo plus</th>
            <th>N. rate</th>
            <th>Quote imputate</th>
            <th>Stato</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${righe || '<tr><td colspan="6" class="imp-table-empty">Nessuna plusvalenza rateizzata.</td></tr>'}</tbody>
      </table>
      <div class="imp-actions">
        <div class="btn btn-secondary btn-sm" onclick="ImposteUI.aggiungiRigaStorico('plus')">+ Aggiungi plusvalenza</div>
      </div>
    `;
  }

  function _renderTabellaManutenzioni(manut) {
    const annoCorr = (Projects.getProgetto().meta || {}).anno_imposta || 0;
    let righe = '';
    (manut || []).forEach((m, i) => {
      const ultimoAnno = (Number(m.anno) || 0) + 5;
      const stato = (annoCorr > ultimoAnno) ? 'esaurita' : 'attiva';
      righe += `
        <tr>
          <td><div class="imp-form-field imp-form-num" contenteditable="true" spellcheck="false"
                  data-path="storico.manutenzioni_eccedenti_5pct.${i}.anno"
                  onblur="ImposteUI.onBlurInt(this)" onfocus="ImposteUI._autoSelect(this)">${_escapeHtml(String(m.anno || ''))}</div></td>
          <td><div class="imp-form-field imp-form-num" contenteditable="true" spellcheck="false"
                  data-path="storico.manutenzioni_eccedenti_5pct.${i}.importo"
                  onblur="ImposteUI.onBlurEuro(this)" onfocus="ImposteUI._autoSelect(this)">${_fmtEuro(Number(m.importo) || 0)}</div></td>
          <td class="imp-form-num">${_fmtEuro((Number(m.importo) || 0) / 5)}</td>
          <td><span class="imp-tag imp-tag-${stato}">${stato}</span></td>
          <td><div class="imp-icon-btn" onclick="ImposteUI.rimuoviRigaStorico('manut', ${i})" title="Rimuovi">✕</div></td>
        </tr>
      `;
    });
    return `
      <table class="imp-table">
        <thead>
          <tr>
            <th>Anno formazione</th>
            <th>Eccedenza totale</th>
            <th>Quota annua (1/5)</th>
            <th>Stato</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${righe || '<tr><td colspan="5" class="imp-table-empty">Nessuna manutenzione eccedente in riporto.</td></tr>'}</tbody>
      </table>
      <div class="imp-actions">
        <div class="btn btn-secondary btn-sm" onclick="ImposteUI.aggiungiRigaStorico('manut')">+ Aggiungi eccedenza</div>
      </div>
    `;
  }

  function _renderTabellaPerdite(arr, tipo, label) {
    let righe = '';
    (arr || []).forEach((p, i) => {
      righe += `
        <tr>
          <td><div class="imp-form-field imp-form-num" contenteditable="true" spellcheck="false"
                  data-path="storico.perdite_${tipo}.${i}.anno"
                  onblur="ImposteUI.onBlurInt(this)" onfocus="ImposteUI._autoSelect(this)">${_escapeHtml(String(p.anno || ''))}</div></td>
          <td><div class="imp-form-field imp-form-num" contenteditable="true" spellcheck="false"
                  data-path="storico.perdite_${tipo}.${i}.importo"
                  onblur="ImposteUI.onBlurEuro(this)" onfocus="ImposteUI._autoSelect(this)">${_fmtEuro(Number(p.importo) || 0)}</div></td>
          <td><div class="imp-icon-btn" onclick="ImposteUI.rimuoviRigaStorico('${tipo}', ${i})" title="Rimuovi">✕</div></td>
        </tr>
      `;
    });
    return `
      <table class="imp-table">
        <thead>
          <tr>
            <th>Anno formazione</th>
            <th>Importo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${righe || `<tr><td colspan="3" class="imp-table-empty">Nessuna perdita ${label}.</td></tr>`}</tbody>
      </table>
      <div class="imp-actions">
        <div class="btn btn-secondary btn-sm" onclick="ImposteUI.aggiungiRigaStorico('${tipo}')">+ Aggiungi perdita</div>
      </div>
    `;
  }

  function renderStorico() {
    const c = document.getElementById('content');
    if (!c) return;
    const p = Projects.getProgetto();
    if (!p) { c.innerHTML = ''; return; }

    const s = p.storico || {};
    const totPiene = (s.perdite_piene || []).reduce((a, x) => a + (Number(x.importo) || 0), 0);
    const totLimitate = (s.perdite_limitate || []).reduce((a, x) => a + (Number(x.importo) || 0), 0);

    const html = `
      <div class="imp-page">

        <div class="imp-card">
          <div class="imp-card-title">Plusvalenze patrimoniali rateizzate (art. 86 c. 4 TUIR)</div>
          <div class="imp-form-hint" style="margin-bottom:8px">
            Per ogni plusvalenza realizzata: anno di realizzo, importo totale e numero di rate (max 5).
            Le quote degli anni precedenti maturano automaticamente in RF34, quelle dell'anno
            corrente in RF7. La colonna "Quote imputate" è gestita dalla funzione "Chiudi anno".
          </div>
          ${_renderTabellaPlusvalenze(s.plusvalenze_rateizzate)}
        </div>

        <div class="imp-card">
          <div class="imp-card-title">Spese di manutenzione eccedenti 5% (art. 102 c. 6 TUIR)</div>
          <div class="imp-form-hint" style="margin-bottom:8px">
            Per ogni anno di formazione: importo dell'eccedenza rispetto al 5% del costo dei beni
            ammortizzabili. La quota dell'1/5 viene dedotta nei 5 esercizi successivi (RF55 cod.6).
          </div>
          ${_renderTabellaManutenzioni(s.manutenzioni_eccedenti_5pct)}
        </div>

        <div class="imp-card">
          <div class="imp-card-title">Perdite fiscali pregresse (art. 84 TUIR)</div>
          <div class="imp-grid-2col" style="margin-top:8px">
            <div>
              <div class="imp-subtitle">Perdite piene (utilizzo 100%)</div>
              <div class="imp-form-hint" style="margin-bottom:6px">
                Generate nei primi 3 esercizi dalla costituzione. Totale: ${_fmtEuro(totPiene)} €
              </div>
              ${_renderTabellaPerdite(s.perdite_piene, 'piene', 'piena')}
            </div>
            <div>
              <div class="imp-subtitle">Perdite limitate (cap 80%)</div>
              <div class="imp-form-hint" style="margin-bottom:6px">
                Utilizzabili al massimo all'80% del reddito imponibile. Totale: ${_fmtEuro(totLimitate)} €
              </div>
              ${_renderTabellaPerdite(s.perdite_limitate, 'limitate', 'limitata')}
            </div>
          </div>
        </div>

        <div class="imp-card">
          <div class="imp-card-title">Riporti scalari</div>
          <div class="imp-grid-2col">
            ${_campoEuro('Eccedenza ACE residua (RS113 col.14)', 'storico.ace_residua', s.ace_residua,
              'L\'ACE corrente è abrogata dal 2024 (D.Lgs. 216/2023): qui solo l\'eccedenza maturata in passato.')}
            ${_campoEuro('Interessi passivi indeducibili riportati (RF121 col.3)', 'storico.interessi_passivi_riporto', s.interessi_passivi_riporto,
              'Riporto a nuovo dell\'eccedenza di interessi passivi non dedotta in es. precedenti.')}
            ${_campoEuro('Eccedenza ROL riportata (RF120 col.3)', 'storico.rol_riporto', s.rol_riporto,
              'Capacità ROL non utilizzata in es. precedenti, riportabile a nuovo.')}
            ${_campoEuro('Credito IRES anno precedente residuo', 'storico.credito_ires_residuo', s.credito_ires_residuo,
              'Solo la quota non chiesta a rimborso e non già compensata in F24.')}
            ${_campoEuro('Credito IRAP anno precedente residuo', 'storico.credito_irap_residuo', s.credito_irap_residuo)}
          </div>
        </div>

      </div>
    `;
    c.innerHTML = html;
  }

  /* ──────────────────────────────────────────────────────────
     CONTO ECONOMICO (input)
     ────────────────────────────────────────────────────────── */

  function renderContoEconomico() {
    const c = document.getElementById('content');
    if (!c) return;
    const p = Projects.getProgetto();
    if (!p) { c.innerHTML = ''; return; }

    const ce = p.ce || {};

    // Preview live della base IRAP lorda calcolata dal motore
    const baseIrap = ImposteEngine._internal.calcolaBaseIrapLorda(ce);

    const html = `
      <div class="imp-page">

        <div class="imp-card">
          <div class="imp-card-title">Risultato civilistico</div>
          <div class="imp-grid-2col">
            ${_campoEuro('Risultato ante imposte', 'ce.risultato_ante_imposte', ce.risultato_ante_imposte,
              'Utile o perdita prima delle imposte (se in perdita inserire valore negativo).')}
            ${_campoEuro('Saldo C) Proventi e oneri finanziari', 'ce.C_saldo', ce.C_saldo,
              'Somma algebrica voci C16-C17 di bilancio. Se negativo, attiva la deduzione forfetaria 10% IRAP da IRES.')}
          </div>
        </div>

        <div class="imp-card">
          <div class="imp-card-title">Voci di Conto economico (per base IRAP)</div>
          <div class="imp-form-hint" style="margin-bottom:12px">
            Base IRAP = A) − (B) escluse B9, B10c, B10d, B12, B13 (art. 5 D.Lgs. 446/1997).
            Le voci escluse sono recuperate come deduzioni cuneo o forfait nella sezione IRAP.
          </div>
          <div class="imp-grid-2col">
            ${_campoEuro('A) Valore della produzione (totale)', 'ce.A_totale', ce.A_totale)}
            ${_campoEuro('B) Costi della produzione (totale)', 'ce.B_totale', ce.B_totale)}
            ${_campoEuro('B9) Costi del personale', 'ce.B9', ce.B9, 'Esclusi dalla base IRAP; recuperati come deduzione cuneo c. 4-octies.')}
            ${_campoEuro('B10c) Svalutazione immobilizzazioni', 'ce.B10c', ce.B10c)}
            ${_campoEuro('B10d) Svalutazione crediti circolante', 'ce.B10d', ce.B10d)}
            ${_campoEuro('B12) Accantonamenti per rischi', 'ce.B12', ce.B12)}
            ${_campoEuro('B13) Altri accantonamenti', 'ce.B13', ce.B13)}
          </div>
        </div>

        <div class="imp-card imp-preview">
          <div class="imp-card-title">Preview base IRAP (calcolo automatico)</div>
          <div class="imp-preview-row">
            <span class="imp-preview-label">A − (B − B9 − B10c − B10d − B12 − B13)</span>
            <span class="imp-preview-value imp-form-num">${_fmtEuro(baseIrap)} €</span>
          </div>
          <div class="imp-form-hint">
            Per aggiornare la preview, lascia il campo (blur). Il calcolo definitivo si vedrà
            nella sezione "IRAP" e nel "Riepilogo".
          </div>
        </div>

      </div>
    `;
    c.innerHTML = html;
  }

  /* ──────────────────────────────────────────────────────────
     API pubblica
     ────────────────────────────────────────────────────────── */

  return {
    // Renderers
    renderAnagrafica:     renderAnagrafica,
    renderContoEconomico: renderContoEconomico,
    renderStorico:        renderStorico,
    // Handler chiamati da onblur/onclick inline
    onBlurEuro:           onBlurEuro,
    onBlurInt:            onBlurInt,
    onBlurText:           onBlurText,
    togglePill:           togglePill,
    aggiungiRigaStorico:  aggiungiRigaStorico,
    rimuoviRigaStorico:   rimuoviRigaStorico,
    // Helper esposto per onfocus
    _autoSelect:          _autoSelect
  };

})();
