# Nyra Governed Research & Distillation Layer — local report

## Outcome

Implemented a governed research/distillation layer in the Core MCP that adds:

- a versioned trusted source registry;
- branch learning pack manifests for stable Nyra branches;
- tenant-scoped temporary research workspaces;
- evidence normalization with redaction and registry binding;
- verified learning candidate creation after confirmation.

## Files added

- `services/skinharmony-core-mcp/src/research-governed-registry.js`
- `services/skinharmony-core-mcp/src/research-governed-layer.js`
- `services/skinharmony-core-mcp/test/research-governed-layer.test.js`
- `docs/NYRA_GOVERNED_RESEARCH_DISTILLATION_LAYER.md`
- `docs/NYRA_GOVERNED_RESEARCH_DISTILLATION_ADR.md`
- `docs/NYRA_GOVERNED_RESEARCH_DISTILLATION_RUNBOOK.md`
- `reports/nyra-governed-research/validation_report.json`

## Files updated

- `services/skinharmony-core-mcp/src/config.js`
- `services/skinharmony-core-mcp/src/server.js`

## Tests

- `node --test services/skinharmony-core-mcp/test/research-governed-layer.test.js`
- `node --test test/app.test.js test/core-handlers.test.js test/research-cortex.test.js test/research-governed-layer.test.js`
- `npm test` in `services/skinharmony-core-mcp`

Results:

- 3/3 passed on the governed research layer test file
- 31/31 passed on the targeted MCP integration set
- 79/79 passed on the MCP package suite

## Notes

- The implementation reuses the existing `research-cortex` and `memory-fabric` paths instead of duplicating them.
- The layer is fail-closed by default in production and can run in shadow locally.
- V2 and DTT behavior were not retrograded by this change set.
- No secrets were printed or added to the repository.
