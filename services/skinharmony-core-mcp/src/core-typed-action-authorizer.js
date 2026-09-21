import crypto from "node:crypto";

import {
  commitPrecommitGate,
  fulfilledCommitPrecommitGate,
  nativePrecommitClaimBinding,
  precommitReconciliationErrorCode,
  trustedIssuedActionTicket,
  trustedNativePrecommitClaim,
  trustedRecoveredNativePrecommitClaim,
} from "./nyra-governed-continue.js";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function fail(code, status) {
  throw Object.assign(new Error(code), { code, status });
}

function actionTicketLifecycleUnsigned(record) {
  const schemaVersion = record?.lifecycle_schema_version || "host_native_action_lifecycle_v1";
  return {
    schema_version: schemaVersion,
    ticket_id: record?.ticket?.ticket_id,
    ticket_digest: digest(record?.ticket),
    state: record?.state,
    uses: record?.uses,
    reservation_id: record?.reservation_id ?? null,
    reserved_at: record?.reserved_at ?? null,
    reservation_expires_at: record?.reservation_expires_at ?? null,
    outcome: record?.outcome ?? null,
    observed_outcome: record?.observed_outcome ?? null,
    result_digest: record?.result_digest ?? null,
    result_commit: record?.result_commit ?? null,
    result_pull_request: record?.result_pull_request ?? null,
    observed_commit: record?.observed_commit ?? null,
    observed_pull_request: record?.observed_pull_request ?? null,
    host_readback_digest: record?.host_readback_digest ?? null,
    completed_at: record?.completed_at ?? null,
    reconciled_at: record?.reconciled_at ?? null,
    pre_merge_readback_digest: record?.pre_merge_readback_digest ?? null,
    quarantined_at: record?.quarantined_at ?? null,
    quarantine_reason_digest: record?.quarantine_reason_digest ?? null,
    semantic_scope_reservation_digest:
      record?.semantic_scope_at_reservation?.decision_digest ?? null,
    ...(schemaVersion === "host_native_action_lifecycle_v2" ? {
      superseded_by_ticket_id: record?.superseded_by_ticket_id ?? null,
      superseded_at: record?.superseded_at ?? null,
    } : {}),
  };
}

function trustedFulfilledRootLifecycle(record, currentTime) {
  const ticket = record?.ticket;
  const expiresAt = Date.parse(String(ticket?.expires_at || ""));
  if (!Number.isFinite(currentTime) || !Number.isFinite(expiresAt) || expiresAt > currentTime) {
    fail("core_typed_request_precommit_claim_recovery_invalid", 502);
  }
  if (record?.state === "issued") {
    if (record.superseded_by_ticket_id !== undefined || record.superseded_at !== undefined ||
        record.lifecycle_schema_version === "host_native_action_lifecycle_v2") {
      fail("core_typed_request_precommit_claim_recovery_invalid", 502);
    }
    return Object.freeze({ expires_at: expiresAt, successor_ticket_id: null });
  }
  const supersededAt = Date.parse(String(record?.superseded_at || ""));
  if (record?.state !== "superseded" ||
      record.lifecycle_schema_version !== "host_native_action_lifecycle_v2" ||
      !/^hnt_(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(String(record.superseded_by_ticket_id || "")) ||
      record.superseded_by_ticket_id === ticket?.ticket_id ||
      !Number.isFinite(supersededAt) || supersededAt < expiresAt || supersededAt > currentTime + 30_000 ||
      !/^[a-f0-9]{64}$/.test(String(record.lifecycle_digest || "")) ||
      !/^hnl_[a-f0-9]{64}$/.test(String(record.lifecycle_signature || "")) ||
      digest(actionTicketLifecycleUnsigned(record)) !== record.lifecycle_digest) {
    fail("core_typed_request_precommit_claim_recovery_invalid", 502);
  }
  return Object.freeze({
    expires_at: expiresAt,
    successor_ticket_id: record.superseded_by_ticket_id,
  });
}

export function createCoreTypedActionAuthorizer({
  coreHandlers,
  workStore,
  tenantAcl,
  hostKind,
  now = () => Date.now(),
} = {}) {
  if (!coreHandlers?.host_native_action_authorize || !coreHandlers?.host_native_action_read ||
      !coreHandlers?.host_native_delegation_read || !workStore?.claimPrecommitTicketGate ||
      !workStore?.readPrecommitTicketGateClaimRecovery || !workStore?.fulfillPrecommitTicketTask ||
      !workStore?.reconcilePrecommitTicketGateClaim ||
      !workStore?.abandonInactivePrecommitTicketGateClaim || typeof tenantAcl !== "function" ||
      typeof hostKind !== "function") {
    throw new Error("core_typed_action_authorizer_dependencies_invalid");
  }

  async function abandonInactiveClaim(request, identity) {
    const claim = request?.gate_claim;
    const coreResult = await coreHandlers.host_native_delegation_read({
      delegation_id: claim?.delegation_id,
    }, identity);
    const payload = coreResult?.structuredContent;
    const delegation = payload?.delegation;
    if (payload?.ok !== true || payload.tenant_id !== identity.tenantId ||
        !delegation || delegation.delegation_id !== claim?.delegation_id ||
        delegation.grant?.tenant_id !== identity.tenantId ||
        delegation.grant?.work_id !== request.work_id ||
        !["active", "expired", "revoked"].includes(delegation.effective_state) ||
        !Number.isFinite(Date.parse(delegation.grant?.expires_at || "")) ||
        typeof delegation.signature !== "string" || delegation.signature.length < 16) {
      throw new Error("precommit_claim_abandonment_core_readback_invalid");
    }
    if (delegation.effective_state === "active") return null;
    const readbackMaterial = {
      schema_version: "core_precommit_claim_inactive_readback_v1",
      authority: "universal_core",
      tenant_id: identity.tenantId,
      work_id: request.work_id,
      delegation_id: delegation.delegation_id,
      effective_state: delegation.effective_state,
      state: String(delegation.state || ""),
      expires_at: new Date(delegation.grant.expires_at).toISOString(),
      revoked_at: delegation.revoked_at ? new Date(delegation.revoked_at).toISOString() : null,
      signature_digest: crypto.createHash("sha256").update(delegation.signature).digest("hex"),
      provider_execution: false,
    };
    const coreDelegationReadback = Object.freeze({
      ...readbackMaterial,
      readback_digest: digest(readbackMaterial),
    });
    return workStore.abandonInactivePrecommitTicketGateClaim(tenantAcl(identity), {
      server_owned: true,
      work_id: request.work_id,
      gate_claim: claim,
      core_delegation_readback: coreDelegationReadback,
    });
  }

  async function authorize(request, identity, typedContext = {}) {
    if (request?.action?.kind !== "git.commit") {
      return coreHandlers.host_native_action_authorize(request, identity);
    }
    const typedRecord = typedContext.typed_record;
    const workContext = typedContext.work_binding?.directive_context;
    if (!typedRecord?.continuation_ref || !typedRecord?.request_digest ||
        !typedRecord?.server_idempotency_key || !Number.isFinite(Date.parse(typedRecord?.issued_at || "")) ||
        !workContext) fail("core_typed_request_precommit_context_invalid", 409);
    const payload = Object.freeze({
      tenant_id: identity.tenantId,
      work_id: request.work_id,
      intent_digest: request.intent_anchor_digest,
      host_kind: hostKind(identity),
      action_class: "GIT_COMMIT",
      issued_at: new Date(typedRecord.issued_at).toISOString(),
    });
    if (typeof request.repository !== "string" || request.repository.length < 3 ||
        request.action?.repository !== request.repository) {
      fail("core_typed_request_action_repository_binding_mismatch", 409);
    }
    const currentGate = workContext.precommit_ticket_gate;
    if (currentGate?.schema_version === "precommit_ticket_gate_v2" && currentGate.fulfilled === true) {
      const fulfilled = fulfilledCommitPrecommitGate(workContext, payload, request);
      const recoveryBinding = Object.freeze({
        work_id: payload.work_id,
        continuation_ref: typedRecord.continuation_ref,
        request_digest: typedRecord.request_digest,
        delegation_id: request.delegation_id,
        action_digest: digest(request.action),
        gate_projection_digest: fulfilled.original_projection_digest,
        host_session_fingerprint: String(identity?.agentPresence?.session_fingerprint || "").toLowerCase(),
        idempotency_key: typedRecord.server_idempotency_key,
      });
      const recovery = await workStore.readPrecommitTicketGateClaimRecovery(tenantAcl(identity), {
        work_id: payload.work_id,
        fulfilled: true,
        request_digest: recoveryBinding.request_digest,
        delegation_id: recoveryBinding.delegation_id,
        action_digest: recoveryBinding.action_digest,
        host_session_fingerprint: recoveryBinding.host_session_fingerprint,
      });
      if (!recovery || recovery.recovery_source !== "fulfillment" ||
          recovery.ticket_id !== fulfilled.gate.ticket_id) {
        fail("core_typed_request_precommit_claim_recovery_invalid", 502);
      }
      const recoveredClaim = trustedRecoveredNativePrecommitClaim(recovery.gate_claim, recoveryBinding);
      const readback = await coreHandlers.host_native_action_read({ ticket_id: fulfilled.gate.ticket_id }, identity);
      const recoveredTicket = readback?.structuredContent?.action_ticket?.ticket;
      if (recoveredTicket?.ticket_id !== fulfilled.gate.ticket_id) {
        fail("core_typed_request_precommit_claim_recovery_invalid", 502);
      }
      const currentTime = Number(now());
      const expiresAt = Date.parse(String(recoveredTicket?.expires_at || ""));
      const gateBinding = Object.freeze({
        schema_version: "precommit_ticket_gate_v2",
        projection_digest: fulfilled.original_projection_digest,
      });
      if (Number.isFinite(expiresAt) && expiresAt > currentTime) {
        if (readback?.structuredContent?.action_ticket?.state !== "issued" ||
            readback.structuredContent.action_ticket.superseded_by_ticket_id !== undefined ||
            readback.structuredContent.action_ticket.superseded_at !== undefined ||
            readback.structuredContent.action_ticket.lifecycle_schema_version ===
              "host_native_action_lifecycle_v2") {
          fail("core_typed_request_precommit_claim_recovery_invalid", 502);
        }
        trustedIssuedActionTicket(
          readback, payload, request, identity, gateBinding, currentTime,
          { allowPriorIssuedAt: true },
        );
        return readback;
      }
      const lifecycle = trustedFulfilledRootLifecycle(
        readback?.structuredContent?.action_ticket, currentTime,
      );
      // Validate every immutable binding on the recovered root before deciding that
      // expiry alone permits a replay. Moving the validation clock just inside the
      // original lifetime does not forgive malformed timestamps, drift or tampering.
      const historicalReadback = readback?.structuredContent?.action_ticket?.state === "superseded"
        ? { ...readback, structuredContent: { ...readback.structuredContent,
          action_ticket: { ...readback.structuredContent.action_ticket, state: "issued" } } }
        : readback;
      trustedIssuedActionTicket(
        historicalReadback, payload, request, identity, gateBinding,
        lifecycle.expires_at - 1, { allowPriorIssuedAt: true },
      );

      // A fulfilled locator is immutable audit evidence. Renew only through the
      // exact server-issued replay claim; never claim or fulfill the gate again.
      const issued = await coreHandlers.host_native_action_authorize({
        ...request,
        idempotency_key: recoveredClaim.idempotency_key,
      }, { ...identity, nativePrecommitClaimIssuer: true }, recoveredClaim);
      const issuedRecord = issued?.structuredContent?.action_ticket;
      const issuedTicket = issuedRecord?.ticket || issuedRecord?.action_ticket?.ticket;
      const successorTicketId = issuedTicket?.ticket_id || null;
      if (!/^hnt_(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(String(successorTicketId || "")) ||
          successorTicketId === fulfilled.gate.ticket_id ||
          (lifecycle.successor_ticket_id && successorTicketId !== lifecycle.successor_ticket_id)) {
        fail("core_typed_request_precommit_claim_recovery_invalid", 502);
      }
      const successorReadback = await coreHandlers.host_native_action_read(
        { ticket_id: successorTicketId }, identity,
      );
      trustedIssuedActionTicket(
        successorReadback, payload, request, identity, gateBinding, Number(now()),
        { allowPriorIssuedAt: true },
      );
      return successorReadback;
    }

    const gate = commitPrecommitGate(workContext, payload, request);
    const claimBinding = nativePrecommitClaimBinding(
      payload, request, gate, identity, typedRecord.continuation_ref,
      typedRecord.request_digest, typedRecord.server_idempotency_key,
    );
    let nativeClaim;
    try {
      nativeClaim = trustedNativePrecommitClaim(
        await workStore.claimPrecommitTicketGate(tenantAcl(identity), claimBinding), claimBinding,
      );
    } catch (error) {
      const code = String(error?.code || error?.message || "");
      if (["tenant_work_terminal", "tenant_work_not_operational", "tenant_work_not_found"]
        .includes(code)) {
        fail("core_typed_request_work_state_invalid", 409);
      }
      throw error;
    }
    let ticketId = null;
    let recovery = null;
    let recoveredTicketId = null;
    try {
      if (nativeClaim.replay === true) {
        recovery = await workStore.readPrecommitTicketGateClaimRecovery(
          tenantAcl(identity), { work_id: payload.work_id, gate_claim: nativeClaim },
        );
        const source = String(recovery?.recovery_source || "");
        if (!recovery || !["claim", "before_ticket_locator", "reconciliation", "fulfillment"].includes(source)) {
          fail("core_typed_request_precommit_claim_recovery_invalid", 502);
        }
        trustedRecoveredNativePrecommitClaim(recovery.gate_claim, claimBinding);
        if (source === "fulfillment" || source === "reconciliation") {
          recoveredTicketId = recovery.ticket_id;
          ticketId = recoveredTicketId;
        }
        if ((source === "claim" || source === "before_ticket_locator") && recovery.ticket_id !== null) {
          fail("core_typed_request_precommit_claim_recovery_invalid", 502);
        }
      }
      const issued = await coreHandlers.host_native_action_authorize({
        ...request, idempotency_key: nativeClaim.idempotency_key,
      }, { ...identity, nativePrecommitClaimIssuer: true }, nativeClaim);
      const issuedRecord = issued?.structuredContent?.action_ticket;
      const issuedTicket = issuedRecord?.ticket || issuedRecord?.action_ticket?.ticket;
      ticketId = issuedTicket?.ticket_id || null;
      if (!/^hnt_(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(String(ticketId || ""))) {
        fail("core_typed_request_ticket_locator_invalid", 503);
      }
      if (recoveredTicketId && ticketId !== recoveredTicketId) {
        fail("core_typed_request_precommit_claim_recovery_invalid", 502);
      }
      const readback = await coreHandlers.host_native_action_read({ ticket_id: ticketId }, identity);
      const trusted = trustedIssuedActionTicket(
        readback, payload, request, identity, gate, Number(now()),
        { allowPriorIssuedAt: recovery !== null && nativeClaim.replay === true },
      );
      await workStore.fulfillPrecommitTicketTask(tenantAcl(identity), {
        work_id: request.work_id,
        gate_projection_digest: gate.projection_digest,
        action_ticket: trusted,
        gate_claim: nativeClaim,
      });
      return readback;
    } catch (error) {
      try {
        const recoverySource = String(recovery?.recovery_source || "");
        if (!recovery || recoverySource === "claim") {
          await workStore.reconcilePrecommitTicketGateClaim(tenantAcl(identity), {
            work_id: request.work_id,
            gate_claim: nativeClaim,
            gate_projection_digest: gate.projection_digest,
            continuation_ref: nativeClaim.continuation_ref,
            request_digest: nativeClaim.request_digest,
            idempotency_key: nativeClaim.idempotency_key,
            stage: ticketId ? "ticket_locator_received" : "before_ticket_locator",
            ticket_id: ticketId,
            error_code: precommitReconciliationErrorCode(error),
          });
        }
        if (!ticketId) await abandonInactiveClaim({ work_id: request.work_id, gate_claim: nativeClaim }, identity);
      } catch {
        fail("core_typed_request_precommit_recovery_failed", 503);
      }
      throw error;
    }
  }

  return Object.freeze({ authorize, abandonInactiveClaim });
}
