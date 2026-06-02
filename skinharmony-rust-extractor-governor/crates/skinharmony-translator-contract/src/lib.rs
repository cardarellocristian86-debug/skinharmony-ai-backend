use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    V2,
    V1,
    V0,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    Source,
    Bundle,
    Html,
    Json,
    Api,
    Css,
    Generated,
    Resource,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Cta,
    Navigation,
    Errors,
    OnboardingTrial,
    AiGoldCopy,
    DataQuality,
    PricingPayment,
    LegalPrivacy,
    AdminSupport,
    GenericUiCopy,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Block,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum RadarLevel {
    Silent,
    Normal,
    Important,
    Critical,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum VisibilityLevel {
    Invisible,
    Maybe,
    Visible,
    CriticalVisible,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct Placeholder {
    pub raw: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Occurrence {
    pub file: String,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SegmentContext {
    pub before: Option<String>,
    pub after: Option<String>,
    pub component: Option<String>,
    pub function: Option<String>,
    pub dom_path: Option<String>,
    pub attribute: Option<String>,
    pub json_path: Option<String>,
    pub api_path: Option<String>,
    pub bundle_chunk: Option<String>,
    pub source_map_origin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RiskInfo {
    pub level: RiskLevel,
    pub score: f64,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RadarInfo {
    pub level: RadarLevel,
    pub score: f64,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VisibilityInfo {
    pub level: VisibilityLevel,
    pub score: f64,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranslatorState {
    pub status: String,
    pub engine: Option<String>,
    pub publish_safe: bool,
    pub nyra_decision: Option<NyraDecision>,
    pub openai_refinement_required: bool,
}

impl Default for TranslatorState {
    fn default() -> Self {
        Self {
            status: "pending".to_string(),
            engine: None,
            publish_safe: false,
            nyra_decision: None,
            openai_refinement_required: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CatalogSegment {
    pub key: String,
    pub id: String,
    pub semantic_id: String,
    pub source_text: String,
    pub normalized_text: String,
    pub source_lang: String,
    pub target_lang: String,
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub span: Span,
    pub format: String,
    pub origin: Origin,
    pub stage: Stage,
    pub category: Category,
    pub category_confidence: f64,
    pub context: SegmentContext,
    pub placeholders: Vec<Placeholder>,
    pub risk: RiskInfo,
    pub radar: RadarInfo,
    pub visibility: VisibilityInfo,
    pub confidence: f64,
    pub quality_score: f64,
    pub suggested_target: Option<String>,
    pub translator: TranslatorState,
    pub warnings: Vec<String>,
    pub occurrences: Vec<Occurrence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranslationRequest {
    pub source_lang: String,
    pub target_lang: String,
    pub segments: Vec<CatalogSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranslationResult {
    pub segment_id: String,
    pub target_text: Option<String>,
    pub status: String,
    pub publish_safe: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlaceholderValidationResult {
    pub valid: bool,
    pub missing: Vec<Placeholder>,
    pub invented: Vec<Placeholder>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PublishSafetyDecision {
    pub publish_safe: bool,
    pub blockers: Vec<String>,
    pub warnings: Vec<String>,
    pub stats: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NyraDecision {
    pub publish_safe: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OpenAIRefinementRequest {
    pub segment_id: String,
    pub reason: String,
    pub source_text: String,
    pub current_target: Option<String>,
}

pub fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn sha256_hex(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn stable_id(
    namespace: &str,
    source_path: &str,
    key: &str,
    span: &Span,
    normalized_text: &str,
) -> String {
    sha256_hex(&format!(
        "{namespace}|{source_path}|{key}|{}|{}|{normalized_text}",
        span.start, span.end
    ))
}

pub fn semantic_id(namespace: &str, key: &str, normalized_text: &str, category: Category) -> String {
    sha256_hex(&format!("{namespace}|{key}|{normalized_text}|{category:?}"))
}

pub fn extract_placeholders(text: &str) -> BTreeSet<Placeholder> {
    let pattern = Regex::new(
        r"(?x)
        \{\{[^}]+\}\}|
        \{[a-zA-Z0-9_.]+\}|
        %\([a-zA-Z0-9_]+\)[sdif]|
        %[sdif]|
        %\.\d+f|
        :[a-zA-Z_][a-zA-Z0-9_]*|
        \$\{[^}]+\}|
        \$[a-zA-Z_][a-zA-Z0-9_]*|
        <(?:b|strong|em|i|a)(?:\s+[^>]*)?>|
        </(?:b|strong|em|i|a)>|
        \[[^\]]+\]\([^)]+\)
        ",
    )
    .expect("placeholder regex must compile");

    pattern
        .find_iter(text)
        .map(|found| Placeholder {
            raw: found.as_str().to_string(),
            kind: classify_placeholder(found.as_str()).to_string(),
        })
        .collect()
}

fn classify_placeholder(raw: &str) -> &'static str {
    if raw.starts_with("${") {
        "template_literal"
    } else if raw.starts_with("{{") {
        "mustache"
    } else if raw.starts_with('{') {
        "brace"
    } else if raw.starts_with('%') {
        "printf"
    } else if raw.starts_with(':') || raw.starts_with('$') {
        "variable"
    } else if raw.starts_with('<') {
        "inline_html"
    } else {
        "markdown_link"
    }
}

pub fn validate_placeholders(source: &str, translated: &str) -> PlaceholderValidationResult {
    let source_set = extract_placeholders(source);
    let translated_set = extract_placeholders(translated);
    let missing = source_set
        .difference(&translated_set)
        .cloned()
        .collect::<Vec<_>>();
    let invented = translated_set
        .difference(&source_set)
        .cloned()
        .collect::<Vec<_>>();
    PlaceholderValidationResult {
        valid: missing.is_empty() && invented.is_empty(),
        missing,
        invented,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholders_are_extracted_and_validated() {
        let placeholders = extract_placeholders("Ciao {name}, hai %d crediti e ${value}");
        assert_eq!(placeholders.len(), 3);
        let valid = validate_placeholders("Ciao {name}", "Hello {name}");
        assert!(valid.valid);
        let invalid = validate_placeholders("Ciao {name}", "Hello");
        assert!(!invalid.valid);
    }

    #[test]
    fn stable_ids_are_stable() {
        let span = Span { start: 1, end: 5 };
        assert_eq!(
            stable_id("n", "a", "k", &span, "text"),
            stable_id("n", "a", "k", &span, "text")
        );
    }
}
