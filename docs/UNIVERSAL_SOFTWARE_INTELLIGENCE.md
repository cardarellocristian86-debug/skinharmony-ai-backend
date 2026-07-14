# Universal Software Intelligence

`Universal Software Intelligence` is a domain-neutral, tenant-scoped evidence plane for authorized software analysis. The engine has no organization, brand, industry, or domain-pack dependency. Any tenant uses the same public API and policy contract.

## Components

- `universal_binary_evidence_core` is the default embedded analyzer. It reads ELF, PE, and Mach-O headers, hashes, entropy, and redacted printable strings without executing or persisting the artifact.
- `ghidra_headless` is an optional adapter capability for sections, symbols, imports, exports, functions, references, call graphs, and selective decompilation. It remains unavailable until an isolated worker image is configured and its official release artifact is verified.
- `frida_local_agent` is an optional local-only dynamic adapter. It accepts only the versioned templates returned by the component API. It never accepts JavaScript or source text from a caller.

Ghidra and Frida are not copied from local installations and their binaries are not included in this repository. The repository does include a Linux container build definition, a fixed Ghidra post-script, and a host launcher under `services/universal-core-service/workers/ghidra/`.

The Ghidra adapter is enabled only when `GHIDRA_SANDBOX_LAUNCHER`, `GHIDRA_SANDBOX_LAUNCHER_SHA256`, and `SOFTWARE_INTELLIGENCE_AUTHORIZATION_SECRET` are configured. Optional `GHIDRA_VERSION`, `GHIDRA_RELEASE_SHA256`, and `SOFTWARE_INTELLIGENCE_TEMP_ROOT` values further pin the runtime. Partial or invalid configuration fails at startup or probe time.

The Frida adapter is enabled only when `FRIDA_LOCAL_AGENT`, `FRIDA_LOCAL_AGENT_SHA256`, and the same Core authorization secret are configured. `FRIDA_VERSION` pins the runtime. Host Python resolution must be explicitly scoped to the verified Frida environment. Local setup is documented in `workers/local-agent/README.md`.

## API

- `GET /v1/software-intelligence/components`
- `POST /v1/software-intelligence/analyze` — synchronous lightweight compatibility route
- `POST /v1/software-intelligence/authorize` — Core-issued short-lived authorization for deep modes
- `POST /v1/software-intelligence/jobs` — asynchronous universal route
- `GET /v1/software-intelligence/jobs`
- `GET /v1/software-intelligence/jobs/:jobId`
- `POST /v1/software-intelligence/correlate` — correlate one completed Ghidra job and one completed Frida job belonging to the same tenant

All evidence uses `universal_software_evidence_v1`. Jobs are visible only to their authenticated tenant. Raw artifact bytes are held only by the request/job closure until completion and never included in the public job record or audit event.

## Authorization

Lightweight static analysis requires read-decision scope plus an asserted basis of `owned`, `written_permission`, or `open_source`.

Ghidra and Frida additionally require available tenant memory, available Core governance, a short-lived `universal_software_authorization_v1` envelope signed by Universal Core and verified server-side, owner confirmation, an allowed authorization basis, and—when dynamic—a target on the signed allowlist. The signature is tenant-, mode- and time-scoped with a maximum five-minute lifetime. A caller-provided boolean or allowlist is never trusted. Missing context fails closed.

Frida templates are versioned and parameter allowlisted. Arbitrary JavaScript, stealth, evasion, credential extraction, TLS bypass, and protection disabling are not exposed as capabilities.

Correlation normalizes platform symbol prefixes and distinguishes static reconstruction from runtime confirmation. Nyra and Codex may explain signatures, pseudocode, callers, callees and observed counts, but the evidence contract prevents presenting an unobserved static inference as a runtime fact.

## Isolation and limits

The job contract fixes `network_access=denied` and bounds CPU, memory, wall time, artifact size, and output size. The Ghidra adapter accepts only an absolute executable launcher whose SHA-256 matches configuration. Its probe must report Ghidra 12.1, the pinned official release hash, denied network access, and OS resource-limit enforcement. Input and output live in a mode-0700 temporary directory removed in `finally`; the Core service never runs the artifact itself.

The Linux launcher additionally requires the worker image by registry digest. It starts a non-root container with a read-only root filesystem, no network, all capabilities dropped, `no-new-privileges`, PID/memory/CPU/wall/output bounds, a `noexec` temporary filesystem, and only the current transient job directory mounted. The image build fetches the official archive and verifies SHA-256 during the build; the archive is not stored in source control. See `workers/ghidra/README.md` for the build contract.

## Supply chain

The manifest and CycloneDX SBOM live in `services/universal-core-service/vendor-manifests/`. Only the embedded native analyzer is active. Optional upstream components stay unavailable until their exact platform artifact, SHA-256, license, NOTICE/COPYING, redistribution obligations, and runtime are verified.

Run:

```sh
npm run test:software-horizontal
npm run test:ghidra-worker
npm run test:local-software-agent
npm run benchmark:software
```

The first command fails when the new universal engine, its manifests, or its tests contain vertical organization/domain references.
