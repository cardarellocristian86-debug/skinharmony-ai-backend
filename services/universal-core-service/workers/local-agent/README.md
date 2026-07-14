# Universal local software agent

This directory connects verified host installations to Universal Core without copying vendor binaries into the repository. Nyra and Codex consume only tenant-scoped evidence returned by Core.

## Ghidra

Configure the fixed launcher, its SHA-256, the installed `analyzeHeadless`, JDK 21, exact installed version, and the verified upstream/package release hash:

```sh
export GHIDRA_SANDBOX_LAUNCHER=/absolute/repository/path/workers/local-agent/ghidra-local-launcher.mjs
export GHIDRA_SANDBOX_LAUNCHER_SHA256=<launcher-sha256>
export GHIDRA_ANALYZE_HEADLESS=/absolute/vendor/path/support/analyzeHeadless
export GHIDRA_JAVA_HOME=/absolute/jdk-21-home
export GHIDRA_VERSION=12.1.2
export GHIDRA_LOCAL_VERSION=12.1.2
export GHIDRA_RELEASE_SHA256=<verified-release-sha256>
export GHIDRA_LOCAL_RELEASE_SHA256=<verified-release-sha256>
```

The launcher applies a macOS deny-network sandbox, CPU time limit, JVM heap/metaspace limit, wall timeout, output bound, transient project, and fixed exporter. No caller script is accepted.

## Frida

Put the verified Frida virtual environment first on `PATH`, then configure the fixed agent and its SHA-256:

```sh
export PATH=/absolute/frida-venv/bin:$PATH
export FRIDA_LOCAL_AGENT=/absolute/repository/path/workers/local-agent/frida-local-agent.py
export FRIDA_LOCAL_AGENT_SHA256=<agent-sha256>
export FRIDA_VERSION=17.15.3
```

Only the catalogued template identifiers and bounded parameters reach Frida. Targets must be included in the short-lived Core-signed allowlist. `pid:<number>` and `process:<exact-name>` are the only target forms.

## Correlation

After one completed Ghidra job and one completed Frida job for the same tenant, call `POST /v1/software-intelligence/correlate` with their two job IDs. The response marks functions as `static_only` or `confirmed_runtime` and carries reconstructed code without persisting raw artifacts.
