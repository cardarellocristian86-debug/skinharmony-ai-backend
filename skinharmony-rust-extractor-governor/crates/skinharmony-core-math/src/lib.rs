use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FeatureVector {
    pub length_norm: f64,
    pub char_count: f64,
    pub token_count: f64,
    pub unicode_letter_ratio: f64,
    pub uppercase_ratio: f64,
    pub lowercase_ratio: f64,
    pub whitespace_ratio: f64,
    pub punctuation_ratio: f64,
    pub digit_ratio: f64,
    pub symbol_ratio: f64,
    pub entropy: f64,
    pub compression_noise_score: f64,
    pub natural_language_shape_score: f64,
    pub placeholder_density: f64,
    pub dom_visibility: f64,
    pub ast_ui_context_score: f64,
    pub api_message_context_score: f64,
    pub resource_key_score: f64,
    pub bundle_origin_penalty: f64,
    pub repetition_score: f64,
    pub user_visibility_prior: f64,
    pub technical_penalty: f64,
    pub secret_penalty: f64,
    pub low_signal_penalty: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RiskVector {
    pub placeholder: f64,
    pub legal: f64,
    pub payment: f64,
    pub privacy: f64,
    pub medical_beauty_claim: f64,
    pub admin_danger: f64,
    pub bundle_context: f64,
    pub missing_context: f64,
}

impl FeatureVector {
    pub fn values(&self) -> [f64; 24] {
        [
            self.length_norm,
            self.char_count,
            self.token_count,
            self.unicode_letter_ratio,
            self.uppercase_ratio,
            self.lowercase_ratio,
            self.whitespace_ratio,
            self.punctuation_ratio,
            self.digit_ratio,
            self.symbol_ratio,
            self.entropy,
            self.compression_noise_score,
            self.natural_language_shape_score,
            self.placeholder_density,
            self.dom_visibility,
            self.ast_ui_context_score,
            self.api_message_context_score,
            self.resource_key_score,
            self.bundle_origin_penalty,
            self.repetition_score,
            self.user_visibility_prior,
            self.technical_penalty,
            self.secret_penalty,
            self.low_signal_penalty,
        ]
    }
}

pub fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

pub fn entropy(text: &str) -> f64 {
    if text.is_empty() {
        return 0.0;
    }
    let mut counts = BTreeMap::<char, usize>::new();
    for ch in text.chars() {
        *counts.entry(ch).or_insert(0) += 1;
    }
    let len = text.chars().count() as f64;
    counts
        .values()
        .map(|count| {
            let p = *count as f64 / len;
            -p * p.log2()
        })
        .sum()
}

pub fn normalized_entropy(text: &str) -> f64 {
    let alphabet = text.chars().collect::<BTreeSet<_>>().len();
    if alphabet <= 1 {
        return 0.0;
    }
    entropy(text) / (alphabet as f64).log2()
}

pub fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

pub fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b.iter()).map(|(left, right)| left * right).sum()
}

pub fn logistic_translatability(weights: &[f64], features: &FeatureVector, bias: f64) -> f64 {
    sigmoid(dot(weights, &features.values()) + bias)
}

pub fn quality_score(features: &FeatureVector) -> f64 {
    clamp01(
        0.18 * features.natural_language_shape_score
            + 0.14 * features.ast_ui_context_score
            + 0.12 * features.api_message_context_score
            + 0.14 * features.dom_visibility
            + 0.10 * features.resource_key_score
            + 0.14 * features.user_visibility_prior
            - 0.14 * features.technical_penalty
            - 0.14 * features.secret_penalty
            - 0.12 * features.low_signal_penalty
            - 0.10 * features.bundle_origin_penalty
            + 0.21,
    )
}

pub fn risk_score(risk: RiskVector) -> f64 {
    clamp01(
        0.15 * risk.placeholder
            + 0.16 * risk.legal
            + 0.15 * risk.payment
            + 0.15 * risk.privacy
            + 0.16 * risk.medical_beauty_claim
            + 0.12 * risk.admin_danger
            + 0.06 * risk.bundle_context
            + 0.05 * risk.missing_context,
    )
}

pub fn radar_score(
    visibility: f64,
    conversion: f64,
    payment: f64,
    legal: f64,
    onboarding: f64,
    error: f64,
    brand_voice: f64,
) -> f64 {
    clamp01(
        0.22 * visibility
            + 0.16 * conversion
            + 0.15 * payment
            + 0.15 * legal
            + 0.12 * onboarding
            + 0.12 * error
            + 0.08 * brand_voice,
    )
}

pub fn visibility_score(
    dom_visible: f64,
    attribute_visible: f64,
    runtime_message_likely: f64,
    api_user_message_likely: f64,
    navigation_likely: f64,
    cta_likely: f64,
    internal_only_penalty: f64,
) -> f64 {
    clamp01(
        0.25 * dom_visible
            + 0.14 * attribute_visible
            + 0.17 * runtime_message_likely
            + 0.17 * api_user_message_likely
            + 0.13 * navigation_likely
            + 0.14 * cta_likely
            - 0.20 * internal_only_penalty,
    )
}

pub fn jaccard(left: &[String], right: &[String]) -> f64 {
    let a = left.iter().cloned().collect::<BTreeSet<_>>();
    let b = right.iter().cloned().collect::<BTreeSet<_>>();
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    let intersection = a.intersection(&b).count() as f64;
    let union = a.union(&b).count() as f64;
    intersection / union
}

pub fn cosine(left: &[f64], right: &[f64]) -> f64 {
    let numerator = dot(left, right);
    let left_norm = dot(left, left).sqrt();
    let right_norm = dot(right, right).sqrt();
    if left_norm == 0.0 || right_norm == 0.0 {
        return 0.0;
    }
    numerator / (left_norm * right_norm)
}

pub fn text_features(
    text: &str,
    placeholder_count: usize,
    visibility_prior: f64,
    context_score: f64,
    technical_penalty: f64,
    secret_penalty: f64,
) -> FeatureVector {
    let chars = text.chars().collect::<Vec<_>>();
    let len = chars.len().max(1) as f64;
    let letters = chars.iter().filter(|ch| ch.is_alphabetic()).count() as f64;
    let uppercase = chars.iter().filter(|ch| ch.is_uppercase()).count() as f64;
    let lowercase = chars.iter().filter(|ch| ch.is_lowercase()).count() as f64;
    let whitespace = chars.iter().filter(|ch| ch.is_whitespace()).count() as f64;
    let digits = chars.iter().filter(|ch| ch.is_ascii_digit()).count() as f64;
    let punctuation = chars.iter().filter(|ch| ch.is_ascii_punctuation()).count() as f64;
    let tokens = text
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .count()
        .max(1) as f64;
    let entropy_value = normalized_entropy(text);
    let symbol_ratio = (len - letters - whitespace - digits - punctuation).max(0.0) / len;
    let low_signal_penalty = if letters / len < 0.35 || tokens < 1.0 {
        0.8
    } else {
        0.0
    };
    let natural_language_shape_score = clamp01((letters / len) + (whitespace / len) * 0.5 - digits / len);

    FeatureVector {
        length_norm: clamp01(len / 140.0),
        char_count: clamp01(len / 260.0),
        token_count: clamp01(tokens / 24.0),
        unicode_letter_ratio: letters / len,
        uppercase_ratio: uppercase / len,
        lowercase_ratio: lowercase / len,
        whitespace_ratio: whitespace / len,
        punctuation_ratio: punctuation / len,
        digit_ratio: digits / len,
        symbol_ratio,
        entropy: entropy_value,
        compression_noise_score: if entropy_value > 0.92 { 0.7 } else { 0.0 },
        natural_language_shape_score,
        placeholder_density: clamp01(placeholder_count as f64 / tokens),
        dom_visibility: visibility_prior,
        ast_ui_context_score: context_score,
        api_message_context_score: context_score,
        resource_key_score: context_score * 0.8,
        bundle_origin_penalty: 0.0,
        repetition_score: 0.0,
        user_visibility_prior: visibility_prior,
        technical_penalty,
        secret_penalty,
        low_signal_penalty,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entropy_and_normalized_entropy_work() {
        assert_eq!(entropy("aaaa"), 0.0);
        assert!(normalized_entropy("abcd") > 0.9);
    }

    #[test]
    fn sigmoid_dot_and_scores_work() {
        assert!((sigmoid(0.0) - 0.5).abs() < 0.0001);
        assert_eq!(dot(&[1.0, 2.0], &[3.0, 4.0]), 11.0);
        let features = text_features("Start your free trial", 0, 1.0, 0.8, 0.0, 0.0);
        assert!(quality_score(&features) > 0.4);
        assert!(logistic_translatability(&[0.1; 24], &features, 0.0) > 0.5);
    }

    #[test]
    fn similarity_works() {
        assert_eq!(jaccard(&["a".into(), "b".into()], &["b".into()]), 0.5);
        assert!((cosine(&[1.0, 0.0], &[1.0, 0.0]) - 1.0).abs() < 0.0001);
    }
}
