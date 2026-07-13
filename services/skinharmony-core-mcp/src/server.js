import { createApp } from "./app.js";
import { createCollaborationHandlers } from "./collaboration-handlers.js";
import { loadConfig } from "./config.js";
import { createCoreHandlers, createCoreWriteGuard } from "./core-handlers.js";
import { createMemoryFabric, createMemoryFabricHandlers } from "./memory-fabric.js";
import { createMemoryHandlers } from "./memory-handlers.js";

const config = loadConfig();
const govern = createCoreWriteGuard(config);
const memoryFabric = config.memoryFabricRoot ? createMemoryFabric(config, { govern }) : null;
const collaborationHandlers = config.agentWorkspaceRoot
  ? createCollaborationHandlers(config, { govern })
  : {};
const coreHandlers = createCoreHandlers(config, {
  contextProvider: memoryFabric ? (input, identity) => memoryFabric.context(input, identity) : null,
});
const app = createApp(config, {
  handlers: {
    ...coreHandlers,
    ...createMemoryHandlers(config),
    ...(memoryFabric ? createMemoryFabricHandlers(memoryFabric) : {}),
    ...collaborationHandlers,
  },
  afterToolCall: memoryFabric ? (event) => memoryFabric.recordToolActivity(event) : null,
});
app.listen(config.port, () => console.log(`[skinharmony-core-mcp] listening on ${config.port}`));
