import { assertIcfStoreContract } from "./icfStoreContract.js";
import { CORE_JOIN_POSTGRES_BACKEND } from "./coreJoinPostgresStore.js";

export function buildIcfPostgresStoreReadiness(store) {
  const backend = typeof store?.kind === "string" && store.kind
    ? store.kind
    : "unavailable";
  const initialized = store?.initialized === true;
  const readyFlag = store?.ready === true;
  const initializationState = String(store?.initialization_state || "unavailable");
  const migrationVerified = store?.migration?.migration_id === "20260825_002_icf_event_digest_v2"
    && store?.migration?.application_state === "COMPLETED"
    && store?.migration?.checkpoint === "READBACK_VERIFIED"
    && /^[a-f0-9]{64}$/u.test(String(store?.migration?.sql_digest || ""));
  let state = "unavailable";
  let reason = "icf_postgres_store_unavailable";
  if (backend !== "postgresql") {
    state = "unavailable";
  } else if (initializationState === "failed") {
    state = "failed";
    reason = "icf_event_digest_v2_migration_unavailable";
  } else if (!initialized || !readyFlag || initializationState !== "ready") {
    state = initializationState === "uninitialized" ? "uninitialized" : "initializing";
    reason = "icf_postgres_store_initializing";
  } else if (!migrationVerified) {
    state = "migration_unverified";
    reason = "icf_event_digest_v2_migration_unverified";
  } else if (store?.restart_durable !== true) {
    state = "durability_unavailable";
    reason = "icf_postgres_store_not_restart_durable";
  } else if (store?.distributed !== true) {
    state = "distributed_store_unavailable";
    reason = "icf_postgres_store_not_distributed";
  } else {
    state = "ready";
    reason = null;
  }
  return Object.freeze({
    ready: state === "ready",
    state,
    reason,
    backend,
    initialized,
    migration_verified: migrationVerified,
    restart_durable: store?.restart_durable === true,
    distributed: store?.distributed === true,
    migration: store?.migration || null,
  });
}

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
      const postgresStore = buildIcfPostgresStoreReadiness(store);
      const genericJoin = buildIcfGenericWorkCoreJoinReadiness(coreJoinStore);
      return {
        contract,
        store_kind: store?.kind || "unavailable",
        restart_durable: store?.restart_durable === true,
        distributed: store?.distributed === true,
        postgres_store: postgresStore,
        generic_work_core_join: genericJoin,
        enforcement_allowed: enforced
          && contract.ok
          && postgresStore.ready === true
          && genericJoin.ready === true,
      };
    },
    kernel,
  };
}
