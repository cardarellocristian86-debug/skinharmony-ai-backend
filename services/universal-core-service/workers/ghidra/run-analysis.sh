#!/bin/sh
set -eu

input=""
output=""
wall_time="60"
output_bytes="2097152"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --input) input="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    --wall-time-seconds) wall_time="$2"; shift 2 ;;
    --output-bytes) output_bytes="$2"; shift 2 ;;
    *) echo "unsupported_argument:$1" >&2; exit 64 ;;
  esac
done

case "$input" in /work/*) ;; *) echo "input_outside_workdir" >&2; exit 64 ;; esac
case "$output" in /work/*) ;; *) echo "output_outside_workdir" >&2; exit 64 ;; esac
[ -f "$input" ] || { echo "input_missing" >&2; exit 66; }
[ ! -L "$input" ] || { echo "input_symlink_denied" >&2; exit 66; }

project="/tmp/usi-project-$$"
mkdir -m 700 "$project"
trap 'rm -rf "$project"' EXIT HUP INT TERM

/opt/ghidra/support/analyzeHeadless "$project" project \
  -import "$input" -overwrite -analysisTimeoutPerFile "$wall_time" \
  -scriptPath /opt/usi/scripts \
  -postScript UniversalEvidenceExporter.java "$output" "20" "true" \
  -deleteProject

[ -f "$output" ] || { echo "evidence_missing" >&2; exit 70; }
size=$(wc -c < "$output" | tr -d ' ')
[ "$size" -le "$output_bytes" ] || { rm -f "$output"; echo "evidence_too_large" >&2; exit 70; }
chmod 0600 "$output"
