import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_BOOTSTRAP_PATHS,
  CANONICAL_BOOTSTRAP_PATHS_SHA256,
  CANONICAL_BOOTSTRAP_SCOPE,
  canonicalBootstrapBundleDigest,
  createCanonicalBootstrapBundle,
  createCanonicalBootstrapProtocol,
} from "../src/index.js";

const COMMIT = "a".repeat(40);
const NOW = Date.parse("2026-07-23T12:00:00.000Z");

function documents() {
  return CANONICAL_BOOTSTRAP_PATHS.map((path, index) => ({
    title: `Canonical document ${index + 1}`,
    content: path === "SHARED_MEMORY/STATE.json"
      ? JSON.stringify({
          tenant: "codexai",
          generated_at: "2026-07-23T11:59:00.000Z",
          active_task_count: 0,
          active_lock_count: 0,
        })
      : path === "SHARED_MEMORY/TASKS.json"
        ? JSON.stringify({ tenant: "codexai", count: 0, tasks: [] })
        : path === "SHARED_MEMORY/LOCKS.json"
          ? JSON.stringify({ tenant: "codexai", count: 0, locks: [] })
          : path === "SHARED_MEMORY/ARTIFACTS.json"
            ? JSON.stringify({ tenant: "codexai", count: 0, artifacts: [] })
            : `# Canonical fixture ${index + 1}\n\nReviewed and redacted.`,
    redaction_count: index,
    redaction_status: "reviewed_redacted",
  }));
}

function bundleFromDocuments(documentSet) {
  return createCanonicalBootstrapBundle({
    bootstrap_id: "mcpboot_0123456789abcdefghijkl",
    target_commit: COMMIT,
    created_at: "2026-07-23T11:59:30.000Z",
    documents: documentSet,
  });
}

function bundle() {
  return bundleFromDocuments(documents());
}

function runtimeBinding(overrides = {}) {
  return {
    tenant_id: CANONICAL_BOOTSTRAP_SCOPE.tenant_id,
    executor_service: CANONICAL_BOOTSTRAP_SCOPE.executor_service,
    control_role: CANONICAL_BOOTSTRAP_SCOPE.control_role,
    target_service: CANONICAL_BOOTSTRAP_SCOPE.target_service,
    target_environment: CANONICAL_BOOTSTRAP_SCOPE.target_environment,
    target_database: CANONICAL_BOOTSTRAP_SCOPE.target_database,
    target_commit: COMMIT,
    ...overrides,
  };
}

function approvalEvidence(expected, overrides = {}) {
  return {
    ...expected,
    schema_version: "mcp_staging_canonical_bootstrap_verified_approval_v1",
    verified: true,
    decision: "allow",
    approval_jti: "mcpcr_0123456789abcdefghijkl",
    issued_at: "2026-07-23T11:59:45.000Z",
    expires_at: "2026-07-23T12:00:15.000Z",
    authorities: [
      {
        issuer: "universal-core-staging",
        role: "final_authority",
        key_fingerprint: `ed25519-sha256:${"1".repeat(64)}`,
        receipt_digest: "2".repeat(64),
      },
      {
        issuer: "nyra-staging",
        role: "advisory_veto",
        key_fingerprint: `ed25519-sha256:${"3".repeat(64)}`,
        receipt_digest: "4".repeat(64),
      },
    ],
    ...overrides,
  };
}

function receiptEvidence(approval, overrides = {}) {
  return {
    schema_version: "mcp_collaboration_verified_receipt_v1",
    tenant_id: approval.tenant_id,
    jti: approval.approval_jti,
    binding_digest: "6".repeat(64),
    receipt_digest: "7".repeat(64),
    issued_at: approval.issued_at,
    expires_at: approval.expires_at,
    authorities: approval.authorities.map(({ issuer, key_fingerprint, receipt_digest }) => ({
      issuer,
      kid: key_fingerprint,
      receipt_digest,
    })),
    ...overrides,
  };
}

function verifiedEvidence(expected, approvalOverrides = {}, receiptOverrides = {}) {
  const approval = approvalEvidence(expected, approvalOverrides);
  return {
    approval,
    receipt_evidence: receiptEvidence(approval, receiptOverrides),
  };
}

test("builds a deterministic redacted bundle bound to the exact staging target", () => {
  const first = bundle();
  const second = bundle();
  assert.equal(canonicalBootstrapBundleDigest(first), canonicalBootstrapBundleDigest(second));
  assert.equal(first.documents.length, 8);
  assert.deepEqual(first.documents.map(({ path }) => path), CANONICAL_BOOTSTRAP_PATHS);
  assert.equal(first.target.service, "skinharmony-core-mcp-staging");
  assert.equal(first.target.environment, "staging");
  assert.equal(first.target.database, "skinharmony_mcp_staging_db");
  assert.match(CANONICAL_BOOTSTRAP_PATHS_SHA256, /^[a-f0-9]{64}$/);
});

test("rejects missing paths, digest changes, unreviewed content, and credential material", () => {
  assert.throws(
    () => bundleFromDocuments(documents().slice(1)),
    /canonical_bootstrap_document_set_invalid/,
  );

  const changed = structuredClone(bundle());
  changed.documents[0].content += " changed";
  assert.throws(
    () => canonicalBootstrapBundleDigest(changed),
    /canonical_bootstrap_content_digest_mismatch/,
  );

  const unreviewed = documents();
  unreviewed[0].redaction_status = "pending";
  assert.throws(
    () => bundleFromDocuments(unreviewed),
    /canonical_bootstrap_redaction_review_required/,
  );

  const credential = documents();
  credential[0].content = "DATABASE_URL=postgres://runtime:do-not-store@example.invalid/db";
  assert.throws(
    () => bundleFromDocuments(credential),
    /canonical_bootstrap_credential_material_rejected/,
  );

  const quotedCredential = documents();
  quotedCredential[0].content = JSON.stringify({
    RENDER_API_KEY: "rnd_abcdefghijklmnop",
  });
  assert.throws(
    () => bundleFromDocuments(quotedCredential),
    /canonical_bootstrap_credential_material_rejected/,
  );

  for (const rawCredential of [
    "rnd_abcdefghijklmnopqrstuvwxyz123456",
    "ghp_abcdefghijklmnopqrstuvwxyzABCDE123456",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjb2RleGFpIn0.abcdefghijklmnopqrstuvwxyzABCDE",
  ]) {
    const rawProviderCredential = documents();
    rawProviderCredential[0].content = `Reviewed text ${rawCredential}`;
    assert.throws(
      () => bundleFromDocuments(rawProviderCredential),
      /canonical_bootstrap_credential_material_rejected/,
    );
  }
});

test("rejects malformed or inconsistent canonical JSON before approval", () => {
  const stateIndex = CANONICAL_BOOTSTRAP_PATHS.indexOf("SHARED_MEMORY/STATE.json");
  const tasksIndex = CANONICAL_BOOTSTRAP_PATHS.indexOf("SHARED_MEMORY/TASKS.json");

  const malformed = documents();
  malformed[stateIndex].content = "{";
  assert.throws(
    () => bundleFromDocuments(malformed),
    /canonical_bootstrap_document_json_invalid/,
  );

  const wrongTenant = documents();
  wrongTenant[stateIndex].content = JSON.stringify({
    tenant: "another-tenant",
    active_task_count: 0,
    active_lock_count: 0,
  });
  assert.throws(
    () => bundleFromDocuments(wrongTenant),
    /canonical_bootstrap_document_tenant_mismatch/,
  );

  const inconsistentCollection = documents();
  inconsistentCollection[tasksIndex].content = JSON.stringify({
    tenant: "codexai",
    count: 1,
    tasks: [],
  });
  assert.throws(
    () => bundleFromDocuments(inconsistentCollection),
    /canonical_bootstrap_document_semantics_invalid/,
  );

  const inconsistentState = documents();
  inconsistentState[stateIndex].content = JSON.stringify({
    tenant: "codexai",
    active_task_count: 1,
    active_lock_count: 0,
  });
  assert.throws(
    () => bundleFromDocuments(inconsistentState),
    /canonical_bootstrap_document_semantics_invalid/,
  );
});

test("requires an opaque verified approval before invoking the consumer", async () => {
  let consumerCalls = 0;
  const verifier = {
    async verify(_artifact, expected) {
      return verifiedEvidence(expected);
    },
  };
  const consumer = {
    async consumeOnce() {
      consumerCalls += 1;
      return {
        consumed: true,
        consumption_id: "mcpbootcons_0123456789abcdefghijkl",
        consumed_at: "2026-07-23T12:00:00.000Z",
        audit_sha256: "5".repeat(64),
      };
    },
  };
  const protocol = createCanonicalBootstrapProtocol({
    approvalVerifier: verifier,
    consumer,
    now: () => NOW,
  });
  const result = await protocol.execute({
    bundle: bundle(),
    runtime_binding: runtimeBinding(),
    approval_artifact: Object.freeze({ opaque: true }),
  });
  assert.equal(consumerCalls, 1);
  assert.equal(result.bootstrapped, true);
  assert.equal(result.document_count, 8);
  assert.equal(result.target_commit, COMMIT);
  assert.equal(result.executor_service, CANONICAL_BOOTSTRAP_SCOPE.executor_service);
  assert.equal(result.control_role, CANONICAL_BOOTSTRAP_SCOPE.control_role);
  assert.equal(JSON.stringify(result).includes("Reviewed and redacted"), false);
  assert.equal(JSON.stringify(result).includes("approval_jti"), false);

  await assert.rejects(
    protocol.execute({
      bundle: bundle(),
      runtime_binding: runtimeBinding({ target_commit: "b".repeat(40) }),
      approval_artifact: Object.freeze({ opaque: true }),
    }),
    /canonical_bootstrap_runtime_binding_mismatch/,
  );
  for (const override of [
    { executor_service: "another-bootstrap-service" },
    { control_role: "provider_admin" },
  ]) {
    await assert.rejects(
      protocol.execute({
        bundle: bundle(),
        runtime_binding: runtimeBinding(override),
        approval_artifact: Object.freeze({ opaque: true }),
      }),
      /canonical_bootstrap_runtime_binding_mismatch/,
    );
  }
  assert.equal(consumerCalls, 1);
});

test("fails closed for a missing verifier, denial, stale approval, or authority mismatch", async () => {
  assert.throws(
    () => createCanonicalBootstrapProtocol({ consumer: { consumeOnce() {} } }),
    /canonical_bootstrap_approval_verifier_required/,
  );

  let consumerCalls = 0;
  async function attempt(overrides) {
    const protocol = createCanonicalBootstrapProtocol({
      approvalVerifier: {
        async verify(_artifact, expected) {
          return verifiedEvidence(expected, overrides);
        },
      },
      consumer: {
        async consumeOnce() {
          consumerCalls += 1;
        },
      },
      now: () => NOW,
    });
    return protocol.execute({
      bundle: bundle(),
      runtime_binding: runtimeBinding(),
      approval_artifact: Symbol("opaque"),
    });
  }

  await assert.rejects(attempt({ decision: "deny" }), /canonical_bootstrap_verified_approval_required/);
  await assert.rejects(
    attempt({
      issued_at: "2026-07-23T11:50:00.000Z",
      expires_at: "2026-07-23T11:55:00.000Z",
    }),
    /canonical_bootstrap_approval_expired/,
  );
  await assert.rejects(
    attempt({ executor_service: "another-bootstrap-service" }),
    /canonical_bootstrap_approval_binding_mismatch/,
  );
  const wrongAuthorities = approvalEvidence({
    tenant_id: "codexai",
    executor_service: CANONICAL_BOOTSTRAP_SCOPE.executor_service,
    control_role: CANONICAL_BOOTSTRAP_SCOPE.control_role,
    target_service: "skinharmony-core-mcp-staging",
    target_environment: "staging",
    target_database: "skinharmony_mcp_staging_db",
    target_commit: COMMIT,
    bootstrap_id: "mcpboot_0123456789abcdefghijkl",
    bundle_sha256: canonicalBootstrapBundleDigest(bundle()),
    canonical_paths_sha256: CANONICAL_BOOTSTRAP_PATHS_SHA256,
    document_count: 8,
  }).authorities;
  wrongAuthorities.reverse();
  await assert.rejects(
    attempt({ authorities: wrongAuthorities }),
    /canonical_bootstrap_approval_authority_invalid/,
  );
  assert.equal(consumerCalls, 0);
});

test("rejects missing, rebound, or authority-mismatched receipt evidence", async () => {
  let consumerCalls = 0;
  async function attempt(mutator) {
    const protocol = createCanonicalBootstrapProtocol({
      approvalVerifier: {
        async verify(_artifact, expected) {
          const verified = verifiedEvidence(expected);
          return mutator(verified);
        },
      },
      consumer: {
        async consumeOnce() {
          consumerCalls += 1;
        },
      },
      now: () => NOW,
    });
    return protocol.execute({
      bundle: bundle(),
      runtime_binding: runtimeBinding(),
      approval_artifact: Object.freeze({ opaque: true }),
    });
  }

  await assert.rejects(
    attempt(({ approval }) => approval),
    /canonical_bootstrap_verified_approval_required/,
  );
  await assert.rejects(
    attempt((verified) => ({
      ...verified,
      receipt_evidence: {
        ...verified.receipt_evidence,
        binding_digest: "8".repeat(64),
        jti: "mcpcr_rebound0123456789abcdef",
      },
    })),
    /canonical_bootstrap_receipt_evidence_invalid/,
  );
  await assert.rejects(
    attempt((verified) => ({
      ...verified,
      receipt_evidence: {
        ...verified.receipt_evidence,
        authorities: verified.receipt_evidence.authorities.toReversed(),
      },
    })),
    /canonical_bootstrap_receipt_evidence_invalid/,
  );
  assert.equal(consumerCalls, 0);
});
