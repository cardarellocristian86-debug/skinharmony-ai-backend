import { assertIcfStoreContract } from "./icfStoreContract.js";
import { CORE_JOIN_POSTGRES_BACKEND } from "./coreJoinPostgresStore.js";

export function buildIcfGenericWorkCoreJoinReadiness(coreJoinStore) {
  const backend = typeof coreJoinStore?.kind === "string" && coreJoinStore.kind
    ? coreJoinStore.kind
    : "unavailable";
  const signerConfigured = coreJoinStore?.signer_configured === true;
  const initialized = coreJoinStore?.initialized === true
    && coreJoinStore?.initialization_state === "ready";
  const restartDurable = coreJoinStore?.restart_durable === true;
  const distributed = coreJoinStore?.distributed === true;
  let state = "unavailable";
  let reason = "generic_work_core_join_postgres_unavailable";
  if (backend !== CORE_JOIN_POSTGRES_BACKEND) {
    state = "unavailable";
    reason = "generic_work_core_join_postgres_unavailable";
  } else if (!signerConfigured) {
    state = "signer_unavailable";
    reason = "generic_work_core_join_signer_unconfigured";
  } else if (coreJoinStore?.initialization_state === "failed") {
    state = "failed";
    reason = "generic_work_core_join_migration_unavailable";
  } else if (!initialized || coreJoinStore?.ready !== true) {
    state = "initializing";
    reason = "generic_work_core_join_store_initializing";
  } else if (!restartDurable) {
    state = "durability_or_signing_unavailable";
    reason = "generic_work_core_join_durable_store_unavailable";
  } else if (!distributed) {
    state = "durability_or_signing_unavailable";
    reason = "generic_work_core_join_distributed_store_unavailable";
  } else {
    state = "ready";
    reason = null;
  }
  const ready = state === "ready";
  return Object.freeze({
    enabled: ready,
    state,
    ready,
    backend,
    restart_durable: restartDurable,
    distributed,
    signer_mode: "hmac_icf",
    signer_state: signerConfigured ? "configured" : "unconfigured",
    signer_configured: signerConfigured,
    reason,
  });
}

export function createIcfRuntimeFacade({ kernel, store, mode = "advisory", coreJoinStore } = {}) {
  const contract = assertIcfStoreContract(store);
  const enforced = String(mode).toLowerCase() === "enforced";
  return {
    readiness() {
      const genericJoin = buildIcfGenericWorkCoreJoinReadiness(coreJoinStore);
      return {
        contract,
        store_kind: store?.kind || "unavailable",
        restart_durable: store?.restart_durable === true,
        distributed: store?.distributed === true,
        generic_work_core_join: genericJoin,
        enforcement_allowed: enforced
          && contract.ok
          && store?.kind === "postgresql"
          && genericJoin.ready === true,
      };
    },
    kernel,
  };
}
