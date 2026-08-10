#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${CFN_LINT_VENV:-$ROOT/.validation-venv}"

python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet --requirement "$ROOT/requirements-dev.txt"
"$VENV/bin/cfn-lint" "$ROOT/template.yaml"
npm --prefix "$ROOT" test
