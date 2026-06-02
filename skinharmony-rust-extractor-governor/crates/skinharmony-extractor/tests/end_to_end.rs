use skinharmony_catalog::{build_catalog, dedupe_segments, write_catalog, OutputFormat};
use skinharmony_extractor::{extract_path, ExtractOptions};
use skinharmony_policy::can_publish;
use skinharmony_translator_contract::{RiskLevel, TranslationResult};
use std::fs;
use std::path::Path;

#[test]
fn fixture_catalog_contains_visible_copy_and_blocks_without_translations() {
    let root = workspace_fixture("tests/fixtures");
    let options = ExtractOptions {
        scan_bundles: true,
        ..ExtractOptions::default()
    };
    let segments = dedupe_segments(extract_path(&root, &options).expect("extract fixtures"));
    assert!(
        !segments.is_empty(),
        "default extractor thresholds must produce a non-empty governed catalog"
    );
    assert!(segments
        .iter()
        .any(|segment| segment.source_text.contains("Start free trial")));
    assert!(segments
        .iter()
        .any(|segment| segment.source_text.contains("Payment required")));
    assert!(!segments
        .iter()
        .any(|segment| segment.source_text.contains("eyJhbGci")));

    let policy = can_publish(&segments, &[]);
    assert!(!policy.publish_safe);
    assert!(segments
        .iter()
        .any(|segment| matches!(segment.risk.level, RiskLevel::High | RiskLevel::Block)));
}

#[test]
fn catalog_jsonl_output_is_valid_and_preserves_occurrences() {
    let root = workspace_fixture("tests/fixtures/html_site");
    let segments = dedupe_segments(extract_path(&root, &ExtractOptions::default()).expect("extract"));
    let catalog = build_catalog("en", "it", segments);
    let out = std::env::temp_dir().join("skinharmony-extractor-catalog.jsonl");
    write_catalog(&out, &catalog, OutputFormat::Jsonl).expect("write catalog");
    let raw = fs::read_to_string(&out).expect("read catalog");
    assert!(raw.lines().count() >= 3);
    for line in raw.lines() {
        let value: serde_json::Value = serde_json::from_str(line).expect("valid jsonl");
        assert!(value.get("id").is_some());
        assert!(value.get("occurrences").is_some());
    }
}

#[test]
fn policy_allows_safe_translated_low_risk_catalog() {
    let root = workspace_fixture("tests/fixtures/html_site");
    let mut segments = dedupe_segments(extract_path(&root, &ExtractOptions::default()).expect("extract"));
    segments.retain(|segment| !matches!(segment.risk.level, RiskLevel::High | RiskLevel::Block));
    let translations = segments
        .iter()
        .map(|segment| TranslationResult {
            segment_id: segment.id.clone(),
            target_text: Some(segment.source_text.clone()),
            status: "validated".into(),
            publish_safe: true,
        })
        .collect::<Vec<_>>();
    let policy = can_publish(&segments, &translations);
    assert!(policy.publish_safe);
}

#[test]
fn smartdesk_mixed_fixture_detects_real_language_surfaces() {
    let root = workspace_fixture("tests/fixtures/smartdesk_mixed");
    let options = ExtractOptions {
        scan_bundles: true,
        ..ExtractOptions::default()
    };
    let segments = dedupe_segments(extract_path(&root, &options).expect("extract smartdesk fixture"));
    let texts = segments
        .iter()
        .map(|segment| segment.source_text.as_str())
        .collect::<Vec<_>>();

    for expected in [
        "Core/Nyra server on top",
        "AI Gold - what to do now",
        "Datenqualität",
        "Agenda öffnen",
        "Mostra periodo",
        "Da richiamare",
        "Business email",
        "AI Gold ha letto il centro. Prima priorità: apri servizi/operatori e completa i costi.",
        "lettura operativa del centro, non solo numeri sparsi.",
        "Operational engine active",
        "3 segnali da leggere",
    ] {
        assert!(
            texts.iter().any(|text| text.contains(expected)),
            "missing Smart Desk user-facing text: {expected}"
        );
    }

    for forbidden in [
        "sk_live_should_not_export",
        "eyJhbGci",
        "api_key = should_not_export",
        "route tecnico da non catalogare",
        "Carlo Rossi",
        "Privilege Parrucchieri",
    ] {
        assert!(
            !texts.iter().any(|text| text.contains(forbidden)),
            "technical/secret noise leaked into catalog: {forbidden}"
        );
    }
}

#[test]
fn include_and_exclude_filters_are_applied_before_extraction() {
    let root = workspace_fixture("tests/fixtures/smartdesk_mixed");
    let options = ExtractOptions {
        include: vec!["**/*.json".into()],
        exclude: vec!["gold-bridge".into()],
        ..ExtractOptions::default()
    };
    let segments = dedupe_segments(extract_path(&root, &options).expect("extract filtered fixture"));
    assert!(segments
        .iter()
        .any(|segment| segment.source_text.contains("Sprache")));
    assert!(!segments
        .iter()
        .any(|segment| segment.source_text.contains("Centro letto da Smart Desk")));
    assert!(segments.iter().all(|segment| segment.file.ends_with(".json")));
}

#[test]
fn max_file_bytes_skips_large_files_before_parsing() {
    let root = workspace_fixture("tests/fixtures/smartdesk_mixed");
    let options = ExtractOptions {
        max_file_bytes: 80,
        ..ExtractOptions::default()
    };
    let segments = dedupe_segments(extract_path(&root, &options).expect("extract size-limited fixture"));
    assert!(
        segments.iter().all(|segment| segment.file != "AiGoldPanel.tsx"),
        "large TSX fixture should be skipped before parser work"
    );
}

#[test]
fn max_files_limits_smoke_scan_scope() {
    let root = workspace_fixture("tests/fixtures");
    let options = ExtractOptions {
        max_files: 1,
        ..ExtractOptions::default()
    };
    let segments = dedupe_segments(extract_path(&root, &options).expect("extract max-files fixture"));
    let touched_files = segments
        .iter()
        .map(|segment| segment.file.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    assert!(touched_files.len() <= 1);
}

fn workspace_fixture(relative: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(relative)
}
