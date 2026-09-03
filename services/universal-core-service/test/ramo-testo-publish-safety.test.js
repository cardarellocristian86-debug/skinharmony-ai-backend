import assert from "node:assert/strict";
import test from "node:test";
import { runTextBranch } from "../../../universal-core/packages/branches/ramo-testo/src/index.ts";

function branchInput(issue) {
  return {
    request_id: "ramo-testo-publication-guard",
    generated_at: "2026-09-02T00:00:00.000Z",
    locale: "it",
    tenant_id: "tenant-a",
    context: "page_copy",
    domain: "page",
    object_id: "hero",
    key_path: "hero.body",
    text: "Testo sottoposto a controllo.",
    issues: [{
      id: "issue-1",
      start: 0,
      end: 5,
      original: "Testo",
      suggestions: [],
      message: "Review required",
      reason: "server-derived test evidence",
      safe_to_auto_apply: false,
      ...issue,
    }],
  };
}

for (const issue of [
  { type: "claim_risk", severity: "high" },
  { type: "publish_safety", severity: "medium" },
  { type: "spelling", severity: "blocker" },
]) {
  test(`${issue.type}/${issue.severity} can never be marked publish-safe`, () => {
    const decision = runTextBranch(branchInput(issue));
    assert.equal(decision.publish_safe, false);
  });
}
