use skinharmony_translator_contract::{
    validate_placeholders, CatalogSegment, Category, PublishSafetyDecision, RadarLevel, RiskLevel,
    TranslationResult,
};
use std::collections::BTreeMap;

pub fn can_publish(catalog: &[CatalogSegment], translations: &[TranslationResult]) -> PublishSafetyDecision {
    let by_id = translations
        .iter()
        .map(|item| (item.segment_id.as_str(), item))
        .collect::<BTreeMap<_, _>>();
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();

    for segment in catalog {
        let translation = by_id.get(segment.id.as_str());
        let target = translation
            .and_then(|item| item.target_text.as_deref())
            .or(segment.suggested_target.as_deref());
        let translated = target.is_some_and(|value| !value.trim().is_empty());

        if matches!(segment.risk.level, RiskLevel::Block) {
            blockers.push(format!("block-risk:{}", segment.key));
        }
        if matches!(segment.risk.level, RiskLevel::High | RiskLevel::Block) && !translated {
            blockers.push(format!("high-risk-untranslated:{}", segment.key));
        }
        if matches!(segment.radar.level, RadarLevel::Critical) && !translated {
            blockers.push(format!("critical-radar-pending:{}", segment.key));
        }
        if matches!(
            segment.category,
            Category::PricingPayment | Category::LegalPrivacy
        ) && matches!(segment.radar.level, RadarLevel::Critical | RadarLevel::Important)
            && !translation.is_some_and(|item| item.publish_safe)
        {
            blockers.push(format!("critical-review-missing:{}", segment.key));
        }
        if let Some(target_text) = target {
            let placeholder_result = validate_placeholders(&segment.source_text, target_text);
            if !placeholder_result.valid {
                blockers.push(format!("placeholder-mismatch:{}", segment.key));
            }
        } else {
            blockers.push(format!("untranslated:{}", segment.key));
            warnings.push(format!("missing-target:{}", segment.key));
        }
    }

    PublishSafetyDecision {
        publish_safe: blockers.is_empty(),
        blockers,
        warnings,
        stats: serde_json::json!({
            "segments": catalog.len(),
            "translations": translations.len()
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use skinharmony_translator_contract::*;

    fn segment(category: Category, risk: RiskLevel, radar: RadarLevel) -> CatalogSegment {
        CatalogSegment {
            key: "key".into(),
            id: "id".into(),
            semantic_id: "sid".into(),
            source_text: "Pay {amount}".into(),
            normalized_text: "Pay {amount}".into(),
            source_lang: "en".into(),
            target_lang: "it".into(),
            file: "a.tsx".into(),
            line: 1,
            column: 1,
            span: Span { start: 0, end: 3 },
            format: "tsx".into(),
            origin: Origin::Source,
            stage: Stage::V2,
            category,
            category_confidence: 0.9,
            context: SegmentContext::default(),
            placeholders: vec![],
            risk: RiskInfo {
                level: risk,
                score: 0.8,
                reasons: vec![],
            },
            radar: RadarInfo {
                level: radar,
                score: 0.9,
                reasons: vec![],
            },
            visibility: VisibilityInfo {
                level: VisibilityLevel::CriticalVisible,
                score: 0.9,
                reasons: vec![],
            },
            confidence: 0.9,
            quality_score: 0.9,
            suggested_target: None,
            translator: TranslatorState::default(),
            warnings: vec![],
            occurrences: vec![],
        }
    }

    #[test]
    fn high_untranslated_blocks_publish() {
        let decision = can_publish(
            &[segment(Category::Errors, RiskLevel::High, RadarLevel::Important)],
            &[],
        );
        assert!(!decision.publish_safe);
    }

    #[test]
    fn any_untranslated_segment_blocks_publish() {
        let decision = can_publish(
            &[segment(
                Category::GenericUiCopy,
                RiskLevel::Low,
                RadarLevel::Normal,
            )],
            &[],
        );
        assert!(!decision.publish_safe);
        assert!(decision
            .blockers
            .iter()
            .any(|blocker| blocker.starts_with("untranslated:")));
    }

    #[test]
    fn placeholder_mismatch_blocks_publish() {
        let translation = TranslationResult {
            segment_id: "id".into(),
            target_text: Some("Paga".into()),
            status: "translated".into(),
            publish_safe: true,
        };
        let decision = can_publish(
            &[segment(
                Category::PricingPayment,
                RiskLevel::Medium,
                RadarLevel::Critical,
            )],
            &[translation],
        );
        assert!(!decision.publish_safe);
    }

    #[test]
    fn safe_translation_allows_publish() {
        let translation = TranslationResult {
            segment_id: "id".into(),
            target_text: Some("Paga {amount}".into()),
            status: "validated".into(),
            publish_safe: true,
        };
        let decision = can_publish(
            &[segment(
                Category::GenericUiCopy,
                RiskLevel::Low,
                RadarLevel::Normal,
            )],
            &[translation],
        );
        assert!(decision.publish_safe);
    }
}
