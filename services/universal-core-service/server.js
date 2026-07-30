import { createUniversalCoreService } from "./src/app.js";
import { createGhidraHeadlessAdapter } from "./src/ghidraHeadlessAdapter.js";
import { createFridaLocalAdapter } from "./src/fridaLocalAdapter.js";
import { createSoftwareAuthorizationVerifier } from "./src/universalSoftwareIntelligence.js";
import { loadHostNativeResolverRegistryFromEnvironment } from "./src/hostNativeResolverRegistry.js";

function safeResolverConfigurationError(error) {
  const code = String(error?.message || "").trim();
  // Registry parsing deliberately emits compact error codes.  Do not reflect
  // arbitrary parser/runtime text into health responses or logs: it could
  // otherwise contain an environment value supplied by the host.
  return /^[a-z0-9_]{3,160}$/.test(code)
    ? code
    : "host_native_resolver_registry_invalid";
}

function unavailableResolverRegistry(error) {
  const unavailable = Object.freeze({
    state: "configuration_invalid",
    binding_count: 0,
    resolver: null,
  });
  return Object.freeze({
    configuration_valid: false,
    configuration_error: safeResolverConfigurationError(error),
    github: unavailable,
    render: unavailable,
    required_checks: unavailable,
  });
}

function loadHostNativeResolverRegistry() {
  try {
    return loadHostNativeResolverRegistryFromEnvironment(process.env);
  } catch (error) {
    // A malformed binding must disable the governed route rather than falling
    // back to caller-controlled origins, checks, or credentials.
    return unavailableResolverRegistry(error);
  }
}

const port = Number(process.env.PORT || process.env.CORE_SERVICE_PORT || 8787);
const hostNativeResolverRegistry = loadHostNativeResolverRegistry();
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
  hostNativeResolverConfigurationValid: hostNativeResolverRegistry.configuration_valid,
  hostNativeResolverConfigurationError:
    hostNativeResolverRegistry.configuration_error || null,
  hostNativeGithubTokenResolver: hostNativeResolverRegistry.github.resolver,
  hostNativeGithubCredentialResolverState: hostNativeResolverRegistry.github.state,
  hostNativeGithubCredentialBindingCount:
    hostNativeResolverRegistry.github.binding_count,
  hostNativeRenderServiceOriginResolver: hostNativeResolverRegistry.render.resolver,
  hostNativeRenderServiceOriginResolverState: hostNativeResolverRegistry.render.state,
  hostNativeRenderServiceOriginBindingCount:
    hostNativeResolverRegistry.render.binding_count,
  hostNativeRequiredChecksPolicyResolver:
    hostNativeResolverRegistry.required_checks.resolver,
  hostNativeRequiredChecksPolicyResolverState:
    hostNativeResolverRegistry.required_checks.state,
  hostNativeRequiredChecksPolicyBindingCount:
    hostNativeResolverRegistry.required_checks.binding_count,
});

app.listen(port, () => {
  console.log(`[UniversalCoreService] listening on ${port}`);
  console.log(`[UniversalCoreService] storage root: ${storageRoot}`);
});
