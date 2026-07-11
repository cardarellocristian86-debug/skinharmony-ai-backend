# SkinHarmony Core MCP

Remote MCP gateway that exposes Nyra context and Universal Core governance to ChatGPT and Codex without allowing the model to impersonate the owner or execute actions directly.

## Tools

- `core_health`: read-only Core health.
- `core_gate_action`: mandatory policy evaluation before sensitive work. It never executes and has no `owner_confirmed` input.
- `nyra_runtime_context`: read-only Nyra readiness/control context.
- `nyra_interpret_request`: Nyra interpretation only; Universal Core remains final judge.

## Security model

- `/mcp` requires `MCP_AUTH_TOKEN` in production.
- Core uses a scoped `CORE_MCP_KEY`, never the admin key.
- Nyra uses a scoped bearer key or Basic credentials stored only in Render.
- Outputs remove secrets, tokens, raw bodies, email, phone, and image fields.
- The model cannot set owner confirmation.
- MCP tools evaluate but do not merge, deploy, publish, delete, or write product data.

## Required Render variables

- `MCP_AUTH_TOKEN`
- `CORE_MCP_KEY` with `policy:check` scope for tenant `codexai`
- `NYRA_MCP_API_KEY` (preferred) or `NYRA_MCP_BASIC_USER` + `NYRA_MCP_BASIC_PASSWORD`
- `CORE_BASE_URL=https://skinharmony-universal-core.onrender.com`
- `NYRA_BASE_URL=https://skinharmony-nyra-core.onrender.com`

## Codex connection

The repository includes `.codex/config.toml`. Set `SKINHARMONY_MCP_TOKEN` in the Codex environment to the same secret stored as `MCP_AUTH_TOKEN` on Render, trust the repository, then restart Codex and run `/mcp`.

The repository hook starts in advisory mode. After `SKINHARMONY_CORE_GATE_KEY` is available to Codex, set `SKINHARMONY_CORE_GATE_ENFORCEMENT=strict`. In strict mode, writes fail closed when Core is unavailable or does not return `allow`.

## ChatGPT Work

ChatGPT web does not read `.codex/config.toml`. Bundle this remote MCP service into a SkinHarmony plugin and install/authorize the plugin in the workspace.
