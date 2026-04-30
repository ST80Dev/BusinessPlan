/**
 * Schema delle voci di variazione del Mod. REDDITI SC e del Mod. IRAP
 * usate dal modulo Imposte.
 *
 * Ogni voce è descritta da:
 *   - id          identificatore stabile usato come chiave nel JSON di progetto
 *   - rigo        rigo del modello fiscale (es. 'RF18', 'IC51')
 *   - codice      sotto-codice o colonna del rigo, se applicabile (es. '99', 'col.1')
 *   - riferimento riferimento normativo principale (TUIR, D.Lgs., ecc.)
 *   - descrizione testo che appare in UI
 *   - tipo        'manuale' (l'utente inserisce l'importo) oppure
 *                 'automatico' (l'importo è calcolato dal motore)
 *   - formula     se tipo='automatico', descrizione testuale della formula
 *                 di calcolo (per tooltip engine-trace)
 *   - note        eventuali note per l'operatore
 *
 * Per la specifica completa vedi caratteristiche_modulo_imposte.md §5 e §10.
 */
(function (global) {
  'use strict';

  // -------------------------------------------------------------------------
  // IRES — Variazioni in aumento (righi RF6-RF31)
  // Riferimento: caratteristiche_modulo_imposte.md §5.1
  // -------------------------------------------------------------------------
  const IRES_AUMENTO = [
    { id: 'RF6', rigo: 'RF6', codice: '',
      riferimento: 'ex quadro EC',
      descrizione: 'Componenti positivi extracontabili',
      tipo: 'manuale' },

    { id: 'RF7', rigo: 'RF7', codice: '',
      riferimento: 'art. 86 c. 4 TUIR',
      descrizione: 'Quote plusvalenze patrimoniali e sopravvenienze attive (rateizzate)',
      tipo: 'automatico',
      formula: 'Somma delle quote dell\'anno provenienti dal prospetto plusvalenze rateizzate (storico §14.1)' },

    { id: 'RF8', rigo: 'RF8', codice: '',
      riferimento: 'art. 88 TUIR',
      descrizione: 'Quote contributi e liberalità',
      tipo: 'manuale' },

    { id: 'RF9', rigo: 'RF9', codice: '',
      riferimento: '',
      descrizione: 'Reddito soggetti con regimi fiscali particolari (es. soc. agricole)',
      tipo: 'manuale' },

    { id: 'RF10', rigo: 'RF10', codice: '',
      riferimento: '',
      descrizione: 'Reddito catastale immobili non strumentali ("immobili patrimonio")',
      tipo: 'manuale' },

    { id: 'RF11', rigo: 'RF11', codice: '',
      riferimento: '',
      descrizione: 'Costi di immobili non strumentali (di cui RF10)',
      tipo: 'manuale' },

    { id: 'RF12', rigo: 'RF12', codice: '',
      riferimento: '',
      descrizione: 'Adeguamento ricavi ai fini ISA',
      tipo: 'manuale' },

    { id: 'RF13', rigo: 'RF13', codice: '',
      riferimento: 'artt. 92-93 TUIR',
      descrizione: 'Rimanenze non contabilizzate o sotto-contabilizzate',
      tipo: 'manuale' },

    { id: 'RF14', rigo: 'RF14', codice: '',
      riferimento: 'art. 95 c. 5 TUIR',
      descrizione: 'Compensi amministratori contabilizzati ma non corrisposti',
      tipo: 'manuale' },

    { id: 'RF15_col1', rigo: 'RF15', codice: 'col.1',
      riferimento: 'art. 96 TUIR',
      descrizione: 'Interessi passivi indeducibili (eccedenti il 30% del ROL)',
      tipo: 'automatico',
      formula: 'MAX(0, IP_eccedenza_anno_corrente - IP_riporto_es_precedenti); vedi prospetto ROL §6' },

    { id: 'RF15_col2', rigo: 'RF15', codice: 'col.2',
      riferimento: '',
      descrizione: 'Altri interessi indeducibili (mora, ritardati IVA)',
      tipo: 'manuale' },

    { id: 'RF16', rigo: 'RF16', codice: '',
      riferimento: 'art. 99 c. 1 TUIR',
      descrizione: 'Imposte non deducibili o deducibili ma non pagate (incluso IMU)',
      tipo: 'manuale' },

    { id: 'RF17', rigo: 'RF17', codice: '',
      riferimento: '',
      descrizione: 'Erogazioni liberali e per finalità sociale indeducibili',
      tipo: 'manuale' },

    // RF18 - autovetture (art. 164 TUIR) - tre sotto-righe
    { id: 'RF18_assicurazione_bollo', rigo: 'RF18', codice: '',
      riferimento: 'art. 164 TUIR',
      descrizione: 'Quota indeducibile assicurazione e bollo autovetture',
      tipo: 'manuale',
      note: 'Deducibile 80% per agenti/rappresentanti, 20% per altre attività' },

    { id: 'RF18_carburante', rigo: 'RF18', codice: '',
      riferimento: 'art. 164 TUIR',
      descrizione: 'Quota indeducibile carburante autovetture',
      tipo: 'manuale' },

    { id: 'RF18_manutenzione', rigo: 'RF18', codice: '',
      riferimento: 'art. 164 TUIR',
      descrizione: 'Quota indeducibile manutenzione e spese varie autovetture',
      tipo: 'manuale' },

    { id: 'RF19', rigo: 'RF19', codice: '',
      riferimento: '',
      descrizione: 'Sopravvenienze passive e minusvalenze patrimoniali indeducibili',
      tipo: 'manuale' },

    { id: 'RF20', rigo: 'RF20', codice: '',
      riferimento: 'art. 87 TUIR',
      descrizione: 'Minusvalenze relative a partecipazioni esenti',
      tipo: 'manuale' },

    // RF21 - ammortamenti (artt. 102, 102-bis, 103, 104) - tre sotto-righe
    { id: 'RF21_immobili', rigo: 'RF21', codice: '',
      riferimento: 'artt. 102, 103 TUIR',
      descrizione: 'Ammortamenti immobili (quota indeducibile, es. terreno)',
      tipo: 'manuale' },

    { id: 'RF21_autovetture', rigo: 'RF21', codice: '',
      riferimento: 'art. 164 TUIR',
      descrizione: 'Ammortamento autovetture (quota indeducibile)',
      tipo: 'manuale' },

    { id: 'RF21_altri', rigo: 'RF21', codice: '',
      riferimento: 'artt. 102, 102-bis, 103, 104 TUIR',
      descrizione: 'Ammortamento cellulari e altri ammortamenti indeducibili',
      tipo: 'manuale' },

    { id: 'RF22', rigo: 'RF22', codice: '',
      riferimento: 'artt. 118, 123 TUIR',
      descrizione: 'Variazioni ex artt. 118-123 (Consolidato Fiscale)',
      tipo: 'manuale' },

    // RF23 - vitto/alloggio/rappresentanza - tre sotto-righe
    { id: 'RF23_col1_vitto_alloggio_totale', rigo: 'RF23', codice: 'col.1',
      riferimento: 'art. 108 TUIR',
      descrizione: 'Spese vitto e alloggio (anche di rappresentanza) — importo totale',
      tipo: 'manuale',
      note: 'L\'importo deducibile (75%) sarà calcolato in RF43' },

    { id: 'RF23_col2_rappresentanza_startup', rigo: 'RF23', codice: 'col.2',
      riferimento: 'art. 108 TUIR',
      descrizione: 'Spese di rappresentanza imprese start-up — importo totale',
      tipo: 'manuale' },

    { id: 'RF23_col2_altre_rappresentanza', rigo: 'RF23', codice: 'col.2',
      riferimento: 'art. 108 TUIR',
      descrizione: 'Altre spese di rappresentanza (es. omaggi) — importo totale',
      tipo: 'manuale',
      note: 'Verificare limiti % su ricavi: 1,5% fino a 10mln, 0,6% tra 10 e 50mln, 0,4% oltre' },

    { id: 'RF23_non_tracciabili', rigo: 'RF23', codice: '',
      riferimento: 'art. 109 c. 5-bis TUIR',
      descrizione: 'Spese vitto/alloggio/viaggio/trasporto pagate con mezzi non tracciabili',
      tipo: 'manuale' },

    { id: 'RF24', rigo: 'RF24', codice: '',
      riferimento: 'art. 102 c. 6 TUIR',
      descrizione: 'Spese di manutenzione eccedenti il 5% del costo dei beni ammortizzabili',
      tipo: 'automatico',
      formula: 'Eccedenza dell\'anno corrente (l\'intero importo come variazione in aumento; le quote degli anni successivi entrano in RF55 cod.6); vedi storico §14.2' },

    { id: 'RF25', rigo: 'RF25', codice: '',
      riferimento: 'artt. 105-107 TUIR',
      descrizione: 'Accantonamenti non deducibili in tutto o in parte',
      tipo: 'manuale' },

    { id: 'RF27', rigo: 'RF27', codice: '',
      riferimento: 'art. 109 c. 5 TUIR',
      descrizione: 'Spese indeducibili pro-rata di deducibilità (spese generali)',
      tipo: 'manuale' },

    { id: 'RF30', rigo: 'RF30', codice: '',
      riferimento: '',
      descrizione: 'Componenti imputati a patrimonio (cambiamento criterio o IAS/IFRS)',
      tipo: 'manuale' },

    { id: 'RF31_cod1', rigo: 'RF31', codice: 'codice 1',
      riferimento: '',
      descrizione: '5% dividendi incassati nell\'anno ma di competenza di esercizi precedenti',
      tipo: 'manuale' },

    { id: 'RF31_cod3', rigo: 'RF31', codice: 'codice 3',
      riferimento: 'art. 95 c. 3 TUIR',
      descrizione: 'Spese vitto/alloggio trasferte dipendenti (incluse non tracciabili)',
      tipo: 'manuale' },

    { id: 'RF31_cod34', rigo: 'RF31', codice: 'codice 34',
      riferimento: '',
      descrizione: 'Costi beni d\'impresa in godimento ai soci e/o familiari indeducibili',
      tipo: 'manuale' },

    { id: 'RF31_cod35', rigo: 'RF31', codice: 'codice 35',
      riferimento: 'art. 102 c. 7 TUIR',
      descrizione: 'Canoni di leasing indeducibili',
      tipo: 'manuale' },

    { id: 'RF31_cod41', rigo: 'RF31', codice: 'codice 41',
      riferimento: 'art. 106 c. 1 TUIR',
      descrizione: 'Eccedenza svalutazione e accantonamenti rischi su crediti',
      tipo: 'manuale' },

    { id: 'RF31_cod56', rigo: 'RF31', codice: 'codice 56',
      riferimento: '',
      descrizione: 'Esenzione utili/perdite stabili organizzazioni (branch exemption)',
      tipo: 'manuale' },

    { id: 'RF31_cod99_sanzioni', rigo: 'RF31', codice: 'codice 99',
      riferimento: '',
      descrizione: 'Sanzioni e multe',
      tipo: 'manuale' },

    { id: 'RF31_cod99_telefoniche_costo_totale', rigo: 'RF31', codice: 'codice 99',
      riferimento: 'art. 102 TUIR',
      descrizione: 'Spese telefoniche (20% indeducibile) — inserire il costo totale',
      tipo: 'automatico',
      formula: 'costo_totale_telefoniche × 20%' },

    { id: 'RF31_cod99_altre', rigo: 'RF31', codice: 'codice 99',
      riferimento: '',
      descrizione: 'Altre spese indeducibili',
      tipo: 'manuale' }
  ];

  // -------------------------------------------------------------------------
  // IRES — Variazioni in diminuzione (righi RF34-RF55)
  // Riferimento: caratteristiche_modulo_imposte.md §5.2
  // -------------------------------------------------------------------------
  const IRES_DIMINUZIONE = [
    { id: 'RF34', rigo: 'RF34', codice: '',
      riferimento: 'art. 86 c. 4 TUIR',
      descrizione: 'Plusvalenze e sopravvenienze attive rateizzate (corrispondente RF7)',
      tipo: 'automatico',
      formula: 'Somma delle quote di plusvalenze rateizzate degli esercizi precedenti che maturano nell\'anno corrente; vedi storico §14.1' },

    { id: 'RF36_RF38', rigo: 'RF36-RF38', codice: '',
      riferimento: 'art. 115 TUIR',
      descrizione: 'Utili da partecipazioni in soc. di persone / dividendi da regime di trasparenza',
      tipo: 'manuale' },

    { id: 'RF39', rigo: 'RF39', codice: '',
      riferimento: '',
      descrizione: 'Proventi degli immobili di cui RF10',
      tipo: 'manuale' },

    { id: 'RF40', rigo: 'RF40', codice: '',
      riferimento: 'art. 95 c. 5-6 TUIR',
      descrizione: 'Utili lavoro dipendente, associati in partecipazione e compensi amministratori imputati a esercizi precedenti',
      tipo: 'manuale' },

    { id: 'RF43_vitto_rappresentanza', rigo: 'RF43', codice: '',
      riferimento: 'artt. 108, 109 c. 5 TUIR',
      descrizione: 'Spese vitto/alloggio e di rappresentanza deducibili (corrispondente RF23)',
      tipo: 'automatico',
      formula: '(RF23_col1 × 75%) + RF23_col2_altre_rappresentanza' },

    { id: 'RF43_es_precedenti', rigo: 'RF43', codice: '',
      riferimento: '',
      descrizione: 'Spese esercizi precedenti e spese non imputabili a conto economico',
      tipo: 'manuale' },

    { id: 'RF44', rigo: 'RF44', codice: '',
      riferimento: 'art. 91 c. 1 TUIR',
      descrizione: 'Proventi non tassabili (es. interessi BOT)',
      tipo: 'manuale' },

    { id: 'RF46', rigo: 'RF46', codice: '',
      riferimento: 'art. 87 TUIR',
      descrizione: 'Plusvalenze relative a partecipazioni esenti (PEX)',
      tipo: 'manuale' },

    { id: 'RF47', rigo: 'RF47', codice: '',
      riferimento: 'art. 89 TUIR',
      descrizione: 'Quota esclusa degli utili distribuiti (95% degli utili percepiti)',
      tipo: 'manuale' },

    { id: 'RF50', rigo: 'RF50', codice: '',
      riferimento: '',
      descrizione: 'Reddito esente e detassato (es. Patent Box)',
      tipo: 'manuale' },

    { id: 'RF53', rigo: 'RF53', codice: '',
      riferimento: '',
      descrizione: 'Componenti negativi a patrimonio per applicazione IAS/IFRS',
      tipo: 'manuale' },

    { id: 'RF54', rigo: 'RF54', codice: '',
      riferimento: 'artt. 92, 93 TUIR',
      descrizione: 'Rimanenze contabilizzate in misura superiore ai sensi del TUIR',
      tipo: 'manuale' },

    { id: 'RF55_cod1', rigo: 'RF55', codice: 'codice 1',
      riferimento: '',
      descrizione: 'Dividendi di competenza non incassati',
      tipo: 'manuale' },

    { id: 'RF55_cod6', rigo: 'RF55', codice: 'codice 6',
      riferimento: 'art. 102 c. 6 TUIR',
      descrizione: 'Spese manutenzione eccedenti 5% di esercizi precedenti (corrispondente RF24)',
      tipo: 'automatico',
      formula: 'Somma delle quote dell\'anno corrente derivanti dalle eccedenze 5% di esercizi precedenti; vedi storico §14.2' },

    { id: 'RF55_cod12', rigo: 'RF55', codice: 'codice 12',
      riferimento: 'art. 6 D.L. 185/2008',
      descrizione: 'IRAP 10% su oneri finanziari (deduzione forfetaria)',
      tipo: 'automatico',
      formula: 'Spettante solo se voce C) bilancio UE è negativa: 10% × (saldo IRAP es. prec. + acconti IRAP anno corrente, capati a IRAP competenza); vedi §12.1' },

    { id: 'RF55_cod13', rigo: 'RF55', codice: 'codice 13',
      riferimento: 'art. 96 c. 5 TUIR',
      descrizione: 'Interessi passivi di esercizi precedenti deducibili nell\'anno (uso ROL)',
      tipo: 'automatico',
      formula: 'Quota di interessi passivi riportati che diventano deducibili grazie all\'eccedenza ROL; vedi prospetto §6' },

    { id: 'RF55_cod24', rigo: 'RF55', codice: 'codice 24',
      riferimento: '',
      descrizione: 'Imposte anticipate',
      tipo: 'manuale' },

    { id: 'RF55_cod33', rigo: 'RF55', codice: 'codice 33',
      riferimento: 'art. 2 D.L. 201/2011',
      descrizione: 'IRAP analitica costo del personale (deduzione dall\'IRES)',
      tipo: 'automatico',
      formula: 'Quota IRAP riferibile al costo del personale dipendente, calcolata separatamente per saldo es. prec. e acconti anno corrente; vedi §12.2' },

    { id: 'RF55_cod50_57_79', rigo: 'RF55', codice: 'codice 50/57/79',
      riferimento: 'L. 208/2015, L. 232/2016, L. 205/2017',
      descrizione: 'Super ammortamenti',
      tipo: 'manuale' },

    { id: 'RF55_cod55_59_75_76', rigo: 'RF55', codice: 'codice 55-59 / 75-76',
      riferimento: 'L. 232/2016, L. 205/2017, L. 145/2018',
      descrizione: 'Iper ammortamenti e super ammortamenti beni immateriali correlati',
      tipo: 'manuale' },

    { id: 'RF55_cod66_67', rigo: 'RF55', codice: 'codice 66-67',
      riferimento: 'art. 4 D.Lgs. 216/2023',
      descrizione: 'Maggior deduzione del costo del personale di nuova assunzione',
      tipo: 'manuale' },

    { id: 'RF55_cod99', rigo: 'RF55', codice: 'codice 99',
      riferimento: '',
      descrizione: 'Altre variazioni in diminuzione',
      tipo: 'manuale' }
  ];

  // -------------------------------------------------------------------------
  // IRAP — Variazioni in aumento (righi IC43-IC51)
  // Riferimento: caratteristiche_modulo_imposte.md §10.2
  // -------------------------------------------------------------------------
  const IRAP_AUMENTO = [
    { id: 'IC43_compensi_amm', rigo: 'IC43', codice: '',
      riferimento: 'D.Lgs. 446/1997',
      descrizione: 'Compensi amministratori',
      tipo: 'manuale' },

    { id: 'IC43_inps_amm', rigo: 'IC43', codice: '',
      riferimento: '',
      descrizione: 'Contributi INPS amministratori',
      tipo: 'manuale' },

    { id: 'IC43_cassa_prev', rigo: 'IC43', codice: '',
      riferimento: '',
      descrizione: 'Cassa di previdenza amministratori',
      tipo: 'manuale' },

    { id: 'IC43_lav_aut_occ', rigo: 'IC43', codice: '',
      riferimento: '',
      descrizione: 'Attività commerciali / lavoro autonomo occasionale e utili ad associati in partecipazione',
      tipo: 'manuale' },

    { id: 'IC43_cococo', rigo: 'IC43', codice: '',
      riferimento: '',
      descrizione: 'Collaborazioni coordinate e continuative (co.co.co.)',
      tipo: 'manuale' },

    { id: 'IC44', rigo: 'IC44', codice: '',
      riferimento: '',
      descrizione: 'Quota interessi su canoni leasing',
      tipo: 'manuale' },

    { id: 'IC45', rigo: 'IC45', codice: '',
      riferimento: '',
      descrizione: 'Perdite e svalutazione crediti',
      tipo: 'manuale' },

    { id: 'IC46_imu', rigo: 'IC46', codice: '',
      riferimento: '',
      descrizione: 'IMU',
      tipo: 'manuale' },

    { id: 'IC48', rigo: 'IC48', codice: '',
      riferimento: '',
      descrizione: 'Quota indeducibile ammortamento marchi e avviamento',
      tipo: 'manuale' },

    { id: 'IC49', rigo: 'IC49', codice: '',
      riferimento: '',
      descrizione: 'Interessi passivi indeducibili (società di intermediazione)',
      tipo: 'manuale' },

    { id: 'IC50', rigo: 'IC50', codice: '',
      riferimento: '',
      descrizione: 'Variazioni IAS / nuovi principi contabili nazionali (in aumento)',
      tipo: 'manuale' },

    { id: 'IC51_cod1', rigo: 'IC51', codice: 'codice 1',
      riferimento: '',
      descrizione: 'Altre spese per personale dipendente (diverse da B9)',
      tipo: 'manuale' },

    { id: 'IC51_cod2', rigo: 'IC51', codice: 'codice 2',
      riferimento: '',
      descrizione: 'Adeguamento da ISA',
      tipo: 'manuale' },

    { id: 'IC51_cod3', rigo: 'IC51', codice: 'codice 3',
      riferimento: '',
      descrizione: 'Contributi (diversi da quelli di A5)',
      tipo: 'manuale' },

    { id: 'IC51_cod4_quota_terreno', rigo: 'IC51', codice: 'codice 4',
      riferimento: '',
      descrizione: 'Quota indeducibile ammortamento fabbricati strumentali (quota terreno)',
      tipo: 'automatico',
      formula: 'Pari alla voce IRES RF21_immobili (quota terreno indeducibile)' },

    { id: 'IC51_cod6', rigo: 'IC51', codice: 'codice 6',
      riferimento: '',
      descrizione: 'Oneri finanziari e spese personale per lavori interni non in A4',
      tipo: 'manuale' },

    { id: 'IC51_cod99_da_ires', rigo: 'IC51', codice: 'codice 99',
      riferimento: '',
      descrizione: 'Altre variazioni in aumento (da voci IRES)',
      tipo: 'automatico',
      formula: 'Somma di RF17 (erogazioni liberali) + RF19 (sopravv. passive) + RF31_cod99_sanzioni + RF31_cod99_altre' }
  ];

  // -------------------------------------------------------------------------
  // IRAP — Variazioni in diminuzione (righi IC53-IC57)
  // Riferimento: caratteristiche_modulo_imposte.md §10.3
  // -------------------------------------------------------------------------
  const IRAP_DIMINUZIONE = [
    { id: 'IC53', rigo: 'IC53', codice: '',
      riferimento: '',
      descrizione: 'Costi effettivamente sostenuti già contabilizzati a fondi rischi',
      tipo: 'manuale' },

    { id: 'IC55', rigo: 'IC55', codice: '',
      riferimento: '',
      descrizione: 'Quota deducibile ammortamento marchi e avviamento',
      tipo: 'manuale' },

    { id: 'IC56', rigo: 'IC56', codice: '',
      riferimento: '',
      descrizione: 'Variazioni IAS / nuovi principi contabili (in diminuzione)',
      tipo: 'manuale' },

    { id: 'IC57_cod3', rigo: 'IC57', codice: 'codice 3',
      riferimento: '',
      descrizione: 'Quota costo lavoro interinale deducibile (se compresa in B9)',
      tipo: 'manuale' },

    { id: 'IC57_cod4', rigo: 'IC57', codice: 'codice 4',
      riferimento: '',
      descrizione: 'Insussistenze e sopravvenienze attive di componenti economiche di esercizi precedenti',
      tipo: 'manuale' },

    { id: 'IC57_cod6_7', rigo: 'IC57', codice: 'codice 6-7',
      riferimento: '',
      descrizione: 'Quote di ammortamento non dedotte in anni precedenti',
      tipo: 'manuale' },

    { id: 'IC57_col16_patent_box', rigo: 'IC57', codice: 'col. 16',
      riferimento: '',
      descrizione: 'Patent box',
      tipo: 'manuale' },

    { id: 'IC57_cod99', rigo: 'IC57', codice: 'codice 99',
      riferimento: '',
      descrizione: 'Altre variazioni in diminuzione',
      tipo: 'manuale' }
  ];

  // -------------------------------------------------------------------------
  // IRAP — Deduzioni dal valore della produzione (cuneo fiscale)
  // Riferimento: art. 11 D.Lgs. 446/1997, caratteristiche_modulo_imposte.md §10.4
  // -------------------------------------------------------------------------
  const IRAP_DEDUZIONI = [
    { id: 'IS1_inail', rigo: 'IS1', codice: '',
      riferimento: 'art. 11 c. 1 lett. a) n. 1 D.Lgs. 446/1997',
      descrizione: 'Deduzione contributi INAIL',
      tipo: 'manuale' },

    { id: 'IS4_apprendisti_disabili_rd', rigo: 'IS4', codice: '',
      riferimento: 'art. 11 c. 1 lett. a) n. 5 D.Lgs. 446/1997',
      descrizione: 'Deduzione costo apprendisti, contratti di formazione, disabili, ricerca e sviluppo',
      tipo: 'manuale' },

    { id: 'IS5_dipendenti_1850', rigo: 'IS5', codice: '',
      riferimento: 'art. 11 c. 4-bis.1 D.Lgs. 446/1997',
      descrizione: 'Deduzione €1.850 per dipendente (solo se ricavi < €400.000)',
      tipo: 'automatico',
      formula: 'Se ricavi_totali < 400.000 → 1850 × n_dipendenti, altrimenti 0' },

    { id: 'IS7_costo_personale_indet', rigo: 'IS7', codice: '',
      riferimento: 'art. 11 c. 4-octies D.Lgs. 446/1997',
      descrizione: 'Deduzione costo del personale dipendente a tempo indeterminato (cuneo fiscale)',
      tipo: 'manuale',
      note: 'Deducibilità integrale dal 2022 per dipendenti a tempo indeterminato' },

    { id: 'IS9_eccedenze', rigo: 'IS9', codice: '',
      riferimento: '',
      descrizione: 'Eccedenze delle deduzioni rispetto alle retribuzioni',
      tipo: 'manuale' },

    { id: 'IC75_forfait_8000', rigo: 'IC75', codice: '',
      riferimento: 'art. 11 c. 4-bis D.Lgs. 446/1997',
      descrizione: 'Deduzione forfettaria €8.000 (solo se VP < €180.759,91)',
      tipo: 'automatico',
      formula: 'Se (VP_post_variazioni - IS1 - IS4 - IS5 - IS7) ≤ 180.759,91 → 8.000, altrimenti 0' }
  ];

  // -------------------------------------------------------------------------
  // Helper di accesso
  // -------------------------------------------------------------------------

  /** Tutte le voci, in unico array, con un campo `sezione` aggiunto. */
  function tutteLeVoci() {
    return [].concat(
      IRES_AUMENTO.map(v => Object.assign({ sezione: 'ires_aumento' }, v)),
      IRES_DIMINUZIONE.map(v => Object.assign({ sezione: 'ires_diminuzione' }, v)),
      IRAP_AUMENTO.map(v => Object.assign({ sezione: 'irap_aumento' }, v)),
      IRAP_DIMINUZIONE.map(v => Object.assign({ sezione: 'irap_diminuzione' }, v)),
      IRAP_DEDUZIONI.map(v => Object.assign({ sezione: 'irap_deduzioni' }, v))
    );
  }

  /** Trova una voce per id. Ritorna null se non esiste. */
  function vocePerId(id) {
    return tutteLeVoci().find(v => v.id === id) || null;
  }

  /** Restituisce solo le voci 'manuale' di una sezione. */
  function vociManuali(sezione) {
    const map = {
      ires_aumento: IRES_AUMENTO,
      ires_diminuzione: IRES_DIMINUZIONE,
      irap_aumento: IRAP_AUMENTO,
      irap_diminuzione: IRAP_DIMINUZIONE,
      irap_deduzioni: IRAP_DEDUZIONI
    };
    const arr = map[sezione] || [];
    return arr.filter(v => v.tipo === 'manuale');
  }

  /** Restituisce solo le voci 'automatico' di una sezione. */
  function vociAutomatiche(sezione) {
    const map = {
      ires_aumento: IRES_AUMENTO,
      ires_diminuzione: IRES_DIMINUZIONE,
      irap_aumento: IRAP_AUMENTO,
      irap_diminuzione: IRAP_DIMINUZIONE,
      irap_deduzioni: IRAP_DEDUZIONI
    };
    const arr = map[sezione] || [];
    return arr.filter(v => v.tipo === 'automatico');
  }

  global.ImposteSchema = {
    IRES_AUMENTO: IRES_AUMENTO,
    IRES_DIMINUZIONE: IRES_DIMINUZIONE,
    IRAP_AUMENTO: IRAP_AUMENTO,
    IRAP_DIMINUZIONE: IRAP_DIMINUZIONE,
    IRAP_DEDUZIONI: IRAP_DEDUZIONI,
    tutteLeVoci: tutteLeVoci,
    vocePerId: vocePerId,
    vociManuali: vociManuali,
    vociAutomatiche: vociAutomatiche
  };
})(typeof window !== 'undefined' ? window : globalThis);
