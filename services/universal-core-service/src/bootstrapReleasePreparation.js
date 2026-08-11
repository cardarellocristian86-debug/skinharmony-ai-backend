import crypto from "node:crypto";

export const BOOTSTRAP_RELEASE_PREPARATION_SCHEMA_VERSION =
  "bootstrap_release_preparation_v1";
export const BOOTSTRAP_RELEASE_EXCEPTION_SCHEMA_VERSION =
  "bootstrap_release_exception_v1";

const DEADLOCK_CLASSIFICATION = "BOOTSTRAP_DEADLOCK_VERIFIED";
const ALLOWED_ACTION = "github.merge";
const AUTHORITY_PROVIDER = "local_pin";
const SIGNATURE_ALGORITHM = "ECDSA-P256-SHA256-P1363";
const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 15 * 60;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const TENANT = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const REQUEST_FIELDS = Object.freeze([
  "allowed_action",
  "head_sha",
  "pr_number",
  "repository",
  "request_id",
  "tenant_id",
  "work_id",
]);

const ROLLBACK_OBLIGATIONS = Object.freeze({
  schema_version: "bootstrap_rollback_obligations_v1",
  obligations: Object.freeze([
    "block_work_closure_on_post_deploy_failure",
    "execute_policy_governed_remediation_or_rollback",
    "preserve_bootstrap_exception_ledger",
  ]),
});

const POST_DEPLOY_OBLIGATIONS = Object.freeze({
  schema_version: "bootstrap_post_deploy_obligations_v1",
  obligations: Object.freeze([
    "verify_exact_live_commit",
    "verify_core_mcp_health",
    "verify_universal_core_health",
    "reconcile_observed_unreserved_effect",
    "execute_native_plan_builder_verifier_cycle",
    "submit_evidence_and_obtain_core_join",
    "produce_release_manifest",
    "checkpoint_work",
  ]),
});

function fail(code) {
  throw new Error(code);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value, expected, code) {
  if (!isPlainObject(value)) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const fields = [...expected].sort();
  if (actual.length !== fields.length || actual.some((field, index) => field !== fields[index])) fail(code);
  if (Object.values(descriptors).some((descriptor) =>
    !Object.prototype.hasOwnProperty.call(descriptor, "value") || descriptor.value === undefined)) fail(code);
}

function canonical(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) fail("bootstrap_release_preparation_canonical_value_invalid");
    seen.add(value);
    const result = `[${value.map((entry) => canonical(entry, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (!isPlainObject(value) || seen.has(value) || Object.getOwnPropertySymbols(value).length) {
    fail("bootstrap_release_preparation_canonical_value_invalid");
  }
  seen.add(value);
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, descriptor]) => {
      if (!Object.prototype.hasOwnProperty.call(descriptor, "value") || descriptor.value === undefined) {
        fail("bootstrap_release_preparation_canonical_value_invalid");
      }
      return `${JSON.stringify(key)}:${canonical(descriptor.value, seen)}`;
    });
  seen.delete(value);
  return `{${entries.join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function assertString(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
}

function validateActionRequest(request, authenticatedTenantId) {
  exactFields(request, REQUEST_FIELDS, "bootstrap_release_preparation_action_request_schema_invalid");
  assertString(request.request_id, IDENTIFIER, "bootstrap_release_preparation_request_id_invalid");
  assertString(request.tenant_id, TENANT, "bootstrap_release_preparation_tenant_invalid");
  assertString(request.work_id, IDENTIFIER, "bootstrap_release_preparation_work_invalid");
  assertString(request.repository, REPOSITORY, "bootstrap_release_preparation_repository_invalid");
  assertString(request.head_sha, SHA1, "bootstrap_release_preparation_head_sha_invalid");
  if (!Number.isSafeInteger(request.pr_number) || request.pr_number < 1) {
    fail("bootstrap_release_preparation_pr_invalid");
  }
  if (request.allowed_action !== ALLOWED_ACTION) fail("bootstrap_release_preparation_action_invalid");
  if (!safeEqual(request.tenant_id, authenticatedTenantId)) fail("bootstrap_release_preparation_cross_tenant_denied");
  if (request.repository.includes("..") || request.repository.endsWith(".git")) {
    fail("bootstrap_release_preparation_repository_invalid");
  }
}

function validateTtl(requestedTtlSeconds) {
  const ttl = requestedTtlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
    fail("bootstrap_release_preparation_ttl_invalid");
  }
  return ttl;
}

function normalFailureCode(result, error) {
  if (error && typeof error.failure_code === "string") return error.failure_code;
  if (isPlainObject(result) && result.ok === false && typeof result.failure_code === "string") {
    return result.failure_code;
  }
  return null;
}

function validateChecksReadback(readback, request) {
  if (!isPlainObject(readback) || !Array.isArray(readback.checks) || readback.checks.length === 0) {
    fail("bootstrap_release_preparation_required_checks_readback_invalid");
  }
  for (const field of ["tenant_id", "work_id", "repository", "head_sha"]) {
    if (!safeEqual(readback[field], request[field])) fail(`bootstrap_release_preparation_readback_${field}_mismatch`);
  }
  if (readback.pr_number !== request.pr_number) fail("bootstrap_release_preparation_readback_pr_number_mismatch");
  if (typeof readback.policy_revision !== "string" || readback.policy_revision.length === 0) {
    fail("bootstrap_release_preparation_required_checks_policy_invalid");
  }
  const normalizedChecks = readback.checks.map((check) => {
    if (!isPlainObject(check) || typeof check.name !== "string" || check.name.length === 0 ||
        check.status !== "completed" || check.conclusion !== "success") {
      fail("bootstrap_release_preparation_required_checks_not_green");
    }
    return { conclusion: check.conclusion, name: check.name, status: check.status };
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(normalizedChecks.map((check) => check.name)).size !== normalizedChecks.length) {
    fail("bootstrap_release_preparation_required_checks_readback_invalid");
  }
  return {
    required_checks_digest: sha256({
      policy_revision: readback.policy_revision,
      required_checks: normalizedChecks.map((check) => check.name),
    }),
    required_checks_results_digest: sha256({
      head_sha: request.head_sha,
      policy_revision: readback.policy_revision,
      pr_number: request.pr_number,
      repository: request.repository,
      results: normalizedChecks,
    }),
  };
}

function validateOwnerVerification(verification, expected) {
  if (!isPlainObject(verification) || verification.verified !== true) {
    fail("bootstrap_release_preparation_owner_confirmation_denied");
  }
  for (const field of ["tenant_id", "owner_id", "request_digest"]) {
    if (!safeEqual(verification[field], expected[field])) {
      fail(`bootstrap_release_preparation_owner_${field}_mismatch`);
    }
  }
  assertString(verification.owner_confirmation_digest, SHA256,
    "bootstrap_release_preparation_owner_confirmation_digest_invalid");
  return verification.owner_confirmation_digest;
}

function validateTrustKey(key) {
  if (!isPlainObject(key) || key.status !== "active" || key.authority_provider !== AUTHORITY_PROVIDER) {
    fail("bootstrap_release_preparation_active_trust_key_unavailable");
  }
  assertString(key.authority_key_id, IDENTIFIER,
    "bootstrap_release_preparation_authority_key_id_invalid");
  return key.authority_key_id;
}

function validateDeadlockVerdict(verdict, scope) {
  if (!isPlainObject(verdict) || verdict.classification !== DEADLOCK_CLASSIFICATION) {
    fail("bootstrap_release_preparation_deadlock_verdict_denied");
  }
  for (const field of [
    "exception_id",
    "tenant_id",
    "work_id",
    "repository",
    "head_sha",
    "allowed_action",
    "failure_code",
    "required_checks_digest",
    "required_checks_results_digest",
  ]) {
    if (!safeEqual(verdict[field], scope[field])) fail(`bootstrap_release_preparation_verdict_${field}_mismatch`);
  }
  if (verdict.pr_number !== scope.pr_number) {
    fail("bootstrap_release_preparation_verdict_pr_number_mismatch");
  }
  assertString(verdict.verdict_digest, SHA256,
    "bootstrap_release_preparation_core_policy_verdict_digest_invalid");
  return verdict.verdict_digest;
}

export function createBootstrapReleasePreparationService({
  normalPathAttempt,
  requiredChecksReadback,
  deadlockVerdictStore,
  activeTrustKeyResolver,
  ownerConfirmationVerifier,
  now,
  idFactory,
  allowedFailureCodes,
} = {}) {
  if (typeof normalPathAttempt !== "function" || typeof requiredChecksReadback !== "function" ||
      typeof activeTrustKeyResolver !== "function" || typeof ownerConfirmationVerifier !== "function" ||
      typeof now !== "function" || typeof idFactory !== "function" ||
      !deadlockVerdictStore || typeof deadlockVerdictStore.issue !== "function") {
    fail("bootstrap_release_preparation_dependencies_invalid");
  }
  const allowlist = new Set(allowedFailureCodes);
  if (allowlist.size === 0 || [...allowlist].some((code) => typeof code !== "string" || code.length === 0)) {
    fail("bootstrap_release_preparation_failure_allowlist_invalid");
  }

  return Object.freeze({
    async prepare({
      authenticated_tenant_id,
      authenticated_owner_id,
      owner_confirmation,
      normal_action_request,
      requested_ttl_seconds,
    } = {}) {
      assertString(authenticated_tenant_id, TENANT,
        "bootstrap_release_preparation_authenticated_tenant_invalid");
      assertString(authenticated_owner_id, IDENTIFIER,
        "bootstrap_release_preparation_authenticated_owner_invalid");
      if (!owner_confirmation) fail("bootstrap_release_preparation_owner_confirmation_required");
      validateActionRequest(normal_action_request, authenticated_tenant_id);
      const ttlSeconds = validateTtl(requested_ttl_seconds);
      const requestDigest = sha256({
        authenticated_owner_id,
        normal_action_request,
      });
      const ownerConfirmationDigest = validateOwnerVerification(
        await ownerConfirmationVerifier({
          owner_confirmation,
          expected: {
            owner_id: authenticated_owner_id,
            request_digest: requestDigest,
            tenant_id: authenticated_tenant_id,
          },
        }),
        {
          owner_id: authenticated_owner_id,
          request_digest: requestDigest,
          tenant_id: authenticated_tenant_id,
        },
      );

      let normalResult;
      let normalError;
      try {
        normalResult = await normalPathAttempt({
          authenticated_owner_id,
          authenticated_tenant_id,
          normal_action_request,
        });
      } catch (error) {
        normalError = error;
      }
      if (!normalError && (!isPlainObject(normalResult) || normalResult.ok !== false)) {
        fail("bootstrap_normal_path_available");
      }
      const failureCode = normalFailureCode(normalResult, normalError);
      if (!failureCode || !allowlist.has(failureCode)) {
        fail("bootstrap_release_preparation_failure_not_allowlisted");
      }

      const checks = validateChecksReadback(await requiredChecksReadback({
        authenticated_tenant_id,
        normal_action_request,
      }), normal_action_request);
      const authorityKeyId = validateTrustKey(await activeTrustKeyResolver({
        authority_provider: AUTHORITY_PROVIDER,
        tenant_id: authenticated_tenant_id,
      }));
      const nowMs = now();
      if (!Number.isSafeInteger(nowMs) || nowMs <= 0) fail("bootstrap_release_preparation_clock_invalid");
      const issuedAt = new Date(nowMs).toISOString();
      const expiresAt = new Date(nowMs + ttlSeconds * 1_000).toISOString();
      const exceptionId = idFactory("exception_id");
      const nonce = idFactory("nonce");
      assertString(exceptionId, IDENTIFIER, "bootstrap_release_preparation_exception_id_invalid");
      assertString(nonce, IDENTIFIER, "bootstrap_release_preparation_nonce_invalid");

      const verdictScope = {
        allowed_action: ALLOWED_ACTION,
        exception_id: exceptionId,
        failure_code: failureCode,
        head_sha: normal_action_request.head_sha,
        owner_confirmation_digest: ownerConfirmationDigest,
        pr_number: normal_action_request.pr_number,
        repository: normal_action_request.repository,
        required_checks_digest: checks.required_checks_digest,
        required_checks_results_digest: checks.required_checks_results_digest,
        tenant_id: authenticated_tenant_id,
        work_id: normal_action_request.work_id,
      };
      const corePolicyVerdictDigest = validateDeadlockVerdict(
        await deadlockVerdictStore.issue(verdictScope),
        verdictScope,
      );

      const unsignedReceipt = Object.freeze({
        schema_version: BOOTSTRAP_RELEASE_EXCEPTION_SCHEMA_VERSION,
        exception_id: exceptionId,
        tenant_id: authenticated_tenant_id,
        work_id: normal_action_request.work_id,
        repository: normal_action_request.repository,
        pr_number: normal_action_request.pr_number,
        head_sha: normal_action_request.head_sha,
        allowed_action: ALLOWED_ACTION,
        max_uses: 1,
        issued_at: issuedAt,
        expires_at: expiresAt,
        required_checks_digest: checks.required_checks_digest,
        required_checks_results_digest: checks.required_checks_results_digest,
        owner_confirmation_digest: ownerConfirmationDigest,
        core_policy_verdict_digest: corePolicyVerdictDigest,
        core_policy_classification: DEADLOCK_CLASSIFICATION,
        rollback_obligations_digest: sha256(ROLLBACK_OBLIGATIONS),
        post_deploy_obligations_digest: sha256(POST_DEPLOY_OBLIGATIONS),
        nonce,
        authority_key_id: authorityKeyId,
        authority_provider: AUTHORITY_PROVIDER,
        consumed_at: null,
        revoked_at: null,
      });

      return Object.freeze({
        schema_version: BOOTSTRAP_RELEASE_PREPARATION_SCHEMA_VERSION,
        preparation_status: "prepared_non_authorizing",
        candidate: true,
        action_authorized: false,
        execution_authorized: false,
        host_action_authorized: false,
        core_join_authorized: false,
        merge_authorized: false,
        deploy_authorized: false,
        unsigned_receipt: unsignedReceipt,
        authority_assertion_requirements: Object.freeze({
          algorithm: SIGNATURE_ALGORITHM,
          authority_provider: AUTHORITY_PROVIDER,
          signature_field: "signature_p1363_base64url",
        }),
      });
    },
  });
}
