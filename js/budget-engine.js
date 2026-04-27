/**
 * budget-engine.js
 * Motore di calcolo del modulo "Analisi Costi & Budget".
 *
 * Calcola incidenze % medie sul fatturato dello storico CE,
 * costruisce il budget previsionale dell'anno corrente, il fatturato
 * di break-even e il preconsuntivo proporzionale a partire dal
 * fatturato realmente fatturato in corso d'anno.
 *
 * Indipendente da ui.js. Usato da budget-ui.js.
 */

'use strict';

const BudgetEngine = (() => {

  /* ──────────────────────────────────────────────────────────
     Schema macroaree CE — fisso per il modulo AB.

     Ogni voce ha:
       id        — chiave stabile usata in storico/budget/mapping
       label     — etichetta visibile
       sezione   — raggruppamento di prospetto (ricavi | variabili |
                   fissi | sotto_linea | imposte)
       tipo      — ricavo | costo
       var_fisso — variabile | fisso (rilevante solo per costi sopra
                   la linea; le voci sotto_linea/imposte non concorrono
                   al break-even)
       mastri    — codici mastro (XX) tipici del piano dei conti
                   italiano da cui i sottoconti vengono pre-mappati a
                   questa macroarea. L'utente può sempre spostare
                   manualmente sottoconti tra macroaree.

     Le righe RIM_INI / RIM_FIN non hanno un mastro proprio: il valore
     viene calcolato come Σ saldi Dare (iniziali) e Σ saldi Avere
     (finali) dei sottoconti dei mastri di variazione (61, 80).
     ────────────────────────────────────────────────────────── */
  const MACROAREE_AB = [
    { id: 'ricavi',       label: 'Ricavi',                                 sezione: 'ricavi',     tipo: 'ricavo', var_fisso: null,        mastri: ['58'] },
    { id: 'mat_prime',    label: 'Costi p/mat. prime, suss., cons., merci', sezione: 'variabili',  tipo: 'costo',  var_fisso: 'variabile', mastri: ['66'] },
    { id: 'rim_ini',      label: 'Rimanenze iniziali',                     sezione: 'variabili',  tipo: 'costo',  var_fisso: 'variabile', mastri: [], calcolato: 'rim_iniziali' },
    { id: 'rim_fin',      label: 'Rimanenze finali',                       sezione: 'variabili',  tipo: 'ricavo', var_fisso: 'variabile', mastri: [], calcolato: 'rim_finali' },
    { id: 'altri_var',    label: 'Altri costi variabili',                  sezione: 'variabili',  tipo: 'costo',  var_fisso: 'variabile', mastri: [] },
    { id: 'servizi',      label: 'Costi per servizi',                      sezione: 'fissi',      tipo: 'costo',  var_fisso: 'fisso',     mastri: ['68'] },
    { id: 'godimento',    label: 'Costi p/godimento beni di terzi',        sezione: 'fissi',      tipo: 'costo',  var_fisso: 'fisso',     mastri: ['70'] },
    { id: 'personale',    label: 'Costi per il personale',                 sezione: 'fissi',      tipo: 'costo',  var_fisso: 'fisso',     mastri: ['72'] },
    { id: 'ammortamenti', label: 'Ammortamenti',                           sezione: 'fissi',      tipo: 'costo',  var_fisso: 'fisso',     mastri: ['75'] },
    { id: 'oneri_gest',   label: 'Oneri diversi di gestione',              sezione: 'fissi',      tipo: 'costo',  var_fisso: 'fisso',     mastri: ['84'] },
    { id: 'oneri_fin',    label: 'Int. pass. e altri oneri finanz.',       sezione: 'fissi',      tipo: 'costo',  var_fisso: 'fisso',     mastri: ['88'] },
    { id: 'straordinari', label: 'Oneri straordinari',                     sezione: 'sotto_linea',tipo: 'costo',  var_fisso: null,        mastri: ['95'] },
    { id: 'altri_ric',    label: 'Altri ricavi e proventi',                sezione: 'sotto_linea',tipo: 'ricavo', var_fisso: null,        mastri: ['64'], filtro_conto: '64/05' },
    { id: 'altri_prov_f', label: 'Altri proventi finanziari',              sezione: 'sotto_linea',tipo: 'ricavo', var_fisso: null,        mastri: ['87'], includi_conto: '64/15' },
    { id: 'imposte',      label: 'Imposte sul reddito',                    sezione: 'imposte',    tipo: 'costo',  var_fisso: null,        mastri: ['96'] }
  ];

  /* ──────────────────────────────────────────────────────────
     Helper interni
     ────────────────────────────────────────────────────────── */

  function _media(arr) {
    const validi = arr.filter(v => typeof v === 'number' && isFinite(v));
    if (validi.length === 0) return 0;
    return validi.reduce((a, b) => a + b, 0) / validi.length;
  }

  function _idRicavi(macroSezioni) {
    const r = (macroSezioni || []).find(m => m.tipo === 'ricavo');
    return r ? r.id : null;
  }

  /* ──────────────────────────────────────────────────────────
     API pubblica
     ────────────────────────────────────────────────────────── */

  /**
   * Calcola, per ogni macro-sezione costo, l'incidenza % media sul
   * fatturato (ricavi) negli anni storici.
   * @param {Array}  macroSezioni - schema delle macro
   * @param {Object} storico      - { "2023": { id_macro: importo }, ... }
   * @returns {Object} { id_macro: pct_media_decimale }
   */
  function calcolaPctMedie(macroSezioni, storico) {
    const idR = _idRicavi(macroSezioni);
    if (!idR || !storico) return {};

    const anni = Object.keys(storico);
    const out = {};

    for (const macro of macroSezioni) {
      if (macro.tipo !== 'costo') continue;
      const pcts = anni.map(a => {
        const ricavi = Number(storico[a][idR]) || 0;
        const valore = Number(storico[a][macro.id]) || 0;
        return ricavi !== 0 ? valore / ricavi : null;
      });
      out[macro.id] = _media(pcts);
    }
    return out;
  }

  /**
   * Calcola, per ogni macro-sezione, la media del valore € negli
   * anni storici (utile per i costi fissi).
   * @param {Array}  macroSezioni
   * @param {Object} storico
   * @returns {Object} { id_macro: media_euro }
   */
  function calcolaMedieEuro(macroSezioni, storico) {
    if (!storico) return {};
    const anni = Object.keys(storico);
    const out = {};
    for (const macro of macroSezioni) {
      const valori = anni.map(a => Number(storico[a][macro.id]) || 0);
      out[macro.id] = _media(valori);
    }
    return out;
  }

  /**
   * Costruisce il budget previsionale dell'anno corrente.
   *
   * Per ogni macro:
   *   - se variabile: costo = (override_pct ?? pct_media) * fatturato_ipotizzato
   *   - se fisso:     costo = override_fisso ?? media_euro
   *
   * @param {Object} progetto - progetto AB
   * @returns {{
   *   fatturato: number,
   *   righe: Array<{id, label, var_fisso, pct, costo}>,
   *   tot_variabili: number,
   *   tot_fissi: number,
   *   risultato: number,
   *   break_even: number|null
   * }}
   */
  function calcolaBudget(progetto) {
    const macro = progetto.macro_sezioni || [];
    const storico = progetto.storico || {};
    const budget  = progetto.budget   || {};

    const pctMedie  = calcolaPctMedie(macro, storico);
    const medieEuro = calcolaMedieEuro(macro, storico);

    const fatturato = Number(budget.fatturato_ipotizzato) || medieEuro[_idRicavi(macro)] || 0;

    const righe = [];
    let totVar = 0;
    let totFis = 0;
    let sommaPctVar = 0;

    for (const m of macro) {
      if (m.tipo !== 'costo') continue;

      if (m.var_fisso === 'variabile') {
        const ovr = budget.override_pct ? budget.override_pct[m.id] : null;
        const pct = (typeof ovr === 'number') ? ovr : (pctMedie[m.id] || 0);
        const costo = pct * fatturato;
        righe.push({ id: m.id, label: m.label, var_fisso: 'variabile', pct: pct, costo: costo });
        totVar += costo;
        sommaPctVar += pct;
      } else {
        const ovr = budget.override_fissi ? budget.override_fissi[m.id] : null;
        const costo = (typeof ovr === 'number') ? ovr : (medieEuro[m.id] || 0);
        righe.push({ id: m.id, label: m.label, var_fisso: 'fisso', pct: null, costo: costo });
        totFis += costo;
      }
    }

    const risultato = fatturato - totVar - totFis;
    const denom = 1 - sommaPctVar;
    const breakEven = (denom > 0) ? (totFis / denom) : null;

    return {
      fatturato:     fatturato,
      righe:         righe,
      tot_variabili: totVar,
      tot_fissi:     totFis,
      risultato:     risultato,
      break_even:    breakEven
    };
  }

  /**
   * Preconsuntivo: dato il fatturato realmente realizzato in N periodi
   * (mesi o trimestri) dell'anno corrente, applica le % variabili al
   * fatturato consuntivato e ratei dei fissi pro-rata temporis.
   *
   * @param {Object} progetto
   * @returns {{
   *   periodi_chiusi: number,
   *   frazione_anno: number,
   *   fatturato_consuntivo: number,
   *   righe: Array<{id, label, var_fisso, pct, costo}>,
   *   tot_variabili: number,
   *   tot_fissi: number,
   *   risultato: number
   * }}
   */
  function calcolaPreconsuntivo(progetto) {
    const macro = progetto.macro_sezioni || [];
    const consuntivo = progetto.consuntivo || { frequenza: 'mensile', fatturato: {} };
    const budget = calcolaBudget(progetto);

    const periodiTotali = consuntivo.frequenza === 'trimestrale' ? 4 : 12;
    const valori = consuntivo.fatturato || {};
    const periodiChiusi = Object.keys(valori).filter(k => typeof valori[k] === 'number' && isFinite(valori[k])).length;
    const fattReale = Object.values(valori).reduce((s, v) => s + (Number(v) || 0), 0);
    const frazione = periodiTotali > 0 ? periodiChiusi / periodiTotali : 0;

    const pctMedie = calcolaPctMedie(macro, progetto.storico || {});
    const medieEur = calcolaMedieEuro(macro, progetto.storico || {});

    const righe = [];
    let totVar = 0, totFis = 0;

    for (const m of macro) {
      if (m.tipo !== 'costo') continue;

      if (m.var_fisso === 'variabile') {
        const ovr = (progetto.budget && progetto.budget.override_pct) ? progetto.budget.override_pct[m.id] : null;
        const pct = (typeof ovr === 'number') ? ovr : (pctMedie[m.id] || 0);
        const costo = pct * fattReale;
        righe.push({ id: m.id, label: m.label, var_fisso: 'variabile', pct: pct, costo: costo });
        totVar += costo;
      } else {
        const annuo = budget.righe.find(r => r.id === m.id);
        const costoAnnuo = annuo ? annuo.costo : (medieEur[m.id] || 0);
        const costo = costoAnnuo * frazione;
        righe.push({ id: m.id, label: m.label, var_fisso: 'fisso', pct: null, costo: costo });
        totFis += costo;
      }
    }

    return {
      periodi_chiusi:        periodiChiusi,
      frazione_anno:         frazione,
      fatturato_consuntivo:  fattReale,
      righe:                 righe,
      tot_variabili:         totVar,
      tot_fissi:             totFis,
      risultato:             fattReale - totVar - totFis
    };
  }

  return {
    MACROAREE_AB:       MACROAREE_AB,
    calcolaPctMedie:    calcolaPctMedie,
    calcolaMedieEuro:   calcolaMedieEuro,
    calcolaBudget:      calcolaBudget,
    calcolaPreconsuntivo: calcolaPreconsuntivo
  };

})();
