import { createSuiteControlPlane } from "./src/app.js";

const port = Number(process.env.PORT || process.env.SUITE_CONTROL_PLANE_PORT || 8791);
const { app, storage } = createSuiteControlPlane();

app.listen(port, () => {
  console.log(`[SuiteControlPlane] listening on ${port}`);
  console.log(`[SuiteControlPlane] storage mode: ${storage.mode}`);
});
