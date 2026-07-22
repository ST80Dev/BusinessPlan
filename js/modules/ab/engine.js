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
                   fissi | prov_oneri_straord | imposte)
       tipo      — ricavo | costo
       var_fisso — variabile | fisso (rilevante solo per costi sopra
                   la linea; le voci prov_oneri_straord/imposte non
                   concorrono al break-even)
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
    { id: 'straordinari', label: 'Oneri straordinari',                     sezione: 'prov_oneri_straord', tipo: 'costo',  var_fisso: null,        mastri: ['95'] },
    { id: 'altri_ric',    label: 'Altri ricavi e proventi',                sezione: 'prov_oneri_straord', tipo: 'ricavo', var_fisso: null,        mastri: ['64'], filtro_conto: '64/05' },
    { id: 'altri_prov_f', label: 'Altri proventi finanziari',              sezione: 'prov_oneri_straord', tipo: 'ricavo', var_fisso: null,        mastri: ['87'], includi_conto: '64/15' },
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

  /**
   * Somma i valori di tutte le macroaree di una data `sezione`,
   * orientando il segno secondo il ruolo della sezione:
   *
   *   orient = 'cost'   → somma i costi e sottrae i ricavi
   *                       (usata per CdV/Variabili e per i Fissi:
   *                        rim_fin viene sottratto perché tipo='ricavo')
   *
   *   orient = 'result' → somma i ricavi e sottrae i costi
   *                       (usata per Proventi/Oneri Straordinari:
   *                        altri_ric/altri_prov_f sommano, straordinari
   *                        sottrae)
   *
   * Sostituisce le sommatorie hardcoded sugli id predefiniti, così le
   * macroaree custom create dall'utente partecipano automaticamente
   * (vedi macroaree con flag `custom: true`).
   *
   * @param {Array}    macroSezioni
   * @param {Function} getVal       - id → valore numerico
   * @param {string}   sezione      - 'variabili' | 'fissi' | 'prov_oneri_straord' | ...
   * @param {string}   orient       - 'cost' | 'result'
   * @returns {number}
   */
  function _sumSezione(macroSezioni, getVal, sezione, orient) {
    return (macroSezioni || [])
      .filter(m => m.sezione === sezione)
      .reduce((s, m) => {
        const v = getVal(m.id) || 0;
        const sign = orient === 'cost'
          ? (m.tipo === 'costo'  ? +1 : -1)
          : (m.tipo === 'ricavo' ? +1 : -1);
        return s + sign * v;
      }, 0);
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
   *   ricavi:         valore = override fatturato_ipotizzato OR ultimo
   *                            anno arrotondato al centinaio
   *   variabili pure (mat_prime, altri_var):
   *                    valore = (override_pct OR pct_media) × fatturato
   *   variabili calcolate (rim_ini, rim_fin):
   *                    valore = override_fissi[id] OR media €
   *                    (le rimanenze in budget sono trattate come €
   *                    perché non scalano linearmente col fatturato)
   *   fissi, prov_oneri_straord e imposte:
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
   * Le voci di proventi/oneri straordinari e le imposte non
   * concorrono al BE operativo per definizione classica.
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

    // Anni "effettivamente importati": quelli con ricavi > 0. Se l'utente
    // ha importato un file con colonne anno presenti ma solo l'ultimo
    // realmente popolato (azienda neocostituita, primo esercizio breve,
    // ecc.), gli altri anni hanno saldi 0 e non devono concorrere alla
    // media — altrimenti la /N divide per il numero di colonne anziché
    // per il numero di esercizi reali, schiacciando la media verso il
    // basso. Stessa euristica già usata per mediePct (riga sotto).
    const anniReali = anni.filter(a => Number((storico[a] || {}).ricavi) > 0);

    // Medie storiche per macroarea (€ e % sul fatturato)
    const medieEuro = {};
    macro.forEach(m => {
      const valori = anniReali.map(a => Number((storico[a] || {})[m.id]) || 0);
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

    // Base "ultimo anno arrotondata al centinaio": per il fatturato e
    // per i costi non variabili il budget teorico parte dall'ultima
    // annualità storica anziché dalla media triennale, per allinearsi
    // alla situazione più recente. L'arrotondamento al centinaio dà un
    // valore tondo come default da rifinire poi via override.
    const ultimoAnno = anni.length > 0 ? Math.max.apply(null, anni) : null;
    const ultimoAnnoEuro = {};
    macro.forEach(m => {
      const v = ultimoAnno != null ? Number((storico[ultimoAnno] || {})[m.id]) || 0 : 0;
      ultimoAnnoEuro[m.id] = Math.round(v / 100) * 100;
    });
    const fatturatoUltimoArrotondato = ultimoAnnoEuro['ricavi'] || 0;

    // Fatturato budget: default = ultimo fatturato storico arrotondato
    // al centinaio (non la media triennale, che resta solo informativa).
    const fatturatoOvr = Number(budget.fatturato_ipotizzato);
    const fatturato = (isFinite(fatturatoOvr) && fatturatoOvr > 0) ? fatturatoOvr : fatturatoUltimoArrotondato;

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
          base_default: ultimoAnnoEuro[m.id]
        };
        continue;
      }

      // Variabili pure (no calcolato): % override o % media × fatturato
      if (m.var_fisso === 'variabile' && !m.calcolato) {
        const pctOvr = ovrPct[m.id];
        const pctMedia = mediePct[m.id] || 0;
        const pct    = (typeof pctOvr === 'number' && isFinite(pctOvr)) ? pctOvr : pctMedia;
        const valore = pct * fatturato;
        valori[m.id] = {
          valore,
          pct,
          fonte_pct: 'pct',
          fonte: (typeof pctOvr === 'number' && isFinite(pctOvr)) ? 'override' : 'storico',
          media_euro: medieEuro[m.id],
          media_pct:  mediePct[m.id],
          ultimo_anno_euro: ultimoAnnoEuro[m.id],
          // base_default: stima storica indipendente dall'override —
          // sempre % media × fatturato_ipotizzato. Si scala col fatturato
          // budget e resta confrontabile col Budget € finale.
          base_default: pctMedia * fatturato
        };
        // sommaPctVar: i costi variabili contribuiscono +pct,
        // i ricavi variabili (rim_fin sarebbe stato qui ma è calcolato)
        // contribuiscono -pct.
        if (m.tipo === 'costo') sommaPctVar += pct;
        else                    sommaPctVar -= pct;
        continue;
      }

      // Calcolato (rim_ini/rim_fin): € override o media €
      // Proventi/oneri straordinari (sezione prov_oneri_straord): per loro
      // natura non ricorrente, default a 0 nel budget; l'utente può
      // sempre forzare un valore tramite override.
      // Tutto il resto (fissi, imposte): € override o ultimo anno
      // arrotondato al centinaio — vedi commento su ultimoAnnoEuro.
      const eurOvr = ovrEur[m.id];
      const isStraord = m.sezione === 'prov_oneri_straord';
      const baseDefault = m.calcolato ? (medieEuro[m.id] || 0)
                        : isStraord  ? 0
                        : ultimoAnnoEuro[m.id];
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

    // Derivati del prospetto — somme aggregate per sezione, così le
    // macroaree custom partecipano senza modifiche all'engine.
    const v = id => (valori[id] && valori[id].valore) || 0;
    const cdv     = _sumSezione(macro, v, 'variabili',          'cost');
    const totVar  = cdv;
    const mdc     = fatturato - totVar;
    const fissi   = _sumSezione(macro, v, 'fissi',              'cost');
    const totCosti = totVar + fissi;
    const provOneriStraordNetto = _sumSezione(macro, v, 'prov_oneri_straord', 'result');
    const utileAnteImposte = mdc - fissi + provOneriStraordNetto;
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
      fatturato_ultimo_arrotondato: fatturatoUltimoArrotondato,
      ultimo_anno: ultimoAnno,
      anni_reali: anniReali,
      valori,
      cdv, totVar, mdc, fissi, totCosti,
      provOneriStraordNetto, utileAnteImposte, imposte: imposteVal, utileNetto,
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
   * ORIZZONTE CONSUNTIVO: la frazione d'anno trascorsa NON è il numero di
   * mesi con ricavo > 0, ma l'indice dell'ultimo mese con ricavo inserito
   * (ultimo_periodo_con_dati). Così:
   *   - un mese intermedio a ricavo 0 (es. gennaio a zero, febbraio
   *     fatturato) è comunque "trascorso": i suoi costi fissi rientrano nel
   *     consuntivato;
   *   - i mesi oltre l'orizzonte non sono ancora rilevati: la loro vista
   *     per_periodo è vuota (niente costi, niente utile negativo fittizio).
   *
   * Quando frazione_anno = 0 (nessun mese con ricavo) la proiezione fine
   * anno coincide col budget originale e il consuntivato è 0.
   *
   * @param {Object} progetto
   * @returns {Object} { frequenza, periodi_totali, periodi_chiusi,
   *   ultimo_periodo_con_dati, frazione_anno, fatturato_consuntivato,
   *   fatturato_proiettato,
   *   consuntivato: { valori: {id: {valore}}, totali: {...} },
   *   proiezione:   { valori: {id: {valore}}, totali: {...} },
   *   per_periodo:  { key: { ..., futuro } },
   *   budget }
   */
  function calcolaPreconsuntivo(progetto) {
    const macro = progetto.macro_sezioni || [];
    const cons  = progetto.consuntivo || { frequenza: 'mensile', fatturato: {} };
    const budget = calcolaBudget(progetto);

    const periodiTotali = cons.frequenza === 'trimestrale' ? 4 : 12;
    const fattPerPeriodo = cons.fatturato || {};

    // Chiavi di periodo (mese o trimestre) in ordine cronologico.
    const periodiKeys = cons.frequenza === 'trimestrale'
      ? ['1', '2', '3', '4']
      : ['01','02','03','04','05','06','07','08','09','10','11','12'];

    // Orizzonte consuntivo: indice dell'ULTIMO periodo con ricavo inserito.
    // Definisce fin dove l'anno è "trascorso". I mesi 0..orizzonte sono
    // consuntivati e i loro costi fissi vanno contati anche se il singolo
    // mese ha ricavo 0 (es. gennaio a zero ma febbraio fatturato); i mesi
    // oltre l'orizzonte non sono ancora rilevati e non devono generare
    // costi né un utile (negativo) fittizio.
    let ultimoPeriodoConDati = -1;
    periodiKeys.forEach((k, i) => {
      if (Number(fattPerPeriodo[k]) > 0) ultimoPeriodoConDati = i;
    });
    const periodiTrascorsi = ultimoPeriodoConDati + 1;

    // "periodi chiusi" = periodi trascorsi fino all'orizzonte, NON il semplice
    // conteggio dei mesi con ricavo > 0: un mese intermedio a zero è comunque
    // trascorso e concorre alla frazione d'anno e ai fissi pro-rata.
    const periodiChiusi = periodiTrascorsi;
    const fattConsuntivato = Object.values(fattPerPeriodo)
      .reduce((s, v) => s + (Number(v) || 0), 0);
    const frazione = periodiTotali > 0 ? periodiTrascorsi / periodiTotali : 0;

    // Modalità di proiezione del fatturato:
    //   'lineare'         → estrapolazione yt-d / frazione_anno (default)
    //   'stagionalizzata' → mix per periodo: dove il consuntivo è chiuso usa
    //                       il consuntivo, dove è aperto usa il valore atteso
    //                       inserito a mano (€ per periodo). La proiezione
    //                       annua è la somma dei 12 (o 4) periodi del mix.
    //                       Pensata per attività con stagionalità marcata
    //                       (es. stabilimenti balneari, gelaterie) dove la
    //                       proiezione lineare sovra/sotto-stima vistosamente.
    const modalita = cons.modalita_proiezione === 'stagionalizzata'
      ? 'stagionalizzata' : 'lineare';
    const fattAtteso = cons.fatturato_atteso || {};

    // Vista per periodo (mese o trimestre): variabili pro-quota sul fatturato
    // del periodo, fissi pro-rata su 1/N dell'anno. Le righe di proventi/oneri
    // straordinari e imposte seguono lo stesso pro-rata dei fissi (sono
    // comunque stime). Le chiavi di periodo (periodiKeys) sono definite in
    // testa alla funzione, insieme all'orizzonte consuntivo.

    // Mix per periodo per la modalità stagionalizzata: consuntivo se chiuso,
    // atteso se aperto. Per coerenza viene calcolato sempre, ma viene usato
    // per la proiezione solo se modalita === 'stagionalizzata'.
    const fattMixPerPeriodo = {};
    const fonteMixPerPeriodo = {}; // 'consuntivo' | 'atteso' | 'vuoto'
    let attesoTotale = 0;
    periodiKeys.forEach(k => {
      const c = Number(fattPerPeriodo[k]) || 0;
      const a = Number(fattAtteso[k]) || 0;
      attesoTotale += a;
      if (c > 0) {
        fattMixPerPeriodo[k]  = c;
        fonteMixPerPeriodo[k] = 'consuntivo';
      } else if (a > 0) {
        fattMixPerPeriodo[k]  = a;
        fonteMixPerPeriodo[k] = 'atteso';
      } else {
        fattMixPerPeriodo[k]  = 0;
        fonteMixPerPeriodo[k] = 'vuoto';
      }
    });
    const fattMixTotale = Object.values(fattMixPerPeriodo).reduce((s, v) => s + v, 0);

    const fattProiettato = modalita === 'stagionalizzata'
      ? fattMixTotale
      : (frazione > 0 ? (fattConsuntivato / frazione) : budget.fatturato);

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

        // Fissi/calcolato/prov_oneri_straord/imposte: budget annuale × frazione tempo
        const valBudget = (budget.valori[m.id] && budget.valori[m.id].valore) || 0;
        valori[m.id] = { valore: valBudget * frazTempo };
      }

      const v = id => (valori[id] && valori[id].valore) || 0;
      const cdv     = _sumSezione(macro, v, 'variabili',          'cost');
      const totVar  = cdv;
      const mdc     = v('ricavi') - totVar;
      const fissi   = _sumSezione(macro, v, 'fissi',              'cost');
      const totCosti = totVar + fissi;
      const provOneriStraordNetto = _sumSezione(macro, v, 'prov_oneri_straord', 'result');
      const utileAnteImposte = mdc - fissi + provOneriStraordNetto;
      const imposteVal = v('imposte');
      const utileNetto = utileAnteImposte - imposteVal;

      return {
        valori,
        fatturato: fattAnnoCompleto,
        cdv, totVar, mdc, fissi, totCosti,
        provOneriStraordNetto, utileAnteImposte, imposte: imposteVal, utileNetto
      };
    }

    const consuntivato = _calcolaVista(fattConsuntivato, fattConsuntivato, frazione);
    const proiezione   = _calcolaVista(fattConsuntivato, fattProiettato, 1);

    const fraz1Periodo = periodiTotali > 0 ? 1 / periodiTotali : 0;

    // Vista vuota per i periodi oltre l'orizzonte: nessun costo/utile, così
    // nessun consumatore (griglia a schermo, PDF, aggregati) conteggia fissi
    // fittizi o espone un utile negativo per mesi non ancora rilevati.
    const _vistaVuota = () => ({
      valori: {}, fatturato: 0, cdv: 0, totVar: 0, mdc: 0, fissi: 0,
      totCosti: 0, provOneriStraordNetto: 0, utileAnteImposte: 0,
      imposte: 0, utileNetto: 0
    });

    const perPeriodo = {};
    periodiKeys.forEach((k, i) => {
      const fattPeriodo = Number(fattPerPeriodo[k]) || 0;
      // futuro = oltre l'ultimo mese con ricavo: non ancora rilevato. La cella
      // editabile del fatturato continua a leggere da cons.fatturato[k], quindi
      // l'operatore può inserire il mese successivo ed estendere l'orizzonte.
      const futuro = i > ultimoPeriodoConDati;
      perPeriodo[k] = futuro
        ? _vistaVuota()
        : _calcolaVista(fattPeriodo, fattPeriodo, fraz1Periodo);
      perPeriodo[k].fatturato_periodo = fattPeriodo;
      perPeriodo[k].inserito = fattPeriodo > 0;
      perPeriodo[k].futuro   = futuro;
      perPeriodo[k].atteso   = Number(fattAtteso[k]) || 0;
      perPeriodo[k].mix      = fattMixPerPeriodo[k];
      perPeriodo[k].fonte    = fonteMixPerPeriodo[k];
    });

    return {
      frequenza:              cons.frequenza,
      modalita_proiezione:    modalita,
      periodi_totali:         periodiTotali,
      periodi_chiusi:         periodiChiusi,
      ultimo_periodo_con_dati: ultimoPeriodoConDati,
      periodi_keys:           periodiKeys,
      frazione_anno:          frazione,
      fatturato_consuntivato: fattConsuntivato,
      fatturato_atteso_tot:   attesoTotale,
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
