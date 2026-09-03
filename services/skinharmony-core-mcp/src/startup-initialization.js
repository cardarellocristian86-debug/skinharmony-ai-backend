export async function initializeStoreAfter(dependency, store) {
  if (!store || typeof store.initialize !== "function") {
    throw new TypeError("startup_store_initializer_required");
  }
  await dependency;
  return store.initialize();
}
