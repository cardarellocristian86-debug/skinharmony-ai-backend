import { createApp } from "./app.js";
import { createCollaborationHandlers } from "./collaboration-handlers.js";
import { loadConfig } from "./config.js";
import { createCoreHandlers, createCoreWriteGuard } from "./core-handlers.js";
import { createMemoryHandlers } from "./memory-handlers.js";

const config = loadConfig();
const collaborationHandlers = config.agentWorkspaceRoot
  ? createCollaborationHandlers(config, { govern: createCoreWriteGuard(config) })
  : {};
const app = createApp(config, { handlers: { ...createCoreHandlers(config), ...createMemoryHandlers(config), ...collaborationHandlers } });
app.listen(config.port, () => console.log(`[skinharmony-core-mcp] listening on ${config.port}`));
