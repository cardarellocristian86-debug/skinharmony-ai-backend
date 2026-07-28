// Compatibility adapter. The canonical implementation is shared so Core, Nyra,
// MCP and tenant adapters cannot silently grow independent policy registries.
export * from "../../shared/nyra-policy-registry.mjs";
