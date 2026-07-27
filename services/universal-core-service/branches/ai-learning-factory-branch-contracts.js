const CONTRACT_VERSION = "ai_learning_factory_branch_contract_v1";

export const AI_LEARNING_EXPOSURE = freezeRecord({
  horizontal: {
    exposure_class: "chatgpt_horizontal",
    allowed_client_types: ["chatgpt", "codex", "api_agent", "smartdesk", "analyzer", "tricocamera", "suite", "waas", "admin"],
    allowed_audiences: ["chatgpt_connector", "codex_internal", "api_agent", "smartdesk_runtime", "analyzer_runtime", "suite_runtime", "admin_control_room"],
    required_entitlements: [],
    discoverable_in_connector: true,
    semantic_select_allowed: true,
  },
  guard: {
    exposure_class: "codex_internal",
    allowed_client_types: ["codex", "admin"],
    allowed_audiences: ["codex_internal", "admin_control_room"],
    required_entitlements: [],
    discoverable_in_connector: true,
    semantic_select_allowed: true,
  },
  test_only: {
    exposure_class: "test_only",
    allowed_client_types: ["admin"],
    allowed_audiences: ["admin_control_room"],
    required_entitlements: [],
    discoverable_in_connector: true,
    semantic_select_allowed: false,
  },
});

function freezeRecord(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeRecord));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, freezeRecord(item)]),
    ));
  }
  return value;
}

function buildNodeContract(branch, [id, purpose]) {
  return freezeRecord({
    id,
    contract_version: CONTRACT_VERSION,
    purpose,
    input: {
      schema_version: `${branch.id}_${id}_input_v1`,
      required: ["tenant_id", "run_id", "policy_snapshot", "evidence_digest"],
      optional: [...branch.optional_inputs],
      content_policy: "redacted_metadata_and_evidence_references_only",
    },
    output: {
      schema_version: `${branch.id}_${id}_output_v1`,
      artifact_type: `${branch.id}_${id}_assessment`,
      required: ["status", "evidence", "confidence", "limitations", "proposal"],
      authority: "advisory",
      autonomous_activation: false,
    },
    activation: {
      when: [...branch.activation],
      requires: ["tenant_scope_verified", "policy_snapshot_present", "evidence_digest_present"],
    },
    non_activation: {
      when: [
        "tenant_scope_missing_or_mismatched",
        "policy_snapshot_missing",
        "evidence_missing_or_unredacted",
        ...branch.non_activation,
      ],
      result: "fail_closed_with_reason",
    },
    evidence: {
      required: [...branch.evidence],
      minimum_independent_items: branch.minimum_independent_items,
      raw_prompt_storage: false,
      raw_sensitive_content_storage: false,
    },
    metrics: [
      `${branch.id}_${id}_coverage`,
      `${branch.id}_${id}_confidence`,
      ...branch.metrics,
    ],
    fallback: {
      state: "manual_review_or_verified_baseline",
      preserves: ["audit_lineage", "previous_verified_snapshot", "tenant_isolation"],
    },
    abstention: {
      when: ["confidence_below_policy", "evidence_requirements_not_met", "authority_not_verified"],
      result: "abstain_with_bounded_reason",
      external_effect: false,
    },
    audit: {
      required: ["tenant_id", "run_id", "policy_snapshot", "evidence_digest", "decision_status"],
      raw_prompt_storage: false,
      raw_sensitive_content_storage: false,
    },
    rollback: {
      strategy: branch.rollback_strategy,
      reference_required: true,
      preserves: ["audit_record", "dataset_metadata", "redacted_trace_metadata"],
    },
  });
}

function defineBranch({
  id,
  label,
  productionStatus,
  description,
  entries,
  optionalInputs,
  activation,
  nonActivation,
  evidence,
  metrics,
  rollbackStrategy,
  minimumIndependentItems = 1,
}) {
  const branch = {
    id,
    label,
    production_status: productionStatus,
    description,
    optional_inputs: optionalInputs,
    activation,
    non_activation: nonActivation,
    evidence,
    metrics,
    rollback_strategy: rollbackStrategy,
    minimum_independent_items: minimumIndependentItems,
  };
  const contracts = Object.fromEntries(entries.map((entry) => [entry[0], buildNodeContract(branch, entry)]));
  return freezeRecord({
    ...branch,
    subbranches: entries.map(([subbranchId]) => subbranchId),
    subbranch_contracts: contracts,
  });
}

function defineBoundedBranch(options, directLimit = 20) {
  const full = defineBranch(options);
  const directIds = full.subbranches.slice(0, directLimit);
  const facetIds = full.subbranches.slice(directLimit);
  return freezeRecord({
    ...full,
    subbranches: directIds,
    subbranch_contracts: Object.fromEntries(directIds.map((id) => [id, full.subbranch_contracts[id]])),
    all_capability_ids: full.subbranches,
    capability_facets: {
      schema_version: "ai_learning_factory_bounded_capability_facets_v1",
      branch_id: full.id,
      expansion_mode: "bounded_contract_facets",
      facet_count: facetIds.length,
      facets: facetIds.map((id) => full.subbranch_contracts[id]),
      authority: "advisory",
      autonomous_activation: false,
    },
  });
}

export const AI_LEARNING_FACTORY_BRANCHES = freezeRecord({
  ai_evaluation_intelligence: defineBranch({
    id: "ai_evaluation_intelligence",
    label: "AI Evaluation Intelligence",
    productionStatus: "advisory",
    description: "Versiona benchmark, trace e scorecard per misurare routing, strumenti, handoff, qualita e sicurezza senza promozione autonoma.",
    entries: [
      ["evaluation_intake", "Normalizzare obiettivo, popolazione, soglie e limiti della valutazione."],
      ["dataset_registry", "Riferire dataset versionati, tenant-scoped e separati dai contenuti grezzi."],
      ["golden_case_versioning", "Versionare casi golden con criteri, provenienza e revisori dichiarati."],
      ["trace_capture_contract", "Definire i metadati redatti necessari per ricostruire una run valutabile."],
      ["branch_selection_accuracy", "Misurare la correttezza della selezione del ramo contro il golden set."],
      ["tool_selection_accuracy", "Misurare scelta dello strumento e conformita dello schema di output."],
      ["handoff_accuracy", "Verificare destinazione, contratto, evidenza e completamento degli handoff."],
      ["final_output_quality", "Valutare correttezza, completezza, limiti e utilita dell'output finale."],
      ["safety_compliance_score", "Misurare conformita a policy, astensione e assenza di effetti non autorizzati."],
      ["judge_calibration", "Calibrare i giudici contro criteri deterministici e revisione umana."],
      ["human_annotation_agreement", "Misurare accordo e disaccordo tra annotatori indipendenti."],
      ["regression_detection", "Confrontare una candidate release con la baseline verificata."],
      ["benchmark_segmentation", "Segmentare risultati per difficolta, client, audience e classe di rischio."],
      ["contamination_guard", "Rilevare sovrapposizione o contaminazione tra training, eval e casi golden."],
      ["eval_replay", "Riprodurre in modo deterministico trace redatte contro snapshot vincolati."],
      ["release_scorecard", "Produrre scorecard versionata con regressioni, confidenza, limiti e proposta."],
    ],
    optionalInputs: ["dataset_version", "golden_set_version", "trace_ids", "baseline_scorecard"],
    activation: ["evaluation_scope_is_bounded", "dataset_or_trace_metadata_available"],
    nonActivation: ["golden_set_contaminated", "judge_not_calibrated"],
    evidence: ["versioned_dataset_reference", "policy_bound_trace_reference", "scoring_criteria"],
    metrics: ["branch_selection_accuracy", "tool_selection_accuracy", "safety_compliance_rate"],
    rollbackStrategy: "invalidate_scorecard_and_restore_previous_verified_baseline",
    minimumIndependentItems: 2,
  }),
  learning_data_governance: defineBranch({
    id: "learning_data_governance",
    label: "Learning Data Governance",
    productionStatus: "advisory",
    description: "Costruisce candidate dataset tenant-scoped con consenso, provenance, redazione, qualita, separazione e cancellazione riconciliata.",
    entries: [
      ["outcome_event_normalization", "Normalizzare outcome eterogenei in eventi versionati e confrontabili."],
      ["label_provenance", "Legare ogni label alla fonte, al revisore e al metodo di derivazione."],
      ["consent_eligibility", "Verificare consenso, finalita e idoneita prima dell'uso per apprendimento."],
      ["tenant_scope_validation", "Impedire inclusioni cross-tenant o scope non dimostrati."],
      ["secret_pii_redaction", "Rimuovere segreti e dati personali non necessari prima della candidatura."],
      ["data_quality_gate", "Misurare completezza, coerenza, validita e limiti del candidato dataset."],
      ["deduplication", "Eliminare duplicati senza perdere provenienza o rappresentativita."],
      ["hard_negative_mining", "Selezionare esempi negativi difficili con prova e bilanciamento."],
      ["active_learning_sampling", "Proporre campioni informativi entro budget e policy dichiarati."],
      ["replay_buffer", "Mantenere riferimenti versionati a casi riproducibili e non contenuti grezzi."],
      ["train_eval_separation", "Impedire sovrapposizione tra candidate training, eval e golden set."],
      ["poisoning_detection", "Rilevare pattern di poisoning, injection o label manipulation."],
      ["retention_expiry", "Applicare scadenza, retention e riesame alle candidate dataset."],
      ["dataset_versioning", "Produrre snapshot immutabile con digest, lineage e policy binding."],
      ["learning_candidate_promotion", "Preparare una proposta di promozione soggetta a eval e review umana."],
      ["deletion_reconciliation", "Propagare cancellazioni e revoche attraverso versioni e indici derivati."],
    ],
    optionalInputs: ["outcome_event_ids", "consent_receipts", "label_records", "retention_policy"],
    activation: ["learning_candidate_requested", "eligible_outcome_metadata_available"],
    nonActivation: ["consent_not_proven", "deletion_not_reconciled", "poisoning_not_quarantined"],
    evidence: ["tenant_binding", "consent_or_eligibility_receipt", "provenance_graph", "redaction_report"],
    metrics: ["eligible_record_rate", "redaction_rate", "train_eval_overlap_rate"],
    rollbackStrategy: "revoke_candidate_dataset_version_and_restore_previous_manifest",
  }),
  ai_runtime_performance_intelligence: defineBranch({
    id: "ai_runtime_performance_intelligence",
    label: "AI Runtime Performance Intelligence",
    productionStatus: "advisory",
    description: "Misura latenza, costo, token, code, saturazione e qualita per outcome verificato e propone ottimizzazioni bounded.",
    entries: [
      ["run_latency_decomposition", "Scomporre la latenza end-to-end in route, queue, tool, handoff e provider."],
      ["time_to_first_token", "Misurare TTFT per route e snapshot senza salvare contenuti."],
      ["branch_router_latency", "Misurare costo e latenza del routing server-side."],
      ["tool_call_latency", "Attribuire latenza e timeout alle singole classi di strumento."],
      ["handoff_latency", "Misurare attesa, trasferimento e verifica degli handoff."],
      ["token_efficiency", "Rapportare token utili a outcome verificati e retry evitabili."],
      ["cost_per_success", "Calcolare costo stimato per outcome riuscito e verificato."],
      ["retry_fallback_efficiency", "Misurare valore, costo e latenza di retry e fallback."],
      ["cache_hit_quality", "Verificare che gli hit cache conservino qualita, isolamento e freschezza."],
      ["queue_backpressure", "Rilevare pressione di coda, attesa e rischio di deadline breach."],
      ["concurrency_saturation", "Individuare saturazione e contention entro i limiti di concorrenza."],
      ["provider_model_comparison", "Confrontare provider e snapshot su qualita, costo, latenza e rischio."],
      ["quality_cost_pareto", "Costruire la frontiera Pareto tra qualita verificata e costo."],
      ["slo_breach_detection", "Rilevare violazioni SLO per segmento con attribution verificabile."],
      ["capacity_forecast", "Prevedere capacita richiesta da trend redatti e aggregati."],
      ["performance_release_score", "Produrre score di release con p50, p95, p99 e raccomandazioni bounded."],
    ],
    optionalInputs: ["trace_metadata", "baseline_window", "slo_policy", "cost_snapshot"],
    activation: ["redacted_runtime_metrics_available", "outcome_verification_available"],
    nonActivation: ["sample_size_below_policy", "cost_snapshot_stale"],
    evidence: ["redacted_trace_aggregate", "outcome_verification_reference", "measurement_window"],
    metrics: ["latency_p50_ms", "latency_p95_ms", "latency_p99_ms", "cost_per_verified_success"],
    rollbackStrategy: "discard_performance_candidate_and_restore_previous_routing_recommendation",
  }),
  experiment_causal_learning: defineBranch({
    id: "experiment_causal_learning",
    label: "Experiment & Causal Learning",
    productionStatus: "advisory",
    description: "Registra esperimenti shadow, canary e A/B, misura causalita e propone promozione o rollback senza attivarli.",
    entries: [
      ["experiment_intake", "Normalizzare ambito, popolazione, rischio, budget e autorita dell'esperimento."],
      ["hypothesis_definition", "Definire ipotesi falsificabile, outcome e soglia prima dell'osservazione."],
      ["baseline_control", "Vincolare una baseline riproducibile e comparabile."],
      ["assignment_integrity", "Verificare assegnazione stabile, bilanciata e tenant-scoped."],
      ["shadow_experiment", "Valutare candidati senza controllare output o azioni di produzione."],
      ["canary_experiment", "Definire un canary limitato soggetto a guard e conferma esterna."],
      ["ab_experiment", "Definire gruppi A/B con assegnazione e metriche versionate."],
      ["guardrail_metrics", "Monitorare sicurezza, qualita, costo e SLO come vincoli di arresto."],
      ["uplift_estimation", "Stimare uplift e intervalli di confidenza rispetto alla baseline."],
      ["sequential_stopping", "Applicare regole di arresto predefinite evitando letture opportunistiche."],
      ["novelty_interference_guard", "Rilevare effetti novita, interferenza e contaminazione tra esperimenti."],
      ["causal_attribution", "Separare evidenza causale da correlazione e fattori confondenti."],
      ["rollback_trigger", "Definire soglie verificabili che propongono ritiro o rollback."],
      ["experiment_registry", "Versionare ipotesi, assegnazioni, metriche, lineage e stato."],
      ["promotion_recommendation", "Produrre proposta di promozione con evidenza, review e rollback."],
      ["post_promotion_monitoring", "Definire sorveglianza e criteri di revoca dopo una promozione esterna."],
    ],
    optionalInputs: ["experiment_id", "baseline_version", "assignment_manifest", "guardrail_policy"],
    activation: ["experiment_scope_registered", "baseline_and_outcomes_measurable"],
    nonActivation: ["assignment_integrity_failed", "guardrail_policy_missing"],
    evidence: ["experiment_manifest", "baseline_reference", "assignment_digest", "guardrail_measurements"],
    metrics: ["uplift_estimate", "confidence_interval_width", "guardrail_breach_count"],
    rollbackStrategy: "stop_experiment_candidate_and_restore_verified_baseline",
    minimumIndependentItems: 2,
  }),
  model_adaptation_lab: defineBranch({
    id: "model_adaptation_lab",
    label: "Model Adaptation Lab",
    productionStatus: "test_only",
    description: "Valuta offline candidati prompt, router, modello, effort e tool surface; non modifica configurazioni o pesi live.",
    entries: [
      ["prompt_version_registry", "Versionare prompt candidati con digest, lineage e stato non-live."],
      ["prompt_candidate_generation", "Produrre proposte di prompt per eval offline senza attivazione."],
      ["router_candidate", "Descrivere una strategia router candidata per replay e shadow eval."],
      ["model_candidate", "Registrare uno snapshot modello candidato senza selezione live."],
      ["reasoning_effort_candidate", "Valutare budget di ragionamento candidati contro difficolta e costo."],
      ["tool_surface_candidate", "Valutare una superficie strumenti minima senza esporla al runtime."],
      ["distillation_candidate", "Registrare una proposta di distillazione senza avviare training."],
      ["fine_tune_candidate", "Documentare fattibilita e rischi di fine-tune senza eseguirlo."],
      ["offline_eval", "Valutare candidati solo su dataset separati e versionati."],
      ["shadow_eval", "Confrontare candidati in shadow senza influenzare output live."],
      ["risk_review", "Valutare sicurezza, privacy, isolamento e failure mode del candidato."],
      ["cost_review", "Stimare costo totale, regressioni e sostenibilita del candidato."],
      ["promotion_proposal", "Produrre proposta non vincolante con review umana e autorita Core."],
      ["rollback_snapshot", "Associare il candidato a uno snapshot di rollback verificabile."],
      ["drift_revalidation", "Richiedere nuova valutazione quando dati, modello o policy cambiano."],
      ["candidate_deprecation", "Ritirare candidati obsoleti preservando lineage e audit."],
    ],
    optionalInputs: ["candidate_manifest", "offline_dataset_version", "shadow_trace_ids", "risk_policy"],
    activation: ["explicit_test_lab_scope", "offline_or_shadow_evaluation_requested"],
    nonActivation: ["production_route_requested", "live_mutation_requested", "training_execution_requested"],
    evidence: ["candidate_digest", "offline_dataset_reference", "risk_review_record", "rollback_snapshot"],
    metrics: ["offline_quality_delta", "shadow_quality_delta", "estimated_cost_delta"],
    rollbackStrategy: "deprecate_candidate_and_restore_previous_lab_snapshot",
    minimumIndependentItems: 2,
  }),
});

export const AI_LEARNING_CORE_GUARDS = freezeRecord({
  ai_learning_governance_guard: defineBranch({
    id: "ai_learning_governance_guard",
    label: "AI Learning Governance Guard",
    productionStatus: "advisory",
    description: "Blocca promozioni prive di eval, review, lineage, autorita e rollback e mantiene ogni candidato in shadow fino a prova completa.",
    entries: [
      ["learning_candidate_intake", "Normalizzare candidato, finalita, tenant, scope ed effetti richiesti."],
      ["evidence_completeness", "Verificare presenza e consistenza delle prove richieste."],
      ["eval_threshold_policy", "Applicare soglie versionate a scorecard e regressioni."],
      ["human_review_requirement", "Determinare e registrare la review umana obbligatoria."],
      ["promotion_authority", "Verificare che l'autorita di promozione sia esplicita e limitata."],
      ["rollback_binding", "Vincolare candidato e promozione a uno snapshot ripristinabile."],
      ["expiry_revalidation", "Far scadere evidenze e richiedere riesame su cambi rilevanti."],
      ["shadow_canary_gate", "Imporre la sequenza offline, shadow e canary quando autorizzata."],
      ["model_prompt_version_binding", "Legare decisione a snapshot modello e versione prompt immutabili."],
      ["experiment_lineage", "Collegare candidato, esperimento, dataset, scorecard e outcome."],
      ["audit_commit", "Produrre record di decisione redatto, immutabile e tenant-scoped."],
      ["post_promotion_watch", "Richiedere metriche e criteri di revoca dopo promozione esterna."],
      ["emergency_stop", "Proporre arresto immediato su guardrail breach senza auto-promuovere alternative."],
    ],
    optionalInputs: ["candidate_id", "scorecard_version", "review_receipt", "promotion_request"],
    activation: ["learning_candidate_enters_governance", "promotion_or_experiment_review_requested"],
    nonActivation: ["candidate_lineage_missing", "rollback_snapshot_missing"],
    evidence: ["candidate_manifest", "versioned_scorecard", "human_review_receipt", "rollback_reference"],
    metrics: ["blocked_incomplete_candidate_count", "expired_evidence_count", "post_promotion_breach_count"],
    rollbackStrategy: "revoke_governance_decision_and_restore_previous_policy_snapshot",
    minimumIndependentItems: 2,
  }),
  ai_data_integrity_guard: defineBranch({
    id: "ai_data_integrity_guard",
    label: "AI Data Integrity Guard",
    productionStatus: "advisory",
    description: "Protegge isolamento, consenso, redazione, provenance, versioni e separazione train/eval dei dati di apprendimento.",
    entries: [
      ["tenant_scope_enforcement", "Bloccare record privi di binding tenant verificabile."],
      ["client_audience_boundary", "Applicare il confine tra client, audience ed entitlement del dataset."],
      ["consent_binding", "Legare ogni record eleggibile a consenso o base autorizzativa."],
      ["pii_secret_redaction", "Rimuovere PII e segreti non necessari e registrarene il digest."],
      ["provenance_required", "Rifiutare label o outcome senza lineage ricostruibile."],
      ["label_integrity", "Verificare coerenza, revisore e metodo di assegnazione delle label."],
      ["dataset_version_lock", "Impedire mutazioni silenziose di snapshot dataset versionati."],
      ["train_eval_separation", "Bloccare sovrapposizione tra training, eval e golden set."],
      ["poisoning_injection_quarantine", "Quarantinare record con segnali di poisoning o prompt injection."],
      ["retention_deletion", "Applicare retention, expiry, revoca e cancellazione riconciliata."],
      ["export_restriction", "Impedire export fuori tenant, audience o finalita autorizzata."],
      ["incident_revocation", "Revocare candidate dataset e derivati durante un incidente."],
    ],
    optionalInputs: ["dataset_version", "record_digests", "consent_receipts", "deletion_manifest"],
    activation: ["dataset_candidate_created_or_read", "learning_record_ingested_or_exported"],
    nonActivation: ["identity_or_audience_unverified", "redaction_report_missing"],
    evidence: ["tenant_binding", "client_audience_binding", "provenance_graph", "integrity_report"],
    metrics: ["cross_tenant_violation_count", "quarantined_record_count", "train_eval_overlap_rate"],
    rollbackStrategy: "quarantine_dataset_version_and_restore_previous_integrity_manifest",
  }),
});

export const AI_AGENTIC_EFFICIENCY_BRANCHES = freezeRecord({
  agentic_efficiency_intelligence: defineBoundedBranch({
    id: "agentic_efficiency_intelligence",
    label: "Agentic Efficiency Intelligence",
    productionStatus: "advisory",
    description: "Riduce invocazioni, contesto, duplicazioni e costo preservando qualita, sicurezza, isolamento e verifica.",
    entries: [
      ["task_complexity_estimation", "Stimare difficolta, rischio e bisogno di coordinamento prima di scegliere la topologia."],
      ["single_vs_multi_agent_selection", "Scegliere advisory single-agent o multi-agent in base a complessita e indipendenza del lavoro."],
      ["context_compaction", "Comprimere contesto mantenendo vincoli, evidenza, lineage e decisioni aperte."],
      ["delta_context_packaging", "Trasferire soltanto il delta necessario rispetto allo snapshot gia attestato."],
      ["semantic_memory_reuse", "Riutilizzare memoria tenant-scoped solo se rilevante, fresca e verificata."],
      ["stable_prompt_prefix", "Rendere riusabile un prefisso stabile senza includere dati sensibili o autorita dinamica."],
      ["tool_surface_minimization", "Ridurre gli strumenti proposti al minimo necessario per il task."],
      ["relevant_file_selection", "Selezionare i file pertinenti tramite evidenza e dipendenze, non scansioni indiscriminate."],
      ["duplicate_work_suppression", "Individuare lavoro equivalente in corso o gia verificato prima di delegare."],
      ["agent_result_reuse", "Riutilizzare risultati di agenti solo con contratto, digest e contesto compatibili."],
      ["verified_artifact_reuse", "Preferire artefatti verificati e versionati a nuove invocazioni equivalenti."],
      ["adaptive_review_depth", "Adattare profondita di review a rischio, novita e copertura dei test."],
      ["selective_reviewer_context", "Fornire al reviewer il contesto minimo indipendente necessario per verificare."],
      ["retry_budget_optimization", "Limitare retry a failure transitori classificati e valore atteso positivo."],
      ["early_stop_policy", "Fermare il lavoro quando criteri verificabili sono soddisfatti o il budget non aggiunge valore."],
      ["model_cost_quality_routing", "Proporre la route modello sulla qualita verificata per costo e rischio."],
      ["provider_capability_detection", "Rilevare capability provider da manifest e prove versionate, senza inferire credenziali."],
      ["credit_forecast", "Prevedere consumo di crediti per piano, route e fallback dichiarati."],
      ["credit_savings_attribution", "Attribuire risparmi a riuso, compaction o minori invocazioni con baseline verificabile."],
      ["quality_cost_pareto", "Confrontare alternative sulla frontiera qualita-costo senza nascondere regressioni."],
      ["invocation_reduction", "Misurare e proporre riduzione di invocazioni preservando outcome verificati."],
      ["work_capsule_compilation", "Compilare un capsule di lavoro con obiettivo, scope, delta, prove e rollback."],
      ["agent_context_expiry", "Far scadere contesti agente quando policy, file, evidence o delega cambiano."],
      ["efficiency_drift_detection", "Rilevare deriva di costo, latenza, riuso o qualita rispetto alla baseline."],
    ],
    optionalInputs: ["task_graph", "verified_artifact_index", "budget_policy", "quality_baseline"],
    activation: ["bounded_agentic_plan_requested", "usage_and_quality_metadata_available"],
    nonActivation: ["quality_baseline_missing", "reuse_integrity_unverified"],
    evidence: ["task_scope_digest", "quality_baseline", "usage_estimate", "reuse_provenance"],
    metrics: ["verified_invocation_reduction", "credit_savings", "quality_non_degradation_rate"],
    rollbackStrategy: "invalidate_efficiency_candidate_and_restore_previous_execution_plan",
  }),
  agentic_budget_governance_guard: defineBoundedBranch({
    id: "agentic_budget_governance_guard",
    label: "Agentic Budget Governance Guard",
    productionStatus: "advisory",
    description: "Applica budget granulari, quality floor, usage provenance e blocchi anti-duplicazione senza concedere esecuzione.",
    entries: [
      ["per_run_credit_budget", "Verificare il tetto crediti della singola run prima della materializzazione."],
      ["per_project_credit_budget", "Vincolare consumo aggregato al budget progetto e alla finestra dichiarata."],
      ["per_agent_budget", "Limitare budget e lease di ciascun agente materializzato."],
      ["token_budget", "Applicare limiti separati a input, output e cache token."],
      ["invocation_budget", "Limitare chiamate agente, modello e tool per piano."],
      ["retry_budget", "Bloccare retry oltre numero, costo o deadline consentiti."],
      ["reviewer_budget", "Preservare un budget reviewer proporzionato al rischio e indipendente dall'autore."],
      ["model_escalation_gate", "Richiedere prova di necessita prima di una route modello piu costosa."],
      ["quality_floor", "Bloccare ottimizzazioni che degradano qualita sotto la soglia verificata."],
      ["safety_non_degradation", "Bloccare risparmi che riducono isolamento, policy, evidenza o sicurezza."],
      ["budget_override_audit", "Richiedere autorita, ragione, scadenza e audit per ogni override."],
      ["provider_rate_card_version", "Vincolare stime e consuntivi a un rate card versionato."],
      ["actual_vs_estimated_usage", "Confrontare consumo reale e previsto per correggere forecast futuri."],
      ["missing_usage_fail_safe", "Fallire in modo sicuro quando telemetria o rate card necessari mancano."],
      ["cost_provenance", "Collegare ogni costo a run, agente, provider, modello, tool e outcome."],
      ["duplicate_execution_block", "Bloccare esecuzioni equivalenti gia attive o coperte da artefatto verificato."],
      ["stale_context_block", "Bloccare capsule o contesti scaduti rispetto a scope, policy o repository."],
      ["cache_integrity", "Verificare tenant, digest, policy e freschezza prima del riuso cache."],
      ["work_capsule_integrity", "Verificare firma logica, scope, dipendenze, budget e rollback del capsule."],
      ["budget_policy_expiry", "Far scadere policy budget e richiedere revalidation periodica."],
      ["savings_claim_guard", "Rifiutare claim di risparmio senza baseline, attribution e quality floor."],
      ["critical_task_cost_override", "Consentire proposta di override per task critici solo con autorita e audit espliciti."],
    ],
    optionalInputs: ["budget_policy", "rate_card_version", "usage_estimate", "work_capsule"],
    activation: ["agentic_plan_requests_budget", "usage_or_savings_claim_evaluated"],
    nonActivation: ["rate_card_missing", "quality_floor_unavailable", "budget_policy_expired"],
    evidence: ["budget_policy_snapshot", "rate_card_digest", "usage_provenance", "quality_baseline"],
    metrics: ["budget_breach_count", "estimate_error_rate", "blocked_duplicate_execution_count"],
    rollbackStrategy: "revoke_budget_decision_and_restore_previous_verified_budget_policy",
  }),
});

function defineExtensionFacet(branchId, entries) {
  const branch = {
    id: branchId,
    optional_inputs: ["baseline_reference", "candidate_reference"],
    activation: ["explicit_learning_factory_request", "tenant_scoped_evidence_available"],
    non_activation: ["automatic_production_change_requested"],
    evidence: ["tenant_scoped_evidence", "policy_snapshot", "rollback_reference"],
    metrics: ["verified_outcome_rate"],
    rollback_strategy: "invalidate_extension_candidate_and_restore_previous_verified_behavior",
    minimum_independent_items: 1,
  };
  return freezeRecord(Object.fromEntries(entries.map((entry) => [entry[0], buildNodeContract(branch, entry)])));
}

export const AI_LEARNING_FACTORY_EXTENSION_FACETS = freezeRecord({
  agent_orchestration: defineExtensionFacet("agent_orchestration", [
    ["skill_candidate_extraction", "Estrarre da outcome verificati una capability skill candidata e bounded."],
    ["skill_contract_compilation", "Compilare input, output, scope, limiti ed evidenza della skill candidata."],
    ["skill_sandbox_replay", "Riprodurre la skill in sandbox contro casi versionati e negativi."],
    ["skill_certification", "Produrre attestazione di conformita senza attivare la skill."],
    ["skill_versioning", "Versionare contratto, dipendenze, digest e compatibilita della skill."],
    ["skill_reuse_telemetry", "Misurare riuso, qualita e costo tramite telemetria redatta."],
    ["skill_failure_detection", "Rilevare regressioni, drift e failure attribuibili alla skill."],
    ["skill_deprecation", "Ritirare versioni non sicure preservando lineage e audit."],
    ["skill_rollback", "Ripristinare il contratto skill verificato precedente."],
  ]),
  adaptive_learning_intelligence: defineExtensionFacet("adaptive_learning_intelligence", [
    ["active_learning", "Selezionare casi per review solo quando il valore informativo atteso giustifica costo e rischio."],
    ["hard_case_prioritization", "Prioritizzare casi difficili per valore di apprendimento e rischio."],
    ["negative_example_replay", "Riprodurre esempi negativi versionati contro la baseline."],
    ["feedback_bias_detection", "Rilevare bias di selezione, provenienza e rappresentativita del feedback."],
    ["reviewer_disagreement", "Conservare e misurare disaccordo tra revisori indipendenti."],
    ["learning_value_estimation", "Stimare beneficio atteso del candidato prima di una eval costosa."],
    ["savings_outcome_validation", "Verificare che un risparmio preservi outcome, quality floor e guardrail prima di apprendere dal risultato."],
  ]),
  learning_knowledge_intelligence: defineExtensionFacet("learning_knowledge_intelligence", [
    ["retrieval_precision_recall", "Misurare precisione e richiamo del retrieval contro casi versionati."],
    ["context_relevance_scoring", "Misurare quanta parte del contesto trasferito e realmente pertinente all'outcome verificato."],
    ["chunking_strategy_evaluation", "Confrontare strategie di chunking su qualita e copertura."],
    ["embedding_version_registry", "Versionare embedding, dimensioni, provider e compatibilita."],
    ["reranking_quality", "Misurare il contributo del reranking a rilevanza e citazioni."],
    ["freshness_expiry", "Far scadere conoscenza obsoleta secondo fonte e dominio."],
    ["citation_coverage", "Misurare copertura e validita delle citazioni sui claim."],
    ["knowledge_poisoning_detection", "Rilevare e quarantinare fonti o chunk manipolati."],
    ["index_rebuild_policy", "Proporre rebuild versionati con rollback dell'indice."],
  ]),
  ai_orchestration: defineExtensionFacet("ai_orchestration", [
    ["universal_abstention_policy", "Applicare astensione coerente tra provider, task e livelli di rischio."],
    ["confidence_to_autonomy_mapping", "Mappare confidenza calibrata ad advisory, review o blocco, mai ad auto-esecuzione."],
    ["task_difficulty_classifier", "Classificare difficolta per scegliere budget e verifica bounded."],
    ["quality_cost_router", "Ottimizzare la route sulla qualita verificata per costo."],
    ["model_snapshot_registry", "Vincolare route e eval a snapshot modello immutabili."],
    ["prompt_budget_enforcement", "Applicare budget di prompt e contesto prima della chiamata."],
    ["tool_surface_minimization", "Ridurre strumenti esposti al minimo richiesto dal task."],
    ["tool_schema_budget", "Limitare numero e dimensione degli schemi tool al minimo verificato necessario."],
    ["stable_prefix_compilation", "Compilare un prefisso stabile versionato e privo di autorita o dati dinamici sensibili."],
    ["provider_usage_normalization", "Normalizzare usage provider distinguendo ricevute effettive da stime trasparenti."],
  ]),
  observability_roi_guard: defineExtensionFacet("observability_roi_guard", [
    ["cost_per_verified_outcome", "Misurare costo effettivo o stimato per outcome verificato dichiarandone la provenienza."],
    ["tokens_per_verified_outcome", "Misurare token input, cache e output per outcome verificato."],
    ["invocations_per_verified_outcome", "Misurare nuove invocazioni agente, modello e tool per outcome verificato."],
    ["duplicate_work_cost", "Attribuire il costo del lavoro duplicato senza confonderlo con attivita indipendente necessaria."],
    ["retry_cost", "Attribuire costo e valore dei retry classificati rispetto al checkpoint valido."],
    ["reviewer_cost", "Misurare il costo reviewer preservando profondita e indipendenza richieste dal rischio."],
    ["cache_savings", "Stimare o riconciliare il risparmio cache soltanto con hit e tenant binding verificati."],
    ["context_compaction_savings", "Misurare contesto evitato dalla compaction rispetto allo stesso snapshot e rubric."],
    ["model_routing_savings", "Attribuire risparmi di routing solo quando l'host prova il modello realmente usato."],
    ["quality_adjusted_savings", "Calcolare il risparmio corretto per delta qualita e invalidarlo oltre il quality floor."],
  ]),
  decision_provenance_intelligence: defineExtensionFacet("decision_provenance_intelligence", [
    ["baseline_run_reference", "Legare la decisione alla run baseline, allo snapshot e alla rubric immutabili."],
    ["optimized_run_reference", "Legare la decisione alla variante ottimizzata e al medesimo criterio di accettazione."],
    ["usage_source", "Dichiarare provider receipt, stima, formula e affidabilita della fonte usage."],
    ["rate_card_reference", "Vincolare calcoli economici a rate card versionata, datata e attestata."],
    ["savings_calculation", "Conservare formula, input e rounding del confronto senza falsa precisione."],
    ["quality_delta", "Conservare qualita baseline, ottimizzata, delta e verifica del quality floor."],
    ["approval_and_expiry", "Legare approvazione, autorita, ambito e scadenza alla decisione di efficienza."],
    ["rollback_reference", "Legare ogni ottimizzazione al checkpoint e al comportamento verificato precedente."],
  ]),
});

export const AI_LEARNING_FACTORY_CAPABILITY_ALIASES = freezeRecord({
  agent_orchestration: {
    skill_extraction: "skill_candidate_extraction",
    skill_replay_verification: "skill_sandbox_replay",
  },
});

export function learningFactoryBranch(branchId) {
  return AI_LEARNING_FACTORY_BRANCHES[branchId]
    || AI_LEARNING_CORE_GUARDS[branchId]
    || AI_AGENTIC_EFFICIENCY_BRANCHES[branchId]
    || null;
}

export function extensionFacetContracts(branchId) {
  return AI_LEARNING_FACTORY_EXTENSION_FACETS[branchId] || Object.freeze({});
}

export function extensionFacetDescriptor(branchId) {
  const contracts = extensionFacetContracts(branchId);
  return freezeRecord({
    schema_version: "ai_learning_factory_extension_facets_v1",
    branch_id: branchId,
    expansion_mode: "bounded_contract_facets",
    facet_count: Object.keys(contracts).length,
    facets: Object.values(contracts),
    authority: "advisory",
    autonomous_activation: false,
  });
}

export { CONTRACT_VERSION as AI_LEARNING_FACTORY_BRANCH_CONTRACT_VERSION };
