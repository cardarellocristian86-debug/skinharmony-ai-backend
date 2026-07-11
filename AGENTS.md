# SkinHarmony Codex Operating Contract

This repository contains proprietary SkinHarmony systems. Universal Core is the final policy judge; Nyra is the context, memory, and interpretation layer. Codex proposes and implements only within their verdicts.

## Mandatory startup sequence

1. Read this file and `services/skinharmony-core-mcp/README.md`.
2. Check `git status` and preserve unrelated user changes.
3. Call `skinharmony_core.core_health`.
4. For material SkinHarmony work, call `skinharmony_core.nyra_runtime_context` before planning.
5. If the MCP server is unavailable, continue only with read-only inspection. Do not merge, deploy, publish, delete, change prices/claims, access customer data, or perform cross-tenant actions.

## Mandatory Core gate

Before any write, update, merge, deploy, publish, deletion, pricing, public claim, finance, customer-data, or cross-tenant action, call `skinharmony_core.core_gate_action` with an honest risk estimate.

- The model must never set, infer, or simulate owner confirmation.
- `ALLOW` permits only the exact scoped action evaluated.
- `CONFIRM`, `BLOCK`, `DEFER`, `SANDBOX`, or `execution_allowed=false` means do not execute.
- Owner confirmation in chat does not replace a Core verdict when the gate is available.
- Re-run the gate if files, scope, tenant, action, or risk materially changes.

The repository PreToolUse hook is a guardrail for shell and file edits. It is not the sole enforcement boundary. Branch protection, CI, Render permissions, and server-side Core checks remain authoritative.

## Safety boundaries

- No direct production writes by default.
- No cross-tenant access.
- No automatic publication, deploy, pricing change, claim approval, customer messaging, payment, trading, or destructive action.
- Never commit API keys, bearer tokens, Basic credentials, Render secrets, customer data, images, or runtime ledgers.
- Use scoped service keys, not Core admin keys.
- Keep Nyra advisory and Universal Core decisive.
- Preserve existing audit, evidence, rollback, tenant isolation, and owner-confirmation behavior.

## Verification

- MCP service: `npm test --prefix services/skinharmony-core-mcp`
- Universal Core: `npm run core:service:test`
- Never merge or deploy with failing tests.
- Work on a feature branch and open a PR. Do not merge unless the owner explicitly requests it and Core returns an allowing verdict for that exact merge/deploy action.

## Deployment notes

- Render blueprint: `render-core-mcp.yaml`
- Remote MCP URL: `https://skinharmony-core-mcp.onrender.com/mcp`
- Codex token env: `SKINHARMONY_MCP_TOKEN`
- Hook gate env: `SKINHARMONY_CORE_GATE_KEY`
- Enable strict hook enforcement only after the gate key is configured: `SKINHARMONY_CORE_GATE_ENFORCEMENT=strict`

ChatGPT web does not read `.codex/config.toml`; it needs a SkinHarmony plugin that bundles this remote MCP server.
