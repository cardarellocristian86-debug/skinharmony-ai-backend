import assert from "node:assert/strict";
import test from "node:test";

import { createCoreHandlers } from "../src/core-handlers.js";
import { TOOLS } from "../src/tool-definitions.js";

test("retires all provider setup and provider-run MCP entry points", () => {
  const providerTools = TOOLS.filter((tool) =>
    tool.name.startsWith("tenant_provider_") || /provider|api key/i.test(tool.name),
  );
  assert.deepEqual(providerTools.map((tool) => tool.name), []);

  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.example.test",
    universalCoreKeys: { codexai: "tenant-core-key" },
  });
  assert.equal(
    Object.keys(handlers).some((name) => name.startsWith("tenant_provider_")),
    false,
  );
  assert.equal(Object.hasOwn(handlers, "issueOwnerOpenAiSetupLink"), false);
});
