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
   * Costruisce il budget previsionale dell'anno corrente sullo
   * schema fisso AB. Per ogni macroarea:
   *
   *   ricavi:         valore = override fatturato_ipotizzato OR media €
   *   variabili pure (mat_prime, altri_var):
   *                    valore = (override_pct OR pct_media) × fatturato
   *   variabili calcolate (rim_ini, rim_fin):
   *                    valore = override_fissi[id] OR media €
   *                    (le rimanenze in budget sono trattate come €
   *                    perché non scalano linearmente col fatturato)
   *   fissi, sotto_linea e imposte:
   *                    valore = override_fissi[id] OR ultimo_anno
   *                             arrotondato al centinaio
   *                    (default ancorato al consuntivo più recente,
   *                    per allinearsi ai costi di gestione attuali)
   *
   * Calcola tutti i derivati del prospetto (CdV, MdC, Tot costi,
   * Utile ante imposte, Utile netto) e il fatturato di break-even
   * operativo:
   *
   *   F_be = (rim_ini − rim_fin + Σ fissi) / (1 − Σ pct_var)
   *
   * Le voci sotto la linea e le imposte non concorrono al BE
   * operativo per definizione classica.
   *
   * @param {Object} progetto - progetto AB
   * @returns {Object} prospetto budget completo
   */
  function calcolaBudget(progetto) {
    const macro   = progetto.macro_sezioni || [];
    const storico = progetto.storico || {};
    const budget  = progetto.budget   || {};
    const anni    = (progetto.meta && progetto.meta.anni_storici) || Object.keys(storico).map(Number);
    const ovrPct  = budget.override_pct   || {};
    const ovrEur  = budget.override_fissi || {};

    // Medie storiche per macroarea (€ e % sul fatturato)
    const medieEuro = {};
    macro.forEach(m => {
      const valori = anni.map(a => Number((storico[a] || {})[m.id]) || 0);
      medieEuro[m.id] = valori.length > 0 ? valori.reduce((s, v) => s + v, 0) / valori.length : 0;
    });

    const fatturatoStoricoMedio = medieEuro['ricavi'] || 0;
    const mediePct = {};
    macro.forEach(m => {
      const validi = anni
        .map(a => ({ ric: Number((storico[a] || {}).ricavi) || 0, val: Number((storico[a] || {})[m.id]) || 0 }))
        .filter(x => x.ric > 0);
      mediePct[m.id] = validi.length > 0
        ? validi.reduce((s, x) => s + x.val / x.ric, 0) / validi.length
        : 0;
    });

    // Base "ultimo anno arrotondata al centinaio": per i costi fissi e
    // le altre voci non variabili il budget teorico parte dall'ultima
    // annualità storica anziché dalla media triennale, per allinearsi
    // ai costi di gestione più recenti. L'arrotondamento al centinaio
    // dà un valore tondo come default da rifinire poi via override.
    const ultimoAnno = anni.length > 0 ? Math.max.apply(null, anni) : null;
    const ultimoAnnoEuro = {};
    macro.forEach(m => {
      const v = ultimoAnno != null ? Number((storico[ultimoAnno] || {})[m.id]) || 0 : 0;
      ultimoAnnoEuro[m.id] = Math.round(v / 100) * 100;
    });

    // Fatturato budget
    const fatturatoOvr = Number(budget.fatturato_ipotizzato);
    const fatturato = (isFinite(fatturatoOvr) && fatturatoOvr > 0) ? fatturatoOvr : fatturatoStoricoMedio;

    // Calcolo per ogni macroarea
    const valori = {};
    let sommaPctVar = 0;

    for (const m of macro) {
      if (m.id === 'ricavi') {
        valori[m.id] = {
          valore: fatturato,
          pct: 1,
          fonte_pct: null,
          fonte: (isFinite(fatturatoOvr) && fatturatoOvr > 0) ? 'override' : 'storico',
          media_euro: medieEuro[m.id],
          media_pct:  mediePct[m.id],
          ultimo_anno_euro: ultimoAnnoEuro[m.id],
          base_default: medieEuro[m.id]
        };
        continue;
      }

      // Variabili pure (no calcolato): % override o % media × fatturato
      if (m.var_fisso === 'variabile' && !m.calcolato) {
        const pctOvr = ovrPct[m.id];
        const pct    = (typeof pctOvr === 'number' && isFinite(pctOvr)) ? pctOvr : (mediePct[m.id] || 0);
        const valore = pct * fatturato;
        valori[m.id] = {
          valore,
          pct,
          fonte_pct: 'pct',
          fonte: (typeof pctOvr === 'number' && isFinite(pctOvr)) ? 'override' : 'storico',
          media_euro: medieEuro[m.id],
          media_pct:  mediePct[m.id],
          ultimo_anno_euro: ultimoAnnoEuro[m.id],
          base_default: pct * fatturato  // base = % media × fatturato
        };
        // sommaPctVar: i costi variabili contribuiscono +pct,
        // i ricavi variabili (rim_fin sarebbe stato qui ma è calcolato)
        // contribuiscono -pct.
        if (m.tipo === 'costo') sommaPctVar += pct;
        else                    sommaPctVar -= pct;
        continue;
      }

      // Calcolato (rim_ini/rim_fin): € override o media €
      // Tutto il resto (fissi, sotto_linea, imposte): € override o ultimo
      // anno arrotondato al centinaio — vedi commento su ultimoAnnoEuro.
      const eurOvr = ovrEur[m.id];
      const baseDefault = m.calcolato ? (medieEuro[m.id] || 0) : ultimoAnnoEuro[m.id];
      const valore = (typeof eurOvr === 'number' && isFinite(eurOvr)) ? eurOvr : baseDefault;
      valori[m.id] = {
        valore,
        pct: fatturato > 0 ? valore / fatturato : 0,
        fonte_pct: 'euro',
        fonte: (typeof eurOvr === 'number' && isFinite(eurOvr)) ? 'override' : 'storico',
        media_euro: medieEuro[m.id],
        media_pct:  mediePct[m.id],
        ultimo_anno_euro: ultimoAnnoEuro[m.id],
        base_default: baseDefault
      };
    }

    // Derivati del prospetto
    const v = id => (valori[id] && valori[id].valore) || 0;
    const cdv     = v('mat_prime') + v('altri_var') + v('rim_ini') - v('rim_fin');
    const totVar  = cdv;
    const mdc     = fatturato - totVar;
    const fissi   = ['servizi','godimento','personale','ammortamenti','oneri_gest','oneri_fin']
                      .reduce((s, k) => s + v(k), 0);
    const totCosti = totVar + fissi;
    const sottoLineaNetto = v('altri_ric') + v('altri_prov_f') - v('straordinari');
    const utileAnteImposte = mdc - fissi + sottoLineaNetto;
    const imposteVal = v('imposte');
    const utileNetto = utileAnteImposte - imposteVal;

    // Break-even operativo:
    //   risultato_op = F * (1 - sommaPctVar) - (rim_ini - rim_fin) - fissi = 0
    //   F_be = (rim_ini - rim_fin + fissi) / (1 - sommaPctVar)
    const denom = 1 - sommaPctVar;
    const kRim = v('rim_ini') - v('rim_fin');
    const breakEven = (denom > 0 && (kRim + fissi) > 0) ? (kRim + fissi) / denom : null;

    return {
      fatturato,
      fatturato_storico_medio: fatturatoStoricoMedio,
      ultimo_anno: ultimoAnno,
      valori,
      cdv, totVar, mdc, fissi, totCosti,
      sottoLineaNetto, utileAnteImposte, imposte: imposteVal, utileNetto,
      somma_pct_var: sommaPctVar,
      break_even: breakEven
    };
  }

  /**
   * Preconsuntivo: data la frequenza (mensile/trimestrale) e il
   * fatturato realmente fatturato in N periodi chiusi dell'anno
   * corrente, costruisce due viste:
   *
   *   - CONSUNTIVATO (year-to-date):
   *       fatturato      = somma effettiva inserita
   *       costi var.     = pct_budget × fatturato_consuntivato
   *       costi fissi    = budget_annuale × frazione_anno
   *
   *   - PROIEZIONE FINE ANNO:
   *       fatturato      = fatturato_consuntivato / frazione_anno
   *                         (ipotesi: stesso ritmo di fatturazione)
   *       costi var.     = pct_budget × fatturato_proiettato
   *       costi fissi    = budget_annuale (intero)
   *
   * Le percentuali e gli importi fissi vengono dal budget calcolato
   * (rispetta gli override impostati dall'utente nello Step 6).
   * Le rimanenze sono assunte stabili (= budget intero, sia consuntivato
   * che proiettato): il preconsuntivo non chiede saldi SP intermedi.
   *
   * Quando frazione_anno = 0 (nessun periodo chiuso) la proiezione
   * fine anno coincide col budget originale e il consuntivato è 0.
   *
   * @param {Object} progetto
   * @returns {Object} { frequenza, periodi_totali, periodi_chiusi,
   *   frazione_anno, fatturato_consuntivato, fatturato_proiettato,
   *   consuntivato: { valori: {id: {valore}}, totali: {...} },
   *   proiezione:   { valori: {id: {valore}}, totali: {...} },
   *   budget }
   */
  function calcolaPreconsuntivo(progetto) {
    const macro = progetto.macro_sezioni || [];
    const cons  = progetto.consuntivo || { frequenza: 'mensile', fatturato: {} };
    const budget = calcolaBudget(progetto);

    const periodiTotali = cons.frequenza === 'trimestrale' ? 4 : 12;
    const fattPerPeriodo = cons.fatturato || {};
    const periodiChiusi = Object.keys(fattPerPeriodo)
      .filter(k => typeof fattPerPeriodo[k] === 'number' && isFinite(fattPerPeriodo[k]) && fattPerPeriodo[k] > 0)
      .length;
    const fattConsuntivato = Object.values(fattPerPeriodo)
      .reduce((s, v) => s + (Number(v) || 0), 0);
    const frazione = periodiTotali > 0 ? periodiChiusi / periodiTotali : 0;

    const fattProiettato = frazione > 0 ? (fattConsuntivato / frazione) : budget.fatturato;

    function _calcolaVista(fattConsForCosti, fattAnnoCompleto, frazTempo) {
      const valori = {};
      for (const m of macro) {
        if (m.id === 'ricavi') {
          valori[m.id] = { valore: fattAnnoCompleto };
          continue;
        }

        // Variabili pure: % budget × fatturato (annuale completo)
        if (m.var_fisso === 'variabile' && !m.calcolato) {
          const pct = (budget.valori[m.id] && budget.valori[m.id].pct) || 0;
          valori[m.id] = { valore: pct * fattAnnoCompleto };
          continue;
        }

        // Fissi/calcolato/sotto_linea/imposte: budget annuale × frazione tempo
        const valBudget = (budget.valori[m.id] && budget.valori[m.id].valore) || 0;
        valori[m.id] = { valore: valBudget * frazTempo };
      }

      const v = id => (valori[id] && valori[id].valore) || 0;
      const cdv     = v('mat_prime') + v('altri_var') + v('rim_ini') - v('rim_fin');
      const totVar  = cdv;
      const mdc     = v('ricavi') - totVar;
      const fissi   = ['servizi','godimento','personale','ammortamenti','oneri_gest','oneri_fin']
                        .reduce((s, k) => s + v(k), 0);
      const totCosti = totVar + fissi;
      const sottoLineaNetto = v('altri_ric') + v('altri_prov_f') - v('straordinari');
      const utileAnteImposte = mdc - fissi + sottoLineaNetto;
      const imposteVal = v('imposte');
      const utileNetto = utileAnteImposte - imposteVal;

      return {
        valori,
        fatturato: fattAnnoCompleto,
        cdv, totVar, mdc, fissi, totCosti,
        sottoLineaNetto, utileAnteImposte, imposte: imposteVal, utileNetto
      };
    }

    const consuntivato = _calcolaVista(fattConsuntivato, fattConsuntivato, frazione);
    const proiezione   = _calcolaVista(fattConsuntivato, fattProiettato, 1);

    // Vista per periodo (mese o trimestre): variabili pro-quota sul fatturato
    // del periodo, fissi pro-rata su 1/N dell'anno. Le righe sotto-linea e
    // imposte seguono lo stesso pro-rata dei fissi (sono comunque stime).
    const periodiKeys = cons.frequenza === 'trimestrale'
      ? ['1', '2', '3', '4']
      : ['01','02','03','04','05','06','07','08','09','10','11','12'];
    const fraz1Periodo = periodiTotali > 0 ? 1 / periodiTotali : 0;

    const perPeriodo = {};
    periodiKeys.forEach(k => {
      const fattPeriodo = Number(fattPerPeriodo[k]) || 0;
      perPeriodo[k] = _calcolaVista(fattPeriodo, fattPeriodo, fraz1Periodo);
      perPeriodo[k].fatturato_periodo = fattPeriodo;
      perPeriodo[k].inserito = fattPeriodo > 0;
    });

    return {
      frequenza:              cons.frequenza,
      periodi_totali:         periodiTotali,
      periodi_chiusi:         periodiChiusi,
      periodi_keys:           periodiKeys,
      frazione_anno:          frazione,
      fatturato_consuntivato: fattConsuntivato,
      fatturato_proiettato:   fattProiettato,
      consuntivato,
      proiezione,
      per_periodo:            perPeriodo,
      budget
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
