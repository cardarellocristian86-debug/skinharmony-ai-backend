# Universal Software Intelligence implementation report

## Architecture

The selected architecture is a lightweight embedded analyzer plus optional capability adapters behind a tenant-scoped asynchronous job plane. The common evidence schema is `universal_software_evidence_v1`. No optional upstream runtime is vendored.

## Runtime state

- Active: `universal_binary_evidence_core`.
- Optional/unavailable: Ghidra 12.1 headless worker.
- Optional/unavailable: Frida 17.9.11 Local Agent.

Optional means the policy, template, job, evidence, and adapter contracts exist; activation still requires a separately built no-network worker and platform-specific supply-chain verification.

## Supply chain

Ghidra 12.1 is pinned to official tag `Ghidra_12.1_build`; the release publishes SHA-256 `aa5cbcbbf48f41ca185fce900e19592f1ade4cd5994eb6e0ede468dac8a6f302`, Apache-2.0 license, NOTICE, and a release SBOM. Frida is pinned to official tag 17.9.11 and its tagged `COPYING` identifies the wxWindows Library Licence 3.1; activation is blocked until one platform-specific official asset and its published checksum are selected and its component obligations are recorded.

## Safety and rollback

The previous synchronous lightweight endpoint is retained. Rolling back consists of reverting this commit; no migration, external storage, environment change, or production deployment is part of this PR. Jobs are process-memory records with short evidence retention and no raw-binary persistence.

## Validation

Tests cover internally generated ELF/PE/Mach-O fixtures, generic tenant isolation, negative authorization, missing Core/memory/workers, target allowlists, arbitrary Frida input, templates, timeout, resource bounds, redaction, no raw persistence, API behavior, Nyra/Core regressions, and an automatic vertical-reference gate.

Post-rebase benchmark results from a 512-byte internal fixture over 100 iterations: lightweight static mean `0.052 ms/job`; deep mock-adapter orchestration mean `0.007 ms/job`. The deep number measures policy, queue, and evidence wrapping only; it is not a Ghidra performance claim.

Universal Core JavaScript tests pass `44/44`; Core MCP tests pass `45/45`. The legacy aggregate smoke reaches the unrelated translation-extractor status check and fails because its external extractor runtime is unavailable in this worktree. Software, Nyra, tenant, API, and Core regression tests complete before that external-runtime check.
