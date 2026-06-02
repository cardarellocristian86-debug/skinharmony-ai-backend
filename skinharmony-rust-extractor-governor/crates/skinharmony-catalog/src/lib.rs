use anyhow::Result;
use serde::{Deserialize, Serialize};
use skinharmony_translator_contract::CatalogSegment;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Catalog {
    pub generated_at: String,
    pub source_lang: String,
    pub target_lang: String,
    pub segments: Vec<CatalogSegment>,
    pub stats: CatalogStats,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CatalogStats {
    pub total: usize,
    pub high_risk: usize,
    pub critical_radar: usize,
    pub by_category: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Json,
    Jsonl,
}

pub fn build_catalog(source_lang: &str, target_lang: &str, segments: Vec<CatalogSegment>) -> Catalog {
    let mut by_category = BTreeMap::<String, usize>::new();
    let high_risk = segments
        .iter()
        .filter(|segment| {
            matches!(
                segment.risk.level,
                skinharmony_translator_contract::RiskLevel::High
                    | skinharmony_translator_contract::RiskLevel::Block
            )
        })
        .count();
    let critical_radar = segments
        .iter()
        .filter(|segment| {
            matches!(
                segment.radar.level,
                skinharmony_translator_contract::RadarLevel::Critical
            )
        })
        .count();
    for segment in &segments {
        *by_category.entry(format!("{:?}", segment.category)).or_insert(0) += 1;
    }
    Catalog {
        generated_at: "generated_by_cli".to_string(),
        source_lang: source_lang.to_string(),
        target_lang: target_lang.to_string(),
        stats: CatalogStats {
            total: segments.len(),
            high_risk,
            critical_radar,
            by_category,
        },
        segments,
    }
}

pub fn dedupe_segments(segments: Vec<CatalogSegment>) -> Vec<CatalogSegment> {
    let mut by_id = BTreeMap::<String, CatalogSegment>::new();
    for segment in segments {
        by_id
            .entry(segment.semantic_id.clone())
            .and_modify(|existing| {
                existing.occurrences.extend(segment.occurrences.clone());
                if segment.radar.score > existing.radar.score {
                    existing.radar = segment.radar.clone();
                }
                if segment.risk.score > existing.risk.score {
                    existing.risk = segment.risk.clone();
                }
            })
            .or_insert(segment);
    }
    by_id.into_values().collect()
}

pub fn write_catalog(path: &Path, catalog: &Catalog, format: OutputFormat) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    match format {
        OutputFormat::Json => serde_json::to_writer_pretty(writer, catalog)?,
        OutputFormat::Jsonl => {
            for segment in &catalog.segments {
                serde_json::to_writer(&mut writer, segment)?;
                writer.write_all(b"\n")?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use skinharmony_translator_contract::*;

    fn segment(id: &str) -> CatalogSegment {
        CatalogSegment {
            key: id.into(),
            id: id.into(),
            semantic_id: id.into(),
            source_text: "Save".into(),
            normalized_text: "Save".into(),
            source_lang: "en".into(),
            target_lang: "it".into(),
            file: "a.tsx".into(),
            line: 1,
            column: 1,
            span: Span { start: 0, end: 4 },
            format: "tsx".into(),
            origin: Origin::Source,
            stage: Stage::V2,
            category: Category::Cta,
            category_confidence: 0.9,
            context: SegmentContext::default(),
            placeholders: vec![],
            risk: RiskInfo {
                level: RiskLevel::Low,
                score: 0.1,
                reasons: vec![],
            },
            radar: RadarInfo {
                level: RadarLevel::Important,
                score: 0.7,
                reasons: vec![],
            },
            visibility: VisibilityInfo {
                level: VisibilityLevel::Visible,
                score: 0.7,
                reasons: vec![],
            },
            confidence: 0.9,
            quality_score: 0.9,
            suggested_target: None,
            translator: TranslatorState::default(),
            warnings: vec![],
            occurrences: vec![Occurrence {
                file: "a.tsx".into(),
                line: 1,
                column: 1,
            }],
        }
    }

    #[test]
    fn dedupe_preserves_occurrences() {
        let deduped = dedupe_segments(vec![segment("same"), segment("same")]);
        assert_eq!(deduped.len(), 1);
        assert_eq!(deduped[0].occurrences.len(), 2);
    }
}
