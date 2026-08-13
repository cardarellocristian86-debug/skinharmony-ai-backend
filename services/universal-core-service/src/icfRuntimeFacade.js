import { assertIcfStoreContract } from "./icfStoreContract.js";
export function createIcfRuntimeFacade({ kernel, store, mode = "advisory", coreJoinStore } = {}) {
  const contract = assertIcfStoreContract(store);
  const enforced = String(mode).toLowerCase() === "enforced";
  const genericJoin = coreJoinStore ? { enabled: coreJoinStore.ready === true, state: coreJoinStore.ready === true ? "ready" : "disabled", ready: coreJoinStore.ready === true, backend: coreJoinStore.kind || "unavailable", restart_durable: coreJoinStore.restart_durable === true, distributed: coreJoinStore.distributed === true } : { enabled: false, state: "disabled", ready: false, backend: "unavailable", restart_durable: false, distributed: false };
  return { readiness() { return { contract, store_kind: store?.kind || "unavailable", restart_durable: store?.restart_durable === true, distributed: store?.distributed === true, generic_work_core_join: genericJoin, enforcement_allowed: enforced && contract.ok && store?.kind === "postgresql" && genericJoin.ready === true }; }, kernel };
}
