import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  createHostNativeExternalReadbackVerifier,
  createHostNativeReleaseJoinVerdictResolver,
} from "../src/hostNativeExternalReadback.js";
import {
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  HOST_NATIVE_HEALTH_CONTRACT_VERSION,
  hostNativeDigest,
  hostNativeGithubDiffDigest,
} from "../src/hostNativeGovernance.js";

const BASE = "1".repeat(40);
const HEAD = "2".repeat(40);
const TARGET = "3".repeat(40);
const ALTERNATE = "4".repeat(40);
const TREE = "5".repeat(40);
const RELEASE_CHANGED_FILES = ["services/universal-core-service/src/app.js"];
const VERIFIED_AT = "2026-07-29T12:00:00.000Z";
const WORKFLOW_SOURCE = "name: Nyra Core Intelligence\non: [pull_request, push]\n";
const WORKFLOW_SHA256 = crypto
  .createHash("sha256")
  .update(WORKFLOW_SOURCE)
  .digest("hex");
const WORKFLOW_CANDIDATE_SOURCE =
  "name: Nyra Core Intelligence\non: [pull_request, push]\n# staged candidate\n";
const WORKFLOW_CANDIDATE_SHA256 = crypto
  .createHash("sha256")
  .update(WORKFLOW_CANDIDATE_SOURCE)
  .digest("hex");
const WORKFLOW_UNKNOWN_SOURCE =
  "name: Nyra Core Intelligence\non: [pull_request, push]\n# unknown digest\n";

function jsonResponse(body, {
  status = 200,
  headers = {},
} = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function mergeTicket({
  tenantId = "tenant-a",
  repository = "owner/repo",
  services = [{
    service_id: "service-a",
    environment: "production",
    origin: "https://service-a.onrender.com",
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  }],
} = {}) {
  const previousLiveAttestations = services.map((service) => {
    const unsigned = {
      service_id: service.service_id,
      environment: service.environment,
      origin: service.origin,
      health_path: "/healthz",
      deployment_id: `previous-${service.service_id}`,
      live_commit: BASE,
      health_status: "healthy",
      health_contract_digest: service.health_contract_digest,
    };
    return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
  });
  const sourceUnsigned = {
    schema_version: "host_native_source_attestation_v1",
    repository,
    evidence_kind: "github_pull_request_files",
    pull_request: 42,
    base_commit: BASE,
    head_commit: HEAD,
    tree_sha: TREE,
    changed_files: RELEASE_CHANGED_FILES,
    diff_digest: hostNativeGithubDiffDigest({
      repository,
      base_commit: BASE,
      head_commit: HEAD,
      tree_sha: TREE,
      changed_files: RELEASE_CHANGED_FILES,
    }),
  };
  const sourceAttestation = {
    ...sourceUnsigned,
    attestation_digest: hostNativeDigest(sourceUnsigned),
  };
  const releaseJoinResolution = {
    schema_version: "host_native_release_join_resolution_v1",
    trusted: true,
    authority: "universal_core",
    allowed: true,
    verdict_id: "hnj_test",
    tenant_id: tenantId,
    work_id: "work-a",
    intent_anchor_digest: "a".repeat(64),
    repository,
    checks_commit: HEAD,
    evidence_digest: "b".repeat(64),
    issued_at: VERIFIED_AT,
    resolved_at: VERIFIED_AT,
    source_attestation: sourceAttestation,
    previous_live_attestations: previousLiveAttestations,
    pre_action_readback_digest: hostNativeDigest({
      source_attestation: sourceAttestation,
      previous_live_attestations: previousLiveAttestations,
    }),
    provider_execution: false,
  };
  return {
    tenant_id: tenantId,
    work_id: "work-a",
    intent_anchor_digest: "a".repeat(64),
    repository,
    evidence_digest: "b".repeat(64),
    core_join_verdict_id: "hnj_test",
    provider_execution: false,
    action: {
      kind: "github.merge",
      pull_request: 42,
      head_branch: "agent/release",
      base_branch: "main",
      head_commit: HEAD,
      expected_base_commit: BASE,
      checks_commit: HEAD,
    },
    release_manifest_binding: {
      base_commit: BASE,
      verification: {
        required_checks: ["deployment-parity", "unit-tests"],
        checks_commit: HEAD,
      },
      services,
      rollback: {
        target_commit: BASE,
      },
    },
    release_join_resolution: releaseJoinResolution,
    release_join_resolution_digest: hostNativeDigest(releaseJoinResolution),
  };
}

function refreshReleaseJoinSourceAttestation(ticket) {
  const resolution = ticket.release_join_resolution;
  const source = resolution.source_attestation;
  try {
    source.diff_digest = hostNativeGithubDiffDigest({
      repository: source.repository,
      base_commit: source.base_commit,
      head_commit: source.head_commit,
      tree_sha: source.tree_sha,
      changed_files: source.changed_files,
    });
  } catch {
    // Preserve the malformed signed shape so the verifier itself must reject it.
  }
  delete source.attestation_digest;
  source.attestation_digest = hostNativeDigest(source);
  resolution.pre_action_readback_digest = hostNativeDigest({
    source_attestation: source,
    previous_live_attestations: resolution.previous_live_attestations,
  });
  ticket.release_join_resolution_digest = hostNativeDigest(resolution);
  return ticket;
}

function branchTicket(overrides = {}) {
  const ticket = mergeTicket(overrides);
  return {
    ...ticket,
    action: {
      kind: "git.push.protected",
      branch: "release/v1",
      source_commit: TARGET,
      expected_remote_commit: BASE,
      checks_commit: HEAD,
    },
  };
}

function successfulChecks(commit = HEAD) {
  return {
    check_runs: [
      {
        name: "unit-tests",
        head_sha: commit,
        status: "completed",
        conclusion: "success",
      },
      {
        name: "deployment-parity",
        head_sha: commit,
        status: "completed",
        conclusion: "success",
      },
    ],
  };
}

function pullRequest(repository = "owner/repo", overrides = {}) {
  return {
    merged: true,
    merge_commit_sha: TARGET,
    head: {
      sha: HEAD,
      ref: "agent/release",
      repo: { full_name: repository },
    },
    base: {
      sha: BASE,
      ref: "main",
      repo: { full_name: repository },
    },
    ...overrides,
  };
}

function serviceHealth(serviceId, overrides = {}) {
  return {
    ok: true,
    render_ready: true,
    version: "1.2.3",
    build: {
      build_id: `build-${serviceId}`,
      commit_sha: TARGET,
      commit_verifiable: true,
    },
    health_contract_version: HOST_NATIVE_HEALTH_CONTRACT_VERSION,
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    ...overrides,
  };
}

const STRICT_POLICY = Object.freeze({
  schema_version: "host_native_required_checks_policy_v1",
  tenant_id: "tenant-a",
  repository: "owner/repo",
  base_branch: "main",
  required_checks: ["core-mcp", "deployment-parity", "universal-core"],
  check_app: { id: 15368, slug: "github-actions", owner: "github" },
  workflow: {
    id: 312527659,
    name: "Nyra Core Intelligence",
    path: ".github/workflows/nyra-core-intelligence.yml",
    sha256: WORKFLOW_SHA256,
  },
  allowed_events: ["pull_request", "push"],
});

function strictTicket() {
  const ticket = mergeTicket();
  ticket.release_manifest_binding.base_branch = "main";
  ticket.release_manifest_binding.verification.required_checks =
    [...STRICT_POLICY.required_checks];
  return ticket;
}

function strictChecks({
  runIds = {},
  wrongApp = false,
  includeDuplicateRerun = false,
} = {}) {
  const checks = STRICT_POLICY.required_checks.map((name, index) => ({
    id: runIds[name] || 100 + index,
    name,
    head_sha: HEAD,
    status: "completed",
    conclusion: "success",
    details_url: "https://github.com/owner/repo/actions/runs/700/job/800",
    app: {
      id: 15368,
      slug: "github-actions",
      owner: { login: "github" },
    },
  }));
  if (includeDuplicateRerun) {
    checks.push({ ...checks[0], id: 1 });
  }
  if (wrongApp) {
    checks.push({
      ...checks[0],
      id: 999,
      app: { id: 44, slug: "spoof", owner: { login: "attacker" } },
    });
  }
  return { check_runs: checks };
}

function strictWorkflow(overrides = {}) {
  return {
    id: 700,
    workflow_id: 312527659,
    run_attempt: 2,
    name: "Nyra Core Intelligence",
    path: ".github/workflows/nyra-core-intelligence.yml",
    event: "pull_request",
    head_sha: HEAD,
    head_branch: "agent/release",
    repository: { full_name: "owner/repo" },
    pull_requests: [{
      url: "https://api.github.com/repos/owner/repo/pulls/42",
      number: 42,
      head: { ref: "agent/release", sha: HEAD },
      base: { ref: "main", sha: BASE },
    }],
    status: "completed",
    conclusion: "success",
    ...overrides,
  };
}

function strictFetch({
  ticket = strictTicket(),
  checks = strictChecks(),
  workflowById = new Map([[700, strictWorkflow()]]),
  calls = [],
} = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    const root = "https://api.github.com/repos/owner/repo";
    if (url === `${root}/commits/${HEAD}/check-runs?per_page=100`) {
      return jsonResponse(checks);
    }
    if ([
      `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${BASE}`,
      `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${HEAD}`,
    ].includes(url)) {
      return jsonResponse({
        type: "file",
        path: ".github/workflows/nyra-core-intelligence.yml",
        encoding: "base64",
        content: Buffer.from(WORKFLOW_SOURCE).toString("base64"),
      });
    }
    const runMatch = /\/actions\/runs\/(\d+)$/.exec(url);
    if (runMatch) return jsonResponse(workflowById.get(Number(runMatch[1])));
    if (url === `${root}/pulls/42`) return jsonResponse(pullRequest());
    if (url === `${root}/git/commits/${TARGET}`) return jsonResponse({ sha: TARGET });
    if (url === `${root}/git/commits/${BASE}`) return jsonResponse({ sha: BASE });
    if (url === "https://service-a.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-a"));
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

function strictFetchWithWorkflowSources({
  baseSource = WORKFLOW_SOURCE,
  headSource = WORKFLOW_SOURCE,
  ...strictFetchOptions
} = {}) {
  const fallback = strictFetch(strictFetchOptions);
  return async (url, init) => {
    const root = "https://api.github.com/repos/owner/repo";
    if (
      url ===
      `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${BASE}`
    ) {
      return jsonResponse({
        type: "file",
        path: ".github/workflows/nyra-core-intelligence.yml",
        encoding: "base64",
        content: Buffer.from(baseSource).toString("base64"),
      });
    }
    if (
      url ===
      `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${HEAD}`
    ) {
      return jsonResponse({
        type: "file",
        path: ".github/workflows/nyra-core-intelligence.yml",
        encoding: "base64",
        content: Buffer.from(headSource).toString("base64"),
      });
    }
    return fallback(url, init);
  };
}

function strictProtectedPushTicket() {
  const ticket = strictTicket();
  ticket.action = {
    kind: "git.push.protected",
    branch: "main",
    source_commit: HEAD,
    expected_remote_commit: BASE,
    force: false,
    delete_ref: false,
    tags: false,
    provider_execution: false,
  };
  return ticket;
}

function strictStagingDeployTicket() {
  const ticket = strictTicket();
  ticket.release_manifest_binding.services[0].environment = "staging";
  ticket.release_join_resolution.previous_live_attestations[0].environment = "staging";
  ticket.release_join_resolution_digest = hostNativeDigest(ticket.release_join_resolution);
  ticket.action = {
    kind: "render.deploy",
    repository: "owner/repo",
    service_id: "service-a",
    environment: "staging",
    branch: "agent/release",
    source_commit: HEAD,
    target_commit: HEAD,
    expected_live_commit: BASE,
    pull_request: 42,
    base_branch: "main",
    expected_base_commit: BASE,
    provider_execution: false,
  };
  return ticket;
}

function strictStagingDeployFetch({
  ticket = strictStagingDeployTicket(),
  workflow = strictWorkflow(),
  pull = pullRequest("owner/repo", { number: 42, merged: false, merge_commit_sha: null, state: "open", draft: false }),
  refSha = HEAD,
} = {}) {
  const fallback = strictFetch({
    ticket,
    workflowById: new Map([[700, workflow]]),
  });
  return async (url, init) => {
    if (url === "https://api.github.com/repos/owner/repo/git/ref/heads/agent/release") {
      return jsonResponse({ object: { sha: refSha } });
    }
    if (url === "https://api.github.com/repos/owner/repo/git/commits/2222222222222222222222222222222222222222") {
      return jsonResponse({ sha: HEAD });
    }
    if (url === "https://api.github.com/repos/owner/repo/git/commits/1111111111111111111111111111111111111111") {
      return jsonResponse({ sha: BASE });
    }
    if (url === "https://api.github.com/repos/owner/repo/pulls/42") {
      return jsonResponse(pull);
    }
    if (url === "https://service-a.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-a", {
        build: { build_id: "build-service-a", commit_sha: HEAD, commit_verifiable: true },
      }));
    }
    return fallback(url, init);
  };
}

function strictProtectedPushFetch({
  baseSource = WORKFLOW_SOURCE,
  headSource = WORKFLOW_SOURCE,
  ticket = strictProtectedPushTicket(),
} = {}) {
  const fallback = strictFetchWithWorkflowSources({
    baseSource,
    headSource,
    ticket,
    workflowById: new Map([[
      700,
      strictWorkflow({
        event: "push",
        head_branch: "main",
        pull_requests: [],
      }),
    ]]),
  });
  return async (url, init) => {
    const root = "https://api.github.com/repos/owner/repo";
    if (url === `${root}/git/ref/heads/main`) {
      return jsonResponse({ object: { sha: HEAD } });
    }
    if (url === `${root}/git/commits/${HEAD}`) {
      return jsonResponse({ sha: HEAD });
    }
    if (url === "https://service-a.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-a", {
        build: {
          build_id: "build-service-a",
          commit_sha: HEAD,
          commit_verifiable: true,
        },
      }));
    }
    return fallback(url, init);
  };
}

test("strict required-check attestation pins app/workflow, accepts deterministic rerun, and caches one run", async () => {
  const ticket = strictTicket();
  const calls = [];
  const verify = createHostNativeExternalReadbackVerifier({
    fetchImpl: strictFetch({
      ticket,
      checks: strictChecks({ includeDuplicateRerun: true }),
      calls,
    }),
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
    workflowRunCacheMaximumEntries: 1,
    now: () => Date.parse(VERIFIED_AT),
  });
  const first = await verify({ ticket, target_commit: TARGET });
  await verify({ ticket, target_commit: TARGET });
  assert.equal(
    calls.filter((call) => call.url.endsWith("/actions/runs/700")).length,
    1,
  );
  assert.equal(verify.workflow_run_cache.maximum_entries, 1);
  assert.equal(verify.workflow_run_cache.size(), 1);
  assert.equal(verify.workflow_source_cache.maximum_entries, 1);
  assert.equal(verify.workflow_source_cache.size(), 1);
  assert.equal(first.github.observed_checks[0].check_run_id, 100);
  assert.equal(first.github.observed_checks[0].workflow_run_attempt, 2);
  assert.match(first.github.required_checks_policy_digest, /^[a-f0-9]{64}$/);
  assert.match(first.github.checks_attestation_digest, /^[a-f0-9]{64}$/);
});

test("post-merge empty workflow association uses only the signed Core source attestation", async (t) => {
  const emptyWorkflow = strictWorkflow({ pull_requests: [] });
  const verify = (ticket = strictTicket(), extra = {}) => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictFetch({
        ticket,
        workflowById: new Map([[700, emptyWorkflow]]),
      }),
      requiredChecksPolicyResolver: async () => STRICT_POLICY,
      now: () => Date.parse(VERIFIED_AT),
    });
    return verifier({ ticket, target_commit: TARGET, ...extra });
  };

  const ticket = strictTicket();
  const result = await verify(ticket);
  assert.equal(result.github.pull_request, 42);
  assert.equal(result.github.head_commit, HEAD);
  assert.equal(result.github.expected_base_commit, BASE);
  assert.equal(
    ticket.release_join_resolution_digest,
    hostNativeDigest(ticket.release_join_resolution),
  );
  assert.equal(
    ticket.release_join_resolution.source_attestation.attestation_digest,
    hostNativeDigest((({ attestation_digest: _digest, ...unsigned }) => unsigned)(
      ticket.release_join_resolution.source_attestation,
    )),
  );

  await t.test("missing persisted resolution fails closed", async () => {
    const missing = strictTicket();
    delete missing.release_join_resolution;
    delete missing.release_join_resolution_digest;
    await assert.rejects(verify(missing), /workflow_pull_request_mismatch/);
  });

  await t.test("caller-supplied source facts cannot substitute", async () => {
    const missing = strictTicket();
    const callerSource = structuredClone(
      missing.release_join_resolution.source_attestation,
    );
    delete missing.release_join_resolution.source_attestation;
    missing.release_join_resolution_digest = hostNativeDigest(
      missing.release_join_resolution,
    );
    await assert.rejects(
      verify(missing, { source_attestation: callerSource }),
      /workflow_pull_request_mismatch/,
    );
  });

  await t.test("resolution digest mismatch fails closed", async () => {
    const mismatched = strictTicket();
    mismatched.release_join_resolution_digest = "0".repeat(64);
    await assert.rejects(verify(mismatched), /workflow_pull_request_mismatch/);
  });

  for (const [name, mutate] of [
    ["repository", (source) => { source.repository = "attacker/repo"; }],
    ["pull request", (source) => { source.pull_request = 99; }],
    ["base commit", (source) => { source.base_commit = ALTERNATE; }],
    ["head commit", (source) => { source.head_commit = ALTERNATE; }],
    ["tree shape", (source) => { source.tree_sha = "not-a-commit"; }],
    ["evidence kind", (source) => { source.evidence_kind = "github_compare_files"; }],
    ["changed-file shape", (source) => { source.changed_files = [...source.changed_files, ...source.changed_files]; }],
    ["unexpected branch field", (source) => { source.head_branch = "agent/release"; }],
  ]) {
    await t.test(`mismatched signed ${name} fails closed`, async () => {
      const mismatched = strictTicket();
      mutate(mismatched.release_join_resolution.source_attestation);
      refreshReleaseJoinSourceAttestation(mismatched);
      await assert.rejects(verify(mismatched), /workflow_pull_request_mismatch/);
    });
  }
});

test("staging Render deploy accepts only an exact same-repository pull-request attestation", async (t) => {
  const ticket = strictStagingDeployTicket();
  const verify = ({ workflow, pull, policy = STRICT_POLICY } = {}) => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictStagingDeployFetch({ ticket, workflow, pull }),
      requiredChecksPolicyResolver: async () => policy,
      now: () => Date.parse(VERIFIED_AT),
    });
    return verifier({ ticket, target_commit: HEAD });
  };

  const result = await verify();
  assert.equal(result.github.branch_commit, HEAD);
  assert.equal(result.github.pull_request, 42);
  assert.equal(result.services[0].live_commit, HEAD);

  await t.test("production remains push-only", async () => {
    const production = structuredClone(ticket);
    production.action.environment = "production";
    production.release_manifest_binding.services[0].environment = "production";
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictStagingDeployFetch({ ticket: production }),
      requiredChecksPolicyResolver: async () => STRICT_POLICY,
    });
    await assert.rejects(
      verifier({ ticket: production, target_commit: HEAD }),
      /workflow_run_mismatch/,
    );
  });

  await t.test("policy must explicitly allow pull_request", async () => {
    await assert.rejects(
      verify({ policy: { ...STRICT_POLICY, allowed_events: ["push"] } }),
      /required_checks_policy_event_denied/,
    );
  });

  await t.test("remote branch must still resolve to the exact target", async () => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictStagingDeployFetch({ ticket, refSha: ALTERNATE }),
      requiredChecksPolicyResolver: async () => STRICT_POLICY,
    });
    await assert.rejects(
      verifier({ ticket, target_commit: HEAD }),
      /trusted_readback_branch_commit_mismatch/,
    );
  });

  await t.test("empty workflow association cannot use the merge-only fallback", async () => {
    await assert.rejects(
      verify({ workflow: strictWorkflow({ pull_requests: [] }) }),
      /workflow_pull_request_mismatch/,
    );
  });

  for (const [name, pull] of [
    ["fork", pullRequest("owner/repo", { number: 42, merged: false, state: "open", draft: false, head: { sha: HEAD, ref: "agent/release", repo: { full_name: "fork/repo" } } })],
    ["wrong head", pullRequest("owner/repo", { number: 42, merged: false, state: "open", draft: false, head: { sha: ALTERNATE, ref: "agent/release", repo: { full_name: "owner/repo" } } })],
    ["wrong base", pullRequest("owner/repo", { number: 42, merged: false, state: "open", draft: false, base: { sha: ALTERNATE, ref: "main", repo: { full_name: "owner/repo" } } })],
    ["draft", pullRequest("owner/repo", { number: 42, merged: false, state: "open", draft: true })],
    ["closed", pullRequest("owner/repo", { number: 42, merged: false, state: "closed", draft: false })],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(verify({ pull }), /workflow_pull_request_mismatch/);
    });
  }
});

test("strict workflow digest rotation permits only monotonic staged transitions", async (t) => {
  const candidatePolicy = Object.freeze({
    ...STRICT_POLICY,
    workflow: Object.freeze({
      ...STRICT_POLICY.workflow,
      candidate_sha256: WORKFLOW_CANDIDATE_SHA256,
    }),
  });
  const promotedPolicy = Object.freeze({
    ...candidatePolicy,
    workflow: Object.freeze({
      ...candidatePolicy.workflow,
      sha256: WORKFLOW_CANDIDATE_SHA256,
      candidate_sha256: null,
    }),
  });
  const verifySources = async ({
    baseSource,
    headSource,
    policy = candidatePolicy,
  }) => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictFetchWithWorkflowSources({ baseSource, headSource }),
      requiredChecksPolicyResolver: async () => policy,
      now: () => Date.parse(VERIFIED_AT),
    });
    return verifier({ ticket: strictTicket(), target_commit: TARGET });
  };

  await t.test("current/current is accepted", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_SOURCE,
      headSource: WORKFLOW_SOURCE,
      policy: STRICT_POLICY,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_SHA256, WORKFLOW_SHA256],
    );
  });

  await t.test("stage-A-candidate-policy keeps unchanged workflow A/A valid", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_SOURCE,
      headSource: WORKFLOW_SOURCE,
      policy: candidatePolicy,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_SHA256, WORKFLOW_SHA256],
    );
  });

  await t.test("stage-B-live-policy accepts PR A-to-B only with candidate", async () => {
    await assert.rejects(
      verifySources({
        baseSource: WORKFLOW_SOURCE,
        headSource: WORKFLOW_CANDIDATE_SOURCE,
        policy: STRICT_POLICY,
      }),
      /workflow_source_mismatch/,
    );
    const result = await verifySources({
      baseSource: WORKFLOW_SOURCE,
      headSource: WORKFLOW_CANDIDATE_SOURCE,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_SHA256, WORKFLOW_CANDIDATE_SHA256],
    );
  });

  await t.test("live candidate policy accepts B/B during promotion window", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_CANDIDATE_SOURCE,
      headSource: WORKFLOW_CANDIDATE_SOURCE,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_CANDIDATE_SHA256, WORKFLOW_CANDIDATE_SHA256],
    );
  });

  await t.test("post-promote-policy accepts B/B with candidate null", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_CANDIDATE_SOURCE,
      headSource: WORKFLOW_CANDIDATE_SOURCE,
      policy: promotedPolicy,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_CANDIDATE_SHA256, WORKFLOW_CANDIDATE_SHA256],
    );
    assert.equal(promotedPolicy.workflow.candidate_sha256, null);
  });

  await t.test("unknown digest is rejected", async () => {
    await assert.rejects(
      verifySources({
        baseSource: WORKFLOW_SOURCE,
        headSource: WORKFLOW_UNKNOWN_SOURCE,
      }),
      /workflow_source_mismatch/,
    );
  });

  await t.test("candidate-current-rollback is rejected", async () => {
    await assert.rejects(
      verifySources({
        baseSource: WORKFLOW_CANDIDATE_SOURCE,
        headSource: WORKFLOW_SOURCE,
      }),
      /workflow_source_rotation_mismatch/,
    );
  });
});

test("protected push workflow digest rotation attests base/head and remains monotonic", async (t) => {
  const candidatePolicy = Object.freeze({
    ...STRICT_POLICY,
    workflow: Object.freeze({
      ...STRICT_POLICY.workflow,
      candidate_sha256: WORKFLOW_CANDIDATE_SHA256,
    }),
  });
  const promotedPolicy = Object.freeze({
    ...candidatePolicy,
    workflow: Object.freeze({
      ...candidatePolicy.workflow,
      sha256: WORKFLOW_CANDIDATE_SHA256,
      candidate_sha256: null,
    }),
  });
  const verifySources = async ({
    baseSource,
    headSource,
    policy = candidatePolicy,
    ticket = strictProtectedPushTicket(),
  }) => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictProtectedPushFetch({
        baseSource,
        headSource,
        ticket,
      }),
      requiredChecksPolicyResolver: async () => policy,
      now: () => Date.parse(VERIFIED_AT),
    });
    return verifier({ ticket, target_commit: HEAD });
  };

  await t.test("A/A is accepted with exact remote-base and checks-head evidence", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_SOURCE,
      headSource: WORKFLOW_SOURCE,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => ({
        role: source.role,
        commit: source.commit,
        sha256: source.sha256,
      })),
      [
        { role: "base", commit: BASE, sha256: WORKFLOW_SHA256 },
        { role: "head", commit: HEAD, sha256: WORKFLOW_SHA256 },
      ],
    );
  });

  await t.test("A-to-B is accepted only when B is the staged candidate", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_SOURCE,
      headSource: WORKFLOW_CANDIDATE_SOURCE,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_SHA256, WORKFLOW_CANDIDATE_SHA256],
    );
  });

  await t.test("B/B is accepted during the current-A candidate-B window", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_CANDIDATE_SOURCE,
      headSource: WORKFLOW_CANDIDATE_SOURCE,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_CANDIDATE_SHA256, WORKFLOW_CANDIDATE_SHA256],
    );
  });

  await t.test("B/B is accepted after B is promoted and candidate is null", async () => {
    const result = await verifySources({
      baseSource: WORKFLOW_CANDIDATE_SOURCE,
      headSource: WORKFLOW_CANDIDATE_SOURCE,
      policy: promotedPolicy,
    });
    assert.deepEqual(
      result.github.workflow_sources.map((source) => source.sha256),
      [WORKFLOW_CANDIDATE_SHA256, WORKFLOW_CANDIDATE_SHA256],
    );
  });

  await t.test("B-to-A rollback is rejected", async () => {
    await assert.rejects(
      verifySources({
        baseSource: WORKFLOW_CANDIDATE_SOURCE,
        headSource: WORKFLOW_SOURCE,
      }),
      /workflow_source_rotation_mismatch/,
    );
  });

  await t.test("unknown head digest is rejected", async () => {
    await assert.rejects(
      verifySources({
        baseSource: WORKFLOW_SOURCE,
        headSource: WORKFLOW_UNKNOWN_SOURCE,
      }),
      /workflow_source_mismatch/,
    );
  });

  await t.test("checks commit and protected source commit must be identical", async () => {
    const ticket = strictProtectedPushTicket();
    ticket.action.source_commit = ALTERNATE;
    await assert.rejects(
      verifySources({
        baseSource: WORKFLOW_SOURCE,
        headSource: WORKFLOW_SOURCE,
        ticket,
      }),
      /workflow_source_commit_mismatch/,
    );
  });
});

test("strict attestation binds the workflow run to the exact pull request and base", async (t) => {
  const cases = [
    ["number", { number: 999 }],
    ["URL repository", { url: "https://api.github.com/repos/attacker/repo/pulls/42" }],
    ["head ref", { head: { ref: "other-head", sha: HEAD } }],
    ["head commit", { head: { ref: "agent/release", sha: ALTERNATE } }],
    ["base ref", { base: { ref: "weak-base", sha: BASE } }],
    ["base commit", { base: { ref: "main", sha: ALTERNATE } }],
  ];
  for (const [name, mutation] of cases) {
    await t.test(name, async () => {
      const valid = strictWorkflow().pull_requests[0];
      const workflow = strictWorkflow({
        pull_requests: [{
          ...valid,
          ...mutation,
          head: mutation.head || valid.head,
          base: mutation.base || valid.base,
        }],
      });
      const verifier = createHostNativeExternalReadbackVerifier({
        fetchImpl: strictFetch({
          workflowById: new Map([[700, workflow]]),
        }),
        requiredChecksPolicyResolver: async () => STRICT_POLICY,
      });
      await assert.rejects(
        verifier({ ticket: strictTicket(), target_commit: TARGET }),
        /workflow_pull_request_mismatch/,
      );
    });
  }
});

test("strict attestation rejects a workflow file whose exact source is not policy-pinned", async () => {
  const verifier = createHostNativeExternalReadbackVerifier({
    fetchImpl: async (url, init) => {
      const root = "https://api.github.com/repos/owner/repo";
      if (
        url === `${root}/contents/.github/workflows/nyra-core-intelligence.yml?ref=${HEAD}`
      ) {
        return jsonResponse({
          type: "file",
          path: ".github/workflows/nyra-core-intelligence.yml",
          encoding: "base64",
          content: Buffer.from("name: attacker-controlled\n").toString("base64"),
        });
      }
      return strictFetch()(url, init);
    },
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
  });
  await assert.rejects(
    verifier({ ticket: strictTicket(), target_commit: TARGET }),
    /workflow_source_mismatch/,
  );
});

test("strict attestation rejects subset/superset, same-name foreign app, and mixed workflow runs", async () => {
  const subsetTicket = strictTicket();
  subsetTicket.release_manifest_binding.verification.required_checks =
    STRICT_POLICY.required_checks.slice(0, 2);
  const subsetVerifier = createHostNativeExternalReadbackVerifier({
    fetchImpl: strictFetch(),
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
  });
  await assert.rejects(
    subsetVerifier({ ticket: subsetTicket, target_commit: TARGET }),
    /required_checks_policy_mismatch/,
  );

  const supersetTicket = strictTicket();
  supersetTicket.release_manifest_binding.verification.required_checks.push("spoof");
  await assert.rejects(
    subsetVerifier({ ticket: supersetTicket, target_commit: TARGET }),
    /required_checks_policy_mismatch/,
  );

  const foreignAppVerifier = createHostNativeExternalReadbackVerifier({
    fetchImpl: strictFetch({ checks: strictChecks({ wrongApp: true }) }),
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
  });
  await assert.rejects(
    foreignAppVerifier({ ticket: strictTicket(), target_commit: TARGET }),
    /check_app_mismatch/,
  );

  const mixed = strictChecks();
  mixed.check_runs[2].details_url =
    "https://github.com/owner/repo/actions/runs/701/job/801";
  const mixedVerifier = createHostNativeExternalReadbackVerifier({
    fetchImpl: strictFetch({
      checks: mixed,
      workflowById: new Map([
        [700, strictWorkflow()],
        [701, strictWorkflow({ id: 701 })],
      ]),
    }),
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
  });
  await assert.rejects(
    mixedVerifier({ ticket: strictTicket(), target_commit: TARGET }),
    /workflow_run_mixed/,
  );
});

test("strict attestation rejects details URL and workflow repo/path/id/head mismatches", async () => {
  const badDetails = strictChecks();
  badDetails.check_runs[0].details_url =
    "https://github.com/attacker/repo/actions/runs/700/job/800";
  const detailVerifier = createHostNativeExternalReadbackVerifier({
    fetchImpl: strictFetch({ checks: badDetails }),
    requiredChecksPolicyResolver: async () => STRICT_POLICY,
  });
  await assert.rejects(
    detailVerifier({ ticket: strictTicket(), target_commit: TARGET }),
    /details_url_invalid/,
  );

  for (const override of [
    { repository: { full_name: "attacker/repo" } },
    { path: ".github/workflows/spoof.yml" },
    { workflow_id: 9 },
    { head_sha: ALTERNATE },
  ]) {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: strictFetch({
        workflowById: new Map([[700, strictWorkflow(override)]]),
      }),
      requiredChecksPolicyResolver: async () => STRICT_POLICY,
    });
    await assert.rejects(
      verifier({ ticket: strictTicket(), target_commit: TARGET }),
      /workflow_run_mismatch/,
    );
  }
});

function successFetch({
  ticket = mergeTicket(),
  calls = [],
  checkRuns = successfulChecks(),
  pull = pullRequest(ticket.repository),
  target = { sha: TARGET },
  rollback = { sha: BASE },
  healthByOrigin = new Map(),
} = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    const repositoryRoot = `https://api.github.com/repos/${ticket.repository}`;
    if (url === `${repositoryRoot}/commits/${HEAD}/check-runs?per_page=100`) {
      return jsonResponse(checkRuns);
    }
    if (url === `${repositoryRoot}/pulls/42`) return jsonResponse(pull);
    if (url === `${repositoryRoot}/git/ref/heads/release/v1`) {
      return jsonResponse({ object: { sha: TARGET } });
    }
    if (url === `${repositoryRoot}/git/commits/${TARGET}`) return jsonResponse(target);
    if (url === `${repositoryRoot}/git/commits/${BASE}`) return jsonResponse(rollback);
    if (url.endsWith("/healthz")) {
      const origin = url.slice(0, -"/healthz".length);
      const service = ticket.release_manifest_binding.services.find(
        (candidate) => candidate.origin === origin,
      );
      if (!service) throw new Error(`unexpected health URL: ${url}`);
      return jsonResponse(
        healthByOrigin.get(origin) || serviceHealth(service.service_id),
      );
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

test("external readback is tenant-scoped, uses fixed provider URLs, and proves every service", async () => {
  const ticket = mergeTicket({
    services: [
      {
        service_id: "service-b",
        environment: "production",
        origin: "https://service-b.onrender.com",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      },
      {
        service_id: "service-a",
        environment: "production",
        origin: "https://service-a.onrender.com",
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      },
    ],
  });
  const calls = [];
  const credentialRequests = [];
  const verify = createHostNativeExternalReadbackVerifier({
    fetchImpl: successFetch({ ticket, calls }),
    githubTokenResolver: async (request) => {
      credentialRequests.push(request);
      return "tenant-a-private-token";
    },
    now: () => Date.parse(VERIFIED_AT),
  });

  const readback = await verify({ ticket, target_commit: TARGET });

  assert.deepEqual(credentialRequests, [{
    tenant_id: "tenant-a",
    repository: "owner/repo",
  }]);
  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map((call) => call.url), [
    `https://api.github.com/repos/owner/repo/commits/${HEAD}/check-runs?per_page=100`,
    "https://api.github.com/repos/owner/repo/pulls/42",
    `https://api.github.com/repos/owner/repo/git/commits/${TARGET}`,
    `https://api.github.com/repos/owner/repo/git/commits/${BASE}`,
    "https://service-b.onrender.com/healthz",
    "https://service-a.onrender.com/healthz",
  ]);
  for (const call of calls) {
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.redirect, "error");
    assert.ok(call.init.signal instanceof AbortSignal);
    if (call.url.startsWith("https://api.github.com/")) {
      assert.equal(call.init.headers.authorization, "Bearer tenant-a-private-token");
      assert.equal(call.init.headers["x-github-api-version"], "2022-11-28");
      assert.equal(
        call.init.headers["user-agent"],
        "skinharmony-universal-core-host-native-readback",
      );
    } else {
      assert.equal(call.init.headers.authorization, undefined);
      assert.equal(call.init.headers.accept, "application/json");
    }
  }

  assert.equal(readback.schema_version, "host_native_external_readback_v1");
  assert.equal(readback.trusted, true);
  assert.equal(readback.verified_at, VERIFIED_AT);
  assert.deepEqual(readback.services.map((service) => service.service_id), [
    "service-a",
    "service-b",
  ]);
  for (const service of readback.services) {
    assert.equal(service.live_commit, TARGET);
    assert.equal(service.rollback_commit, BASE);
    assert.equal(service.rollback_status, "previous_live_attested");
    const unsigned = { ...service };
    delete unsigned.readback_digest;
    assert.equal(service.readback_digest, hostNativeDigest(unsigned));
  }
  assert.equal(readback.github.head_branch, "agent/release");
  assert.equal(readback.github.base_branch, "main");
  assert.equal(readback.github.head_commit, HEAD);
  assert.equal(readback.github.expected_base_commit, BASE);
  assert.equal(readback.github.merge_commit, TARGET);
  assert.equal(readback.github.target_commit, TARGET);
  assert.equal(readback.github.rollback_commit, BASE);
  assert.deepEqual(readback.github.required_checks, [
    "deployment-parity",
    "unit-tests",
  ]);
  const unsignedGithub = { ...readback.github };
  delete unsignedGithub.readback_digest;
  assert.equal(readback.github.readback_digest, hostNativeDigest(unsignedGithub));
});

test("external readback binds previous-live evidence from the persisted action ticket", async (t) => {
  const persistedTicket = mergeTicket();
  assert.equal(persistedTicket.release_manifest_binding.join_resolution, undefined);
  assert.equal(
    persistedTicket.release_join_resolution_digest,
    hostNativeDigest(persistedTicket.release_join_resolution),
  );

  const readback = await createHostNativeExternalReadbackVerifier({
    fetchImpl: successFetch({ ticket: persistedTicket }),
  })({
    ticket: persistedTicket,
    target_commit: TARGET,
  });
  assert.equal(readback.services[0].rollback_commit, BASE);
  assert.equal(readback.services[0].rollback_status, "previous_live_attested");

  await t.test("missing persisted resolution fails closed", async () => {
    const ticket = mergeTicket();
    delete ticket.release_join_resolution;
    delete ticket.release_join_resolution_digest;
    await assert.rejects(
      createHostNativeExternalReadbackVerifier({
        fetchImpl: successFetch({ ticket }),
      })({ ticket, target_commit: TARGET }),
      /trusted_readback_render_health_mismatch/,
    );
  });

  await t.test("legacy manifest-binding evidence cannot substitute", async () => {
    const ticket = mergeTicket();
    ticket.release_manifest_binding.join_resolution = {
      previous_live_attestations:
        ticket.release_join_resolution.previous_live_attestations,
    };
    delete ticket.release_join_resolution;
    delete ticket.release_join_resolution_digest;
    await assert.rejects(
      createHostNativeExternalReadbackVerifier({
        fetchImpl: successFetch({ ticket }),
      })({ ticket, target_commit: TARGET }),
      /trusted_readback_render_health_mismatch/,
    );
  });

  for (const [name, mutate] of [
    ["wrong prior commit", (entry) => { entry.live_commit = ALTERNATE; }],
    ["wrong service identity", (entry) => { entry.service_id = "other-service"; }],
    ["wrong environment", (entry) => { entry.environment = "staging"; }],
    ["wrong origin", (entry) => { entry.origin = "https://other-service.onrender.com"; }],
  ]) {
    await t.test(name, async () => {
      const ticket = mergeTicket();
      mutate(ticket.release_join_resolution.previous_live_attestations[0]);
      ticket.release_join_resolution_digest = hostNativeDigest(ticket.release_join_resolution);
      await assert.rejects(
        createHostNativeExternalReadbackVerifier({
          fetchImpl: successFetch({ ticket }),
        })({ ticket, target_commit: TARGET }),
        /trusted_readback_render_health_mismatch/,
      );
    });
  }
});

test("post-action compact commit identity readback remains size-bounded", async (t) => {
  const ticket = mergeTicket();
  const repositoryRoot = "https://api.github.com/repos/owner/repo";
  const targetUrl = `${repositoryRoot}/git/commits/${TARGET}`;
  const rollbackUrl = `${repositoryRoot}/git/commits/${BASE}`;

  await t.test("rejects an oversized declared target response", async () => {
    const calls = [];
    const fallback = successFetch({ ticket, calls });
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: async (url, init) => {
        if (url === targetUrl) {
          calls.push({ url, init });
          return jsonResponse({}, { headers: { "content-length": "256001" } });
        }
        return fallback(url, init);
      },
    });
    await assert.rejects(
      verifier({ ticket, target_commit: TARGET }),
      /trusted_readback_response_too_large/,
    );
    assert.equal(calls.at(-1)?.url, targetUrl);
  });

  await t.test("rejects an oversized streamed rollback response", async () => {
    const calls = [];
    const fallback = successFetch({ ticket, calls });
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: async (url, init) => {
        if (url === rollbackUrl) {
          calls.push({ url, init });
          const body = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(200_000));
              controller.enqueue(new Uint8Array(60_001));
              controller.close();
            },
          });
          return new Response(body, {
            headers: { "content-type": "application/json" },
          });
        }
        return fallback(url, init);
      },
    });
    await assert.rejects(
      verifier({ ticket, target_commit: TARGET }),
      /trusted_readback_response_too_large/,
    );
    assert.deepEqual(calls.slice(-2).map((call) => call.url), [
      targetUrl,
      rollbackUrl,
    ]);
  });
});

test("private GitHub credentials remain isolated by tenant and never reach Render", async () => {
  const cases = [
    {
      ticket: mergeTicket({
        tenantId: "tenant-a",
        repository: "owner-a/repo-a",
        services: [{
          service_id: "tenant-a-service",
          environment: "production",
          origin: "https://tenant-a-service.onrender.com",
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        }],
      }),
      token: "token-a",
    },
    {
      ticket: mergeTicket({
        tenantId: "tenant-b",
        repository: "owner-b/repo-b",
        services: [{
          service_id: "tenant-b-service",
          environment: "production",
          origin: "https://tenant-b-service.onrender.com",
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        }],
      }),
      token: "token-b",
    },
  ];
  const credentialRequests = [];
  const calls = [];
  const verifier = createHostNativeExternalReadbackVerifier({
    githubTokenResolver: async (request) => {
      credentialRequests.push(request);
      const match = cases.find((candidate) =>
        candidate.ticket.tenant_id === request.tenant_id &&
        candidate.ticket.repository === request.repository);
      if (!match) throw new Error("cross-tenant credential request");
      return match.token;
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const match = cases.find((candidate) =>
        url.includes(`/repos/${candidate.ticket.repository}/`) ||
        url.startsWith(candidate.ticket.release_manifest_binding.services[0].origin));
      if (!match) throw new Error(`unexpected URL: ${url}`);
      return successFetch({ ticket: match.ticket })(url, init);
    },
  });

  await Promise.all(cases.map(({ ticket }) => verifier({
    ticket,
    target_commit: TARGET,
  })));

  assert.deepEqual(
    credentialRequests.sort((left, right) => left.tenant_id.localeCompare(right.tenant_id)),
    [
      { tenant_id: "tenant-a", repository: "owner-a/repo-a" },
      { tenant_id: "tenant-b", repository: "owner-b/repo-b" },
    ],
  );
  for (const { ticket, token } of cases) {
    const providerCalls = calls.filter((call) =>
      call.url.includes(`/repos/${ticket.repository}/`));
    assert.ok(providerCalls.length > 0);
    assert.ok(providerCalls.every((call) =>
      call.init.headers.authorization === `Bearer ${token}`));
    const healthCalls = calls.filter((call) =>
      call.url.startsWith(ticket.release_manifest_binding.services[0].origin));
    assert.equal(healthCalls.length, 1);
    assert.equal(healthCalls[0].init.headers.authorization, undefined);
  }
});

test("external readback rejects untrusted Render origins before contacting them", async (t) => {
  const invalidOrigins = [
    "http://service-a.onrender.com",
    "https://service-a.onrender.com/path",
    "https://service-a.onrender.com:443",
    "https://user:secret@service-a.onrender.com",
    "https://service-a.onrender.com?tenant=b",
    "https://service-a.onrender.com#fragment",
    "https://onrender.com",
    "https://service-a.example.com",
    "https://nested.service-a.onrender.com",
  ];
  for (const origin of invalidOrigins) {
    await t.test(origin, async () => {
      const ticket = mergeTicket({
        services: [{
          service_id: "service-a",
          environment: "production",
          origin,
          health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        }],
      });
      const calls = [];
      const verify = createHostNativeExternalReadbackVerifier({
        fetchImpl: successFetch({ ticket, calls }),
      });
      await assert.rejects(
        verify({ ticket, target_commit: TARGET }),
        /trusted_readback_render_origin_invalid/,
      );
      assert.equal(calls.length, 4);
      assert.ok(calls.every((call) => call.url.startsWith("https://api.github.com/")));
    });
  }
});

test("external readback enforces redirect, content type, size, stream, and timeout boundaries", async (t) => {
  const ticket = mergeTicket();
  const verifyWith = (fetchImpl, timeoutMs = 5_000) =>
    createHostNativeExternalReadbackVerifier({ fetchImpl, timeoutMs })({
      ticket,
      target_commit: TARGET,
    });

  await t.test("network failure", async () => {
    await assert.rejects(
      verifyWith(async () => {
        throw new Error("socket reset");
      }),
      /trusted_readback_unavailable/,
    );
  });

  await t.test("redirect response", async () => {
    let options;
    await assert.rejects(
      verifyWith(async (_url, init) => {
        options = init;
        return jsonResponse({}, { status: 302 });
      }),
      /trusted_readback_unavailable/,
    );
    assert.equal(options.redirect, "error");
  });

  await t.test("non-JSON response", async () => {
    await assert.rejects(
      verifyWith(async () => new Response("{}", {
        headers: { "content-type": "text/plain" },
      })),
      /trusted_readback_response_invalid/,
    );
  });

  await t.test("invalid JSON response", async () => {
    await assert.rejects(
      verifyWith(async () => new Response("{", {
        headers: { "content-type": "application/json" },
      })),
      /trusted_readback_response_invalid/,
    );
  });

  await t.test("declared oversized response", async () => {
    await assert.rejects(
      verifyWith(async () => jsonResponse({}, {
        headers: { "content-length": "256001" },
      })),
      /trusted_readback_response_too_large/,
    );
  });

  await t.test("streamed oversized response", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(200_000));
        controller.enqueue(new Uint8Array(60_001));
        controller.close();
      },
    });
    await assert.rejects(
      verifyWith(async () => new Response(body, {
        headers: { "content-type": "application/json" },
      })),
      /trusted_readback_response_too_large/,
    );
  });

  await t.test("body read remains covered by timeout", async () => {
    await assert.rejects(
      verifyWith(async (_url, init) => ({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        body: {
          getReader() {
            return {
              read() {
                return new Promise((_resolve, reject) => {
                  init.signal.addEventListener(
                    "abort",
                    () => reject(new Error("body aborted")),
                    { once: true },
                  );
                });
              },
              releaseLock() {},
            };
          },
        },
      }), 250),
      /trusted_readback_unavailable/,
    );
  });
});

test("required GitHub checks must match the exact commit and conclude success", async (t) => {
  const ticket = mergeTicket();
  const cases = [
    {
      name: "missing check",
      mutate: (payload) => ({
        ...payload,
        check_runs: payload.check_runs.filter((run) => run.name !== "unit-tests"),
      }),
    },
    {
      name: "wrong commit",
      mutate: (payload) => ({
        ...payload,
        check_runs: payload.check_runs.map((run) =>
          run.name === "unit-tests" ? { ...run, head_sha: ALTERNATE } : run),
      }),
    },
    {
      name: "not completed",
      mutate: (payload) => ({
        ...payload,
        check_runs: payload.check_runs.map((run) =>
          run.name === "unit-tests" ? { ...run, status: "in_progress" } : run),
      }),
    },
    ...["failure", "neutral", "skipped"].map((conclusion) => ({
      name: `conclusion ${conclusion}`,
      mutate: (payload) => ({
        ...payload,
        check_runs: payload.check_runs.map((run) =>
          run.name === "unit-tests" ? { ...run, conclusion } : run),
      }),
    })),
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const verify = createHostNativeExternalReadbackVerifier({
        fetchImpl: successFetch({
          ticket,
          checkRuns: scenario.mutate(successfulChecks()),
        }),
      });
      await assert.rejects(
        verify({ ticket, target_commit: TARGET }),
        /trusted_readback_checks_not_ready/,
      );
    });
  }
});

test("merge readback binds exact PR commits, refs, repository, and merge commit", async (t) => {
  const ticket = mergeTicket();
  const cases = [
    ["not merged", { merged: false }],
    ["merge commit", { merge_commit_sha: ALTERNATE }],
    ["head commit", { head: { ...pullRequest().head, sha: ALTERNATE } }],
    ["base commit", { base: { ...pullRequest().base, sha: ALTERNATE } }],
    ["head ref", { head: { ...pullRequest().head, ref: "attacker/head" } }],
    ["base ref", { base: { ...pullRequest().base, ref: "attacker/base" } }],
    ["head repository", {
      head: { ...pullRequest().head, repo: { full_name: "attacker/repo" } },
    }],
    ["base repository", {
      base: { ...pullRequest().base, repo: { full_name: "attacker/repo" } },
    }],
  ];
  for (const [name, mutation] of cases) {
    await t.test(name, async () => {
      const verify = createHostNativeExternalReadbackVerifier({
        fetchImpl: successFetch({
          ticket,
          pull: pullRequest(ticket.repository, mutation),
        }),
      });
      await assert.rejects(
        verify({ ticket, target_commit: TARGET }),
        /trusted_readback_github_merge_mismatch/,
      );
    });
  }
});

test("branch, target, rollback, and all Render health bindings are exact", async (t) => {
  const ticket = branchTicket();
  const calls = [];
  const verify = createHostNativeExternalReadbackVerifier({
    fetchImpl: successFetch({ ticket, calls }),
  });
  const readback = await verify({ ticket, target_commit: TARGET });
  assert.ok(calls.some((call) =>
    call.url === "https://api.github.com/repos/owner/repo/git/ref/heads/release/v1"));
  assert.ok(calls.some((call) =>
    call.url === `https://api.github.com/repos/owner/repo/git/commits/${TARGET}`));
  assert.ok(calls.some((call) =>
    call.url === `https://api.github.com/repos/owner/repo/git/commits/${BASE}`));
  assert.equal(readback.github.branch, "release/v1");
  assert.equal(readback.github.branch_commit, TARGET);

  await t.test("branch mismatch", async () => {
    const fetchImpl = async (url, init) => {
      if (url.endsWith("/git/ref/heads/release/v1")) {
        return jsonResponse({ object: { sha: ALTERNATE } });
      }
      return successFetch({ ticket })(url, init);
    };
    await assert.rejects(
      createHostNativeExternalReadbackVerifier({ fetchImpl })({
        ticket,
        target_commit: TARGET,
      }),
      /trusted_readback_branch_commit_mismatch/,
    );
  });

  await t.test("target commit mismatch", async () => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: successFetch({ ticket, target: { sha: ALTERNATE } }),
    });
    await assert.rejects(
      verifier({ ticket, target_commit: TARGET }),
      /trusted_readback_target_commit_mismatch/,
    );
  });

  await t.test("rollback commit mismatch", async () => {
    const verifier = createHostNativeExternalReadbackVerifier({
      fetchImpl: successFetch({ ticket, rollback: { sha: ALTERNATE } }),
    });
    await assert.rejects(
      verifier({ ticket, target_commit: TARGET }),
      /trusted_readback_rollback_unavailable/,
    );
  });

  const healthCases = [
    ["ok", { ok: false }],
    ["render readiness", { render_ready: false }],
    ["commit verifiability", {
      build: {
        ...serviceHealth("service-a").build,
        commit_verifiable: false,
      },
    }],
    ["live commit", {
      build: {
        ...serviceHealth("service-a").build,
        commit_sha: ALTERNATE,
      },
    }],
    ["contract version", { health_contract_version: "other_contract" }],
    ["contract digest", { health_contract_digest: "f".repeat(64) }],
  ];
  for (const [name, mutation] of healthCases) {
    await t.test(`health ${name}`, async () => {
      const origin = ticket.release_manifest_binding.services[0].origin;
      const verifier = createHostNativeExternalReadbackVerifier({
        fetchImpl: successFetch({
          ticket,
          healthByOrigin: new Map([[
            origin,
            serviceHealth("service-a", mutation),
          ]]),
        }),
      });
      await assert.rejects(
        verifier({ ticket, target_commit: TARGET }),
        /trusted_readback_render_health_mismatch/,
      );
    });
  }
});

test("credential resolver failures fail closed before any provider request", async () => {
  let fetchCalls = 0;
  const verify = createHostNativeExternalReadbackVerifier({
    githubTokenResolver: async () => {
      throw new Error("tenant connector unavailable");
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({});
    },
  });
  await assert.rejects(
    verify({ ticket: mergeTicket(), target_commit: TARGET }),
    /trusted_readback_github_credential_unavailable/,
  );
  assert.equal(fetchCalls, 0);
});

function releaseJoinRequest(overrides = {}) {
  const sourceEvidence = {
    base_commit: BASE,
    head_commit: HEAD,
    tree_sha: TREE,
    changed_files: RELEASE_CHANGED_FILES,
  };
  sourceEvidence.diff_digest = hostNativeGithubDiffDigest({
    repository: "owner/repo",
    ...sourceEvidence,
  });
  return {
    core_join_verified: true,
    core_join_issued_at: "2026-07-29T11:59:00.000Z",
    verdict_id: "hnj_test",
    tenant_id: "tenant-a",
    work_id: "work-a",
    intent_anchor_digest: "a".repeat(64),
    repository: "owner/repo",
    checks_commit: HEAD,
    required_checks: ["deployment-parity", "unit-tests"],
    evidence_digest: "b".repeat(64),
    source_evidence: sourceEvidence,
    delivery_services: [{
      service_id: "service-a",
      environment: "production",
      origin: "https://service-a.onrender.com",
      expected_previous_commit: BASE,
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    }],
    rollback: {
      target_commit: BASE,
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      mode: "forward_revert",
      ready: true,
    },
    action: {
      kind: "github.merge",
      pull_request: 42,
      head_branch: "agent/release",
      base_branch: "main",
      head_commit: HEAD,
      expected_base_commit: BASE,
    },
    ...overrides,
  };
}

function releaseJoinFetch({
  treeSha = TREE,
  files = [{
    filename: RELEASE_CHANGED_FILES[0],
    status: "modified",
  }],
  healthOverrides = {},
} = {}) {
  return async (url) => {
    if (url.endsWith(`/git/commits/${HEAD}`)) {
      return jsonResponse({ sha: HEAD, tree: { sha: treeSha } });
    }
    if (url.endsWith(`/commits/${HEAD}/check-runs?per_page=100`)) {
      return jsonResponse(successfulChecks());
    }
    if (url.endsWith("/pulls/42")) {
      return jsonResponse(pullRequest("owner/repo", { merged: false }));
    }
    if (url.endsWith("/pulls/42/files?per_page=10&page=1")) {
      return jsonResponse(files);
    }
    if (url === "https://service-a.onrender.com/healthz") {
      return jsonResponse(serviceHealth("service-a", {
        build: {
          build_id: "previous-service-a",
          commit_sha: BASE,
          commit_verifiable: true,
        },
        ...healthOverrides,
      }));
    }
    throw new Error(`unexpected URL: ${url}`);
  };
}

test("release-join resolver independently proves exact pre-merge GitHub state", async () => {
  const calls = [];
  const credentialRequests = [];
  const request = releaseJoinRequest();
  const resolver = createHostNativeReleaseJoinVerdictResolver({
    githubTokenResolver: async (scope) => {
      credentialRequests.push(scope);
      return "join-token";
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith(`/git/commits/${HEAD}`)) {
        return jsonResponse({ sha: HEAD, tree: { sha: TREE } });
      }
      if (url.endsWith(`/commits/${HEAD}/check-runs?per_page=100`)) {
        return jsonResponse(successfulChecks());
      }
      if (url.endsWith("/pulls/42")) {
        return jsonResponse(pullRequest("owner/repo", { merged: false }));
      }
      if (url.endsWith("/pulls/42/files?per_page=10&page=1")) {
        return jsonResponse([{
          filename: RELEASE_CHANGED_FILES[0],
          status: "modified",
        }]);
      }
      if (url === "https://service-a.onrender.com/healthz") {
        return jsonResponse(serviceHealth("service-a", {
          build: {
            build_id: "previous-service-a",
            commit_sha: BASE,
            commit_verifiable: true,
          },
        }));
      }
      throw new Error(`unexpected URL: ${url}`);
    },
    now: () => Date.parse(VERIFIED_AT),
  });

  const resolution = await resolver(request);

  assert.deepEqual(credentialRequests, [{
    tenant_id: "tenant-a",
    repository: "owner/repo",
  }]);
  assert.deepEqual(calls.map((call) => call.url), [
    `https://api.github.com/repos/owner/repo/git/commits/${HEAD}`,
    `https://api.github.com/repos/owner/repo/commits/${HEAD}/check-runs?per_page=100`,
    "https://api.github.com/repos/owner/repo/pulls/42",
    "https://api.github.com/repos/owner/repo/pulls/42/files?per_page=10&page=1",
    "https://service-a.onrender.com/healthz",
  ]);
  assert.ok(calls
    .filter((call) => call.url.startsWith("https://api.github.com/"))
    .every((call) => call.init.headers.authorization === "Bearer join-token"));
  assert.equal(
    calls.find((call) => call.url === "https://service-a.onrender.com/healthz")
      .init.headers.authorization,
    undefined,
  );
  assert.deepEqual(resolution, {
    schema_version: "host_native_release_join_resolution_v1",
    trusted: true,
    authority: "universal_core",
    allowed: true,
    verdict_id: "hnj_test",
    tenant_id: "tenant-a",
    work_id: "work-a",
    intent_anchor_digest: "a".repeat(64),
    repository: "owner/repo",
    checks_commit: HEAD,
    evidence_digest: "b".repeat(64),
    issued_at: "2026-07-29T11:59:00.000Z",
    resolved_at: VERIFIED_AT,
    source_attestation: resolution.source_attestation,
    previous_live_attestations: resolution.previous_live_attestations,
    pre_action_readback_digest: resolution.pre_action_readback_digest,
    provider_execution: false,
  });
});

test("release-join compact commit readback preserves fail-closed boundaries", async (t) => {
  const compactCommitUrl =
    `https://api.github.com/repos/owner/repo/git/commits/${HEAD}`;
  const resolverFor = (responseFactory, calls) =>
    createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return responseFactory();
      },
    });

  await t.test("rejects the legacy repository-commit tree shape", async () => {
    const calls = [];
    const resolver = resolverFor(
      () => jsonResponse({ sha: HEAD, commit: { tree: { sha: TREE } } }),
      calls,
    );
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /release_join_verdict_source_attestation_mismatch/,
    );
    assert.deepEqual(calls.map((call) => call.url), [compactCommitUrl]);
  });

  await t.test("rejects an oversized declared compact response", async () => {
    const calls = [];
    const resolver = resolverFor(
      () => jsonResponse({}, { headers: { "content-length": "256001" } }),
      calls,
    );
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /trusted_readback_response_too_large/,
    );
    assert.deepEqual(calls.map((call) => call.url), [compactCommitUrl]);
  });

  await t.test("rejects an oversized streamed compact response", async () => {
    const calls = [];
    const resolver = resolverFor(() => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(200_000));
          controller.enqueue(new Uint8Array(60_001));
          controller.close();
        },
      });
      return new Response(body, {
        headers: { "content-type": "application/json" },
      });
    }, calls);
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /trusted_readback_response_too_large/,
    );
    assert.deepEqual(calls.map((call) => call.url), [compactCommitUrl]);
  });
});

test("release-join source scope and previous-live evidence fail closed", async (t) => {
  await t.test("commit tree mismatch", async () => {
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: releaseJoinFetch({ treeSha: ALTERNATE }),
    });
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /release_join_verdict_source_attestation_mismatch/,
    );
  });

  await t.test("caller-hidden forbidden file", async () => {
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: releaseJoinFetch({
        files: [
          { filename: RELEASE_CHANGED_FILES[0], status: "modified" },
          { filename: ".github/workflows/hidden.yml", status: "added" },
        ],
      }),
    });
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /release_join_verdict_changed_files_mismatch/,
    );
  });

  await t.test("rename binds both source and destination paths", async () => {
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: releaseJoinFetch({
        files: [{
          filename: RELEASE_CHANGED_FILES[0],
          previous_filename: "forbidden/secret.js",
          status: "renamed",
        }],
      }),
    });
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /release_join_verdict_changed_files_mismatch/,
    );
  });

  await t.test("PR file pagination cannot hide a later path", async () => {
    const firstPage = [
      { filename: RELEASE_CHANGED_FILES[0], status: "modified" },
      ...Array.from({ length: 9 }, (_, index) => ({
        filename: `services/generated/file-${index}.js`,
        status: "added",
      })),
    ];
    const baseFetch = releaseJoinFetch();
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: async (url, init) => {
        if (url.endsWith("/pulls/42/files?per_page=10&page=1")) {
          return jsonResponse(firstPage);
        }
        if (url.endsWith("/pulls/42/files?per_page=10&page=2")) {
          return jsonResponse([{
            filename: ".github/workflows/later-hidden.yml",
            status: "added",
          }]);
        }
        return baseFetch(url, init);
      },
    });
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /release_join_verdict_changed_files_mismatch/,
    );
  });

  for (const [name, healthOverrides] of [
    ["wrong previous live commit", {
      build: {
        build_id: "wrong-previous",
        commit_sha: ALTERNATE,
        commit_verifiable: true,
      },
    }],
    ["unhealthy previous deployment", { ok: false }],
  ]) {
    await t.test(name, async () => {
      const resolver = createHostNativeReleaseJoinVerdictResolver({
        fetchImpl: releaseJoinFetch({ healthOverrides }),
      });
      await assert.rejects(
        resolver(releaseJoinRequest()),
        /release_join_verdict_previous_live_mismatch/,
      );
    });
  }
});

test("release-join resolver rejects untrusted, failed-check, or mismatched PR evidence", async (t) => {
  await t.test("untrusted Core join", async () => {
    let fetchCalls = 0;
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: async () => {
        fetchCalls += 1;
        return jsonResponse({});
      },
    });
    await assert.rejects(
      resolver(releaseJoinRequest({ core_join_verified: false })),
      /release_join_verdict_untrusted/,
    );
    assert.equal(fetchCalls, 0);
  });

  await t.test("failed required check", async () => {
    const resolver = createHostNativeReleaseJoinVerdictResolver({
      fetchImpl: async (url) => {
        if (url.endsWith(`/git/commits/${HEAD}`)) {
          return jsonResponse({ sha: HEAD, tree: { sha: TREE } });
        }
        if (url.includes("/check-runs")) {
          const checks = successfulChecks();
          checks.check_runs[0].conclusion = "failure";
          return jsonResponse(checks);
        }
        throw new Error(`unexpected URL: ${url}`);
      },
    });
    await assert.rejects(
      resolver(releaseJoinRequest()),
      /trusted_readback_checks_not_ready/,
    );
  });

  const mismatches = [
    ["already merged", { merged: true }],
    ["head SHA", { head: { ...pullRequest().head, sha: ALTERNATE } }],
    ["base SHA", { base: { ...pullRequest().base, sha: ALTERNATE } }],
    ["head ref", { head: { ...pullRequest().head, ref: "attacker/head" } }],
    ["base ref", { base: { ...pullRequest().base, ref: "attacker/base" } }],
    ["head repository", {
      head: { ...pullRequest().head, repo: { full_name: "attacker/repo" } },
    }],
    ["base repository", {
      base: { ...pullRequest().base, repo: { full_name: "attacker/repo" } },
    }],
  ];
  for (const [name, mutation] of mismatches) {
    await t.test(name, async () => {
      const resolver = createHostNativeReleaseJoinVerdictResolver({
        fetchImpl: async (url) => {
          if (url.endsWith(`/git/commits/${HEAD}`)) {
            return jsonResponse({ sha: HEAD, tree: { sha: TREE } });
          }
          if (url.includes("/check-runs")) return jsonResponse(successfulChecks());
          if (url.endsWith("/pulls/42")) {
            return jsonResponse(pullRequest("owner/repo", {
              merged: false,
              ...mutation,
            }));
          }
          throw new Error(`unexpected URL: ${url}`);
        },
      });
      await assert.rejects(
        resolver(releaseJoinRequest()),
        /release_join_verdict_pull_request_mismatch/,
      );
    });
  }
});
