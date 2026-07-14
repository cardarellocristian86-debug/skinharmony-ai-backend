# Ghidra 12.1 Linux worker

This optional worker is built from the single official Ghidra 12.1 release asset. The 568 MB archive is downloaded during the image build, checked against its official SHA-256, and never committed to the repository.

Both builder and runtime base images must be supplied with immutable `@sha256:` digests. The produced image runs as UID 65532. Analysis is launched with no network, read-only root filesystem, all capabilities dropped, `no-new-privileges`, bounded PIDs, memory, CPU, wall time and output, plus one job-only bind mount.

The fixed `UniversalEvidenceExporter.java` is the only Ghidra post-script. Callers cannot submit scripts or JavaScript.

Build requires a running Docker or Podman daemon:

```sh
export BUILDER_IMAGE='eclipse-temurin:21-jdk@sha256:<verified-digest>'
export RUNTIME_IMAGE='eclipse-temurin:21-jre@sha256:<verified-digest>'
export GHIDRA_WORKER_IMAGE='usi-ghidra:12.1-20260513'
./build-image.sh
```

After building, push to an approved registry if required and configure the runtime by immutable image digest, never by `latest`.
