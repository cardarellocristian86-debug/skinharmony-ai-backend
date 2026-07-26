# Agent & AI Orchestration v1

Status: production candidate

Authority: Universal Core

Intelligence plane: Relational Supervisor → Nyra

Execution boundary: proposal-only unless a separate Core authorization contract permits a bounded action

## Outcome

This release adds two distinct horizontal Core branches:

- `agent_orchestration`: agent factory, identity, delegation, topology, scheduling, context, memory, tools, resilience, verification, observability and teardown.
- `ai_orchestration`: provider/model discovery, routing, composition, evidence, verification, optimization, resilience, safety, evaluation, interoperability and lifecycle.

Nyra gains three corresponding cognitive entries:

- `relational_supervision`
- `agent_orchestration`
- `ai_orchestration`

When either orchestration branch is inferred or requested, Universal Core inserts relational supervision before Nyra's orchestration work.

## Authority hierarchy

```text
Universal Core
  └─ Relational Supervisor
       └─ Nyra
            ├─ Agent Orchestration
            ├─ AI Orchestration
            └─ bounded authorized workers
```

The Relational Supervisor is cognitively above Nyra for coordination and conflict detection, but it is below Universal Core in authority. It cannot call models, invoke tools, execute external actions, publish, deploy or grant itself permissions.

## Capacity model

The design space is intentionally much larger than the active runtime:

| Branch | Atomic capabilities | Categories | Virtual combinations |
|---|---:|---:|---:|
| Agent Orchestration | 40 | 17 | 540,000 |
| AI Orchestration | 38 | 13 | 816,480 |
| Combined | 78 | 30 | 1,356,480 |

Both branch taxonomies reach L30. Virtual composition and recursive depth are lazy and have no static catalog ceiling. Concrete runs are always materialized within an explicit Core contract.

The catalog is deterministic and versioned. It returns at most 100 atomic capabilities or 50 virtual combinations per page, and never materializes an agent or calls a model while browsing.

## Dynamic Task Tree v2

DTT v2 supports:

- typed nodes: analysis, research, decision, agent, AI model, tool, human gate, verification, join and rollback;
- dependencies, parents and fallback nodes;
- cycle rejection;
- explicit node, depth, fan-out, parallelism, time, token and cost budgets;
- bounded retry and fallback proposals;
- dynamic expansion proposals;
- prune and replan proposals;
- cancellation propagation and kill signal;
- verified-node requirement before Core join;
- tenant isolation and deterministic identifiers.

Expansion, pruning, replanning, retry and fallback are proposals. They are never applied implicitly. Runtime materialization remains bounded even though virtual taxonomy and composition are recursively extensible.

## Relational supervision

The Relational Supervisor builds a tenant-bound graph of actors and relations. It verifies:

- exactly one Universal Core authority;
- exactly one relational supervisor;
- exactly one Nyra;
- no authority inversion;
- no hierarchy inversion;
- typed governance, coordination, delegation, verification and join relations;
- conflict provenance and Core reconciliation;
- no cross-tenant access.

Nyra interprets context and advises. Workers provide bounded artifacts. Universal Core reconciles conflicts and owns the final join.

## Research basis

The architecture combines patterns from current primary specifications and official framework documentation:

- OpenAI Agents SDK separates manager-style agents-as-tools from handoffs and adds guardrails and tracing:
  - https://openai.github.io/openai-agents-python/multi_agent/
  - https://openai.github.io/openai-agents-python/handoffs/
  - https://openai.github.io/openai-agents-python/guardrails/
  - https://openai.github.io/openai-agents-python/tracing/
- MCP separates hosts, clients and servers, while its authorization model requires resource-bound tokens and forbids token passthrough:
  - https://modelcontextprotocol.io/docs/learn/architecture
  - https://modelcontextprotocol.io/specification/draft/basic/authorization
  - https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- A2A provides agent discovery, task lifecycle, artifacts and asynchronous collaboration:
  - https://a2aproject.github.io/A2A/latest/specification/
- Microsoft Semantic Kernel and AutoGen document sequential, concurrent, handoff, group and selector-based orchestration:
  - https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/agent-orchestration/
  - https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/selector-group-chat.html
- LangGraph emphasizes supervisor/subagent context isolation, persistence and resumable subgraphs:
  - https://docs.langchain.com/oss/javascript/langchain/multi-agent
  - https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs

## Market direction

The strongest forward path is not maximum simultaneous agents. It is maximum verified capability per bounded unit of cost and risk. The design therefore prioritizes:

1. mission-to-typed-graph compilation;
2. separation of sovereign control plane and intelligence plane;
3. relational health and anti-collusion supervision;
4. tenant-bound identity and short-lived delegation leases;
5. joint selection of topology, agent, model, tool and budget;
6. evidence and distillation gates before learning;
7. shadow, canary, continuous evaluation and rollback;
8. MCP and A2A interoperability;
9. quality/cost/latency/risk economics;
10. unlimited virtual design space with strictly bounded execution.

## Failure modes addressed

- agent explosion and infinite handoffs;
- recursive spawn without a depth contract;
- duplicate work and hidden ownership conflict;
- context poisoning and cross-tenant leakage;
- privilege laundering and token passthrough;
- malicious capability manifests or tool descriptions;
- collusion, sycophancy and false consensus;
- stale memory and unverified learning;
- evaluator bias and provider drift;
- retry storms, quota amplification and unbounded cost;
- execution without termination, cancellation or rollback.

## Production activation and rollback

This feature is code-active and advisory by construction:

- catalog reads are non-executing;
- relational evaluation is non-executing;
- DTT planning is non-executing;
- model/tool/external execution remains false;
- Universal Core remains final authority;
- owner confirmation remains required for publication, deployment and protected actions.

Rollback:

1. revert the release commit or deploy the previous Render version;
2. keep `CORE_RUNTIME_V2_MODE=shadow` as the runtime fallback;
3. Core continues to own routing and authority even if the new orchestration catalog is unavailable.
