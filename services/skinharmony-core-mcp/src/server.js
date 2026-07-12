import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createCoreHandlers } from "./core-handlers.js";
import { createMemoryHandlers } from "./memory-handlers.js";

const config = loadConfig();
const app = createApp(config, { handlers: { ...createCoreHandlers(config), ...createMemoryHandlers(config) } });
app.listen(config.port, () => console.log(`[skinharmony-core-mcp] listening on ${config.port}`));
