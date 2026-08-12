import { assertIcfStoreContract } from "./icfStoreContract.js";

export function createIcfRuntimeFacade({ kernel, store, mode = "advisory" } = {}) {
  const contract = assertIcfStoreContract(store);
  const enforced = String(mode).toLowerCase() === "enforced";
  return {
    readiness() {
      return { contract, store_kind: store?.kind || "unavailable", restart_durable: store?.restart_durable === true, distributed: store?.distributed === true, enforcement_allowed: enforced && contract.ok && store?.kind === "postgresql" };
    },
    kernel,
  };
}
