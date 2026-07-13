# Universal Software Intelligence

`Universal Software Intelligence` is a domain-neutral, tenant-scoped evidence plane for authorized software analysis. The engine has no organization, brand, industry, or domain-pack dependency. Any tenant uses the same public API and policy contract.

## Components

- `universal_binary_evidence_core` is the default embedded analyzer. It reads ELF, PE, and Mach-O headers, hashes, entropy, and redacted printable strings without executing or persisting the artifact.
- `ghidra_headless` is an optional adapter capability for sections, symbols, imports, exports, functions, references, call graphs, and selective decompilation. It remains unavailable until an isolated worker image is configured and its official release artifact is verified.
- `frida_local_agent` is an optional local-only dynamic adapter. It accepts only the versioned templates returned by the component API. It never accepts JavaScript or source text from a caller.

Ghidra and Frida are not copied from local installations and are not included in this repository.

## API

- `GET /v1/software-intelligence/components`
- `POST /v1/software-intelligence/analyze` — synchronous lightweight compatibility route
- `POST /v1/software-intelligence/jobs` — asynchronous universal route
- `GET /v1/software-intelligence/jobs`
- `GET /v1/software-intelligence/jobs/:jobId`

All evidence uses `universal_software_evidence_v1`. Jobs are visible only to their authenticated tenant. Raw artifact bytes are held only by the request/job closure until completion and never included in the public job record or audit event.

## Authorization

Lightweight static analysis requires read-decision scope plus an asserted basis of `owned`, `written_permission`, or `open_source`.

Ghidra and Frida additionally require available tenant memory, available Core governance, an affirmative authorization from the server-side `softwareAuthorizationVerifier`, owner confirmation, an allowed authorization basis, and—when dynamic—a target on the verifier-provided allowlist. A caller-provided boolean is never trusted as the Core verdict. Missing context fails closed.

Frida templates are versioned and parameter allowlisted. Arbitrary JavaScript, stealth, evasion, credential extraction, TLS bypass, and protection disabling are not exposed as capabilities.

## Isolation and limits

The job contract fixes `network_access=denied` and bounds CPU, memory, wall time, artifact size, and output size. A production worker adapter must enforce the same limits at the OS/container boundary; the Core service never runs an artifact itself.

## Supply chain

The manifest and CycloneDX SBOM live in `services/universal-core-service/vendor-manifests/`. Only the embedded native analyzer is active. Optional upstream components stay unavailable until their exact platform artifact, SHA-256, license, NOTICE/COPYING, redistribution obligations, and runtime are verified.

Run:

```sh
npm run test:software-horizontal
npm run benchmark:software
```

The first command fails when the new universal engine, its manifests, or its tests contain vertical organization/domain references.
