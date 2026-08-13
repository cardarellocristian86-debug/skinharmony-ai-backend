import { createUniversalCoreService } from "./src/app.js";
import { createGhidraHeadlessAdapter } from "./src/ghidraHeadlessAdapter.js";
import { createFridaLocalAdapter } from "./src/fridaLocalAdapter.js";
import { createSoftwareAuthorizationVerifier } from "./src/universalSoftwareIntelligence.js";
import pg from "pg";
import { createIcfPostgresStore } from "./src/icfPostgresStore.js";
import { createCoreJoinPostgresStore, createCoreJoinSigner } from "./src/coreJoinPostgresStore.js";

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
const icfDatabaseUrl = process.env.GOVERNED_AGENT_DATABASE_URL || process.env.DATABASE_URL || "";
const icfPool = icfDatabaseUrl ? new pg.Pool({ connectionString: icfDatabaseUrl, max: 4, idleTimeoutMillis: 30000 }) : null;
const icfStore = icfPool ? createIcfPostgresStore({ pool: icfPool }) : undefined;
const coreJoinSigner = createCoreJoinSigner({ secret: process.env.ICF_GENERIC_JOIN_SIGNING_SECRET, keyId: process.env.ICF_GENERIC_JOIN_KEY_ID || "core-join-hmac-v1" });
const coreJoinStore = icfPool ? createCoreJoinPostgresStore({ pool: icfPool, signer: coreJoinSigner }) : undefined;
if (icfStore) {
  try { await icfStore.initialize(); } catch (error) { console.error(`[UniversalCoreService] ICF PostgreSQL store unavailable: ${error.message}`); }
}
if (coreJoinStore?.ready) {
  try { await coreJoinStore.initialize(); } catch (error) { console.error(`[UniversalCoreService] Generic Core Join store unavailable: ${error.message}`); }
}
const { app, storageRoot } = createUniversalCoreService({
  softwareWorkerAdapters,
  softwareAuthorizationVerifier,
  softwareAuthorizationSecret: process.env.SOFTWARE_INTELLIGENCE_AUTHORIZATION_SECRET,
  icfStore,
  coreJoinStore,
});

app.listen(port, () => {
  console.log(`[UniversalCoreService] listening on ${port}`);
  console.log(`[UniversalCoreService] storage root: ${storageRoot}`);
});
