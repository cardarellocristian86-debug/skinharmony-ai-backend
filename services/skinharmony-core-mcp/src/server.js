import { createApp } from "./app.js";
import { createCollaborationHandlers } from "./collaboration-handlers.js";
import { loadConfig } from "./config.js";
import { createCoreHandlers, createCoreWriteGuard } from "./core-handlers.js";
import { createMemoryFabric, createMemoryFabricHandlers } from "./memory-fabric.js";
import { createMemoryHandlers } from "./memory-handlers.js";
import { createCloudMemoryStore } from "./cloud-memory-store.js";
import { createSharedMemoryBootstrap } from "./shared-memory-bootstrap.js";
import { createResearchCortex, createResearchHandlers } from "./research-cortex.js";

const config = loadConfig();
const cloudMemoryStore = createCloudMemoryStore(config);
const sharedMemoryBootstrap = createSharedMemoryBootstrap(cloudMemoryStore, { cacheTtlMs: 300_000 });
const govern = createCoreWriteGuard(config);
const memoryFabric = config.memoryFabricRoot ? createMemoryFabric(config, { govern }) : null;
const collaborationHandlers = config.agentWorkspaceRoot
  ? createCollaborationHandlers(config, { govern })
  : {};
const coreHandlers = createCoreHandlers(config, {
  contextProvider: memoryFabric ? (input, identity) => memoryFabric.context(input, identity) : null,
  sharedMemoryBootstrap,
});
const researchCortex = config.researchCortexRoot
  ? createResearchCortex(config, {
      govern,
      planProvider: coreHandlers.research_plan,
      validateProvider: coreHandlers.research_validate,
      memoryFabric,
    })
  : null;

const CORE_PREFLIGHT_NATIVE_TOOLS = new Set([
  "work_preflight",
]);

function summarizeToolRequest(toolName, args = {}) {
  return String(
    args.request || args.message || args.action_label || args.title || args.query || args.description ||
    args.question || args.body || args.path || `Use SkinHarmony MCP tool ${toolName}`,
  ).slice(0, 20_000);
}

const app = createApp(config, {
  handlers: {
    ...coreHandlers,
    ...createMemoryHandlers(config, { researchCortex, cloudMemoryStore }),
    ...(memoryFabric ? createMemoryFabricHandlers(memoryFabric) : {}),
    ...(researchCortex ? createResearchHandlers(researchCortex) : {}),
    ...collaborationHandlers,
  },
  beforeToolCall: async ({ identity, toolName, args }) => {
    if (CORE_PREFLIGHT_NATIVE_TOOLS.has(toolName)) return null;
    const result = await coreHandlers.work_preflight({
      request: summarizeToolRequest(toolName, args),
      operation_type: toolName,
      tool_name: toolName,
      project_id: args.project_id,
      session_id: args.session_id,
      agent_id: args.agent_id || args.from_agent_id || "connected_ai",
      available_capabilities: ["skinharmony_core_mcp", toolName],
      owner_confirmed: identity.ownerConfirmed === true,
      confirmation_reference: identity.confirmationReference,
    }, identity);
    return result.structuredContent;
  },
  afterToolCall: memoryFabric ? (event) => memoryFabric.recordToolActivity(event) : null,
});
app.listen(config.port, () => console.log(`[skinharmony-core-mcp] listening on ${config.port}`));
