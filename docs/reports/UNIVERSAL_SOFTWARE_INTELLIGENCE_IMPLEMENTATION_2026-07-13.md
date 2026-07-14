# Universal Software Intelligence implementation report

## Architecture

The selected architecture is a lightweight embedded analyzer plus optional capability adapters behind a tenant-scoped asynchronous job plane. The common evidence schema is `universal_software_evidence_v1`. No optional upstream runtime is vendored.

## Runtime state

- Active: `universal_binary_evidence_core`.
- Optional/unavailable runtime: Ghidra 12.1 headless adapter, Linux container build definition, fixed exporter, and digest-only host launcher are implemented. No Ghidra binary, built worker image, or production launcher configuration is vendored or active.
- Optional/configurable local runtime: Ghidra 12.1.2 Homebrew with JDK 21 and Frida 17.15.3 from a verified Python environment. Vendor binaries remain outside the repository. Both launchers are path- and SHA-pinned; Frida accepts only fixed templates and Core-signed allowlisted targets.

Optional means the policy, template, job, evidence, and adapter contracts exist; activation still requires a separately built no-network worker and platform-specific supply-chain verification.

The Linux worker definition is rootless-compatible and the launcher enforces an immutable image digest, no network, read-only root, dropped capabilities, `no-new-privileges`, bounded PIDs/memory/CPU/wall/output, transient storage, and one job-only mount. A local arm64 build verified the official 568 MB Ghidra archive hash and produced a probeable image. Live analysis then found and fixed the global `RUNTIME_IMAGE` ARG scope and Docker bind-mount syntax, and established that Ghidra headless requires a full JDK rather than a JRE-only runtime. Eclipse Temurin 21 JDK was resolved as `sha256:1eeacc8c295ed4805f6ffead2417b1936aad296b02ea9e56b457230befc9e98d`. The corrected JDK runtime rebuild was interrupted by a Docker Desktop BuildKit storage I/O failure and the daemon did not recover after a controlled restart. Runtime therefore remains unverified and no `embedded_active` claim is made.

## Supply chain

The container Ghidra 12.1 release remains pinned to official tag `Ghidra_12.1_build` and SHA-256 `aa5cbcbbf48f41ca185fce900e19592f1ade4cd5994eb6e0ede468dac8a6f302`. The verified local Homebrew Ghidra 12.1.2 formula records upstream source SHA-256 `c30fe709ec5d5e68bf799a6c1f4dfc6853dacb189d10203eb882ecbb408db216`. The local Frida binding is version 17.15.3, its binary hash is recorded in the SBOM, and its package metadata identifies the wxWindows Library Licence 3.1. Local verification does not mark vendor code as embedded.

## Safety and rollback

The previous synchronous lightweight endpoint is retained. Rolling back consists of reverting this commit; no migration, external storage, environment change, or production deployment is part of this PR. Jobs are process-memory records with short evidence retention and no raw-binary persistence.

## Validation

Tests cover internally generated ELF/PE/Mach-O fixtures, generic tenant isolation, negative authorization, missing Core/memory/workers, target allowlists, arbitrary Frida input, templates, timeout, resource bounds, redaction, no raw persistence, API behavior, Nyra/Core regressions, and an automatic vertical-reference gate.

Post-rebase benchmark results from a 512-byte internal fixture over 100 iterations: lightweight static mean `0.052 ms/job`; deep mock-adapter orchestration mean `0.007 ms/job`. The deep number measures policy, queue, and evidence wrapping only; it is not a Ghidra performance claim.

Post-rebase Universal Core JavaScript tests pass `78/78`; Core MCP tests pass `59/59`. The local-agent suite verifies launcher hashes, versions, denied network, fixed Frida templates and fail-closed policy. A live owned-fixture run produced three reconstructed functions, two static call edges, three decompilations, twenty bounded Frida call events and one runtime-confirmed function with no unmatched symbol. Shell entrypoints pass syntax validation and the horizontal gate scans the worker sources. GitHub reports no failing PR checks.
