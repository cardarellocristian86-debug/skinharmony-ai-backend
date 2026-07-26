const STAGE_IDS = Object.freeze([
  "sensory_ingest",
  "intent_router",
  "context_binding",
  "rule_matrix",
  "risk_surface",
  "execution_planning",
  "verification_contract",
  "rollback_paths",
  "telemetry_capture",
  "memory_distillation",
  "feedback_loop",
  "policy_reweighting",
  "synaptic_consolidation",
  "terminal_action_model",
  "outcome_observation",
  "expected_actual_comparison",
  "drift_detection",
  "failure_attribution",
  "cross_branch_reconciliation",
  "knowledge_gap_update",
  "policy_candidate_review",
  "human_review_checkpoint",
  "verified_learning_commit",
  "continuity_handoff",
]);

function freezeList(values) {
  return Object.freeze(values.map((value) => (
    value && typeof value === "object" ? Object.freeze({ ...value }) : value
  )));
}

function defineProfile(profile) {
  if (profile.stage_map.length !== STAGE_IDS.length) {
    throw new Error(`research_learning_profile_stage_count:${profile.id}`);
  }
  const stageMap = {};
  profile.stage_map.forEach((stage, index) => {
    const expectedId = STAGE_IDS[index];
    if (stage.stage_id !== expectedId) {
      throw new Error(`research_learning_profile_stage_order:${profile.id}:${expectedId}`);
    }
    stageMap[stage.stage_id] = Object.freeze({
      ...stage,
      semantic_tags: freezeList(stage.semantic_tags),
    });
  });
  return Object.freeze({
    ...profile,
    branch_ids: freezeList(profile.branch_ids),
    semantic_tags: freezeList(profile.semantic_tags),
    operational_subbranches: freezeList(profile.operational_subbranches),
    research_questions: freezeList(profile.research_questions),
    source_policy: Object.freeze({
      ...profile.source_policy,
      preferred: freezeList(profile.source_policy.preferred),
      conditional: freezeList(profile.source_policy.conditional),
      rejected: freezeList(profile.source_policy.rejected),
    }),
    benchmarks: freezeList(profile.benchmarks),
    negative_cases: freezeList(profile.negative_cases),
    learning_objectives: freezeList(profile.learning_objectives),
    verify_criteria: freezeList(profile.verify_criteria),
    stage_map: Object.freeze(stageMap),
  });
}

const SOFTWARE_ARCHITECTURE = defineProfile({
  id: "software_architecture_research_learning_v1",
  area: "programming_architecture",
  label: "Programming & Architecture Research Lab",
  branch_ids: ["software_systems_intelligence", "codex_architecture_guard"],
  mission: "Trasformare requisiti e prove tecniche in architetture modulari, contratti compatibili, release verificabili e apprendimento riusabile.",
  semantic_tags: ["programming", "architecture", "contracts", "testing", "runtime", "release", "observability"],
  operational_subbranches: [
    "requirement_to_boundary_mapping", "bounded_context_design", "component_responsibility_matrix",
    "api_schema_lifecycle", "event_contract_evolution", "state_machine_design", "data_ownership_lineage",
    "tenant_isolation_architecture", "identity_authority_boundaries", "frontend_backend_contracts",
    "mobile_desktop_web_convergence", "adapter_port_design", "dependency_direction_control",
    "failure_domain_partitioning", "concurrency_idempotency_control", "performance_capacity_model",
    "observability_signal_design", "test_pyramid_contract", "integration_compatibility_matrix",
    "migration_backfill_strategy", "release_progressive_delivery", "rollback_recovery_proof",
    "architecture_decision_records", "technical_debt_evidence", "secure_defaults_review",
    "operational_runbook_design", "post_release_learning", "cross_runtime_regression",
  ],
  research_questions: [
    "Quale confine minimizza coupling e preserva ownership dei dati?",
    "Quali consumer dipendono dal contratto e quali compatibilita devono restare garantite?",
    "Quali stati, transizioni e condizioni concorrenti devono essere modellati esplicitamente?",
    "Quale strategia di migrazione evita doppie scritture incoerenti e perdita di dati?",
    "Quali segnali dimostrano salute, degradazione, sicurezza e valore del cambiamento?",
    "Quale failure domain limita il blast radius per tenant, runtime e dipendenza?",
    "Quali test riproducono il comportamento reale oltre alle unita isolate?",
    "Quale rollback e realmente eseguibile con schema e dati della nuova versione?",
  ],
  source_policy: {
    preferred: ["specifiche ufficiali", "standard tecnici", "repository e contratti locali", "ADR e runbook verificati", "benchmark riproducibili"],
    conditional: ["paper peer-reviewed", "issue tracker del maintainer", "postmortem primari", "analisi vendor con metodologia dichiarata"],
    rejected: ["snippet senza provenienza", "benchmark non riproducibile", "blog SEO come unica fonte", "codice con licenza incompatibile"],
    freshness: "Verificare versione, data, runtime e compatibilita; una fonte storica vale solo come contesto dichiarato.",
    citation_rule: "Ogni proposta esterna deve legare fonte, versione, claim tecnico e prova locale.",
  },
  benchmarks: [
    "compatibilita dei contratti esistenti", "latenza p50/p95/p99 e throughput", "error rate e recovery time",
    "isolamento tenant e authorization failures", "copertura delle transizioni di stato", "tempo e affidabilita del rollback",
  ],
  negative_cases: [
    "contratto apparentemente compatibile ma semantica modificata", "retry che duplica una scrittura",
    "migrazione parziale tra versioni", "cache o sessione condivisa tra tenant", "rollback incompatibile con il nuovo schema",
    "test verdi con dipendenza reale assente", "successo medio che nasconde regressione p99", "decisione critica spostata in UI o prompt",
  ],
  learning_objectives: [
    "riconoscere confini e ownership stabili", "prevedere consumer e regressioni", "selezionare prove proporzionate al rischio",
    "distinguere miglioramento locale da salute sistemica", "riusare pattern solo con contesto compatibile", "mantenere ADR e runbook aggiornati",
  ],
  verify_criteria: [
    "contratti versionati e consumer enumerati", "test unitari, integrazione e failure-path pertinenti superati",
    "benchmark confrontato con baseline", "tenant isolation e autorizzazione provate negativamente",
    "migrazione e rollback provati su fixture rappresentative", "evidenze collegate a commit, runtime e decisione",
  ],
  stage_map: [
    { stage_id: "sensory_ingest", label: "Ingestione requisiti e topologia", research_focus: "Raccogliere requisiti, repository, runtime, contratti e dipendenze reali.", expected_artifact: "system_evidence_inventory", semantic_tags: ["requirements", "topology", "dependencies"] },
    { stage_id: "intent_router", label: "Routing per tipo di cambiamento", research_focus: "Classificare feature, bug, migrazione, sicurezza, performance o debito.", expected_artifact: "change_classification", semantic_tags: ["change_type", "routing", "ownership"] },
    { stage_id: "context_binding", label: "Binding di runtime e consumer", research_focus: "Legare richiesta a tenant, runtime, consumer, versioni e vincoli.", expected_artifact: "runtime_consumer_context", semantic_tags: ["runtime", "consumer", "scope"] },
    { stage_id: "rule_matrix", label: "Matrice contratti e invarianti", research_focus: "Esplicitare API, schema, stato, ownership e invarianti di compatibilita.", expected_artifact: "contract_invariant_matrix", semantic_tags: ["contracts", "invariants", "compatibility"] },
    { stage_id: "risk_surface", label: "Superficie failure e blast radius", research_focus: "Mappare sicurezza, concorrenza, dati, dipendenze e failure domain.", expected_artifact: "architecture_risk_map", semantic_tags: ["failure_domain", "blast_radius", "security"] },
    { stage_id: "execution_planning", label: "Piano incrementale di implementazione", research_focus: "Ordinare adapter, migrazioni, feature flag, test e rollout.", expected_artifact: "implementation_dependency_plan", semantic_tags: ["implementation", "migration", "delivery"] },
    { stage_id: "verification_contract", label: "Contratto di verifica multi-livello", research_focus: "Definire prove unit, contract, integration, e2e, security e performance.", expected_artifact: "verification_test_matrix", semantic_tags: ["testing", "acceptance", "evidence"] },
    { stage_id: "rollback_paths", label: "Prova di rollback e recovery", research_focus: "Verificare reversibilita di codice, schema, dati e configurazione.", expected_artifact: "rollback_recovery_runbook", semantic_tags: ["rollback", "schema", "recovery"] },
    { stage_id: "telemetry_capture", label: "Telemetria di architettura", research_focus: "Catturare latenza, errori, saturazione, audit e segnali per consumer.", expected_artifact: "runtime_signal_pack", semantic_tags: ["observability", "latency", "errors"] },
    { stage_id: "memory_distillation", label: "Distillazione dei pattern tecnici", research_focus: "Separare pattern riusabili da dettagli di questa implementazione.", expected_artifact: "architecture_pattern_candidate", semantic_tags: ["patterns", "distillation", "context"] },
    { stage_id: "feedback_loop", label: "Feedback da test e runtime", research_focus: "Collegare fallimenti e deviazioni ai confini o contratti responsabili.", expected_artifact: "engineering_feedback_cycle", semantic_tags: ["feedback", "regression", "ownership"] },
    { stage_id: "policy_reweighting", label: "Ricalibrazione delle regole architetturali", research_focus: "Proporre variazioni a priorita e guardrail senza attivarle.", expected_artifact: "architecture_policy_candidate", semantic_tags: ["policy", "guardrails", "proposal"] },
    { stage_id: "synaptic_consolidation", label: "Consolidamento tra rami software", research_focus: "Collegare architettura, sicurezza, test, release e osservabilita.", expected_artifact: "cross_branch_engineering_links", semantic_tags: ["cross_branch", "security", "release"] },
    { stage_id: "terminal_action_model", label: "Modello dell'azione tecnica", research_focus: "Dichiarare file, componenti, migrazioni, gate e owner della modifica.", expected_artifact: "bounded_change_model", semantic_tags: ["change_set", "authority", "gate"] },
    { stage_id: "outcome_observation", label: "Osservazione post-release", research_focus: "Misurare compatibilita, prestazioni, errori e comportamento reale.", expected_artifact: "post_release_observation", semantic_tags: ["production", "outcome", "slo"] },
    { stage_id: "expected_actual_comparison", label: "Confronto architettura attesa/reale", research_focus: "Confrontare ADR, benchmark e risultati per consumer.", expected_artifact: "architecture_variance_report", semantic_tags: ["expected_actual", "adr", "benchmark"] },
    { stage_id: "drift_detection", label: "Rilevamento drift di contratto", research_focus: "Trovare schema drift, dependency drift, config drift e ownership erosion.", expected_artifact: "technical_drift_report", semantic_tags: ["schema_drift", "dependency_drift", "ownership"] },
    { stage_id: "failure_attribution", label: "Attribuzione sistemica del guasto", research_focus: "Distinguere causa primaria, propagazione, rilevamento e recovery gap.", expected_artifact: "failure_causal_graph", semantic_tags: ["root_cause", "propagation", "recovery"] },
    { stage_id: "cross_branch_reconciliation", label: "Riconciliazione con sicurezza e release", research_focus: "Risolvere conflitti tra velocita, sicurezza, prodotto e operabilita.", expected_artifact: "engineering_tradeoff_record", semantic_tags: ["tradeoff", "security", "product"] },
    { stage_id: "knowledge_gap_update", label: "Backlog dei vuoti tecnici", research_focus: "Aggiornare incognite su dipendenze, scala, edge case e recovery.", expected_artifact: "technical_unknowns_backlog", semantic_tags: ["knowledge_gap", "edge_case", "research"] },
    { stage_id: "policy_candidate_review", label: "Review del pattern candidato", research_focus: "Valutare generalizzabilita, eccezioni e costo della nuova regola.", expected_artifact: "pattern_review_packet", semantic_tags: ["pattern_review", "exceptions", "cost"] },
    { stage_id: "human_review_checkpoint", label: "Checkpoint dell'architecture owner", research_focus: "Richiedere review umana su confini, rischio, migrazione e release.", expected_artifact: "architecture_owner_review", semantic_tags: ["human_review", "owner", "release"] },
    { stage_id: "verified_learning_commit", label: "Commit dell'apprendimento tecnico", research_focus: "Salvare soltanto pattern verificati con contesto, limiti e prove.", expected_artifact: "verified_engineering_memory", semantic_tags: ["verified_learning", "evidence", "limits"] },
    { stage_id: "continuity_handoff", label: "Handoff tecnico riproducibile", research_focus: "Passare ADR, stato, prove, rischi aperti e prossimo checkpoint.", expected_artifact: "engineering_continuity_pack", semantic_tags: ["handoff", "adr", "next_step"] },
  ],
});

const SUITE = defineProfile({
  id: "suite_research_learning_v1",
  area: "suite_vertical",
  label: "Suite/WaaS Research & Learning",
  branch_ids: ["suite_governance"],
  mission: "Governare siti, template, moduli, licenze, lead e rete commerciale mantenendo isolamento di tenant, brand e nodo.",
  semantic_tags: ["suite", "waas", "wordpress", "licensing", "templates", "claims", "pricing", "lead"],
  operational_subbranches: [
    "tenant_site_registry", "brand_node_scope", "waas_template_lifecycle", "module_entitlement_matrix",
    "license_activation_revocation", "wordpress_plugin_compatibility", "content_schema_governance", "claim_evidence_ledger",
    "pricing_advisory_policy", "catalog_offer_consistency", "lead_capture_consent", "b2b_crm_handoff",
    "distributor_visibility_scope", "translation_locale_parity", "seo_schema_quality", "analytics_attribution",
    "update_channel_integrity", "site_backup_restore", "credential_boundary", "template_accessibility",
    "performance_budget", "publish_preview_approval", "node_health_observability", "waas_onboarding_completion",
    "renewal_churn_signals", "cross_site_regression", "owner_override_audit", "commercial_policy_learning",
  ],
  research_questions: [
    "Quali differenze tra template sono configurazione lecita e quali fork pericolosi?",
    "Come verificare entitlement e revoca senza interrompere nodi autorizzati?",
    "Quali claim, prezzi e offerte divergono tra catalogo, sito e materiale commerciale?",
    "Quali versioni WordPress, plugin e temi costituiscono la matrice supportata?",
    "Come attribuire lead e conversioni senza confondere tenant, brand o canale?",
    "Quali segnali anticipano churn, mancato onboarding o degrado del nodo?",
    "Quale procedura garantisce preview, approvazione, publish e rollback?",
    "Quali contenuti e traduzioni richiedono nuova evidenza o review locale?",
  ],
  source_policy: {
    preferred: ["documentazione WordPress e plugin ufficiale", "catalogo e policy tenant autorizzati", "registro licenze", "analytics first-party", "test di compatibilita riproducibili"],
    conditional: ["linee guida SEO/accessibilita ufficiali", "benchmark field-data", "policy commerciali approvate", "issue upstream confermate"],
    rejected: ["claim competitor non verificati", "prezzi estratti senza data e mercato", "plugin nulled", "contenuto di altro tenant"],
    freshness: "Versioni plugin, prezzi, claim e compatibilita richiedono timestamp e scope di mercato.",
    citation_rule: "Ogni decisione Suite lega nodo, tenant, versione, fonte e autorizzazione.",
  },
  benchmarks: ["Core Web Vitals per template", "compatibilita plugin/versione", "tempo onboarding-to-live", "lead conversion per canale", "restore time", "locale parity"],
  negative_cases: ["template pubblicato senza preview", "licenza riutilizzata cross-tenant", "prezzo imposto al rivenditore", "claim senza evidenza", "lead senza consenso", "update che rompe un plugin", "traduzione che modifica il claim", "backup non ripristinabile"],
  learning_objectives: ["ridurre fork di template", "prevedere incompatibilita", "migliorare onboarding", "distillare pattern di conversione tenant-scoped", "rilevare claim e price drift", "validare restore e rollback"],
  verify_criteria: ["scope tenant/site provato", "matrice versioni superata", "preview approvata", "claim e pricing con fonte valida", "backup restore testato", "analytics e consenso coerenti"],
  stage_map: [
    { stage_id: "sensory_ingest", label: "Inventario nodo, contenuti e licenze", research_focus: "Raccogliere stato sito, moduli, versioni, catalogo, lead e consensi.", expected_artifact: "suite_node_inventory", semantic_tags: ["site", "modules", "license"] },
    { stage_id: "intent_router", label: "Routing WaaS, contenuti o commercio", research_focus: "Classificare onboarding, update, publish, claim, pricing, lead o supporto.", expected_artifact: "suite_work_route", semantic_tags: ["waas", "publish", "commerce"] },
    { stage_id: "context_binding", label: "Binding tenant-brand-site", research_focus: "Legare richiesta a tenant, brand, nodo, locale, piano e entitlement.", expected_artifact: "suite_scope_context", semantic_tags: ["tenant", "brand", "site_scope"] },
    { stage_id: "rule_matrix", label: "Matrice entitlement e contenuti", research_focus: "Applicare moduli, licenze, claim, pricing, consenso e publish policy.", expected_artifact: "suite_policy_matrix", semantic_tags: ["entitlement", "claims", "pricing"] },
    { stage_id: "risk_surface", label: "Rischio publish e isolamento", research_focus: "Mappare leak cross-site, credential exposure, claim e incompatibilita.", expected_artifact: "suite_risk_register", semantic_tags: ["isolation", "credentials", "compatibility"] },
    { stage_id: "execution_planning", label: "Piano preview-to-publish", research_focus: "Ordinare staging, migrazione contenuti, test, approvazione e rollout.", expected_artifact: "suite_delivery_plan", semantic_tags: ["preview", "staging", "rollout"] },
    { stage_id: "verification_contract", label: "Contratto di collaudo del nodo", research_focus: "Definire test visuali, funzionali, SEO, accessibilita e conversione.", expected_artifact: "suite_acceptance_matrix", semantic_tags: ["visual_qa", "seo", "accessibility"] },
    { stage_id: "rollback_paths", label: "Restore sito e configurazione", research_focus: "Provare restore di codice, database, contenuti, config e DNS.", expected_artifact: "suite_restore_runbook", semantic_tags: ["backup", "restore", "dns"] },
    { stage_id: "telemetry_capture", label: "Telemetria siti e funnel", research_focus: "Catturare salute, performance, errori, lead e conversioni per nodo.", expected_artifact: "suite_node_telemetry", semantic_tags: ["web_vitals", "lead", "conversion"] },
    { stage_id: "memory_distillation", label: "Distillazione template e onboarding", research_focus: "Estrarre pattern riusabili senza copiare dati o brand tenant.", expected_artifact: "waas_pattern_candidate", semantic_tags: ["template", "onboarding", "tenant_safe"] },
    { stage_id: "feedback_loop", label: "Feedback gestore-cliente-nodo", research_focus: "Collegare ticket, abbandoni, errori e risultati commerciali.", expected_artifact: "suite_feedback_cycle", semantic_tags: ["support", "churn", "outcome"] },
    { stage_id: "policy_reweighting", label: "Ricalibrazione governance Suite", research_focus: "Proporre soglie per update, claim e publish senza attivarle.", expected_artifact: "suite_policy_candidate", semantic_tags: ["governance", "threshold", "proposal"] },
    { stage_id: "synaptic_consolidation", label: "Collegamento sito-CRM-commerce", research_focus: "Consolidare connessioni tra contenuti, lead, CRM, catalogo e analytics.", expected_artifact: "suite_value_chain_links", semantic_tags: ["crm", "catalog", "analytics"] },
    { stage_id: "terminal_action_model", label: "Modello azione sul nodo", research_focus: "Dichiarare nodo, modifica, approvazione, credenziali e rollback.", expected_artifact: "suite_bounded_action", semantic_tags: ["node_action", "approval", "rollback"] },
    { stage_id: "outcome_observation", label: "Osservazione post-publish", research_focus: "Misurare salute, contenuti, lead, SEO e regressioni dopo update.", expected_artifact: "suite_release_observation", semantic_tags: ["post_publish", "health", "lead"] },
    { stage_id: "expected_actual_comparison", label: "Confronto obiettivi sito-risultati", research_focus: "Confrontare preview, KPI attesi e comportamento effettivo.", expected_artifact: "suite_variance_report", semantic_tags: ["kpi", "expected_actual", "conversion"] },
    { stage_id: "drift_detection", label: "Rilevamento drift tra nodi", research_focus: "Trovare version, template, claim, price e locale drift.", expected_artifact: "suite_drift_report", semantic_tags: ["version_drift", "claim_drift", "locale"] },
    { stage_id: "failure_attribution", label: "Attribuzione guasti WaaS", research_focus: "Separare causa template, plugin, hosting, contenuto o configurazione.", expected_artifact: "suite_failure_map", semantic_tags: ["plugin", "hosting", "root_cause"] },
    { stage_id: "cross_branch_reconciliation", label: "Riconciliazione Suite-commerciale", research_focus: "Risolvere conflitti tra sito, catalogo, CRM, legale e brand.", expected_artifact: "suite_policy_reconciliation", semantic_tags: ["catalog", "legal", "brand"] },
    { stage_id: "knowledge_gap_update", label: "Backlog ricerca Suite", research_focus: "Aggiornare dubbi su compatibilita, mercato, claim e funnel.", expected_artifact: "suite_research_backlog", semantic_tags: ["research_gap", "compatibility", "market"] },
    { stage_id: "policy_candidate_review", label: "Review pattern WaaS", research_focus: "Valutare applicabilita del pattern tra nodi e piani diversi.", expected_artifact: "waas_pattern_review", semantic_tags: ["pattern_review", "plans", "nodes"] },
    { stage_id: "human_review_checkpoint", label: "Checkpoint owner/publisher", research_focus: "Richiedere approvazione per publish, prezzi, claim o policy.", expected_artifact: "suite_owner_review", semantic_tags: ["owner", "publisher", "approval"] },
    { stage_id: "verified_learning_commit", label: "Memoria Suite verificata", research_focus: "Conservare pattern con scope, versione, evidenza e limiti.", expected_artifact: "verified_suite_memory", semantic_tags: ["verified_learning", "scope", "version"] },
    { stage_id: "continuity_handoff", label: "Handoff del nodo gestito", research_focus: "Passare stato, versione, KPI, rischi e prossime verifiche.", expected_artifact: "suite_node_handoff", semantic_tags: ["handoff", "node_state", "next_check"] },
  ],
});

const SMARTDESK = defineProfile({
  id: "smartdesk_research_learning_v1",
  area: "smartdesk_vertical",
  label: "Smart Desk Operations Research & Learning",
  branch_ids: ["smartdesk_operations_guard"],
  mission: "Migliorare operazioni, capacita e continuita commerciale usando dati reali senza alterare numeri o contattare clienti autonomamente.",
  semantic_tags: ["smartdesk", "appointments", "customers", "cash", "inventory", "operators", "crm", "capacity"],
  operational_subbranches: [
    "appointment_capacity_model", "operator_shift_balance", "service_duration_variance", "no_show_cancellation_pattern",
    "customer_identity_resolution", "consent_channel_matrix", "cash_payment_reconciliation", "revenue_source_attribution",
    "inventory_consumption_link", "reorder_threshold_evidence", "service_product_margin", "technology_utilization",
    "protocol_execution_record", "operator_skill_eligibility", "customer_journey_continuity", "recall_eligibility",
    "next_best_action_candidate", "base_silver_gold_entitlement", "ai_gold_explanation", "manual_correction_queue",
    "data_quality_completeness", "peak_load_forecast", "tenant_node_isolation", "audit_event_trace",
    "operational_slo", "failure_recovery_queue", "outcome_verified_learning", "human_operator_release",
  ],
  research_questions: [
    "Quali slot e operatori creano capacita inutilizzata o sovraccarico?",
    "Quali differenze tra durata prevista e reale alterano agenda e margine?",
    "Quali clienti sono eleggibili al recall per consenso, frequenza e storico?",
    "Quali ricavi e costi sono attribuibili senza inventare dati mancanti?",
    "Quale consumo di prodotto deriva realmente da servizio, vendita o rettifica?",
    "Quale suggerimento produce valore senza modificare numeri o inviare comunicazioni?",
    "Quali funzionalita appartengono a Base, Silver o Gold e come mostrarne la preview?",
    "Quali esiti verificati possono diventare pattern tenant-scoped?",
  ],
  source_policy: {
    preferred: ["ledger e audit Smart Desk", "agenda e pagamenti first-party", "catalogo tenant", "consensi registrati", "outcome operatore verificati"],
    conditional: ["benchmark gestionali anonimizzati", "stagionalita locale documentata", "linee guida fiscali ufficiali", "ricerca operativa con metodologia"],
    rejected: ["ricavi stimati presentati come reali", "profilazione senza consenso", "dati di altro tenant", "benchmark beauty senza campione dichiarato"],
    freshness: "Agenda, cassa, stock e consenso richiedono snapshot temporale coerente; confronti storici dichiarano finestra.",
    citation_rule: "Ogni insight cita record/snapshot, qualita dati, periodo e tenant senza esporre dati personali non necessari.",
  },
  benchmarks: ["saturazione agenda", "no-show e cancellazioni", "revenue per ora operatore", "durata prevista/reale", "stock accuracy", "recall conversion con consenso"],
  negative_cases: ["cliente duplicato", "pagamento senza appuntamento", "appuntamento spostato dopo snapshot", "consenso revocato", "stock negativo per sync", "AI corregge un importo", "messaggio inviato senza operatore", "confronto tra tenant"],
  learning_objectives: ["migliorare qualita dati", "stimare capacita con incertezza", "collegare servizio-prodotto-stock", "prioritizzare azioni confermabili", "spiegare raccomandazioni Gold", "distillare esiti verificati"],
  verify_criteria: ["snapshot coerente", "nessuna mutazione dei record", "consenso valido", "calcoli riconciliati al ledger", "entitlement rispettato", "review operatore prima di azioni esterne"],
  stage_map: [
    { stage_id: "sensory_ingest", label: "Ingestione agenda-cassa-stock", research_focus: "Raccogliere snapshot coerenti di clienti, agenda, operatori, pagamenti e stock.", expected_artifact: "smartdesk_operational_snapshot", semantic_tags: ["agenda", "cash", "inventory"] },
    { stage_id: "intent_router", label: "Routing operativo Smart Desk", research_focus: "Classificare capacita, cliente, cassa, stock, marketing, protocollo o supporto.", expected_artifact: "smartdesk_work_route", semantic_tags: ["capacity", "customer", "operations"] },
    { stage_id: "context_binding", label: "Binding tenant-centro-piano", research_focus: "Legare analisi a tenant, nodo, periodo, piano e ruoli operatore.", expected_artifact: "smartdesk_scope_context", semantic_tags: ["tenant", "center", "entitlement"] },
    { stage_id: "rule_matrix", label: "Matrice dati, consenso e piano", research_focus: "Applicare source-of-truth, consensi, ruoli e limiti Base/Silver/Gold.", expected_artifact: "smartdesk_rule_matrix", semantic_tags: ["source_of_truth", "consent", "plan"] },
    { stage_id: "risk_surface", label: "Rischio operativo e dati cliente", research_focus: "Mappare errori numerici, privacy, invii, overbooking e stock incoerente.", expected_artifact: "smartdesk_risk_map", semantic_tags: ["privacy", "overbooking", "numbers"] },
    { stage_id: "execution_planning", label: "Piano di azioni confermabili", research_focus: "Ordinare controlli, correzioni manuali e suggerimenti per impatto.", expected_artifact: "smartdesk_action_queue", semantic_tags: ["priority", "manual_review", "impact"] },
    { stage_id: "verification_contract", label: "Contratto di riconciliazione", research_focus: "Definire prove su ledger, agenda, stock, consenso e entitlement.", expected_artifact: "smartdesk_verification_matrix", semantic_tags: ["reconciliation", "ledger", "consent"] },
    { stage_id: "rollback_paths", label: "Ripristino operativo non distruttivo", research_focus: "Preparare undo, audit e recovery senza perdere eventi reali.", expected_artifact: "smartdesk_recovery_plan", semantic_tags: ["undo", "audit", "recovery"] },
    { stage_id: "telemetry_capture", label: "Telemetria centro e operatori", research_focus: "Calcolare saturazione, durata, no-show, ricavi e stock con qualita.", expected_artifact: "smartdesk_kpi_snapshot", semantic_tags: ["saturation", "duration", "revenue"] },
    { stage_id: "memory_distillation", label: "Distillazione pattern operativi", research_focus: "Estrarre pattern tenant-scoped da eventi e outcome verificati.", expected_artifact: "smartdesk_pattern_candidate", semantic_tags: ["tenant_scoped", "pattern", "outcome"] },
    { stage_id: "feedback_loop", label: "Feedback dell'operatore", research_focus: "Registrare accettazione, modifica, rifiuto e risultato del suggerimento.", expected_artifact: "operator_feedback_cycle", semantic_tags: ["operator", "feedback", "decision"] },
    { stage_id: "policy_reweighting", label: "Ricalibrazione priorita Gold", research_focus: "Proporre pesi per priorita senza modificare policy live.", expected_artifact: "smartdesk_priority_candidate", semantic_tags: ["gold", "priority", "proposal"] },
    { stage_id: "synaptic_consolidation", label: "Collegamento operazioni-CRM-analyzer", research_focus: "Connettere eventi operativi a journey, protocolli e catalogo autorizzato.", expected_artifact: "smartdesk_cross_branch_links", semantic_tags: ["crm", "journey", "catalog"] },
    { stage_id: "terminal_action_model", label: "Modello azione operatore", research_focus: "Dichiarare record, proposta, consenso, conferma e compensazione.", expected_artifact: "operator_confirmable_action", semantic_tags: ["record", "confirmation", "compensation"] },
    { stage_id: "outcome_observation", label: "Osservazione del risultato operativo", research_focus: "Misurare esito su agenda, cliente, cassa o stock senza causalita inventata.", expected_artifact: "smartdesk_outcome_observation", semantic_tags: ["outcome", "operations", "uncertainty"] },
    { stage_id: "expected_actual_comparison", label: "Confronto previsione-risultato", research_focus: "Confrontare capacita, durata, ricavo e risposta attesi con dati reali.", expected_artifact: "smartdesk_variance_report", semantic_tags: ["forecast", "actual", "variance"] },
    { stage_id: "drift_detection", label: "Rilevamento drift operativo", research_focus: "Trovare cambi in durata, mix servizi, no-show, stock e qualita dati.", expected_artifact: "smartdesk_drift_report", semantic_tags: ["duration_drift", "service_mix", "data_quality"] },
    { stage_id: "failure_attribution", label: "Attribuzione anomalie Smart Desk", research_focus: "Separare errore umano, sync, catalogo, calcolo o processo.", expected_artifact: "smartdesk_failure_map", semantic_tags: ["sync", "calculation", "process"] },
    { stage_id: "cross_branch_reconciliation", label: "Riconciliazione operativa verticale", research_focus: "Risolvere conflitti tra agenda, cassa, stock, CRM e protocolli.", expected_artifact: "smartdesk_reconciliation_record", semantic_tags: ["agenda", "cash", "protocol"] },
    { stage_id: "knowledge_gap_update", label: "Coda dati e ricerca mancanti", research_focus: "Esplicitare campi, periodi, benchmark e outcome mancanti.", expected_artifact: "smartdesk_gap_queue", semantic_tags: ["missing_data", "research", "outcome"] },
    { stage_id: "policy_candidate_review", label: "Review pattern operativo", research_focus: "Verificare stabilita, fairness e utilita del pattern nel tenant.", expected_artifact: "smartdesk_pattern_review", semantic_tags: ["stability", "fairness", "utility"] },
    { stage_id: "human_review_checkpoint", label: "Checkpoint operatore/owner", research_focus: "Richiedere review per dati, invii, automazioni e regole operative.", expected_artifact: "smartdesk_human_review", semantic_tags: ["operator_review", "owner", "external_action"] },
    { stage_id: "verified_learning_commit", label: "Memoria operativa verificata", research_focus: "Salvare esiti con periodo, qualita, scope e revisore.", expected_artifact: "verified_smartdesk_memory", semantic_tags: ["verified_learning", "data_quality", "reviewer"] },
    { stage_id: "continuity_handoff", label: "Handoff del centro operativo", research_focus: "Passare snapshot, priorita, verifiche aperte e prossima misura.", expected_artifact: "smartdesk_continuity_pack", semantic_tags: ["handoff", "priorities", "next_measure"] },
  ],
});

const ANALYZER = defineProfile({
  id: "analyzer_research_learning_v1",
  area: "analyzer_vertical",
  label: "Analyzer Evidence & Learning",
  branch_ids: ["skinharmony_analyzer", "beauty_vertical_orchestration"],
  mission: "Interpretare acquisizioni estetiche ripetibili, collegarle a catalogo e percorso del centro e apprendere solo da outcome verificati.",
  semantic_tags: ["analyzer", "capture", "skin", "quality", "protocol", "catalog", "fairness", "longitudinal"],
  operational_subbranches: [
    "capture_device_identity", "illumination_modality_control", "focus_distance_repeatability", "region_of_interest_alignment",
    "artifact_occlusion_detection", "score_calibration_provenance", "hydration_barrier_relation", "sebum_pore_relation",
    "texture_aging_relation", "pigmentation_tone_relation", "sensitivity_reactivity_relation", "porphyrin_context",
    "confounder_recent_treatment", "confounder_cosmetic_layer", "anamnesis_score_reconciliation", "uncertainty_abstention",
    "longitudinal_capture_comparability", "tone_group_performance_audit", "catalog_product_eligibility", "technology_operator_eligibility",
    "protocol_intensity_guard", "formulation_compatibility", "post_treatment_followup_window", "customer_report_language",
    "center_journey_handoff", "outcome_label_quality", "human_reviewer_agreement", "verified_learning_candidate",
    "device_model_drift", "cross_center_generalization_guard",
  ],
  research_questions: [
    "Quali modalita, luce, distanza e fuoco rendono acquisizioni confrontabili?",
    "Quali artefatti o trattamenti recenti possono spiegare il segnale senza rappresentare un cambiamento stabile?",
    "Quali relazioni tra score sono sostenute da dati e quali restano ipotesi?",
    "Quali prestazioni e astensioni emergono nei gruppi di tonalita rappresentati?",
    "Quali prodotti, tecnologie e protocolli sono realmente presenti e compatibili?",
    "Quale finestra di follow-up distingue effetto temporaneo e variazione osservabile?",
    "Quali outcome sono validi, comparabili e revisionati abbastanza da alimentare apprendimento?",
    "Come separare raccomandazione estetica, comunicazione cliente e divieto di diagnosi?",
  ],
  source_policy: {
    preferred: ["specifiche dispositivo e SDK ufficiali", "dataset con protocollo e composizione dichiarati", "letteratura peer-reviewed pertinente", "catalogo centro autorizzato", "outcome longitudinali revisionati"],
    conditional: ["white paper con metodo completo", "benchmark interni con controllo acquisizione", "linee guida cosmetiche e sicurezza ufficiali", "manuali operatore verificati"],
    rejected: ["diagnosi da immagine", "dataset senza provenance", "prima/dopo non comparabile", "claim prodotto non autorizzato", "inferenza etnica"],
    freshness: "Device, SDK, catalogo e claim richiedono versione; evidenza scientifica deve dichiarare popolazione e limiti.",
    citation_rule: "Ogni interpretazione lega segnale, qualita acquisizione, fonte, incertezza e catalogo applicabile.",
  },
  benchmarks: ["capture repeatability", "inter-device agreement", "abstention precision", "longitudinal comparability", "tone-group error distribution", "human reviewer agreement"],
  negative_cases: ["fuoco insufficiente", "luce/modalita diversa", "cosmetico sulla cute", "trattamento recente", "ROI disallineata", "prodotto inventato", "diagnosi clinica", "improvement da esposizione diversa", "outcome senza review"],
  learning_objectives: ["migliorare quality gate", "calibrare astensione", "riconoscere confondenti", "mantenere equita misurabile", "collegare solo catalogo autorizzato", "imparare da follow-up comparabili"],
  verify_criteria: ["provenance completa", "quality threshold soddisfatta", "confronto acquisizione comparabile", "incertezza esplicita", "catalogo e idoneita verificati", "outcome e review umana presenti"],
  stage_map: [
    { stage_id: "sensory_ingest", label: "Ingestione acquisizione e anamnesi", research_focus: "Raccogliere immagine, modalita, device, score, qualita, anamnesi e catalogo.", expected_artifact: "analyzer_evidence_bundle", semantic_tags: ["capture", "device", "anamnesis"] },
    { stage_id: "intent_router", label: "Routing cute, percorso o follow-up", research_focus: "Classificare lettura, comparazione, catalogo, protocollo o ricerca.", expected_artifact: "analyzer_intent_route", semantic_tags: ["analysis", "followup", "research"] },
    { stage_id: "context_binding", label: "Binding soggetto-device-centro", research_focus: "Legare dati a tenant, soggetto, device, protocollo, operatore e tempo.", expected_artifact: "analyzer_scope_context", semantic_tags: ["subject_scope", "device", "operator"] },
    { stage_id: "rule_matrix", label: "Matrice qualita e idoneita", research_focus: "Applicare quality gate, comparabilita, linguaggio e catalog eligibility.", expected_artifact: "analyzer_rule_matrix", semantic_tags: ["quality_gate", "comparability", "eligibility"] },
    { stage_id: "risk_surface", label: "Rischio artefatti, bias e claim", research_focus: "Mappare confondenti, tonalita, diagnosi, overclaim e catalogo inventato.", expected_artifact: "analyzer_risk_map", semantic_tags: ["artifact", "fairness", "claims"] },
    { stage_id: "execution_planning", label: "Piano analisi-raccomandazione", research_focus: "Ordinare repeat capture, ensemble score, astensione e percorso operatore.", expected_artifact: "analyzer_analysis_plan", semantic_tags: ["repeat_capture", "ensemble", "abstention"] },
    { stage_id: "verification_contract", label: "Contratto evidenza Analyzer", research_focus: "Definire provenance, ripetibilita, review, catalogo e follow-up.", expected_artifact: "analyzer_verification_contract", semantic_tags: ["provenance", "repeatability", "review"] },
    { stage_id: "rollback_paths", label: "Ritiro raccomandazione e recalibrazione", research_focus: "Prevedere invalidazione dell'analisi e ritorno a review manuale.", expected_artifact: "analyzer_recovery_path", semantic_tags: ["invalidate", "manual_review", "recalibration"] },
    { stage_id: "telemetry_capture", label: "Telemetria qualità e astensione", research_focus: "Catturare qualita, ripetizioni, errori, astensioni e accordo umano.", expected_artifact: "analyzer_quality_telemetry", semantic_tags: ["quality", "abstention", "agreement"] },
    { stage_id: "memory_distillation", label: "Distillazione pattern estetici", research_focus: "Estrarre relazioni solo da acquisizioni e outcome comparabili.", expected_artifact: "analyzer_pattern_candidate", semantic_tags: ["longitudinal", "pattern", "outcome"] },
    { stage_id: "feedback_loop", label: "Feedback operatore e follow-up", research_focus: "Collegare revisione, percorso scelto, tolleranza e nuova acquisizione.", expected_artifact: "analyzer_feedback_cycle", semantic_tags: ["operator", "tolerance", "followup"] },
    { stage_id: "policy_reweighting", label: "Ricalibrazione soglie candidata", research_focus: "Proporre quality/abstention threshold senza cambiare policy live.", expected_artifact: "analyzer_threshold_candidate", semantic_tags: ["threshold", "abstention", "proposal"] },
    { stage_id: "synaptic_consolidation", label: "Collegamento Analyzer-beauty journey", research_focus: "Connettere score, protocollo, cosmetica, catalogo, CRM e valore.", expected_artifact: "analyzer_vertical_links", semantic_tags: ["protocol", "catalog", "journey"] },
    { stage_id: "terminal_action_model", label: "Modello raccomandazione estetica", research_focus: "Dichiarare evidenze, limiti, proposta, operatore e follow-up.", expected_artifact: "bounded_analyzer_recommendation", semantic_tags: ["recommendation", "limits", "operator"] },
    { stage_id: "outcome_observation", label: "Osservazione longitudinale", research_focus: "Misurare nuova acquisizione, tolleranza e outcome dichiarato.", expected_artifact: "analyzer_longitudinal_observation", semantic_tags: ["longitudinal", "tolerance", "outcome"] },
    { stage_id: "expected_actual_comparison", label: "Confronto raccomandazione-outcome", research_focus: "Confrontare risultato atteso, score comparabili e valutazione umana.", expected_artifact: "analyzer_outcome_variance", semantic_tags: ["expected_actual", "scores", "human_review"] },
    { stage_id: "drift_detection", label: "Rilevamento drift device e popolazione", research_focus: "Trovare drift di device, protocollo, qualita e distribuzione errori.", expected_artifact: "analyzer_drift_report", semantic_tags: ["device_drift", "protocol_drift", "error_distribution"] },
    { stage_id: "failure_attribution", label: "Attribuzione errore di analisi", research_focus: "Separare acquisizione, algoritmo, confondente, catalogo e review.", expected_artifact: "analyzer_failure_map", semantic_tags: ["acquisition", "algorithm", "confounder"] },
    { stage_id: "cross_branch_reconciliation", label: "Riconciliazione Analyzer-protocollo", research_focus: "Risolvere conflitti tra score, anamnesi, sicurezza e percorso commerciale.", expected_artifact: "analyzer_vertical_reconciliation", semantic_tags: ["anamnesis", "safety", "commercial"] },
    { stage_id: "knowledge_gap_update", label: "Backlog di evidenza Analyzer", research_focus: "Aggiornare gap su tonalita, device, confondenti, outcome e catalogo.", expected_artifact: "analyzer_research_backlog", semantic_tags: ["evidence_gap", "tone", "device"] },
    { stage_id: "policy_candidate_review", label: "Review candidata di calibrazione", research_focus: "Verificare validita, fairness, generalizzazione e rischio.", expected_artifact: "analyzer_calibration_review", semantic_tags: ["calibration", "fairness", "generalization"] },
    { stage_id: "human_review_checkpoint", label: "Checkpoint esperto/operatore", research_focus: "Richiedere review prima di learning, protocollo o comunicazione cliente.", expected_artifact: "analyzer_human_review", semantic_tags: ["expert_review", "operator", "customer"] },
    { stage_id: "verified_learning_commit", label: "Memoria Analyzer verificata", research_focus: "Salvare pattern con provenance, coorte, limiti e reviewer.", expected_artifact: "verified_analyzer_memory", semantic_tags: ["verified_learning", "provenance", "cohort"] },
    { stage_id: "continuity_handoff", label: "Handoff percorso Analyzer", research_focus: "Passare baseline, evidenze, astensioni, percorso e follow-up.", expected_artifact: "analyzer_continuity_pack", semantic_tags: ["handoff", "baseline", "followup"] },
  ],
});

export const BRANCH_RESEARCH_LEARNING_PROFILES = Object.freeze({
  [SOFTWARE_ARCHITECTURE.id]: SOFTWARE_ARCHITECTURE,
  [SUITE.id]: SUITE,
  [SMARTDESK.id]: SMARTDESK,
  [ANALYZER.id]: ANALYZER,
});

const PROFILE_BY_BRANCH_ID = Object.freeze(
  Object.fromEntries(
    Object.values(BRANCH_RESEARCH_LEARNING_PROFILES)
      .flatMap((profile) => profile.branch_ids.map((branchId) => [branchId, profile])),
  ),
);

export function getBranchResearchLearningProfile(branchId) {
  return PROFILE_BY_BRANCH_ID[String(branchId || "")] || null;
}

export function researchLearningProfileSummary(profile) {
  if (!profile) return null;
  return Object.freeze({
    profile_id: profile.id,
    area: profile.area,
    label: profile.label,
    mission: profile.mission,
    semantic_tags: profile.semantic_tags,
    operational_subbranches: profile.operational_subbranches,
    research_question_count: profile.research_questions.length,
    benchmark_count: profile.benchmarks.length,
    negative_case_count: profile.negative_cases.length,
    learning_objective_count: profile.learning_objectives.length,
    verify_criteria_count: profile.verify_criteria.length,
    stage_count: Object.keys(profile.stage_map).length,
  });
}

