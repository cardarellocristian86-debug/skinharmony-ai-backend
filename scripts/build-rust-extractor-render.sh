#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT_DIR/skinharmony-rust-extractor-governor/Cargo.toml"
BIN="$ROOT_DIR/skinharmony-rust-extractor-governor/target/release/skinharmony-extract"

if ! command -v cargo >/dev/null 2>&1; then
  curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi

cargo build --release --manifest-path "$MANIFEST"
test -x "$BIN"
echo "SkinHarmony Rust extractor ready: $BIN"
