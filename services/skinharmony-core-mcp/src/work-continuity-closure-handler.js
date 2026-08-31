import { coreJoinIdempotencyKey } from "./work-continuity-runtime.js";

function defaultTextResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function createWorkContinuityClosureEvaluateHandler({
  runtime,
  coreHandlers,
  textResult = defaultTextResult,
} = {}) {
  if (!runtime || typeof runtime.evaluateClosure !== "function" ||
      typeof runtime.prepareEffectiveCoreJoinEvaluation !== "function" ||
      typeof runtime.bindCoreJoinVerdict !== "function") {
    throw new Error("work_continuity_closure_runtime_required");
  }
  if (typeof coreHandlers?.host_native_release_intent_build !== "function" ||
      typeof coreHandlers?.host_native_core_join_issue !== "function") {
    throw new Error("work_continuity_closure_core_handlers_required");
  }

  return async (args, identity) => {
    const initialEvaluation = await runtime.evaluateClosure(identity, args);
    if (initialEvaluation.closed !== true) {
      return textResult({ ok: true, result: initialEvaluation });
    }
    const evaluation = await runtime.prepareEffectiveCoreJoinEvaluation(identity, {
      work_id: args.work_id,
      plan_id: args.plan_id,
      evaluation_id: initialEvaluation.evaluation_id,
      release: args.release,
    });
    const material = evaluation.core_join_material;
    if (
      material?.schema_version !== "continuity_core_join_material_v1" ||
      material.tenant_id !== identity.tenantId ||
      !material.release_intent_request ||
      !material.core_join_request
    ) {
      throw new Error("continuity_core_join_material_required");
    }
    const releaseIntentResult = await coreHandlers.host_native_release_intent_build(
      material.release_intent_request,
      identity,
    );
    const releaseIntent = releaseIntentResult?.structuredContent?.release_intent;
    if (
      releaseIntentResult?.structuredContent?.dedicated_core_gate?.authorized !== true ||
      releaseIntentResult?.structuredContent?.tenant_id !== identity.tenantId ||
      releaseIntent?.tenant_id !== identity.tenantId ||
      releaseIntent?.work_id !== args.work_id
    ) {
      throw new Error("continuity_core_release_intent_invalid");
    }
    const coreJoinResult = await coreHandlers.host_native_core_join_issue({
      ...material.core_join_request,
      release_intent: releaseIntent,
      idempotency_key: coreJoinIdempotencyKey(material),
    }, identity);
    const coreJoinRecord = coreJoinResult?.structuredContent?.core_join_verdict;
    if (
      coreJoinResult?.structuredContent?.dedicated_core_gate?.authorized !== true ||
      coreJoinResult?.structuredContent?.tenant_id !== identity.tenantId ||
      coreJoinRecord?.tenant_id !== identity.tenantId
    ) {
      throw new Error("continuity_core_join_response_invalid");
    }
    const coreJoin = await runtime.bindCoreJoinVerdict(identity, {
      work_id: args.work_id,
      plan_id: args.plan_id,
      evaluation_id: evaluation.evaluation_id,
    }, {
      releaseIntent,
      coreJoinRecord,
    });
    const { core_join_material: _coreJoinMaterial, ...publicEvaluation } = evaluation;
    return textResult({
      ok: true,
      result: {
        ...publicEvaluation,
        release_ready: coreJoin.release_ready === true,
        release_intent_digest: coreJoin.release_intent_digest,
        core_join: coreJoin,
      },
    });
  };
}
