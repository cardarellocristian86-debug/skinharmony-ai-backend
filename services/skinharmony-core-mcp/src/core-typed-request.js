import { normalizeConnectedAiTypedRequest } from "../../shared/connected-ai-typed-request.mjs";
import { HOST_APP_CAPABILITIES, hostPrincipalAllows } from "./host-app-registry.js";

function fail(code, status = 422) {
  const error = new Error(code); error.code = code; error.status = status; throw error;
}

export function createCoreTypedRequestHandler({ store, issueDelegation, authorizeAction,
  reviewWorkBootstrap, resolveWorkBinding } = {}) {
  if (!store?.recordConnectedAiTypedRequest || typeof issueDelegation !== "function" ||
      typeof authorizeAction !== "function" || typeof reviewWorkBootstrap !== "function" ||
      typeof resolveWorkBinding !== "function") throw new Error("core_typed_request_dependencies_invalid");
  return async function coreTypedRequest(args = {}, identity = {}) {
    const canonical = normalizeConnectedAiTypedRequest({
      schema_version: args.schema_version, operation: args.operation, request: args.request,
    });
    const requiredCapability = canonical.operation === "WORK_CREATE_OR_RECONCILE"
      ? HOST_APP_CAPABILITIES.WORK_CREATE
      : canonical.operation === "DELEGATION_REQUEST"
        ? HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE
        : HOST_APP_CAPABILITIES.HOST_NATIVE_AUTHORIZE;
    if (!hostPrincipalAllows(identity, requiredCapability)) {
      fail("core_typed_request_host_capability_required", 403);
    }
    let materializedRequest = canonical.request;
    let coreResponse;
    if (canonical.operation === "WORK_CREATE_OR_RECONCILE") {
      coreResponse = await reviewWorkBootstrap(canonical.request, identity);
    } else {
      const binding = await resolveWorkBinding(canonical.request.work_id, identity);
      if (!binding || binding.work_id !== canonical.request.work_id || !binding.intent_digest) {
        fail("core_typed_request_work_binding_invalid", 409);
      }
      materializedRequest = Object.freeze({ ...canonical.request,
        intent_anchor_digest: binding.intent_digest });
      coreResponse = canonical.operation === "DELEGATION_REQUEST"
        ? await issueDelegation(materializedRequest, identity)
        : await authorizeAction(materializedRequest, identity);
    }
    const coreResult = coreResponse?.structuredContent;
    if (!coreResult || coreResult.ok !== true || coreResult.tenant_id !== identity.tenantId) {
      fail("core_typed_request_core_result_invalid", 502);
    }
    const refs = await store.recordConnectedAiTypedRequest({
      identity, canonical_request: Object.freeze({ ...canonical, request: materializedRequest }),
      core_result: coreResult,
    });
    const result = Object.freeze({ ok: true, schema_version: "connected_ai_core_entry_v1",
      operation: canonical.operation, canonical_request_ref: refs.canonical_request_ref,
      continuation_ref: refs.continuation_ref, expires_at: refs.expires_at,
      core_materialized: true, requester: "AI_HOST", authority: "UNIVERSAL_CORE",
      orchestration_refs: Object.freeze({ continuation_ref: refs.continuation_ref }),
      execution_authorized: coreResult.execution_authorized === true,
      external_action_authorized: coreResult.external_action_authorized === true,
      provider_execution: false });
    return { structuredContent: result, content: [{ type: "text",
      text: "Universal Core ha materializzato la richiesta tipizzata. Usa soltanto continuation_ref per il passo successivo governato." }] };
  };
}

export function connectedAiContinuationResult(value) {
  return { structuredContent: Object.freeze({ ok: true, result: value,
    execution_authorized: false, external_action_authorized: false, provider_execution: false }),
    content: [{ type: "text", text: "Nyra ha ripreso il risultato Core server-owned tramite il riferimento opaco." }] };
}
