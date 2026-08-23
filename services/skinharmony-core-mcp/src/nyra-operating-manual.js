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
      id: "automatic_context",
      doc_anchor: "What Nyra knows automatically",
      text: "Every bound Work carries compact references to Intent, checkpoint, Gallery, Software Cognition, assignment and self-diagnosis. Raw evidence stays authoritative server-side.",
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
