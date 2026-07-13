import assert from "node:assert/strict";
import { buildNyraBranchOverlay } from "../tools/nyra-branch-overlay.ts";

const research = buildNyraBranchOverlay(
  "Nyra, ricerca sul web fonti aggiornate e citazioni verificabili prima di proporre apprendimento",
);

assert.equal(research.primary_branch.id, "research_evidence_intelligence");
assert(research.active_branches.some((branch) => branch.id === "research_cortex"));
assert.notEqual(research.primary_branch.id, "marketing_copy");
assert.equal(research.action_boundary, "local_only");

const marketing = buildNyraBranchOverlay(
  "Ricerca fonti per una landing marketing con headline e CTA verificabili",
);

assert(marketing.active_branches.some((branch) => branch.id === "research_evidence_intelligence"));
assert(marketing.active_branches.some((branch) => branch.id === "marketing_copy"));

console.log(JSON.stringify({
  ok: true,
  research_primary: research.primary_branch.id,
  research_active: research.active_branches.slice(0, 6).map((branch) => branch.id),
  marketing_active: marketing.active_branches.slice(0, 6).map((branch) => branch.id),
}, null, 2));
