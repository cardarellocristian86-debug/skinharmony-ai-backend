#!/bin/sh
set -eu
: "${BUILDER_IMAGE:?Set a digest-pinned JDK 21 builder image}"
: "${RUNTIME_IMAGE:?Set a digest-pinned JRE 21 runtime image}"
: "${GHIDRA_WORKER_IMAGE:?Set the output image name without latest tag}"
case "$BUILDER_IMAGE" in *@sha256:*) ;; *) echo "builder_image_digest_required" >&2; exit 64 ;; esac
case "$RUNTIME_IMAGE" in *@sha256:*) ;; *) echo "runtime_image_digest_required" >&2; exit 64 ;; esac
case "$GHIDRA_WORKER_IMAGE" in *:latest|*@sha256:*) echo "mutable_or_digest_output_image_denied" >&2; exit 64 ;; esac
engine="${GHIDRA_CONTAINER_ENGINE:-docker}"
"$engine" build --pull=false --network=default \
  --build-arg "BUILDER_IMAGE=$BUILDER_IMAGE" --build-arg "RUNTIME_IMAGE=$RUNTIME_IMAGE" \
  --build-arg "GHIDRA_URL=https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1_build/ghidra_12.1_PUBLIC_20260513.zip" \
  --build-arg "GHIDRA_SHA256=aa5cbcbbf48f41ca185fce900e19592f1ade4cd5994eb6e0ede468dac8a6f302" \
  --tag "$GHIDRA_WORKER_IMAGE" --file Containerfile .
