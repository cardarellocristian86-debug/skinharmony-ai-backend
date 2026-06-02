# SkinHarmony Rust Extractor Governor

Spec owner-imported. This project builds a deterministic Rust extractor that scans authorized software sources and produces governed translation catalogs before translation.

Non-goals:
- no DRM bypass;
- no cracking;
- no credential extraction;
- no unauthorized reverse engineering;
- no network calls during extraction;
- no direct translation.

Core pipeline:

`authorized input -> scanner -> parser -> candidate generator -> mathematical governor -> V2/V1/V0 noise firewall -> classifier -> context/risk/radar/visibility -> catalog -> SkinHarmony Core Translator -> Core/Nyra publish-safe decision`.

