import { createUniversalCoreService } from "./src/app.js";
import { createGhidraHeadlessAdapter } from "./src/ghidraHeadlessAdapter.js";
import { createFridaLocalAdapter } from "./src/fridaLocalAdapter.js";
import { createSoftwareAuthorizationVerifier } from "./src/universalSoftwareIntelligence.js";

const port = Number(process.env.PORT || process.env.CORE_SERVICE_PORT || 8787);
const softwareWorkerAdapters = {};
if (process.env.GHIDRA_SANDBOX_LAUNCHER && process.env.GHIDRA_SANDBOX_LAUNCHER_SHA256) {
  softwareWorkerAdapters.ghidra_headless = createGhidraHeadlessAdapter({
    launcherPath: process.env.GHIDRA_SANDBOX_LAUNCHER,
    launcherSha256: process.env.GHIDRA_SANDBOX_LAUNCHER_SHA256,
    expectedVersion: process.env.GHIDRA_VERSION || "12.1",
    expectedReleaseSha256: process.env.GHIDRA_RELEASE_SHA256,
    tempRoot: process.env.SOFTWARE_INTELLIGENCE_TEMP_ROOT,
    launcherEnv: {
      GHIDRA_ANALYZE_HEADLESS: process.env.GHIDRA_ANALYZE_HEADLESS,
      GHIDRA_JAVA_HOME: process.env.GHIDRA_JAVA_HOME,
      GHIDRA_LOCAL_VERSION: process.env.GHIDRA_LOCAL_VERSION,
      GHIDRA_LOCAL_RELEASE_SHA256: process.env.GHIDRA_LOCAL_RELEASE_SHA256,
    },
  });
}
if (process.env.FRIDA_LOCAL_AGENT && process.env.FRIDA_LOCAL_AGENT_SHA256) {
  softwareWorkerAdapters.frida_local_agent = createFridaLocalAdapter({
    agentPath: process.env.FRIDA_LOCAL_AGENT,
    agentSha256: process.env.FRIDA_LOCAL_AGENT_SHA256,
    expectedVersion: process.env.FRIDA_VERSION || "17.15.3",
  });
}
const softwareAuthorizationVerifier = process.env.SOFTWARE_INTELLIGENCE_AUTHORIZATION_SECRET
  ? createSoftwareAuthorizationVerifier({ secret: process.env.SOFTWARE_INTELLIGENCE_AUTHORIZATION_SECRET })
  : undefined;
const { app, storageRoot } = createUniversalCoreService({
  softwareWorkerAdapters,
  softwareAuthorizationVerifier,
  softwareAuthorizationSecret: process.env.SOFTWARE_INTELLIGENCE_AUTHORIZATION_SECRET,
});

app.listen(port, () => {
  console.log(`[UniversalCoreService] listening on ${port}`);
  console.log(`[UniversalCoreService] storage root: ${storageRoot}`);
});
