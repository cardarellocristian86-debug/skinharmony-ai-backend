# AI Work Quality Failure Mediation V1

Status: implementation candidate. Live default: `observe`.

## Fixed architecture

```text
Tenant Work Gallery (work, participant, lease, checkpoint)
        |
        v
evidence-bound observation -> Universal Core exact-code evaluation
        |                         |
        |                         +-> immutable BLOCK / CONFIRM / DEFER
        v
Core Block Remediation -> Nyra explanation/review -> worker proposal
        |                                            |
        +------ PostgreSQL versions + ledger <-------+
                             |
                             v
                 new Universal Core decision
```

Universal Core is the only component that may issue `ALLOW`. Nyra explains,
diagnoses and reviews; a worker may propose a correction but cannot execute it.
Gallery supplies the tenant/work/session/lease boundary and exposes the same
remediation blocker to every authorized session of that tenant.

## Failure taxonomy

The closed exact-code registry covers claim integrity, context integrity,
execution quality, tool integrity, collaboration, memory provenance, security,
resource control and uncertainty. Unknown codes fail closed. The existing
Defensive Hardening codes are explicitly classified; substring matching is not
used.

## Rollout tiers

| Tier | Observe | Draft proposal/review | Resubmit | External execution |
|---|---:|---:|---:|---:|
| `observe` | yes | no | no | no |
| `draft` | yes | quality contracts only | no | no |
| `sandbox_active` | yes | quality contracts only | sandbox re-evaluation | no |
| `scoped_active` | yes | quality contracts only | bounded scope | only after new Core verdict |
| `privileged` | yes | quality contracts only | bounded scope | new Core verdict plus request-bound owner confirmation |

`CORE_BLOCK_REMEDIATION_MODE` continues to govern legacy remediation and is not
implicitly enabled by an AI quality tier.

## Evidence and storage

- Observations require expected, observed and evidence digests.
- Evidence requirements use exact identifiers/digests, never substring matches.
- Raw prompt/chat fields and credential-like values are recursively redacted.
- PostgreSQL is the single durable Gallery/remediation store.
- Current state uses optimistic concurrency; every version is also appended to
  an immutable history table.
- Tenant, original decision and scope digest are immutable.

## Research basis

- [NIST AI 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) identifies confabulation and lifecycle risk management needs.
- [OWASP LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) explains why retrieved or peer-provided content remains untrusted.
- [OWASP LLM06 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) motivates least capability and externally verified action boundaries.
- [METR long-task measurement](https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/) motivates durable checkpoints and repeated verification on long jobs.
- [Anthropic agent evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) motivates outcome-based, multi-turn and independent evaluation.

