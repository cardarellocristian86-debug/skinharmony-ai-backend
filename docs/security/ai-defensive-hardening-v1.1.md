# AI Defensive Hardening V1.1

Codename: Nyra "Debian-Immune" Layer

## Purpose

This layer reduces the attack surface, limits blast radius, blocks known escalation patterns by policy, and preserves verifiable security evidence. It does not claim to make compromise impossible and is not a certification.

The hardening gate runs after the Core logical verdict and before operational capability issuance or MCP write side effects:

```text
Core verdict -> remediation proposal -> hardening evaluation -> scoped lease
-> confined execution adapter -> output verification -> existing ledger
-> commit, verified rollback, or quarantine -> lease revocation and cleanup
```

A `CORRECTABLE` Core result is not executable by itself. In enforcement mode execution additionally requires trusted tool provenance, valid tenant/work scope, least privilege, authorized filesystem and network scope, a verified checkpoint, available required isolation controls, and a new single-use lease.

## Existing components reused

- Universal Core action evaluator and AI gateway remain the mediation authority.
- The MCP write guard remains the mandatory gate for governed mutation handlers.
- Existing Work Identity and mandatory work preflight provide tenant, work, session, and agent context.
- Existing Capability Catalog data is injected into `ToolIntegrityGate`; no implicit capability is introduced.
- Existing Universal Core audit and PostgreSQL Decision Ledger are extended with redaction and hash chaining. No parallel security ledger is created.
- Existing checkpoint and rollback metadata are verified before lease issuance.
- Existing operational runtime retains execution responsibility after hardening approval.

## Trust boundaries and assets

Trust boundaries exist between callers and Core, Core and tool packages, tenant workspaces, Core and execution adapters, DNS/network destinations, and mutable storage and append-only ledgers.

Protected assets include tenant data, repository state, work identity, capability credentials, environment secrets, audit evidence, checkpoints, and outbound network authority. Tenant IDs, work IDs, repository identity, bound scope, operation, target, issuer, and audience are bound into the lease digest.

## Threat model

An attacker may submit a modified, downgraded, expired, revoked, or falsely signed tool; replay a previous request; request wildcard or root-like authority; substitute tenant/work identity; traverse paths or escape through symlinks; inspect secret environment variables; mutate global environment state; use a runtime library for network access; follow redirects to private infrastructure; forge a checkpoint; produce excessive output; or tamper with audit records.

The model assumes the host process, configured trust roots, capability catalog, database administrator boundary, and injected execution adapters have not already been fully compromised. A host-level compromise remains outside application-policy containment.

## Controls and enforcement levels

| Level | Meaning | V1.1 status |
|---|---|---|
| Policy-level isolation | Input, identity, capability, path, environment, network and rollback decisions | Implemented and application-enforced |
| Process-level isolation | Dedicated unprivileged process, timeout and process resource limits | Adapter contract; enforced only when a real adapter reports enforcement |
| Container-level isolation | Container filesystem, user and network boundaries | Unavailable unless supplied by deployment runtime |
| Kernel-enforced isolation | seccomp, namespaces, cgroups or equivalent host primitives | Unavailable unless supplied and attested by deployment runtime |

The implementation is not described as a kernel-mode sandbox. `enforced`, `partially_enforced`, and `unavailable` report actual capability state. In `enforce`, unavailable required controls fail closed.

Filesystem access is deny-by-default against `bound_scope`; absolute escapes, traversal, and resolved symlink escapes are denied. Environment keys use an allowlist and sensitive names are removed. Per-remediation temporary working directories, process users, memory limits and deterministic process cleanup belong to the execution adapter; policy preparation does not misreport them as OS enforcement.

Network access is deny-by-default and evaluates URL protocol, host, port, method, DNS answers, private/loopback/link-local ranges, cloud metadata targets, and every redirect. It is independent of command names and therefore also covers declared requests made through libraries or alternate binaries. An OS-level egress adapter is required when network containment must extend beyond application-declared intent.

## Tool integrity and leases

Tool verification binds tool ID, version, content digest, contextual signature, signer trust root, provenance, tenant scope, expiry, revocation, anti-downgrade floor, declared capabilities, and catalog authorization. An untrusted tool causes `UNTRUSTED_TOOL_DETECTED`, proposal quarantine, execution denial, and preservation of sanitized evidence. Only the affected lease/capability is revoked; the whole work identity is not destroyed.

Execution leases are temporary, single-purpose, tenant/work/session/remediation scoped, operation and target bound, issuer/audience bound, nonce protected, revocable, and single-use. Wildcard and root-like capabilities are denied with `PRIVILEGE_ESCALATION_BLOCKED`.

## Audit and privacy

Security events are appended to the existing tenant-scoped ledgers with event and previous digests. Structured redaction removes authorization headers, cookies, passwords, API keys, private keys, credentials, secrets, and tokens before persistence. File bodies and unnecessary personal payloads must not be submitted as metadata. Metrics use fixed names without tenant, user, URL, or work labels.

Metrics:

```text
hardening_evaluations_total
hardening_blocks_total
hardening_quarantines_total
integrity_failures_total
privilege_escalation_attempts_total
filesystem_scope_violations_total
network_egress_denials_total
execution_lease_replays_total
rollback_verification_failures_total
audit_chain_verification_failures_total
```

## Quarantine, rollback, and incident response

A quarantined proposal cannot reuse its lease or nonce. Retry requires a new proposal evaluation and nonce. Evidence and denial reasons remain in the ledger.

Rollback is allowed only when checkpoint digest, tenant, work, and repository match and the checkpoint is not stale. Unsafe rollback produces `ABSOLUTE_BLOCK`; operators must preserve evidence and create a newly verified checkpoint rather than forcing rollback.

Incident flow:

1. Deny execution and revoke the affected lease.
2. Quarantine the proposal and suppress automatic retry.
3. Persist redacted evidence and verify the tenant ledger chain.
4. Revoke the tool/catalog entry or signer where justified.
5. Restore only from a verified compatible checkpoint.
6. Re-evaluate with a new nonce, manifest, and lease.

## Activation

The default is `off`, including unconfigured production environments. Initial activation must be shadow-only:

```sh
NYRA_DEFENSIVE_HARDENING_MODE=shadow
```

Modes:

- `off`: preserves the existing flow and does not evaluate or persist hardening decisions.
- `shadow`: evaluates and records findings, returning `CORRECTABLE` for violations without changing the existing verdict.
- `enforce`: blocks fail-closed. Do not enable in production until catalogs, trust roots, checkpoint generation, clients, and real required adapters are configured and shadow telemetry is clean.

Activation strategy: configure non-secret catalog metadata and runtime-provided trust roots; run locally; activate shadow in a non-production environment; review blocks, unavailable controls and compatibility; remediate callers; then approve enforcement through the normal production change process. This repository change does not activate production enforcement.

Rollback strategy: set the flag to `off` and restart through the existing deployment process. This restores the previous mediation behavior without deleting ledger evidence. Code rollback should revert the dedicated hardening commits only and must not rewrite the append-only ledger.

## Limits and residual risks

- Application policy cannot contain arbitrary code that bypasses the declared execution adapter.
- DNS can change between validation and connection unless the network adapter pins the validated address.
- Process, container and kernel containment depend on real runtime adapters and are otherwise unavailable.
- In-process memory limits cannot be guaranteed by application checks alone.
- Trust-root protection and rotation depend on deployment secret management.
- Append-only files reduce casual tampering but PostgreSQL permissions, immutable storage, external anchoring, backups and monitoring remain necessary for stronger forensic guarantees.
- A compromised host or database administrator can attack application evidence outside this threat boundary.

## Indicative framework mapping

The controls are directionally relevant to OWASP Agentic AI threats involving tool misuse, excessive agency, identity/privilege abuse and memory or supply-chain compromise; OWASP LLM risks involving insecure plugin design, excessive agency and sensitive disclosure; NIST AI RMF Govern, Map, Measure and Manage functions; GDPR security, minimization and accountability principles; and AI Act risk management, logging and human oversight themes. This mapping is informational and does not claim compliance, conformity assessment, or certification.
