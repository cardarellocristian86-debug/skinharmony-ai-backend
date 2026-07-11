import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(process.cwd(), "../..");

test("repository contains durable Codex governance guidance", () => {
  const agents = fs.readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
  const config = fs.readFileSync(path.join(repoRoot, ".codex", "config.toml"), "utf8");
  const hooks = JSON.parse(fs.readFileSync(path.join(repoRoot, ".codex", "hooks.json"), "utf8"));
  assert.match(agents, /Universal Core is the final policy judge/);
  assert.match(agents, /Before any write/);
  assert.match(config, /mcp_servers\.skinharmony_core/);
  assert.match(config, /SKINHARMONY_MCP_TOKEN/);
  assert.equal(hooks.hooks.PreToolUse[0].matcher, "^(Bash|apply_patch|Edit|Write)$");
});

test("Codex hook is advisory by default and fail-closed in strict mode", () => {
  const hook = path.join(repoRoot, ".codex", "hooks", "core-gate-hook.mjs");
  const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push origin main" } });
  const advisory = spawnSync(process.execPath, [hook], { input, encoding: "utf8", env: { ...process.env, SKINHARMONY_CORE_GATE_KEY: "", SKINHARMONY_CORE_GATE_ENFORCEMENT: "advisory" } });
  assert.equal(advisory.status, 0);
  assert.match(advisory.stdout, /additionalContext/);
  assert.doesNotMatch(advisory.stdout, /permissionDecision.*deny/);

  const strict = spawnSync(process.execPath, [hook], { input, encoding: "utf8", env: { ...process.env, SKINHARMONY_CORE_GATE_KEY: "", SKINHARMONY_CORE_GATE_ENFORCEMENT: "strict" } });
  assert.equal(strict.status, 0);
  assert.match(strict.stdout, /permissionDecision/);
  assert.match(strict.stdout, /deny/);
});
