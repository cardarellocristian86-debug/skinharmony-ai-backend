#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT_DIR/skinharmony-rust-extractor-governor/Cargo.toml"
BIN="$ROOT_DIR/skinharmony-rust-extractor-governor/target/release/skinharmony-extract"

export CARGO_HOME="${CARGO_HOME:-$ROOT_DIR/.render-rust/cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$ROOT_DIR/.render-rust/rustup}"
mkdir -p "$CARGO_HOME" "$RUSTUP_HOME"

if ! command -v rustup >/dev/null 2>&1; then
  curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --no-modify-path
fi

if [ -f "$CARGO_HOME/env" ]; then
  # shellcheck disable=SC1090
  source "$CARGO_HOME/env"
fi

if ! rustup default >/dev/null 2>&1; then
  rustup toolchain install stable --profile minimal
  rustup default stable
fi

rustup run stable cargo build --release --manifest-path "$MANIFEST"
test -x "$BIN"
echo "SkinHarmony Rust extractor ready: $BIN"
