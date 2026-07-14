# Universal Core agent rules

Core is the policy and decision authority. Nyra opens contextual branches; agents only advise through bounded contracts.

- Use deterministic routing, authorization, tenant isolation, schema validation and evidence storage before any model call.
- The coordinator owns the final response; use specialists as tools for bounded work. Handoffs are reserved for a true transfer of user-facing ownership.
- Keep specialist fan-out at three or fewer, with at most two model calls in parallel. Do not invoke vision without an image.
- A Core variant is always a proposal with contract, impact analysis, tests, evidence and rollback plan. It is never applied or published automatically.
- Pass only minimal tenant-scoped structured memory to a specialist. Never reuse tenant memory, identities, tokens or caches across tenants.
- Publishing, deployment, payments, customer contact, tenant writes and destructive actions require Core verdict, explicit owner confirmation, audit and a rollback/sandbox path.
- Keep SkinHarmony-specific protocol/catalog configuration in authorized domain adapters. Do not place tenant IDs, secrets or brand configuration in the universal horizontal engine.
