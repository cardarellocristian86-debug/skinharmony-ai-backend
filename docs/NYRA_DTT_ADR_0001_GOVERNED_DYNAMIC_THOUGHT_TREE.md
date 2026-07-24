# ADR 0001: Governed Dynamic Thought Tree

Status: accepted locally

Context

Nyra needs a stable branch catalog and, within each request, a bounded way to explore alternatives. A static catalog alone is too rigid for ambiguous requests. An unconstrained reasoning tree would be unsafe and difficult to govern.

Decision

Implement a governed Dynamic Thought Tree as a request-scoped, tenant-scoped structure that:

- expands up to three hypotheses per node;
- scores candidates using evidence, reliability, utility, probability, risk, cost, reversibility, uncertainty, and policy;
- prunes weak paths early;
- backtracks when the current path fails;
- stops early once evidence is sufficient;
- hands the final join to Universal Core;
- stores only redacted, structured outputs.

Universal Core remains the only authority that can approve or deny the final result.

Alternatives considered

1. Extend the fixed branch catalog only.

   Rejected because it does not solve per-request ambiguity.

2. Use an unconstrained tree search.

   Rejected because it does not satisfy boundedness, tenant isolation, or Core governance.

3. Make DTT a permanent branch type.

   Rejected because temporary reasoning must not become permanent policy or memory automatically.

Consequences

- Better handling of ambiguous requests.
- More transparent and auditable intermediate reasoning.
- Clear rollback path through `CORE_DTT_MODE=off`.
- Slight runtime overhead from bounded scoring and tree management.

