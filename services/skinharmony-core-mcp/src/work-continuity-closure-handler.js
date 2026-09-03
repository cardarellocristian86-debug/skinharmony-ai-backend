import { coreJoinIdempotencyKey } from "./work-continuity-runtime.js";

function defaultTextResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export async function replayNyraVerifiedWorkFinalize({
  store,
  aclIdentity,
  args,
  state,
  textResult = defaultTextResult,
} = {}) {
  if (state?.work?.status !== "COMPLETED") return null;
  if (typeof store?.finalizeGenericClosure !== "function" ||
      typeof store?.verifyWorkClosure !== "function") {
    throw new Error("nyra_verified_work_finalize_store_required");
  }
  const adapter = state.work.work_type;
  const closure = await store.finalizeGenericClosure(aclIdentity, {
    work_id: args.work_id,
    adapter,
    idempotency_key: `${args.idempotency_key}:closure`,
  });
  const verification = await store.verifyWorkClosure(aclIdentity, {
    work_id: args.work_id,
  });
  if (verification.verified !== true) {
    throw new Error("tenant_work_terminal_closure_verification_failed");
  }
  return textResult({
    ok: true,
    result: {
      checkpoint: null,
      core_join: null,
      closure,
      verification,
      terminal_replay: true,
    },
    dedicated_core_gate: {
      authorized: true,
      authority: "universal_core",
      route: "/v1/work/core-join-verdicts",
      server_owned: true,
    },
  });
}

export function createWorkContinuityClosureFinalizeHandler({
  runtime,
  coreHandlers,
  textResult = defaultTextResult,
} = {}) {
  if (typeof runtime?.replayFinalizedClosure !== "function" ||
      typeof runtime?.finalizeClosure !== "function") {
    throw new Error("work_continuity_finalize_runtime_required");
  }
  if (typeof coreHandlers?.host_native_action_closure_receipt !== "function") {
    throw new Error("work_continuity_finalize_core_handler_required");
  }
  return async (args, identity) => {
    const localReplay = await runtime.replayFinalizedClosure(identity, args);
    if (localReplay) {
      return textResult({ ok: true, result: localReplay });
    }
    const coreReceipt = await coreHandlers.host_native_action_closure_receipt({
      ticket_id: args.action_ticket_id,
    }, identity);
    const authorization = coreReceipt?.structuredContent?.finalize_authorization;
    if (
      coreReceipt?.structuredContent?.tenant_id !== identity.tenantId ||
      authorization?.schema_version !== "host_native_finalize_authorization_v1" ||
      authorization?.trusted !== true ||
      authorization?.allowed !== true ||
      !/^hnf_[a-f0-9]{64}$/.test(String(authorization?.signature || "")) ||
      authorization.tenant_id !== identity.tenantId ||
      authorization.work_id !== args.work_id ||
      authorization.action_ticket_id !== args.action_ticket_id
    ) {
      throw new Error("continuity_trusted_core_closure_receipt_required");
    }
    return textResult({
      ok: true,
      result: await runtime.finalizeClosure(identity, args, authorization),
    });
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

  async function evaluateAndJoin(args, identity, { releaseSource = "caller" } = {}) {
    const initialEvaluation = await runtime.evaluateClosure(identity, args);
    if (initialEvaluation.terminal_replay === true) {
      if (initialEvaluation.completed !== true || initialEvaluation.closed !== true) {
        throw new Error("continuity_terminal_replay_invalid");
      }
      return textResult({ ok: true, result: initialEvaluation });
    }
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
        ...(releaseSource === "persisted_immutable"
          ? { release_source: "persisted_immutable" }
          : {}),
        release_ready: coreJoin.release_ready === true,
        release_intent_digest: coreJoin.release_intent_digest,
        core_join: coreJoin,
      },
    });
  }

  return evaluateAndJoin;
}

export function createWorkContinuityClosureRejoinPersistedReleaseHandler({
  runtime,
  coreHandlers,
  textResult = defaultTextResult,
} = {}) {
  if (typeof runtime?.resolvePersistedClosureRelease !== "function") {
    throw new Error("work_continuity_persisted_release_runtime_required");
  }
  const evaluateAndJoin = createWorkContinuityClosureEvaluateHandler({
    runtime,
    coreHandlers,
    textResult,
  });
  return async (args, identity) => {
    const persisted = await runtime.resolvePersistedClosureRelease(identity, {
      work_id: args.work_id,
      plan_id: args.plan_id,
    });
    return evaluateAndJoin({ ...args, release: persisted.release }, identity, {
      releaseSource: "persisted_immutable",
    });
  };
}
