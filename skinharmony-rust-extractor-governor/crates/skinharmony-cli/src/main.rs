use anyhow::{Context, Result};
use clap::{Parser, ValueEnum};
use skinharmony_catalog::{build_catalog, dedupe_segments, write_catalog, OutputFormat};
use skinharmony_extractor::{extract_path, ExtractOptions};
use skinharmony_policy::can_publish;
use skinharmony_translator_contract::{RadarLevel, TranslationResult};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, ValueEnum)]
enum CliFormat {
    Json,
    Jsonl,
}

#[derive(Debug, Parser)]
#[command(name = "skinharmony-extract")]
#[command(about = "Governatore di estrazione cataloghi traducibili SkinHarmony")]
struct Args {
    input: PathBuf,

    #[arg(long, default_value = "en")]
    source_lang: String,

    #[arg(long, default_value = "it")]
    target_lang: String,

    #[arg(long, default_value = "./out/catalog.jsonl")]
    out: PathBuf,

    #[arg(long, value_enum, default_value_t = CliFormat::Jsonl)]
    format: CliFormat,

    #[arg(long, default_value_t = 0.62)]
    min_confidence: f64,

    #[arg(long, default_value_t = 0.58)]
    min_quality: f64,

    #[arg(long)]
    include: Vec<String>,

    #[arg(long)]
    exclude: Vec<String>,

    #[arg(long, default_value_t = 750_000)]
    max_file_bytes: u64,

    #[arg(long, default_value_t = 5_000)]
    max_files: usize,

    #[arg(long)]
    scan_bundles: bool,

    #[arg(long)]
    use_sourcemaps: bool,

    #[arg(long)]
    stats: bool,

    #[arg(long)]
    dry_run: bool,

    #[arg(long)]
    fail_on_high_untranslated: bool,

    #[arg(long)]
    fail_on_placeholder_risk: bool,

    #[arg(long)]
    emit_policy_report: Option<PathBuf>,

    #[arg(long)]
    emit_radar_report: Option<PathBuf>,

    #[arg(long)]
    emit_noise_report: Option<PathBuf>,

    #[arg(long)]
    translation_memory: Option<PathBuf>,

    #[arg(long)]
    previous_catalog: Option<PathBuf>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let options = ExtractOptions {
        source_lang: args.source_lang.clone(),
        target_lang: args.target_lang.clone(),
        min_confidence: args.min_confidence,
        min_quality: args.min_quality,
        scan_bundles: args.scan_bundles,
        use_sourcemaps: args.use_sourcemaps,
        include: args.include.clone(),
        exclude: args.exclude.clone(),
        max_file_bytes: args.max_file_bytes,
        max_files: args.max_files,
    };

    let mut segments = extract_path(&args.input, &options)
        .with_context(|| format!("estrazione fallita da {}", args.input.display()))?;
    segments = dedupe_segments(segments);
    apply_translation_memory(&mut segments, args.translation_memory.as_ref())?;
    let catalog = build_catalog(&args.source_lang, &args.target_lang, segments);

    if args.stats {
        eprintln!(
            "segments={} high_risk={} critical_radar={}",
            catalog.stats.total, catalog.stats.high_risk, catalog.stats.critical_radar
        );
    }

    let translations = collect_pretranslated(&catalog.segments);
    let policy = can_publish(&catalog.segments, &translations);

    if let Some(path) = args.emit_policy_report.as_ref() {
        write_json(path, &policy)?;
    }
    if let Some(path) = args.emit_radar_report.as_ref() {
        write_json(path, &radar_report(&catalog.segments))?;
    }
    if let Some(path) = args.emit_noise_report.as_ref() {
        write_json(
            path,
            &serde_json::json!({ "redacted_secret_candidates": [], "note": "secrets are redacted before catalog export" }),
        )?;
    }

    if args.previous_catalog.is_some() {
        eprintln!("previous-catalog accepted for compatibility; merge strategy is deterministic dedupe in this bootstrap");
    }

    if !args.dry_run {
        write_catalog(
            &args.out,
            &catalog,
            match args.format {
                CliFormat::Json => OutputFormat::Json,
                CliFormat::Jsonl => OutputFormat::Jsonl,
            },
        )?;
    }

    if args.fail_on_high_untranslated && catalog.stats.high_risk > 0 {
        anyhow::bail!(
            "high-risk untranslated segments found: {}",
            catalog.stats.high_risk
        );
    }
    if args.fail_on_placeholder_risk && !policy.publish_safe {
        anyhow::bail!("publish policy failed: {:?}", policy.blockers);
    }
    Ok(())
}

fn apply_translation_memory(
    segments: &mut [skinharmony_translator_contract::CatalogSegment],
    path: Option<&PathBuf>,
) -> Result<()> {
    let Some(path) = path else {
        return Ok(());
    };
    let raw =
        fs::read_to_string(path).with_context(|| format!("lettura translation memory {}", path.display()))?;
    let memory: BTreeMap<String, String> = serde_json::from_str(&raw)
        .with_context(|| format!("translation memory non valida {}", path.display()))?;
    for segment in segments {
        if let Some(target) = memory
            .get(&segment.key)
            .or_else(|| memory.get(&segment.normalized_text))
        {
            segment.suggested_target = Some(target.clone());
            segment.translator.status = "pretranslated".into();
            segment.translator.engine = Some("translation_memory".into());
        }
    }
    Ok(())
}

fn collect_pretranslated(
    segments: &[skinharmony_translator_contract::CatalogSegment],
) -> Vec<TranslationResult> {
    segments
        .iter()
        .filter_map(|segment| {
            segment.suggested_target.as_ref().map(|target| TranslationResult {
                segment_id: segment.id.clone(),
                target_text: Some(target.clone()),
                status: "pretranslated".into(),
                publish_safe: true,
            })
        })
        .collect()
}

fn radar_report(segments: &[skinharmony_translator_contract::CatalogSegment]) -> serde_json::Value {
    let radar_item = |segment: &skinharmony_translator_contract::CatalogSegment| {
        serde_json::json!({
            "id": segment.id,
            "key": segment.key,
            "text": segment.source_text,
            "category": segment.category,
            "risk": segment.risk.level,
            "radar": segment.radar.level,
            "file": segment.file,
            "line": segment.line
        })
    };
    let critical = segments
        .iter()
        .filter(|segment| matches!(segment.radar.level, RadarLevel::Critical))
        .map(radar_item)
        .collect::<Vec<_>>();
    let important = segments
        .iter()
        .filter(|segment| matches!(segment.radar.level, RadarLevel::Important))
        .map(radar_item)
        .collect::<Vec<_>>();
    serde_json::json!({
        "critical": critical,
        "important": important,
        "critical_count": critical.len(),
        "important_count": important.len(),
        "count": critical.len() + important.len()
    })
}

fn write_json(path: &PathBuf, value: &impl serde::Serialize) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(value)?)?;
    Ok(())
}
