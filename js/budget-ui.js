/**
 * budget-ui.js
 * Rendering UI per il modulo "Analisi Costi & Budget".
 *
 * Le sotto-sezioni (Importa CE, Macro-sezioni, Storico, Budget,
 * Consuntivo) sono gestite qui per non far gonfiare ulteriormente
 * ui.js. Ogni renderXxx() scrive in #content come fa UI._renderXxx().
 *
 * Dipende da: schema.js (no), engine.js (no), projects.js, budget-engine.js, ui.js (helper formattazione).
 */

'use strict';

const BudgetUI = (() => {

  /* ──────────────────────────────────────────────────────────
     Rendering scheletro — implementazioni complete negli step
     successivi (3-7).
     ────────────────────────────────────────────────────────── */

  function renderImportaCE() {
    const c = document.getElementById('content');
    if (!c) return;
    c.innerHTML = _placeholder('Importa CE', 'Caricamento file Excel multi-anno con mappatura conti → macro-sezioni.');
  }

  function renderMacroSezioni() {
    const c = document.getElementById('content');
    if (!c) return;
    c.innerHTML = _placeholder('Macro-sezioni', 'Editor delle macro-sezioni con flag variabile/fisso.');
  }

  function renderStorico() {
    const c = document.getElementById('content');
    if (!c) return;
    c.innerHTML = _placeholder('Storico & medie', 'Tabella anni × macro-sezioni con valori € e incidenze % sul fatturato.');
  }

  function renderBudget() {
    const c = document.getElementById('content');
    if (!c) return;
    c.innerHTML = _placeholder('Budget anno', 'Fatturato ipotizzato, costi attesi, risultato e fatturato di break-even.');
  }

  function renderConsuntivo() {
    const c = document.getElementById('content');
    if (!c) return;
    c.innerHTML = _placeholder('Consuntivo', 'Inserimento fatturato per periodo (mensile/trimestrale) e preconsuntivo.');
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
    renderConsuntivo:   renderConsuntivo
  };

})();
