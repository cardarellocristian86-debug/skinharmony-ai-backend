#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readMcpStagingBlueprints,
  validateMcpStagingBlueprints,
} from "./render-mcp-staging-blueprint-policy.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
let report;
try {
  report = validateMcpStagingBlueprints(readMcpStagingBlueprints(repositoryRoot));
} catch {
  report = {
    schema_version: "mcp_staging_blueprint_policy_v1",
    static_policy_ok: false,
    deploy_ready: false,
    errors: ["blueprint_read_failed"],
    blockers: [],
    risks: [],
    secrets_exposed: false,
  };
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.deploy_ready === true ? 0 : 1;
