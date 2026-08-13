import { assertIcfStoreContract } from "./icfStoreContract.js";

export function createIcfRuntimeFacade({ kernel, store, mode = "advisory", policyProofVerifier, coreJoinStore } = {}) {
  const contract = assertIcfStoreContract(store);
  const enforced = String(mode).toLowerCase() === "enforced";
  const policyProof = policyProofVerifier?.readiness?.() || { configured: false, fail_closed: true };
  const genericJoin = coreJoinStore ? { enabled: coreJoinStore.ready === true, state: coreJoinStore.ready === true ? "ready" : "disabled", ready: coreJoinStore.ready === true, backend: coreJoinStore.kind || "unavailable", restart_durable: coreJoinStore.restart_durable === true, distributed: coreJoinStore.distributed === true, signer_configured: coreJoinStore.ready === true } : { enabled: false, state: "disabled", ready: false, backend: "unavailable", restart_durable: false, distributed: false, signer_configured: false };
  return {
    readiness() {
      return { contract, store_kind: store?.kind || "unavailable", restart_durable: store?.restart_durable === true, distributed: store?.distributed === true, policy_proof: policyProof, generic_work_core_join: genericJoin, enforcement_allowed: enforced && contract.ok && store?.kind === "postgresql" && policyProof.configured === true && genericJoin.ready === true };
    },
    async appendAuthoritative({ tenantId, workId, eventType, payload }) {
      if (!contract.ok) return { ok: false, error: "icf_store_contract_incomplete", missing: contract.missing };
      const event = await store.appendEvent({ tenantId, workId, eventType, payload });
      return { ok: true, authoritative: true, event };
    },
    async compareAndSwapHead(input) {
      if (!contract.ok) return { ok: false, error: "icf_store_contract_incomplete" };
      return store.compareAndSwapHead(input);
    },
    kernel,
  };
}
