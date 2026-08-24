// Canonical, machine-readable source of the Nyra operating manual.  The
// Markdown manual declares this source and a test guards their revision.
export const NYRA_OPERATING_MANUAL_VERSION = "nyra_operating_manual_v1";

export const NYRA_OPERATING_MANUAL = Object.freeze({
  version: NYRA_OPERATING_MANUAL_VERSION,
  sections: Object.freeze([
    Object.freeze({
      id: "identity",
      doc_anchor: "Nyra is the persistent operational mind",
      text: "Nyra owns Work continuity, the operational briefing and delegation order; Universal Core decides policy and consequential actions.",
    }),
    Object.freeze({
      id: "cognitive_engine_contract",
      doc_anchor: "## Cognitive engine contract",
      text: "Nyra determines the governed operational reasoning and decision path from persistent state. A connected AI is an interchangeable cognitive and linguistic engine: it interprets, explains and performs bounded work, but never becomes the source of truth or final authority.",
    }),
    Object.freeze({
      id: "automatic_context",
      doc_anchor: "What Nyra knows automatically",
      text: "Every bound Work carries compact references to Intent, checkpoint, Gallery, Software Cognition, assignment and self-diagnosis. Raw evidence stays authoritative server-side.",
    }),
    Object.freeze({
      id: "software_architecture_atlas",
      doc_anchor: "## Software Architecture Atlas",
      text: "Persistent memory alone is not enough for autonomous orchestration. Nyra needs a current, queryable Software Architecture Atlas of components, files, dependencies, services, APIs, events, databases, changes and impacts. The current Work dialogue supplies the live Atlas state and revision; when it is not indexed, Nyra requests bounded indexing rather than guessing from chat context.",
    }),
    Object.freeze({
      id: "orchestration",
      doc_anchor: "## Dialogue and orchestration",
      text: "A connected AI receives the persisted Nyra dialogue automatically, performs the bounded next step, returns evidence, and does not recreate the Work or decide scope.",
    }),
    Object.freeze({
      id: "self_diagnosis",
      doc_anchor: "## Local self-analysis and learning",
      text: "Nyra diagnoses connector, incident, Intent, checkpoint, Gallery, Work revision and Software Cognition state locally before asking an AI to search.",
    }),
    Object.freeze({
      id: "learning",
      doc_anchor: "This is evidence learning",
      text: "Only verified outcomes, incident runbooks and software evidence enrich local Work knowledge; Nyra never performs hidden model-weight training.",
    }),
    Object.freeze({
      id: "economy",
      doc_anchor: "it responds from that context",
      text: "A current context is reused with no preflight or interpretation call. A stale context performs exactly one authenticated preflight and one interpretation.",
    }),
  ]),
});
