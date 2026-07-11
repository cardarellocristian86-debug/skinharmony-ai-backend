import express from "express";
import { createUniversalCoreService } from "./src/app.js";
import { createIntelligenceSpine } from "./src/intelligenceSpine.js";

const port = Number(process.env.PORT || process.env.CORE_SERVICE_PORT || 8787);
const { app: coreApp, storageRoot } = createUniversalCoreService();
const spine = createIntelligenceSpine(storageRoot);
const app = express();

app.disable("x-powered-by");
app.use(spine.middleware);
app.get("/intelligence-spine/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "skinharmony-intelligence-spine",
    ...spine.status(),
  });
});
app.use(coreApp);

app.listen(port, () => {
  console.log(`[UniversalCoreService] listening on ${port}`);
  console.log(`[UniversalCoreService] storage root: ${storageRoot}`);
  console.log(`[IntelligenceSpine] shadow mode enabled: ${spine.status().enabled}`);
});
