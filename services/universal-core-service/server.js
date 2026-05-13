import { createUniversalCoreService } from "./src/app.js";

const port = Number(process.env.PORT || process.env.CORE_SERVICE_PORT || 8787);
const { app, storageRoot } = createUniversalCoreService();

app.listen(port, () => {
  console.log(`[UniversalCoreService] listening on ${port}`);
  console.log(`[UniversalCoreService] storage root: ${storageRoot}`);
});
