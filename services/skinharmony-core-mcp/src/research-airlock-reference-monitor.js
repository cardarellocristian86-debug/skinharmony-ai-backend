export function researchAirlockToolMetadata(toolName, args = {}, tools = []) {
  const transportToolName = String(toolName || "").trim();
  const dynamic = Boolean(
    ["core_capability_read", "core_capability_invoke"].includes(transportToolName)
      && args.capability_id,
  );
  const effectiveToolName = dynamic ? String(args.capability_id).trim() : transportToolName;
  const transportDefinition = tools.find((tool) => tool.name === transportToolName);
  const effectiveDefinition = tools.find((tool) => tool.name === effectiveToolName);
  return {
    tool_name: effectiveToolName,
    transport_tool_name: transportToolName,
    // Unknown dynamic capabilities are deliberately open-world for Airlock
    // purposes. This is a deny-by-default classification, not caller input.
    open_world: dynamic
      || transportDefinition?.annotations?.openWorldHint === true
      || effectiveDefinition?.annotations?.openWorldHint === true,
  };
}
